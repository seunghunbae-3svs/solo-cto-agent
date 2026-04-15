const { loadProjectConfig } = require('../lib/project-config');
const { checkRepoHealth } = require('../lib/repo-health-checker');

const TOKEN = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.BOOTSTRAP_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
const OWNER = process.env.GITHUB_OWNER || '{{GITHUB_OWNER}}';
const ORCH_REPO = process.env.ORCH_REPO || '{{ORCHESTRATOR_REPO}}';
const LOCALE = (process.env.BOOTSTRAP_LOCALE || 'en').startsWith('ko') ? 'ko' : 'en';
const MAX_REVIEWED_PRS = parseInt(process.env.BOOTSTRAP_MAX_PRS || '3', 10);

function L(en, ko) {
  return LOCALE === 'ko' ? ko : en;
}

function truncate(text, max = 240) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function extractJsonPayload(rawText) {
  const value = String(rawText || '').trim();
  if (!value) throw new Error('Empty model response');

  const fenceMatch = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : value;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to object extraction.
  }

  const start = candidate.indexOf('{');
  if (start === -1) {
    throw new Error(`No JSON object found in model response: ${truncate(candidate, 160)}`);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = candidate.slice(start, index + 1);
        try {
          return JSON.parse(slice);
        } catch (error) {
          throw new Error(`Invalid JSON payload from model: ${truncate(slice, 160)} (${error.message})`);
        }
      }
    }
  }

  throw new Error(`Incomplete JSON object in model response: ${truncate(candidate, 160)}`);
}

async function gh(endpoint, method = 'GET', body = null, extraHeaders = {}) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'solo-cto-agent-bootstrap-review',
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getRepoVariable(name) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${ORCH_REPO}/actions/variables/${name}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'solo-cto-agent-bootstrap-review',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function setRepoVariable(name, value) {
  const existing = await getRepoVariable(name);
  const payload = { name, value };
  const endpoint = existing
    ? `/repos/${OWNER}/${ORCH_REPO}/actions/variables/${name}`
    : `/repos/${OWNER}/${ORCH_REPO}/actions/variables`;
  const method = existing ? 'PATCH' : 'POST';
  await gh(endpoint, method, payload);
}

async function sendTelegram(text, replyMarkup = null) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('Telegram secrets not configured. Skipping Telegram summary.');
    return;
  }
  const payload = {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

async function sendPreviewPhoto(previewUrl, caption) {
  if (!BOT_TOKEN || !CHAT_ID || !previewUrl) return;
  const imageUrl = `https://image.thum.io/get/width/1200/${encodeURIComponent(previewUrl)}`;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      photo: imageUrl,
      caption,
      disable_notification: true,
    }),
  }).catch(() => {});
}

async function fetchOpenPulls(project) {
  return gh(`/repos/${OWNER}/${project.repo}/pulls?state=open&per_page=5`);
}

async function fetchDiff(project, prNumber) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${project.repo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.v3.diff',
      'User-Agent': 'solo-cto-agent-bootstrap-review',
    },
  });
  if (!res.ok) throw new Error(`GitHub diff ${res.status}: ${await res.text()}`);
  return res.text();
}

async function findPreviewUrl(project, pr) {
  const urls = String(pr.body || '').match(/https?:\/\/\S+/g) || [];
  const preview = urls.find((url) => /vercel\.app|preview/i.test(url));
  if (preview) return preview;

  if (!pr.head?.sha) return null;
  try {
    const deployments = await gh(`/repos/${OWNER}/${project.repo}/deployments?sha=${pr.head.sha}&per_page=5`);
    for (const deployment of deployments) {
      const statuses = await gh(`/repos/${OWNER}/${project.repo}/deployments/${deployment.id}/statuses`);
      const success = statuses.find((status) => status.state === 'success');
      if (success) return success.environment_url || success.target_url || null;
    }
  } catch {
    return null;
  }
  return null;
}

async function claudeReview(project, pr, diff, previewUrl) {
  if (!ANTHROPIC_API_KEY) return null;
  const prompt = [
    'You are the first baseline reviewer in a codex-main onboarding flow.',
    'Review the PR for correctness, regression risk, missing tests, and rollout safety.',
    'Return JSON only with this schema:',
    '{"verdict":"APPROVE|REVISE|HOLD","summary":"...","blockers":["..."],"suggestions":["..."],"nextAction":"..."}',
    '',
    `Repo: ${OWNER}/${project.repo}`,
    `PR: #${pr.number} ${pr.title}`,
    `Preview: ${previewUrl || 'none'}`,
    '',
    'DIFF:',
    diff.slice(0, 12000),
  ].join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJsonPayload(data.content[0].text);
}

async function openAiReview(project, pr, diff, previewUrl) {
  if (!OPENAI_API_KEY) return null;
  const prompt = [
    'You are the second baseline reviewer in a codex-main onboarding flow.',
    'Review the PR for correctness, regression risk, missing tests, and rollout safety.',
    'Return JSON only with this schema:',
    '{"verdict":"APPROVE|REVISE|HOLD","summary":"...","blockers":["..."],"suggestions":["..."],"nextAction":"..."}',
    '',
    `Repo: ${OWNER}/${project.repo}`,
    `PR: #${pr.number} ${pr.title}`,
    `Preview: ${previewUrl || 'none'}`,
    '',
    'DIFF:',
    diff.slice(0, 12000),
  ].join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return extractJsonPayload(data.choices[0].message.content);
}

function combineReviews(claude, codex) {
  if (!claude && !codex) return null;
  const verdicts = [claude?.verdict, codex?.verdict].filter(Boolean);
  const blockers = [...(claude?.blockers || []), ...(codex?.blockers || [])].filter(Boolean);
  const suggestions = [...(claude?.suggestions || []), ...(codex?.suggestions || [])].filter(Boolean);
  const verdict = blockers.length || verdicts.includes('REVISE')
    ? 'REVISE'
    : verdicts.every((value) => value === 'APPROVE')
      ? 'APPROVE'
      : 'HOLD';
  return {
    verdict,
    blockers: [...new Set(blockers)].slice(0, 4),
    suggestions: [...new Set(suggestions)].slice(0, 4),
    summary: truncate(claude?.summary || codex?.summary || L('Baseline review completed.', '기준선 리뷰가 완료되었습니다.')),
    nextAction: truncate(claude?.nextAction || codex?.nextAction || L('Open the PR and decide.', 'PR을 열고 결정을 내려주세요.')),
  };
}

async function postReviewComment(project, prNumber, review, claude, codex, previewUrl) {
  const lines = [
    '## Baseline Review (codex-main setup)',
    '',
    `- Final verdict: **${review.verdict}**`,
    `- Summary: ${review.summary}`,
    previewUrl ? `- Preview: ${previewUrl}` : '- Preview: pending',
    '',
  ];
  if (claude) {
    lines.push(`### Claude`);
    lines.push(`- Verdict: ${claude.verdict}`);
    lines.push(`- Summary: ${claude.summary}`);
    for (const blocker of claude.blockers || []) lines.push(`- Blocker: ${blocker}`);
    for (const suggestion of claude.suggestions || []) lines.push(`- Suggestion: ${suggestion}`);
    lines.push('');
  }
  if (codex) {
    lines.push(`### Codex`);
    lines.push(`- Verdict: ${codex.verdict}`);
    lines.push(`- Summary: ${codex.summary}`);
    for (const blocker of codex.blockers || []) lines.push(`- Blocker: ${blocker}`);
    for (const suggestion of codex.suggestions || []) lines.push(`- Suggestion: ${suggestion}`);
    lines.push('');
  }
  lines.push(`- Next action: ${review.nextAction}`);
  lines.push('');
  lines.push('<!-- bootstrap-review:codex-main -->');

  await gh(`/repos/${OWNER}/${project.repo}/issues/${prNumber}/comments`, 'POST', { body: lines.join('\n') });
}

function buildDecisionKeyboard(project, prNumber, previewUrl, prUrl) {
  const rows = [];
  rows.push([{ text: `${project.repo} PR #${prNumber}`, url: prUrl }]);
  if (previewUrl) rows.push([{ text: 'Preview', url: previewUrl }]);
  rows.push([
    { text: 'Approve', callback_data: `DECISION|${project.repo}|${prNumber}|APPROVE` },
    { text: 'Revise', callback_data: `DECISION|${project.repo}|${prNumber}|REVISE` },
    { text: 'Hold', callback_data: `DECISION|${project.repo}|${prNumber}|HOLD` },
  ]);
  return { inline_keyboard: rows };
}

function buildRepoHealthLine(project, health) {
  if (health?.skipped) {
    return `- ${project.repo}: ${L('deployment health unavailable', '배포 상태 데이터 없음')}`;
  }
  if (health?.healthy === false) {
    return `- ${project.repo}: ${L('deployment issue detected', '배포 이상 감지')} (${truncate(health.lastError, 80)})`;
  }
  return `- ${project.repo}: ${L('deployment healthy', '배포 정상')}`;
}

async function main() {
  if (!TOKEN) throw new Error('Missing GitHub token');

  const config = loadProjectConfig({ owner: OWNER, orchestratorRepo: ORCH_REPO });
  if (!config.products.length) {
    console.log('No product repos configured.');
    return;
  }

  const reviewLimit = Number.isFinite(MAX_REVIEWED_PRS) && MAX_REVIEWED_PRS > 0 ? MAX_REVIEWED_PRS : 3;
  let reviewedCount = 0;
  const repoLines = [];
  const prSummaries = [];

  for (const project of config.products) {
    const health = await checkRepoHealth(OWNER, project.repo, TOKEN);
    repoLines.push(buildRepoHealthLine(project, health));

    const prs = await fetchOpenPulls(project);
    if (!prs.length) {
      prSummaries.push(`- ${project.repo}: ${L('no open PRs', '열린 PR 없음')}`);
      continue;
    }

    for (const pr of prs) {
      if (reviewedCount >= reviewLimit) break;
      reviewedCount += 1;
      const previewUrl = await findPreviewUrl(project, pr);
      const diff = await fetchDiff(project, pr.number);

      let claude = null;
      let codex = null;
      try {
        claude = await claudeReview(project, pr, diff, previewUrl);
      } catch (error) {
        prSummaries.push(`- ${project.repo} PR #${pr.number}: Claude review failed (${truncate(error.message, 80)})`);
      }
      try {
        codex = await openAiReview(project, pr, diff, previewUrl);
      } catch (error) {
        prSummaries.push(`- ${project.repo} PR #${pr.number}: Codex review failed (${truncate(error.message, 80)})`);
      }

      const combined = combineReviews(claude, codex);
      if (!combined) {
        prSummaries.push(`- ${project.repo} PR #${pr.number}: ${L('open PR found, but AI keys are not configured yet.', '열린 PR은 있으나 AI 키가 아직 설정되지 않았습니다.')}`);
        continue;
      }

      await postReviewComment(project, pr.number, combined, claude, codex, previewUrl);
      prSummaries.push(`- ${project.repo} PR #${pr.number}: ${combined.verdict} · ${combined.summary}`);
      await sendPreviewPhoto(previewUrl, `${project.repo} PR #${pr.number} preview`);
      await sendTelegram(
        [
          `🔎 <b>${project.repo}</b> PR #${pr.number}`,
          `${L('Baseline review finished.', '기준선 리뷰가 완료되었습니다.')}`,
          `Verdict: ${combined.verdict}`,
          `Summary: ${combined.summary}`,
          combined.blockers.length ? `Blockers: ${combined.blockers.map((item) => truncate(item, 90)).join(' | ')}` : `Blockers: ${L('none', '없음')}`,
          `Next: ${combined.nextAction}`,
          previewUrl ? `Preview: ${previewUrl}` : `Preview: ${L('pending', '준비 중')}`,
          pr.html_url,
        ].join('\n'),
        buildDecisionKeyboard(project, pr.number, previewUrl, pr.html_url),
      );
    }
  }

  const summary = [
    `<b>${L('Baseline review summary', '기준선 리뷰 요약')}</b>`,
    '',
    ...repoLines,
    '',
    `<b>${L('PR results', 'PR 결과')}</b>`,
    ...(prSummaries.length ? prSummaries : [`- ${L('No open PRs were found.', '열린 PR이 없습니다.')}`]),
  ].join('\n');

  console.log(summary.replace(/<[^>]+>/g, ''));
  await sendTelegram(summary);
  await setRepoVariable(config.onboarding?.bootstrapVariable || 'SOLO_CTO_BOOTSTRAP_LAST_RUN_AT', new Date().toISOString());
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  combineReviews,
  buildRepoHealthLine,
  extractJsonPayload,
};
