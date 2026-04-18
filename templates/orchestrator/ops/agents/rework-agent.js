const { Octokit } = require('@octokit/rest');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const https = require('https');
const fs = require('fs');
const { recordFailure, recordSuccess, isBlocked } = require('../lib/circuit-breaker');

const gh = new Octokit({ auth: process.env.GH_PAT });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// PR-action inline keyboard — duplicated from bin/lib/telegram-commands.js
// because this file runs in a workflow runtime without the shared module.
function prActionKeyboard(repo, prNumber) {
  if (!repo || !prNumber) return null;
  const prUrl = `https://github.com/${repo}/pull/${prNumber}`;
  return {
    inline_keyboard: [
      [{ text: 'Open PR', url: prUrl }],
      [
        { text: '✅ Approve', callback_data: `APPROVE|${repo}|${prNumber}` },
        { text: '❌ Reject', callback_data: `REJECT|${repo}|${prNumber}` },
      ],
      [
        { text: '🔧 Rework', callback_data: `REWORK|${repo}|${prNumber}` },
        { text: '🔀 Merge', callback_data: `MERGE|${repo}|${prNumber}` },
      ],
    ],
  };
}

function telegram(text, extra = null) {
  // Telegram is optional. Skip cleanly when creds aren't configured so the
  // rework path isn't blocked on missing notification setup.
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return;
  }
  const payload = { chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' };
  if (extra && typeof extra === 'object') Object.assign(payload, extra);
  const data = JSON.stringify(payload);
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
  });
  req.on('error', () => {}); // notification failure must not break rework
  req.write(data);
  req.end();
}

async function getReworkAgent() {
  const branch = process.env.PR_BRANCH.toLowerCase();
  return branch.includes('claude') ? 'claude' : branch.includes('codex') ? 'openai' : 'claude';
}

async function listReviews() {
  const [owner, repo] = process.env.PR_REPO.split('/');
  const response = await gh.pulls.listReviews({
    owner,
    repo,
    pull_number: parseInt(process.env.PR_NUMBER)
  });
  return response.data || [];
}

async function getReviewComments() {
  const [owner, repo] = process.env.PR_REPO.split('/');
  const reviews = await listReviews();

  let comments = [];
  for (const review of reviews) {
    if (review.state === 'COMMENTED' || review.state === 'CHANGES_REQUESTED') {
      const reviewComments = await gh.pulls.listCommentsForReview({
        owner,
        repo,
        pull_number: parseInt(process.env.PR_NUMBER),
        review_id: review.id
      });
      comments = comments.concat(reviewComments.data);
    }
  }
  // Include human feedback from issue comments (Telegram, etc.)
  try {
    const issueComments = await gh.issues.listComments({
      owner,
      repo,
      issue_number: parseInt(process.env.PR_NUMBER),
      per_page: 100
    });
    const feedback = issueComments.data.filter(c =>
      /\[human-feedback/i.test(c.body || '') || /telegram/i.test(c.body || '')
    );
    comments = comments.concat(
      feedback.map(c => ({ path: 'issue-comment', start_line: 0, body: c.body }))
    );
  } catch {}
  return comments;
}

async function getLatestReviewState() {
  const reviews = await listReviews();
  if (!reviews.length) return null;
  reviews.sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
  return reviews[0].state || null;
}

async function getRoundCount() {
  const [owner, repo] = process.env.PR_REPO.split('/');
  const issueComments = await gh.issues.listComments({
    owner,
    repo,
    issue_number: parseInt(process.env.PR_NUMBER),
    per_page: 100
  });
  const roundComments = issueComments.data.filter(c =>
    /\[rework-round\]/i.test(c.body || '')
  );
  return roundComments.length;
}

async function getChangedFiles() {
  const [owner, repo] = process.env.PR_REPO.split('/');
  const response = await gh.pulls.listFiles({
    owner,
    repo,
    pull_number: parseInt(process.env.PR_NUMBER)
  });
  return response.data;
}

async function getFileContent(path) {
  const [owner, repo] = process.env.PR_REPO.split('/');
  try {
    const response = await gh.repos.getContent({
      owner,
      repo,
      path,
      ref: process.env.PR_BRANCH
    });
    return Buffer.from(response.data.content, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Opt-in auto-merge.
 *
 * Only runs when the PR carries the 'auto-merge-when-ready' label. Uses
 * GitHub's native enablePullRequestAutoMerge mutation so the merge only
 * happens after every required check passes — we never bypass branch
 * protection or required reviews.
 *
 * Returns { enabled: bool, reason?: string }.
 */
async function tryEnableAutoMerge(owner, repo, prNumber) {
  try {
    const pr = await gh.pulls.get({ owner, repo, pull_number: prNumber });
    const labels = (pr.data.labels || []).map(l => l.name);
    if (!labels.includes('auto-merge-when-ready')) {
      return { enabled: false, reason: 'label-not-set' };
    }

    const mutation = `
      mutation($prId: ID!, $method: PullRequestMergeMethod!) {
        enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: $method }) {
          pullRequest { autoMergeRequest { enabledAt } }
        }
      }
    `;

    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GH_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: mutation,
        variables: { prId: pr.data.node_id, method: 'SQUASH' },
      }),
    });
    const data = await res.json();
    if (data.errors && data.errors.length) {
      return { enabled: false, reason: data.errors[0].message };
    }
    return { enabled: true };
  } catch (e) {
    return { enabled: false, reason: e.message };
  }
}

async function pushFiles(updates) {
  const [owner, repo] = process.env.PR_REPO.split('/');

  for (const { path, content } of updates) {
    try {
      const existing = await gh.repos.getContent({
        owner,
        repo,
        path,
        ref: process.env.PR_BRANCH
      });

      await gh.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `rework: fix issues from review`,
        content: Buffer.from(content).toString('base64'),
        sha: existing.data.sha,
        branch: process.env.PR_BRANCH
      });
    } catch {
      await gh.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `rework: fix issues from review`,
        content: Buffer.from(content).toString('base64'),
        branch: process.env.PR_BRANCH
      });
    }
  }
}

/**
 * Look up the current HEAD SHA of the PR branch. Called both before and
 * after pushFiles() so the visual-report stage can screenshot the exact
 * pre- and post-rework commits.
 */
async function getBranchHeadSha() {
  const [owner, repo] = process.env.PR_REPO.split('/');
  const ref = await gh.repos.getBranch({
    owner,
    repo,
    branch: process.env.PR_BRANCH,
  });
  return ref.data.commit.sha;
}

/**
 * Write a visual-report payload JSON to disk so the rework workflow
 * can upload it as an artifact for visual-report.yml to consume.
 * Only invoked on the happy path (rework pushed successfully).
 */
function writeVisualReportPayload({ prevSha, newSha }) {
  const out = process.env.VISUAL_REPORT_PAYLOAD_PATH;
  if (!out) return;
  try {
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          pr: parseInt(process.env.PR_NUMBER, 10),
          repo: process.env.PR_REPO,
          branch: process.env.PR_BRANCH,
          prevSha,
          newSha,
        },
        null,
        2
      )
    );
  } catch (err) {
    console.warn('Failed to write visual-report payload:', err.message);
  }
}

async function main() {
  try {
    const [owner, repo] = process.env.PR_REPO.split('/');
    const prNumber = parseInt(process.env.PR_NUMBER);
    const agent = await getReworkAgent();

    // Check circuit breaker
    if (isBlocked(repo, prNumber, agent)) {
      const msg = `⚠️ <b>Rework 중단 (Circuit Breaker)</b>\nCircuit breaker activated: too many consecutive failures.\nAgent: ${agent}\nPR: #${prNumber}`;
      telegram(msg, { reply_markup: prActionKeyboard(process.env.PR_REPO, prNumber) });

      // Post comment to PR
      await gh.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `⚠️ **Rework Stopped (Circuit Breaker)**\n\nThe rework agent (${agent}) has attempted this PR multiple times without success. Circuit breaker activated to prevent infinite retry loops.\n\nPlease review the code manually or contact support.`,
      });

      console.log('Circuit breaker activated. Exiting.');
      return;
    }

    console.log('Fetching PR review comments...');
    const reviewComments = await getReviewComments();
    const latestReviewState = await getLatestReviewState();
    const roundCount = await getRoundCount();

    console.log('Fetching changed files...');
    const changedFiles = await getChangedFiles();

    const commentText = reviewComments.map(c => `${c.path} (L${c.start_line}): ${c.body}`).join('\n');

    const hasReviseSignal =
      (latestReviewState && latestReviewState.toUpperCase() === 'CHANGES_REQUESTED') ||
      /blocker|블로커|개선|improve|needs work|request[_\\s]?changes|필요|ui|ux|layout|design|접근성|a11y|성능|performance|bug|오류|에러|fix/i.test(commentText);

    const maxRounds = roundCount >= 2 && hasReviseSignal ? 3 : 2;
    if (roundCount >= maxRounds) {
      telegram(
        `⚠️ <b>Rework 중단</b>\nRepo: ${process.env.PR_REPO}\nPR: #${process.env.PR_NUMBER}\nReason: max rounds ${maxRounds} reached`,
        { reply_markup: prActionKeyboard(process.env.PR_REPO, parseInt(process.env.PR_NUMBER, 10)) }
      );
      console.log('Max rounds reached. Skipping rework.');
      return;
    }

    let fileContents = '';
    const filesToProcess = changedFiles
      .filter(f => f.status !== 'removed')
      .slice(0, 20);

    for (const file of filesToProcess) {
      const content = await getFileContent(file.filename);
      if (content) {
        const truncated = content.length > 3000 ? content.substring(0, 3000) + '...' : content;
        fileContents += `\n## ${file.filename}\n\`\`\`\n${truncated}\n\`\`\`\n`;
      }
    }

    console.log(`Using agent: ${agent}`);

    const systemPrompt = `You are a code rework agent fixing issues identified in PR reviews.

Rules:
1. Fix only the issues mentioned in review comments or human feedback.
2. If UI/UX issues are mentioned, improve layout, spacing, contrast, or interaction accordingly.
3. Do not change public APIs or data contracts unless the review explicitly requires it.
4. Avoid introducing new dependencies unless required by the review.
5. Keep changes minimal and safe.
6. Avoid using 'any' in TypeScript. Prefer precise types.

Output JSON only:
{ "updates": [ { "path": "...", "content": "..." } ] }`;

    const userPrompt = `Review comments:\n${commentText}\n\nCurrent files:\n${fileContents}\n\nFix the issues and output ONLY valid JSON.`;

    let response;
    if (agent === 'claude') {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });
      response = msg.content[0].text;
    } else {
      // OpenAI Chat Completions API does not accept a top-level `system`
      // parameter; system instructions must be the first message in `messages`.
      const msg = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 4096,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });
      response = msg.choices[0].message.content;
    }

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const result = JSON.parse(jsonMatch[0]);

    // Capture the branch HEAD *before* we push — this is the "Before"
    // commit for the visual-report stage.
    let prevSha = null;
    try {
      prevSha = await getBranchHeadSha();
    } catch (err) {
      console.warn('Could not read prevSha:', err.message);
    }

    console.log('Pushing fixed files...');
    await pushFiles(result.updates);

    // And capture the new HEAD — the "After" commit.
    let newSha = null;
    try {
      newSha = await getBranchHeadSha();
    } catch (err) {
      console.warn('Could not read newSha:', err.message);
    }

    if (prevSha && newSha && prevSha !== newSha) {
      writeVisualReportPayload({ prevSha, newSha });
    }

    await gh.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `## [rework-round]\nRound: ${roundCount + 1}/${maxRounds}\nTrigger: ${hasReviseSignal ? 'revise' : 'feedback'}\n\n✅ Rework 완료 — 리뷰 피드백 반영`
    });

    // Record success to reset circuit breaker
    recordSuccess(repo, prNumber, agent);

    telegram(
      `✅ <b>Rework 완료</b>\nRepo: ${process.env.PR_REPO}\nPR: #${prNumber}\nAgent: ${agent}\nRound: ${roundCount + 1}/${maxRounds}`,
      { reply_markup: prActionKeyboard(process.env.PR_REPO, prNumber) }
    );

    // Opt-in auto-merge: only fires if PR has 'auto-merge-when-ready' label.
    // GitHub gates the actual merge on all required checks passing.
    const autoMerge = await tryEnableAutoMerge(owner, repo, prNumber);
    if (autoMerge.enabled) {
      await gh.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: `🔀 **Auto-merge enabled.** PR will merge automatically once all required checks pass.`,
      });
      telegram(
        `🔀 <b>Auto-merge 활성화</b>\nPR #${prNumber} — CI green 시 자동 머지`,
        { reply_markup: prActionKeyboard(process.env.PR_REPO, prNumber) }
      );
    } else if (autoMerge.reason && autoMerge.reason !== 'label-not-set') {
      console.log(`Auto-merge not enabled: ${autoMerge.reason}`);
    }

    console.log('Done!');

  } catch (err) {
    console.error(err);

    // Record failure for circuit breaker
    const [owner, repo] = process.env.PR_REPO.split('/');
    const prNumber = parseInt(process.env.PR_NUMBER);
    const agent = await getReworkAgent();

    const failureResult = recordFailure(repo, prNumber, agent);
    console.log(`Failure recorded: ${failureResult.message}`);

    if (failureResult.blocked) {
      telegram(`⚠️ <b>Rework 회로차단 (Circuit Breaker)</b>\n${failureResult.message}\nError: ${err.message}`);
    } else {
      telegram(`❌ <b>Rework 실패</b>\nError: ${err.message}\nFailure: ${failureResult.failureCount}/${failureResult.maxFailures}`);
    }

    process.exit(1);
  }
}

main();
