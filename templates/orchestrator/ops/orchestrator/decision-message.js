const fs = require('fs');
const crypto = require('crypto');

const EVENT_PATH = process.env.GITHUB_EVENT_PATH;
const EVENT_NAME = process.env.GITHUB_EVENT_NAME;
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_PAT;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SETTINGS_PATH = 'ops/orchestrator/telegram-settings.json';

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, default_locale: 'en', default_settings: {}, chats: {} };
  }
}

function normalizeDefaultSettings(data) {
  const base = {
    report_mode: '6h',
    report_format: 'compact',
    approval_mode: 'buttons',
    locale: data.default_locale || 'en',
  };
  const overrides = (data && typeof data.default_settings === 'object') ? data.default_settings : {};
  return { ...base, ...overrides, locale: overrides.locale || base.locale };
}

function normalizeChatSettings(entry, defaults) {
  if (!entry) return null;
  if (typeof entry === 'string') return { ...defaults, locale: entry };
  if (typeof entry === 'object') return { ...defaults, ...entry, locale: entry.locale || defaults.locale };
  return null;
}

function resolveChatSettings(chatId) {
  const settings = loadSettings();
  const defaults = normalizeDefaultSettings(settings);
  const entry = chatId ? (settings.chats || {})[String(chatId)] : null;
  return normalizeChatSettings(entry, defaults) || defaults;
}

function L(locale, en, ko) {
  return locale === 'ko' ? ko : en;
}

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (!key) continue;
    args[key] = argv[i + 1] || '';
  }
  return args;
}

function readEvent() {
  if (!EVENT_PATH || !fs.existsSync(EVENT_PATH)) return {};
  return JSON.parse(fs.readFileSync(EVENT_PATH, 'utf8'));
}

function writeOutput(key, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  fs.appendFileSync(out, `${key}<<EOF\n${value}\nEOF\n`);
}

function writeLineOutput(key, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  fs.appendFileSync(out, `${key}=${value}\n`);
}

async function gh(endpoint) {
  if (!TOKEN) throw new Error('Missing GITHUB_TOKEN');
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'orchestrator-decision-message',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendTelegram(text, parseMode = 'HTML', replyMarkup = null) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const payload = { chat_id: CHAT_ID, text, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function buildReplyMarkup(repo, prNumber) {
  return {
    inline_keyboard: [
      [
        { text: '승인', callback_data: `DECISION|${repo}|${prNumber}|APPROVE` },
        { text: '보류', callback_data: `DECISION|${repo}|${prNumber}|HOLD` },
        { text: '기타의견', callback_data: `DECISION|${repo}|${prNumber}|FEEDBACK` },
      ],
    ],
  };
}

async function postGitHubComment(owner, repo, prNumber, body) {
  if (!TOKEN) return;
  await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'orchestrator-decision-message',
    },
    body: JSON.stringify({ body }),
  });
}

function computeFingerprint(payload, tier) {
  const base = [
    payload.repo,
    payload.prNumber,
    payload.phase,
    payload.recommendation,
    payload.consensus || '',
    payload.blockers || '',
    payload.previewUrl || '',
    payload.codexAssessment || '',
    payload.claudeAssessment || '',
    payload.optionSignature || '',
    tier,
  ].join('|');
  return crypto.createHash('sha1').update(base).digest('hex');
}

function extractLastFingerprint(comments) {
  if (!Array.isArray(comments)) return null;
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const body = comments[i]?.body || '';
    const match = body.match(/telegram-decision-fingerprint:\s*([a-f0-9]{10,40})/i);
    if (match) return match[1];
  }
  return null;
}

function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

function detectReviewer(body) {
  const text = (body || '').toLowerCase();
  if (text.includes('cross-reviewer:claude') || text.includes('reviewer: claude') || text.includes('claude 교차')) {
    return 'claude';
  }
  if (text.includes('cross-reviewer:codex') || text.includes('reviewer: codex') || text.includes('codex 교차')) {
    return 'codex';
  }
  return null;
}

function detectVerdict(body) {
  const text = body || '';
  const match = text.match(/verdict:\s*(APPROVE|REQUEST_CHANGES|COMMENT)/i) ||
    text.match(/overall verdict:\s*(APPROVE|REQUEST_CHANGES|COMMENT)/i) ||
    text.match(/최종\s*판정[:\s]*(승인|수정요청|보류)/i);
  if (!match) return null;
  const raw = match[1].toUpperCase();
  if (raw.includes('승인')) return 'APPROVE';
  if (raw.includes('수정')) return 'REQUEST_CHANGES';
  if (raw.includes('보류')) return 'COMMENT';
  if (raw === 'REQUEST_CHANGES') return 'REQUEST_CHANGES';
  if (raw === 'COMMENT') return 'COMMENT';
  return 'APPROVE';
}

function extractCrossReviewVerdicts(comments) {
  const verdicts = { codex: null, claude: null };
  for (const c of comments || []) {
    const reviewer = detectReviewer(c.body || '');
    if (!reviewer) continue;
    const verdict = detectVerdict(c.body || '');
    if (!verdict) continue;
    verdicts[reviewer] = verdict;
  }
  return verdicts;
}

function computeConsensus(verdicts) {
  if (!verdicts) return null;
  const { codex, claude } = verdicts;
  if (!codex || !claude) return null;
  if (codex === 'REQUEST_CHANGES' || claude === 'REQUEST_CHANGES') return 'REVISE';
  if (codex === 'APPROVE' && claude === 'APPROVE') return 'APPROVE';
  return 'HOLD';
}

function isPreviewUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes('vercel.app') || lower.includes('preview');
}

function extractAssessment(body) {
  if (!body) return null;
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const analysisLine = lines.find(l => l.startsWith('**분석**:')) ||
    lines.find(l => l.startsWith('분석:')) ||
    lines.find(l => l.toLowerCase().startsWith('analysis:'));
  if (analysisLine) {
    return analysisLine
      .replace(/^\*\*분석\*\*:\s*/i, '')
      .replace(/^분석:\s*/i, '')
      .replace(/^analysis:\s*/i, '')
      .trim();
  }
  const firstMeaningful = lines.find(l => l.length > 8);
  return firstMeaningful ? firstMeaningful.slice(0, 120) : null;
}

function detectBlocker(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('blocker') || text.includes('⛔') || text.includes('블로커')) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const blockerLine = lines.find(l => l.toLowerCase().includes('blocker')) ||
      lines.find(l => l.includes('⛔')) ||
      lines.find(l => l.includes('블로커'));
    return blockerLine ? blockerLine.slice(0, 140) : 'Blocker reported';
  }
  return null;
}

function extractIssueNumber(title, branch) {
  const titleMatch = String(title || '').match(/Issue\s*#(\d+)/i);
  if (titleMatch) return parseInt(titleMatch[1], 10);
  const branchMatch = String(branch || '').match(/feature\/(\d+)-/i);
  if (branchMatch) return parseInt(branchMatch[1], 10);
  return null;
}

function classifyAgent(pr) {
  const title = (pr.title || '').toLowerCase();
  const bracket = (pr.title || '').match(/^\[([^\]]+)\]/);
  if (bracket) return bracket[1].trim();
  const branch = (pr.head?.ref || '').toLowerCase();
  if (title.includes('combined') || branch.includes('combined')) return 'Combined';
  if (title.includes('codex') || branch.includes('codex')) return 'Codex';
  if (title.includes('claude') || branch.includes('claude')) return 'Claude';
  return 'Agent';
}

async function findSiblingPRs(owner, repo, issueNumber) {
  if (!issueNumber) return [];
  const prs = await gh(`/repos/${owner}/${repo}/pulls?state=open&per_page=50`);
  return (prs || []).filter(pr => {
    const t = String(pr.title || '');
    const titleMatch = t.match(/Issue\s*#(\d+)/i);
    const branchMatch = String(pr.head?.ref || '').match(/feature\/(\d+)-/i);
    const num = titleMatch ? parseInt(titleMatch[1], 10) : branchMatch ? parseInt(branchMatch[1], 10) : null;
    return num === issueNumber;
  });
}

async function findPreviewUrl(owner, repo, pr, comments) {
  const prUrl = extractUrl(pr?.body || '');
  if (isPreviewUrl(prUrl)) return prUrl;

  for (const c of comments || []) {
    const url = extractUrl(c.body || '');
    if (isPreviewUrl(url)) {
      return url;
    }
  }

  if (pr?.head?.sha) {
    try {
      const deploys = await gh(`/repos/${owner}/${repo}/deployments?sha=${pr.head.sha}&per_page=5`);
      for (const d of deploys) {
        const statuses = await gh(`/repos/${owner}/${repo}/deployments/${d.id}/statuses`);
        const success = statuses.find(s => s.state === 'success');
        if (success) return success.environment_url || success.target_url || null;
      }
    } catch {
      // Ignore deployment lookup failures
    }
  }
  return null;
}

function getRepoInfo(event) {
  const repo = event.repository?.name || process.env.GITHUB_REPOSITORY?.split('/')[1];
  const owner = event.repository?.owner?.login || process.env.GITHUB_REPOSITORY?.split('/')[0];
  return { owner, repo };
}

function getPrNumber(event) {
  if (event.pull_request?.number) return event.pull_request.number;
  if (event.issue?.pull_request && event.issue?.number) return event.issue.number;
  return null;
}

function buildDecisionMessage(locale, { repo, prNumber, prTitle, phase, previewUrl, recommendation, blockers, codexAssessment, claudeAssessment, consensus, options }) {
  const previewLine = previewUrl
    ? previewUrl
    : L(locale, '⏳ Preview pending (deploy not ready)', '⏳ Preview 준비 중 (배포 전 → HOLD 권장)');
  const blockerText = blockers || L(locale, 'No critical issues flagged', '특별한 문제 표시 없음');
  const codexLine = codexAssessment || L(locale, '(summary pending)', '(요약 준비 중)');
  const claudeLine = claudeAssessment || L(locale, '(summary pending)', '(요약 준비 중)');
  const header = blockers
    ? L(locale, '🔴 Decision needed', '🔴 결정 필요')
    : L(locale, '✅ Decision check', '✅ 결정 확인');
  const consensusLine = consensus || L(locale, 'pending', 'pending');
  const actionLine = blockers || !previewUrl
    ? L(locale, 'Action: choose revise or hold', '해야 할 일: 수정 또는 보류 중 선택해주세요')
    : L(locale, 'Action: choose approve or hold', '해야 할 일: 승인 또는 보류 중 선택해주세요');

  const choiceBlock = (options && options.length >= 2)
    ? `\n${L(locale, 'Available options', '선택 가능한 결과물')}\n${options.map(o => `- ${o.label}: PR #${o.number} ${o.url}`).join('\n')}`
    : '';

  return `${header}
<b>${repo} PR #${prNumber}</b>
${prTitle}

${actionLine}
${L(locale, 'Recommendation', '추천')}: ${recommendation}
${L(locale, 'Review consensus', '리뷰 합의')}: ${consensusLine}
${L(locale, 'Issue summary', '문제 요약')}: ${blockerText}
${L(locale, 'Preview', 'Preview')}: ${previewLine}

${choiceBlock}

${L(locale, 'Quick summary', '참고 요약')}
- Codex: ${codexLine}
- Claude: ${claudeLine}

${L(locale, 'Reply examples (auto-merge on approve)', '응답 예시 (승인 시 자동 머지)')}
${repo} PR${prNumber} ${L(locale, 'approve', '승인')}
${repo} PR${prNumber} ${L(locale, 'revise', '수정')} <${L(locale, 'reason', '사유')}>
${repo} PR${prNumber} ${L(locale, 'hold', '보류')} <${L(locale, 'reason', '사유')}>`;
}

function buildNotifyMessage(locale, { repo, prNumber, prTitle, phase, previewUrl, recommendation, blockers, codexAssessment, claudeAssessment, consensus, options }) {
  const previewLine = previewUrl ? previewUrl : L(locale, '⏳ Preview pending', '⏳ Preview 준비 중');
  const blockerText = blockers || L(locale, 'No critical issues flagged', '특별한 문제 표시 없음');
  const codexLine = codexAssessment || L(locale, '(summary pending)', '(요약 준비 중)');
  const claudeLine = claudeAssessment || L(locale, '(summary pending)', '(요약 준비 중)');
  const consensusLine = consensus || L(locale, 'pending', 'pending');
  const choiceBlock = (options && options.length >= 2)
    ? `\n${L(locale, 'Available options', '선택 가능한 결과물')}\n${options.map(o => `- ${o.label}: PR #${o.number} ${o.url}`).join('\n')}`
    : '';
  return `🔔 ${L(locale, 'Update', '업데이트')}
<b>${repo} PR #${prNumber}</b>
${prTitle}

${L(locale, 'Status', '상태')}: ${phase}
${L(locale, 'Recommendation', '추천')}: ${recommendation}
${L(locale, 'Review consensus', '리뷰 합의')}: ${consensusLine}
${L(locale, 'Issue summary', '문제 요약')}: ${blockerText}
${L(locale, 'Preview', 'Preview')}: ${previewLine}

${choiceBlock}

${L(locale, 'Quick summary', '요약')}
- Codex: ${codexLine}
- Claude: ${claudeLine}

${L(locale, 'If needed (auto-merge on approve):', '필요 시 (승인 시 자동 머지):')}
${repo} PR${prNumber} ${L(locale, 'approve', '승인')} | ${L(locale, 'revise', '수정')} | ${L(locale, 'hold', '보류')}`;
}

async function main() {
  const chatSettings = resolveChatSettings(CHAT_ID);
  const locale = chatSettings.locale || 'en';
  const approvalMode = chatSettings.approval_mode || 'buttons';
  const cli = parseArgs();
  if (cli['pr-number']) {
    const repoInput = cli.repo || process.env.GITHUB_REPOSITORY || 'repo';
    const repoShort = repoInput.split('/').pop();
    const repoFull = repoInput.includes('/') ? repoInput : `${process.env.GITHUB_REPOSITORY || `seunghunbae-3svs/${repoInput}`}`;
    const previewUrl = cli['preview-url'] || '';
    const hasBlocker = cli['has-blocker'] === 'true';
    const recommendation = hasBlocker || !previewUrl ? 'HOLD' : 'APPROVE';
    const payload = {
      repo: repoShort,
      prNumber: cli['pr-number'],
      prTitle: cli['pr-title'] || '',
      phase: 'update',
      previewUrl: previewUrl || null,
      recommendation,
      blockers: hasBlocker ? 'Blocker reported' : null,
      codexAssessment: null,
      claudeAssessment: null,
      consensus: null,
    };
    const tier = cli.tier || 'notify';
    const message = tier === 'decision'
      ? buildDecisionMessage(locale, payload)
      : buildNotifyMessage(locale, payload);
    const replyMarkup = tier === 'decision' && approvalMode !== 'text'
      ? buildReplyMarkup(payload.repo, payload.prNumber)
      : null;
    const fingerprint = computeFingerprint(payload, tier);
    const decisionComment = `## [telegram-decision]\nTier: ${tier}\nPhase: ${payload.phase}\nRecommendation: ${payload.recommendation}\nBlockers: ${payload.blockers || 'None'}\nPreview: ${payload.previewUrl || 'Preview pending'}\ntelegram-decision-fingerprint: ${fingerprint}`;
    if (process.env.GITHUB_OUTPUT) {
      writeLineOutput('tier', tier);
      writeOutput('message', message);
      if (replyMarkup) writeOutput('reply_markup', JSON.stringify(replyMarkup));
    }
    await sendTelegram(message, 'HTML', replyMarkup);
    const [owner, repo] = repoFull.split('/');
    if (owner && repo) {
      await postGitHubComment(owner, repo, payload.prNumber, decisionComment);
    }
    return;
  }

  const event = readEvent();

  if (EVENT_NAME === 'workflow_dispatch') {
    const message = event.inputs?.message || 'Manual notification';
    writeLineOutput('tier', 'notify');
    writeOutput('message', message);
    return;
  }

  const { owner, repo } = getRepoInfo(event);
  const prNumber = getPrNumber(event);

  if (!owner || !repo || !prNumber) {
    const fallback = `[Notify] ${repo || 'repo'} event: ${EVENT_NAME}`;
    writeLineOutput('tier', 'notify');
    writeOutput('message', fallback);
    return;
  }

  const pr = await gh(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  const comments = await gh(`/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=50`);
  const reviews = await gh(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=20`);
  const verdicts = extractCrossReviewVerdicts(comments);
  const consensus = computeConsensus(verdicts);

  const reviewEvent = event.review;
  const reviewState = reviewEvent?.state?.toLowerCase();
  const reviewBody = reviewEvent?.body || '';
  const reviewBlocker = reviewState === 'changes_requested' ? 'Review requested changes' : detectBlocker(reviewBody);
  const commentBlocker = detectBlocker(event.comment?.body || '');

  const blockers = reviewBlocker || commentBlocker || null;
  const previewUrl = await findPreviewUrl(owner, repo, pr, comments);
  const previewMissing = !previewUrl;
  const issueNumber = extractIssueNumber(pr.title, pr.head?.ref);
  const siblingPRs = await findSiblingPRs(owner, repo, issueNumber);
  const options = siblingPRs
    .sort((a, b) => a.number - b.number)
    .map(prItem => ({
      label: classifyAgent(prItem),
      number: prItem.number,
      url: prItem.html_url,
    }));
  const optionSignature = options.map(o => `${o.label}:${o.number}`).join('|');

  let phase = EVENT_NAME;
  if (EVENT_NAME === 'pull_request') {
    phase = event.action === 'opened' || event.action === 'ready_for_review' || event.action === 'reopened'
      ? 'review-ready'
      : event.action || 'pull_request';
  } else if (EVENT_NAME === 'pull_request_review') {
    phase = 'cross-review completed';
  } else if (EVENT_NAME === 'issue_comment') {
    phase = 'review comment';
  }

  let recommendation = 'HOLD';
  if (consensus === 'REVISE') {
    recommendation = 'REVISE';
  } else if (blockers) {
    recommendation = 'HOLD';
  } else if (previewMissing) {
    recommendation = 'HOLD';
  } else if (consensus === 'APPROVE') {
    recommendation = 'APPROVE';
  } else if (reviewState === 'approved') {
    recommendation = 'APPROVE';
  } else if (reviewState === 'changes_requested') {
    recommendation = 'REVISE';
  } else if (EVENT_NAME === 'pull_request_review') {
    recommendation = 'APPROVE';
  } else {
    recommendation = 'HOLD';
  }

  let codexAssessment = null;
  let claudeAssessment = null;
  for (const c of comments || []) {
    if (!codexAssessment && /Codex Self-Review|Codex 작업 완료|Codex 리뷰|Codex Self Review/i.test(c.body || '')) {
      codexAssessment = extractAssessment(c.body);
    }
    if (!claudeAssessment && /Claude Self-Review|Claude 작업 완료|Claude 리뷰|Claude Self Review/i.test(c.body || '')) {
      claudeAssessment = extractAssessment(c.body);
    }
    if (codexAssessment && claudeAssessment) break;
  }

  let tier = 'notify';
  if (blockers) tier = 'decision';
  if (consensus === 'REVISE' || consensus === 'HOLD') tier = 'decision';
  if (EVENT_NAME === 'pull_request_review' && reviewState === 'changes_requested') tier = 'decision';

  const commentBody = event.comment?.body || '';
  const isBotComment = EVENT_NAME === 'issue_comment' && event.comment?.user?.type === 'Bot';
  const isDecisionComment = /telegram-decision/i.test(commentBody) || /telegram-decision-fingerprint/i.test(commentBody);
  if (isBotComment && isDecisionComment) tier = 'silent';

  const payload = {
    repo,
    prNumber,
    prTitle: pr.title,
    phase,
    previewUrl,
    recommendation,
    blockers,
    codexAssessment,
    claudeAssessment,
    consensus,
    options,
    optionSignature,
  };

  const fingerprint = computeFingerprint(payload, tier);
  const lastFingerprint = extractLastFingerprint(comments);
  if (lastFingerprint && lastFingerprint === fingerprint) {
    tier = 'silent';
  }

  const message = tier === 'decision'
    ? buildDecisionMessage(locale, payload)
    : buildNotifyMessage(locale, payload);
  const replyMarkup = (tier === 'decision' && approvalMode !== 'text' && (!options || options.length < 2))
    ? buildReplyMarkup(payload.repo, payload.prNumber)
    : null;

  writeLineOutput('tier', tier);
  writeOutput('message', `${message}\n${pr.html_url}`);
  if (replyMarkup) writeOutput('reply_markup', JSON.stringify(replyMarkup));

  if (tier !== 'silent') {
    const decisionComment = `## [telegram-decision]\nTier: ${tier}\nPhase: ${payload.phase}\nRecommendation: ${payload.recommendation}\nBlockers: ${payload.blockers || 'None'}\nPreview: ${payload.previewUrl || 'Preview pending'}\ntelegram-decision-fingerprint: ${fingerprint}`;
    await postGitHubComment(owner, repo, prNumber, decisionComment);
  }
}

main().catch((err) => {
  writeLineOutput('tier', 'notify');
  writeOutput('message', `[Notify] Decision message error: ${err.message}`);
});
