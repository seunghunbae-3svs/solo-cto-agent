// cross-reviewer.js — Multi-turn agent debate for PR review.
//
// Replaces the single-pass critique with a bounded A/B consensus loop:
//   R1: Agent A proposes a classified issue list.
//   R2: Agent B agrees/disagrees/adds per item.
//   R3: Agent A renders a final verdict on unresolved items (only if needed).
//
// Who is A vs B is decided by the PR's head branch:
//   claude/* → A=Codex (OpenAI), B=Claude (Anthropic)   [cross-check a claude PR]
//   codex/*  → A=Claude, B=Codex
//
// Early termination rules:
//   - Zero BLOCKERs in R1              → APPROVE, stop after R1.
//   - Zero DISAGREE + zero ADD_MORE R2 → stop after R2 with A's list.
//   - After R3 still diverging         → emit [non-consensus] flag, dispatch
//                                        rework with reason=non-consensus-blocker.
//
// Fallbacks:
//   - Only one of OPENAI_API_KEY / ANTHROPIC_API_KEY set → single-pass mode
//     with a [single-agent-fallback] note (preserves previous behaviour).
//
// Output: one PR comment with machine tag <!-- cross-reviewer:consensus -->.
// C-A rework auto-dispatch on blocker is preserved.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PR_NUMBER = process.env.PR_NUMBER;
const PR_REPO = process.env.PR_REPO;
const PR_TITLE = process.env.PR_TITLE;

const MAX_ROUNDS = 3;
const MAX_TOKENS_PER_ROUND = 2000;
const OPENAI_MODEL = 'gpt-4o-mini';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function gh(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'BDA-Cross-Reviewer',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function telegram(text) {
  // Notifications are optional. Missing creds must never break a review run.
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
  } catch (_) {
    // swallow — telegram must not block the review loop
  }
}

async function callOpenAI(messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.2,
      max_tokens: MAX_TOKENS_PER_ROUND,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function callAnthropic(systemPrompt, userPrompt) {
  // We use @anthropic-ai/sdk so this file stays small and the SDK handles
  // retries / API shape changes. require is lazy so the SDK is only needed
  // when the Anthropic branch actually runs.
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS_PER_ROUND,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  // messages API returns content blocks; grab the joined text.
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// Dispatcher by agent identity. Kept small so the debate loop below only
// cares about "agent A" / "agent B" and never which SDK is underneath.
async function callAgent(agent, systemPrompt, userPrompt) {
  if (agent === 'openai') {
    return callOpenAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);
  }
  if (agent === 'anthropic') {
    return callAnthropic(systemPrompt, userPrompt);
  }
  throw new Error(`Unknown agent: ${agent}`);
}

// ---------------------------------------------------------------------------
// Pure parsing / decision logic (unit-testable, no network)
// ---------------------------------------------------------------------------

/**
 * Parse an Agent A Round 1 response into a list of issue items.
 * Expected format per item (LLM output):
 *   [BLOCKER|SUGGESTION|NIT] [HIGH|MED|LOW] <text>
 * We also accept bullet prefixes ("-", "*", "1.") and square brackets missing.
 */
function parseIssueList(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const items = [];
  const kindRe = /\b(BLOCKER|SUGGESTION|NIT)\b/i;
  const confRe = /\b(HIGH|MED(IUM)?|LOW)\b/i;

  for (const raw of lines) {
    const line = raw.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim();
    if (!line) continue;
    const kindMatch = line.match(kindRe);
    if (!kindMatch) continue;
    const confMatch = line.match(confRe);
    // Strip the classification tokens from the body to get the description.
    let body = line
      .replace(/\[(BLOCKER|SUGGESTION|NIT)\]/ig, '')
      .replace(/\[(HIGH|MED(IUM)?|LOW)\]/ig, '')
      .replace(kindRe, '')
      .replace(confRe, '')
      .replace(/^[\s:\-—]+/, '')
      .trim();
    if (!body) continue;
    items.push({
      kind: kindMatch[1].toUpperCase(),
      confidence: normalizeConfidence(confMatch ? confMatch[1] : 'MED'),
      text: body,
    });
  }
  return items;
}

function normalizeConfidence(raw) {
  const u = String(raw || '').toUpperCase();
  if (u.startsWith('HIGH')) return 'HIGH';
  if (u.startsWith('LOW')) return 'LOW';
  return 'MED';
}

/**
 * Parse an Agent B Round 2 response. Expected lines:
 *   #<n> AGREE
 *   #<n> DISAGREE — <why>
 *   ADD <BLOCKER|SUGGESTION|NIT> <HIGH|MED|LOW> — <text>
 * Returns { decisions: [{index, stance, note}], additions: [...issueItems] }.
 */
function parseReviewResponse(text) {
  const decisions = [];
  const additions = [];
  if (!text) return { decisions, additions };
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim();
    if (!line) continue;

    // #n AGREE/DISAGREE/ADD_MORE
    const idxMatch = line.match(/^#\s*(\d+)\s*[:\-—]?\s*(AGREE|DISAGREE|ADD_MORE)\b\s*[:\-—]?\s*(.*)$/i);
    if (idxMatch) {
      decisions.push({
        index: parseInt(idxMatch[1], 10) - 1, // 1-based → 0-based
        stance: idxMatch[2].toUpperCase(),
        note: (idxMatch[3] || '').trim(),
      });
      continue;
    }

    // ADD-style lines introduce a new item B thinks A missed.
    const addMatch = line.match(/^ADD(?:_MORE)?\s*[:\-—]?\s*(.*)$/i);
    if (addMatch) {
      const added = parseIssueList(addMatch[1]);
      if (added.length) additions.push(...added);
    }
  }
  return { decisions, additions };
}

/**
 * Decide whether we can stop after the current round and what the verdict is.
 * Pure function — drives the loop in main() and is exercised by unit tests.
 *
 * round === 1:
 *   - no issues at all            → stop, APPROVE
 *   - no BLOCKERs                 → stop, COMMENT (approve-with-nits path)
 *   - otherwise                   → continue to round 2
 * round === 2:
 *   - zero DISAGREE, zero ADD     → stop, verdict from merged list
 *   - otherwise                   → continue to round 3
 * round === 3: always stop.
 */
function decideNextRound({ round, issues, review }) {
  if (round === 1) {
    if (!issues || issues.length === 0) {
      return { stop: true, verdict: 'APPROVE', reason: 'no-issues' };
    }
    const hasBlocker = issues.some((i) => i.kind === 'BLOCKER');
    if (!hasBlocker) {
      return { stop: true, verdict: 'COMMENT', reason: 'no-blocker' };
    }
    return { stop: false };
  }
  if (round === 2) {
    const hasDisagree = review.decisions.some((d) => d.stance === 'DISAGREE');
    const hasAdds = review.additions.length > 0;
    if (!hasDisagree && !hasAdds) {
      return { stop: true, verdict: null, reason: 'consensus' };
    }
    return { stop: false };
  }
  return { stop: true, verdict: null, reason: 'max-rounds' };
}

/**
 * Merge A's original issues with B's decisions + additions into the final
 * consensus view. Items B AGREEs with survive; DISAGREEd items drop from the
 * blocker list but stay in suggestions with a "disputed" marker; ADDed items
 * are appended. After round 3, A's final verdict overrides disputed items.
 */
function mergeConsensus(issuesA, reviewB, finalRoundA = null) {
  const consensus = issuesA.map((item, idx) => {
    const decision = reviewB.decisions.find((d) => d.index === idx);
    const stance = decision ? decision.stance : 'AGREE'; // unlabeled → implicit agree
    return { ...item, stance, bNote: decision ? decision.note : '' };
  });
  for (const add of reviewB.additions) {
    consensus.push({ ...add, stance: 'ADD_MORE', bNote: '(B가 추가)' });
  }
  // Apply Agent A's Round 3 final verdicts if present — they supersede B.
  if (finalRoundA && Array.isArray(finalRoundA.decisions)) {
    for (const verdict of finalRoundA.decisions) {
      if (verdict.index >= 0 && verdict.index < consensus.length) {
        consensus[verdict.index].finalVerdict = verdict.stance; // KEEP / DROP / DOWNGRADE
      }
    }
  }
  return consensus;
}

/**
 * Classify an item in the final consensus view as either a confirmed blocker,
 * a suggestion, or an unresolved disagreement. Used to build PR comment sections
 * and to drive the rework auto-dispatch.
 */
function classifyConsensus(consensus) {
  const blockers = [];
  const suggestions = [];
  const disagreements = [];

  for (const item of consensus) {
    if (item.finalVerdict === 'DROP') {
      suggestions.push({ ...item, demoted: true });
      continue;
    }
    if (item.kind === 'BLOCKER') {
      if (item.stance === 'AGREE' || item.finalVerdict === 'KEEP') {
        blockers.push(item);
      } else if (item.stance === 'DISAGREE' && !item.finalVerdict) {
        disagreements.push(item);
      } else if (item.stance === 'ADD_MORE') {
        blockers.push(item);
      } else {
        // Implicit agreement when unlabeled.
        blockers.push(item);
      }
    } else {
      suggestions.push(item);
    }
  }
  return { blockers, suggestions, disagreements };
}

function finalVerdictFrom(classified, nonConsensus) {
  if (nonConsensus && classified.disagreements.length > 0) return 'REQUEST_CHANGES';
  if (classified.blockers.length > 0) return 'REQUEST_CHANGES';
  if (classified.suggestions.length > 0) return 'COMMENT';
  return 'APPROVE';
}

// ---------------------------------------------------------------------------
// Prompt builders (English for LLM clarity; PR comment below is Korean)
// ---------------------------------------------------------------------------

function systemPromptRound1(agentName) {
  return `You are ${agentName}, performing a rigorous code review for a PR
opened by the other AI agent. Focus on real defects, not style. For every
issue you flag, output ONE line in this EXACT format:

[KIND] [CONFIDENCE] <one-line description with file/function hint if possible>

KIND ∈ {BLOCKER, SUGGESTION, NIT}. CONFIDENCE ∈ {HIGH, MED, LOW}.
BLOCKER = must fix before merge (regression, security, broken contract).
SUGGESTION = real improvement, not merge-blocking.
NIT = style / naming / doc tweaks.

Order items BLOCKER → SUGGESTION → NIT. Do not write prose outside this list.
If you find nothing, output exactly: NONE`;
}

function userPromptRound1({ prTitle, prBody, diff }) {
  return `PR TITLE: ${prTitle}
PR BODY: ${prBody || '(none)'}

DIFF (truncated to 8000 chars):
${diff.substring(0, 8000)}

Review for: requirement mismatch, regression risk, missing tests, edge cases,
security issues, rollback risk, UI/UX quality (layout/a11y/interaction).
Output the issue list per the format above.`;
}

function systemPromptRound2(agentName) {
  return `You are ${agentName}, performing a counter-review. Another AI
agent produced the issue list below. For EACH numbered item answer on ONE
line in this exact format:

#<n> AGREE
#<n> DISAGREE — <why you think it's wrong or not a real blocker>

Then, if you spotted issues they missed, add lines:

ADD [KIND] [CONFIDENCE] <description>

KIND ∈ {BLOCKER, SUGGESTION, NIT}. CONFIDENCE ∈ {HIGH, MED, LOW}.
Do not restate AGREE items with commentary. Be terse.`;
}

function userPromptRound2({ prTitle, diff, issuesA }) {
  const numbered = issuesA
    .map((it, i) => `#${i + 1} [${it.kind}] [${it.confidence}] ${it.text}`)
    .join('\n');
  return `PR TITLE: ${prTitle}

DIFF (truncated):
${diff.substring(0, 8000)}

AGENT A's ISSUE LIST:
${numbered}

Respond per the format in your system prompt.`;
}

function systemPromptRound3(agentName) {
  return `You are ${agentName}. The counter-reviewer disagreed on some of
your items. For each disputed item, output ONE line:

#<n> KEEP — <one-sentence justification>
#<n> DROP — <one-sentence concession>
#<n> DOWNGRADE — <new KIND, e.g. SUGGESTION, and why>

Only address the numbered items listed as DISPUTED below. Be decisive.`;
}

function userPromptRound3({ prTitle, issuesA, disputed }) {
  const numbered = issuesA
    .map((it, i) => `#${i + 1} [${it.kind}] ${it.text}`)
    .join('\n');
  const disputedList = disputed
    .map((d) => `#${d.index + 1} — B says: ${d.note || '(no reason given)'}`)
    .join('\n');
  return `PR TITLE: ${prTitle}

YOUR ORIGINAL ISSUES:
${numbered}

DISPUTED:
${disputedList}

Render final verdict per the format.`;
}

// ---------------------------------------------------------------------------
// PR comment builder (Korean, matches existing template style)
// ---------------------------------------------------------------------------

function buildComment({
  roundCount,
  classified,
  nonConsensus,
  singleAgentFallback,
  agentA,
  agentB,
  verdict,
  rawTranscript,
}) {
  const flags = [];
  if (nonConsensus) flags.push('[non-consensus]');
  if (singleAgentFallback) flags.push('[single-agent-fallback]');
  const flagLine = flags.length ? `\n\n${flags.join(' ')}` : '';

  const blockerSection = classified.blockers.length
    ? classified.blockers
        .map((b, i) => `${i + 1}. ${b.text}${b.stance === 'ADD_MORE' ? ' _(B 제안)_' : ''}`)
        .join('\n')
    : '_없음_';

  const suggSection = classified.suggestions.length
    ? classified.suggestions
        .map((s, i) => `${i + 1}. [${s.kind}] ${s.text}${s.demoted ? ' _(강등됨)_' : ''}`)
        .join('\n')
    : '_없음_';

  const disagreeSection = classified.disagreements.length
    ? classified.disagreements
        .map((d, i) => `${i + 1}. ${d.text}\n   - B 의견: ${d.bNote || '(미기재)'}`)
        .join('\n')
    : null;

  const roleLine = singleAgentFallback
    ? `_단독 리뷰 모드_ (Agent A = ${agentA})`
    : `Agent A = ${agentA} · Agent B = ${agentB}`;

  const disagreeBlock = disagreeSection
    ? `\n\n### 미해결 이견 ${classified.disagreements.length}건\n${disagreeSection}`
    : '';

  return [
    `## 🔍 Consensus Review (${roundCount} round${roundCount > 1 ? 's' : ''})`,
    roleLine,
    `Verdict: **${verdict}**${flagLine}`,
    '',
    `### BLOCKERS — ${classified.blockers.length}건 (합의)`,
    blockerSection,
    '',
    '### Suggestions / Nits',
    suggSection,
    disagreeBlock,
    '',
    '<details><summary>원본 라운드별 응답</summary>\n\n' +
      '```\n' +
      rawTranscript +
      '\n```\n</details>',
    '',
    '<!-- cross-reviewer:consensus -->',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function runConsensusLoop({
  agentA,
  agentB,
  agentAName,
  agentBName,
  prTitle,
  prBody,
  diff,
}) {
  const transcript = [];

  // ---------- Round 1 ----------
  const r1Raw = await callAgent(
    agentA,
    systemPromptRound1(agentAName),
    userPromptRound1({ prTitle, prBody, diff })
  );
  transcript.push(`=== Round 1 (${agentAName}) ===\n${r1Raw}`);
  const issuesA = parseIssueList(r1Raw);

  const d1 = decideNextRound({ round: 1, issues: issuesA });
  if (d1.stop) {
    const classified = classifyConsensus(issuesA.map((i) => ({ ...i, stance: 'AGREE' })));
    return {
      roundCount: 1,
      classified,
      nonConsensus: false,
      verdict: d1.verdict,
      transcript: transcript.join('\n\n'),
    };
  }

  // ---------- Round 2 ----------
  const r2Raw = await callAgent(
    agentB,
    systemPromptRound2(agentBName),
    userPromptRound2({ prTitle, diff, issuesA })
  );
  transcript.push(`=== Round 2 (${agentBName}) ===\n${r2Raw}`);
  const reviewB = parseReviewResponse(r2Raw);

  const d2 = decideNextRound({ round: 2, review: reviewB });
  if (d2.stop) {
    const consensus = mergeConsensus(issuesA, reviewB);
    const classified = classifyConsensus(consensus);
    return {
      roundCount: 2,
      classified,
      nonConsensus: false,
      verdict: finalVerdictFrom(classified, false),
      transcript: transcript.join('\n\n'),
    };
  }

  // ---------- Round 3 ----------
  const disputed = reviewB.decisions.filter((d) => d.stance === 'DISAGREE');
  const r3Raw = await callAgent(
    agentA,
    systemPromptRound3(agentAName),
    userPromptRound3({ prTitle, issuesA, disputed })
  );
  transcript.push(`=== Round 3 (${agentAName}, final) ===\n${r3Raw}`);

  // Round 3 reuses the "#n STANCE — note" format; stance ∈ {KEEP, DROP, DOWNGRADE}.
  const finalA = parseReviewResponse(r3Raw);
  // Coerce the stance vocabulary so mergeConsensus can apply it via finalVerdict.
  finalA.decisions = finalA.decisions.map((d) => ({
    ...d,
    stance: ['KEEP', 'DROP', 'DOWNGRADE'].includes(d.stance) ? d.stance : 'KEEP',
  }));

  const consensus = mergeConsensus(issuesA, reviewB, finalA);
  const classified = classifyConsensus(consensus);

  // After round 3, any still-unresolved DISAGREE (neither KEEP nor DROP from A)
  // means genuine non-consensus — this is the failure mode that dispatches
  // rework with reason=non-consensus-blocker.
  const nonConsensus = classified.disagreements.length > 0;
  return {
    roundCount: 3,
    classified,
    nonConsensus,
    verdict: finalVerdictFrom(classified, nonConsensus),
    transcript: transcript.join('\n\n'),
  };
}

async function runSingleAgent({ agentA, agentAName, prTitle, prBody, diff }) {
  // Fallback path when only one SDK key is available. Produces the same shape
  // as the consensus loop so the PR comment / verdict code is unified.
  const raw = await callAgent(
    agentA,
    systemPromptRound1(agentAName),
    userPromptRound1({ prTitle, prBody, diff })
  );
  const issuesA = parseIssueList(raw);
  const consensus = issuesA.map((i) => ({ ...i, stance: 'AGREE' }));
  const classified = classifyConsensus(consensus);
  return {
    roundCount: 1,
    classified,
    nonConsensus: false,
    verdict: finalVerdictFrom(classified, false),
    transcript: `=== Single-agent (${agentAName}) ===\n${raw}`,
  };
}

async function main() {
  // Fetch diff + PR metadata in parallel.
  const [diff, pr] = await Promise.all([
    fetch(`https://api.github.com/repos/${PR_REPO}/pulls/${PR_NUMBER}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3.diff',
        'User-Agent': 'BDA-Cross-Reviewer',
      },
    }).then((r) => r.text()),
    gh(`/repos/${PR_REPO}/pulls/${PR_NUMBER}`),
  ]);

  // Assign A/B by branch convention.
  // claude/* PR → A=openai (Codex), B=anthropic (Claude)
  // codex/*  PR → A=anthropic (Claude), B=openai (Codex)
  const branch = (pr.head.ref || '').toLowerCase();
  const isCodexBranch = branch.includes('codex');
  const agentA = isCodexBranch ? 'anthropic' : 'openai';
  const agentB = isCodexBranch ? 'openai' : 'anthropic';
  const agentAName = isCodexBranch ? 'Claude' : 'Codex';
  const agentBName = isCodexBranch ? 'Codex' : 'Claude';

  const hasOpenAI = !!OPENAI_API_KEY;
  const hasAnthropic = !!ANTHROPIC_API_KEY;
  let singleAgentFallback = false;
  let effectiveAgentA = agentA;
  let effectiveAgentAName = agentAName;
  if (!hasOpenAI && !hasAnthropic) {
    throw new Error('No LLM API key configured (need OPENAI_API_KEY and/or ANTHROPIC_API_KEY)');
  }
  if (!hasOpenAI || !hasAnthropic) {
    singleAgentFallback = true;
    // Use whichever agent's key we have as the sole reviewer.
    if (!hasOpenAI) {
      effectiveAgentA = 'anthropic';
      effectiveAgentAName = 'Claude';
    } else {
      effectiveAgentA = 'openai';
      effectiveAgentAName = 'Codex';
    }
  }

  await telegram(
    `🔍 교차 리뷰 시작\n\n${PR_REPO} PR #${PR_NUMBER}\n브랜치: ${pr.head.ref}\n` +
      `모드: ${singleAgentFallback ? `단독(${effectiveAgentAName})` : `합의(${agentAName}↔${agentBName})`}`
  );

  const result = singleAgentFallback
    ? await runSingleAgent({
        agentA: effectiveAgentA,
        agentAName: effectiveAgentAName,
        prTitle: PR_TITLE,
        prBody: pr.body || '',
        diff,
      })
    : await runConsensusLoop({
        agentA,
        agentB,
        agentAName,
        agentBName,
        prTitle: PR_TITLE,
        prBody: pr.body || '',
        diff,
      });

  const commentBody = buildComment({
    roundCount: result.roundCount,
    classified: result.classified,
    nonConsensus: result.nonConsensus,
    singleAgentFallback,
    agentA: agentAName,
    agentB: agentBName,
    verdict: result.verdict,
    rawTranscript: result.transcript,
  });

  await gh(`/repos/${PR_REPO}/issues/${PR_NUMBER}/comments`, 'POST', { body: commentBody });

  // One-message Telegram summary.
  const verdictIcon =
    result.verdict === 'APPROVE' ? '✅' : result.verdict === 'REQUEST_CHANGES' ? '❌' : '💬';
  await telegram(
    `${verdictIcon} 교차 리뷰 완료\n\n${PR_REPO} PR #${PR_NUMBER}\n` +
      `Rounds: ${result.roundCount}\n` +
      `Blockers(합의): ${result.classified.blockers.length}\n` +
      (result.nonConsensus ? `⚠️ 미해결 이견: ${result.classified.disagreements.length}건\n` : '') +
      `Verdict: ${result.verdict}\n\n${pr.html_url}`
  );

  // ---------- C-A auto-rework dispatch (preserved behaviour) ----------
  // Trigger rework if: consensus blockers exist, OR after 3 rounds we still
  // have unresolved disagreements (non-consensus case should still get a
  // rework attempt with a distinguishable reason so the orchestrator can
  // tune its policy).
  const autoReworkDisabled = (process.env.DISABLE_AUTO_REWORK || '').toLowerCase() === 'true';
  const hasBlocker = result.classified.blockers.length > 0;
  const needsRework = hasBlocker || result.nonConsensus;
  const reason = result.nonConsensus ? 'non-consensus-blocker' : 'cross-review-blocker';

  if (needsRework && !autoReworkDisabled) {
    const target = process.env.GITHUB_REPOSITORY;
    try {
      await gh(`/repos/${target}/dispatches`, 'POST', {
        event_type: 'rework-request',
        client_payload: {
          repo: PR_REPO,
          pr: PR_NUMBER,
          branch: pr.head.ref,
          title: PR_TITLE,
          url: pr.html_url,
          reason,
        },
      });
      console.log(`Dispatched rework-request (${reason})`);
      await telegram(
        `🔧 자동 rework 디스패치됨\n\n${PR_REPO} PR #${PR_NUMBER}\nReason: ${reason}`
      );
    } catch (err) {
      console.error('Failed to dispatch rework:', err.message);
      await telegram(`⚠️ rework 디스패치 실패: ${err.message}`).catch(() => {});
    }
  }
}

// Export the pure helpers for unit tests. main() is only called when run
// directly as a CLI (node ops/agents/cross-reviewer.js under the workflow).
module.exports = {
  parseIssueList,
  parseReviewResponse,
  decideNextRound,
  mergeConsensus,
  classifyConsensus,
  finalVerdictFrom,
  normalizeConfidence,
  buildComment,
};

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    await telegram(`❌ 교차 리뷰 실패: ${err.message}`).catch(() => {});
    process.exit(1);
  });
}
