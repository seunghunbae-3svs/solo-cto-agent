// BDA Orchestrator Telegram Bot Command Handler

const tc = require('./telegram-commands.js');

const GITHUB_TOKEN = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GITHUB_OWNER = process.env.GITHUB_OWNER || '{{GITHUB_OWNER}}';
const ORCH_REPO = process.env.ORCH_REPO || '{{ORCHESTRATOR_REPO}}';
const DECISION_LOG_PATH = 'ops/orchestrator/decision-log.json';
const TELEGRAM_SETTINGS_PATH = 'ops/orchestrator/telegram-settings.json';

// Shared command surface — ghApi wrapper that matches bin/lib/telegram-commands.js
// (endpoint, { method, body }) → parsed JSON
async function _ghApiShared(endpoint, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  return gh(endpoint, method, opts.body || null);
}

function _buildSharedCtx(chatId, message) {
  const env = {
    ...process.env,
    GITHUB_OWNER,
    ORCH_REPO,
    ORCH_REPO_SLUG: GITHUB_OWNER && ORCH_REPO ? `${GITHUB_OWNER}/${ORCH_REPO}` : process.env.ORCH_REPO_SLUG,
  };
  return {
    chatId,
    fromLabel: message?.from?.username || message?.from?.first_name || 'user',
    env,
    ghApi: _ghApiShared,
    trackedRepos: _defaultTrackedRepos(env),
    adminChatIds: tc.resolveAdminChatIds(env),
  };
}

function _defaultTrackedRepos(env) {
  const explicit = tc.resolveTrackedRepos(env, null);
  if (explicit.length) return explicit;
  // Fall back to the PROJECTS map slugs in this template.
  const owner = GITHUB_OWNER;
  if (!owner || owner.startsWith('{{')) return [];
  const slugs = [];
  for (const key of PROJECT_ORDER) {
    const proj = PROJECTS[key];
    if (proj && proj.repo && !proj.repo.startsWith('{{')) {
      slugs.push(`${owner}/${proj.repo}`);
    }
  }
  return slugs;
}

const PROJECTS = {
  {{PRODUCT_REPO_4}}: { repo: '{{PRODUCT_REPO_4}}', aliases: ['프로젝트B', 'sample-events', '{{PRODUCT_REPO_4}}', 'events', 'pb'] },
  'sample-event': { repo: '{{PRODUCT_REPO_5}}', aliases: ['sample-event', '프로젝트E', 'project-e', 'se'] },
  golf: { repo: '{{PRODUCT_REPO_2}}', aliases: ['프로젝트C', 'sample-golf', 'golf', 'gc'] },
  'sample-store': { repo: '{{PRODUCT_REPO_1}}', aliases: ['프로젝트A', 'sample-store', 'seller', 'ss'] },
  'sample-app': { repo: '{{PRODUCT_REPO_3}}', aliases: ['프로젝트D', 'sample-app', 'app', 'sa'] },
  orchestrator: { repo: '{{ORCHESTRATOR_REPO}}', aliases: ['orchestrator', 'orchestrator', 'orch'] },
};

const PROJECT_ORDER = ['sample-store', 'golf', 'sample-app', '{{PRODUCT_REPO_4}}', 'sample-event', 'orchestrator'];
const ISSUE_KEYWORDS = [
  '안됨', '안돼', '오류', '에러', '버그', '문제', '로딩', '깨짐', '불가',
  '요청', '추가', '개선', '수정', '필요', '누락', '반영', '없음', '느림',
  '멈춤', '고장', 'broken', 'bug', 'error', 'issue', 'fix', 'feature'
];

function normalizeText(input) {
  return String(input || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function identifyAgent(branch) {
  const name = (branch || '').toLowerCase();
  if (name.includes('codex')) return 'codex';
  if (name.includes('claude')) return 'claude';
  return 'unknown';
}

function formatAge(ms) {
  const hours = Math.max(0, Math.round(ms / 36e5));
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days}d ${rem}h` : `${days}d`;
}

function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

function extractUrls(text) {
  if (!text) return [];
  return Array.from(text.matchAll(/https?:\/\/\S+/g)).map(m => m[0]);
}

function isPreviewUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes('vercel.app') || lower.includes('preview');
}

async function findPreviewUrl(owner, repo, pr, comments) {
  const prUrl = extractUrl(pr?.body || '');
  if (isPreviewUrl(prUrl)) return prUrl;

  for (const c of comments || []) {
    const url = extractUrl(c.body || '');
    if (isPreviewUrl(url)) return url;
  }

  if (pr?.head?.sha) {
    try {
      const deploys = await gh(`/repos/${owner}/${repo}/deployments?sha=${pr.head.sha}&per_page=5`);
      for (const d of deploys) {
        const statuses = await gh(`/repos/${owner}/${repo}/deployments/${d.id}/statuses`);
        const success = statuses.find(s => s.state === 'success');
        if (success) return success.environment_url || success.target_url || null;
      }
    } catch {}
  }
  return null;
}

function extractBlockerSummary(reviews) {
  if (!reviews || !reviews.length) return null;
  const blocker = reviews.find(r => r.state === 'CHANGES_REQUESTED');
  if (!blocker) return null;
  const text = (blocker.body || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!text.length) return 'changes requested';
  return text[0].slice(0, 140);
}

function inferNextAction(text, locale) {
  const lower = (text || '').toLowerCase();
  if (/rls|row level|policy/.test(lower)) {
    return L(locale, 'Next: verify RLS policies and update Supabase rules', '다음: RLS 정책 확인 후 Supabase 규칙 업데이트');
  }
  if (/test|jest|vitest|coverage/.test(lower)) {
    return L(locale, 'Next: add or fix tests and rerun CI', '다음: 테스트 추가/수정 후 CI 재실행');
  }
  if (/type|typescript|ts|typing/.test(lower)) {
    return L(locale, 'Next: fix TypeScript types and rebuild', '다음: 타입 오류 수정 후 빌드 재확인');
  }
  if (/perf|slow|latency|optimiz/.test(lower)) {
    return L(locale, 'Next: profile bottleneck and optimize hot path', '다음: 병목 프로파일링 후 핵심 구간 최적화');
  }
  if (/ui|ux|layout|design|spacing|contrast|accessibil|a11y/.test(lower)) {
    return L(locale, 'Next: adjust UI/UX per review notes and share preview', '다음: UI/UX 개선 반영 후 프리뷰 공유');
  }
  if (/auth|login|permission|role/.test(lower)) {
    return L(locale, 'Next: verify auth flow and role permissions', '다음: 인증 흐름/권한 설정 점검');
  }
  return L(locale, 'Next: review blocker notes and apply targeted fix', '다음: 블로커 요약 확인 후 핵심 수정 반영');
}

function buildDecisionKeyboard(items) {
  const rows = [];
  for (const item of items) {
    rows.push([{ text: `${item.repo} PR#${item.prNumber} 열기`, url: item.url }]);
    if (item.previewUrl) {
      rows.push([{ text: 'Preview 보기', url: item.previewUrl }]);
    }
    rows.push([
      { text: '승인', callback_data: `DECISION|${item.repo}|${item.prNumber}|APPROVE` },
      { text: '수정', callback_data: `DECISION|${item.repo}|${item.prNumber}|REVISE` },
      { text: '보류', callback_data: `DECISION|${item.repo}|${item.prNumber}|HOLD` },
    ]);
  }
  return { inline_keyboard: rows };
}

async function buildDecisionQueue(limit = 4) {
  const queue = [];
  const now = Date.now();
  for (const key of PROJECT_ORDER) {
    const proj = PROJECTS[key];
    let prs = [];
    try {
      prs = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=open&per_page=5`);
    } catch {
      continue;
    }
    for (const pr of prs) {
      let reviews = [];
      try {
        reviews = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls/${pr.number}/reviews?per_page=10`);
      } catch {}
      const status = reviews.some(r => r.state === 'CHANGES_REQUESTED')
        ? 'BLOCKER'
        : reviews.some(r => r.state === 'APPROVED') ? 'APPROVED' : 'PENDING';
      const ageMs = now - new Date(pr.created_at).getTime();
      const urgent = status === 'BLOCKER' || ageMs >= 24 * 60 * 60 * 1000;
      queue.push({
        repo: proj.repo,
        prNumber: pr.number,
        title: pr.title,
        agent: identifyAgent(pr.head?.ref || ''),
        status,
        urgent,
        ageMs,
        url: pr.html_url,
        reviewSummary: extractBlockerSummary(reviews),
        pr,
      });
    }
  }

  queue.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return b.ageMs - a.ageMs;
  });

  const top = queue.filter(q => q.status !== 'APPROVED').slice(0, limit);
  for (const item of top) {
    try {
      const comments = await gh(`/repos/${GITHUB_OWNER}/${item.repo}/issues/${item.prNumber}/comments?per_page=20`);
      item.previewUrl = await findPreviewUrl(GITHUB_OWNER, item.repo, item.pr, comments);
    } catch {
      item.previewUrl = null;
    }
  }
  return top;
}

async function getDecisionStatus(repo, prNumber) {
  try {
    const reviews = await gh(`/repos/${GITHUB_OWNER}/${repo}/pulls/${prNumber}/reviews?per_page=20`);
    if (reviews.some(r => r.state === 'CHANGES_REQUESTED')) return '🔴';
    if (reviews.some(r => r.state === 'APPROVED')) return '✅';
  } catch {}
  return '🕒';
}

// Resolve project key from alias
function resolveProject(input) {
  if (!input) return null;
  const normalized = normalizeText(input);
  for (const [key, proj] of Object.entries(PROJECTS)) {
    if (normalizeText(key) === normalized) return key;
    if (normalizeText(proj.repo) === normalized) return key;
    for (const alias of proj.aliases) {
      if (normalizeText(alias) === normalized) return key;
    }
  }
  return null;
}

function resolveProjectByRepo(repoName) {
  if (!repoName) return null;
  for (const [key, proj] of Object.entries(PROJECTS)) {
    if (proj.repo === repoName) return key;
  }
  return null;
}

function parseProjectIndex(text) {
  const match = String(text || '').match(/프로젝트\s*([0-9]+)/i);
  if (!match) return null;
  const idx = parseInt(match[1], 10);
  if (!idx || idx < 1 || idx > PROJECT_ORDER.length) return null;
  return PROJECT_ORDER[idx - 1];
}

function parseDecisionCallback(data) {
  if (!data) return null;
  const parts = data.split('|');
  if (parts.length < 4) return null;
  if (parts[0] !== 'DECISION') return null;
  const repo = parts[1];
  const prNumber = parseInt(parts[2], 10);
  const action = parts[3];
  if (!repo || Number.isNaN(prNumber) || !action) return null;
  return { repo, prNumber, action };
}

function parseFeedbackTarget(text) {
  if (!text) return null;
  const match = text.match(/\[feedback-target\]\s*repo=([^\s]+)\s*pr=(\d+)/i);
  if (!match) return null;
  return { repo: match[1], prNumber: parseInt(match[2], 10) };
}

function normalizeDecisionAction(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'approve' || lower === 'approved' || /승인|ok|오케이|승인함/.test(raw)) return 'APPROVE';
  if (lower === 'revise' || lower === 'rework' || /수정|보완|재작업|리워크|리비전|변경/.test(raw)) return 'REVISE';
  if (lower === 'hold' || /보류|대기|스탑|중지|멈춤/.test(raw)) return 'HOLD';
  if (lower === 'detail' || /확인|상세|자세히|자세|내용|보기|check|show/.test(raw)) return 'DETAIL';
  return null;
}

function parseDecisionFromReply(text, replyText) {
  if (!replyText) return null;
  const action = normalizeDecisionAction(text);
  let match = replyText.match(/([a-z0-9-]+)\s+pr\s*#?(\d+)/i);
  let repo = null;
  let prNumber = null;
  if (match) {
    repo = match[1];
    prNumber = parseInt(match[2], 10);
  } else {
    match = replyText.match(/pr\s*#?(\d+)/i);
    if (match) {
      prNumber = parseInt(match[1], 10);
    }
  }
  if (!prNumber || Number.isNaN(prNumber)) return null;
  return { repo, prNumber, action };
}

function parseDecisionResponse(text) {
  const trimmed = text.trim();
  let match = trimmed.match(/^([a-z0-9가-힣-]+)\s*pr\s*#?(\d+)\s*([^\s]+)\s*(.*)$/i);
  if (match) {
    const projectKey = resolveProject(match[1]);
    const action = normalizeDecisionAction(match[3]);
    if (!action) return null;
    return {
      projectKey,
      prNumber: parseInt(match[2], 10),
      action,
      reason: (match[4] || '').trim(),
    };
  }

  match = trimmed.match(/^pr\s*#?(\d+)\s*([^\s]+)\s*(.*)$/i);
  if (match) {
    const action = normalizeDecisionAction(match[2]);
    if (!action) return null;
    return {
      projectKey: null,
      prNumber: parseInt(match[1], 10),
      action,
      reason: (match[3] || '').trim(),
    };
  }

  match = trimmed.match(/^#?(\d+)\s*([^\s]+)\s*(.*)$/i);
  if (match) {
    const action = normalizeDecisionAction(match[2]);
    if (!action) return null;
    return {
      projectKey: null,
      prNumber: parseInt(match[1], 10),
      action,
      reason: (match[3] || '').trim(),
    };
  }

  return null;
}

function parsePrNumber(text) {
  const match = text.match(/pr\s*#?(\d+)/i) || text.match(/#(\d+)/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (Number.isNaN(num) || num <= 0) return null;
  return num;
}

function parseLoosePrNumberForBlocker(text) {
  const lower = String(text || '').toLowerCase();
  if (!/blocker|블로커|조치|확인|detail|상세|자세|내용|보기|check|show/.test(lower)) return null;
  const match = text.match(/(?:pr|#)?\s*(\d+)\s*(?:번)?/i);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (Number.isNaN(num) || num <= 0) return null;
  return num;
}

async function triggerRework(repo, prNumber) {
  if (!GITHUB_TOKEN) return;
  try {
    const pr = await gh(`/repos/${GITHUB_OWNER}/${repo}/pulls/${prNumber}`);
    await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/dispatches`, 'POST', {
      event_type: 'rework-request',
      client_payload: {
        repo: `${GITHUB_OWNER}/${repo}`,
        pr: prNumber,
        branch: pr.head.ref,
      }
    });
  } catch {}
}

// GitHub API
async function gh(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'BDA-Orchestrator',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

function detectLocaleFromText(text) {
  return /[가-힣]/.test(text || '') ? 'ko' : 'en';
}

async function fetchTelegramSettings() {
  try {
    const data = await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/contents/${TELEGRAM_SETTINGS_PATH}`);
    const content = Buffer.from(data.content || '', 'base64').toString('utf8');
    const parsed = content ? JSON.parse(content) : { version: 1, default_locale: 'en', default_settings: {}, chats: {} };
    return { sha: data.sha, data: parsed };
  } catch (err) {
    if (String(err.message || err).includes('404')) {
      return { sha: null, data: { version: 1, default_locale: 'en', default_settings: {}, chats: {} } };
    }
    throw err;
  }
}

async function saveTelegramSettings(sha, data) {
  const body = {
    message: 'chore: update telegram settings',
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64'),
    branch: 'main',
    ...(sha ? { sha } : {}),
  };
  await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/contents/${TELEGRAM_SETTINGS_PATH}`, 'PUT', body);
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
  if (typeof entry === 'object') {
    return { ...defaults, ...entry, locale: entry.locale || defaults.locale };
  }
  return null;
}

function formatSettings(settings) {
  return `report=${settings.report_mode}, format=${settings.report_format}, approval=${settings.approval_mode}, locale=${settings.locale}`;
}

function buildWelcomeMessage(locale) {
  return L(locale,
    `👋 Welcome to BDA\n\nQuick setup:\n/setup report=6h format=compact approval=buttons\n\nKey commands:\n/status  | /pending | /setup\n"project 1 status"\n"PR17 detail"\n"myproject approve"\n\nDecision keywords:\napprove / revise / hold / detail\n\nTip: approvals auto-merge when possible.\nHelp: /help`,
    `👋 BDA 설치 완료\n\n빠른 설정:\n/setup report=6h format=compact approval=buttons\n\n주요 명령:\n/현황  | /pending | /setup\n"프로젝트 1 현황"\n"PR17 확인"\n"sample-store 승인"\n\n결정 키워드:\n승인 / 수정 / 보류 / 확인\n\n팁: 승인 시 자동 머지됩니다.\n도움말: /help`
  );
}

function parseSetupInput(text) {
  const lower = String(text || '').toLowerCase();
  const updates = {};
  if (/report\s*=\s*(\w+)/i.test(lower)) {
    const match = lower.match(/report\s*=\s*([a-z0-9-]+)/i);
    updates.report_mode = match ? match[1] : undefined;
  }
  if (/6h|6시간/.test(lower)) updates.report_mode = '6h';
  if (/daily|day|일일|매일/.test(lower)) updates.report_mode = 'daily';
  if (/off|stop|끄기|중지/.test(lower)) updates.report_mode = 'off';

  if (/approval\s*=\s*(\w+)/i.test(lower)) {
    const match = lower.match(/approval\s*=\s*([a-z0-9-]+)/i);
    updates.approval_mode = match ? match[1] : undefined;
  }
  if (/buttons|button|버튼/.test(lower)) updates.approval_mode = 'buttons';
  if (/text|명령|커맨드|텍스트/.test(lower)) updates.approval_mode = 'text';

  if (/format\s*=\s*(\w+)/i.test(lower)) {
    const match = lower.match(/format\s*=\s*([a-z0-9-]+)/i);
    updates.report_format = match ? match[1] : undefined;
  }
  if (/compact|요약|간단|short/.test(lower)) updates.report_format = 'compact';
  if (/detail|상세|full|긴/.test(lower)) updates.report_format = 'detail';

  if (/한국|korean|ko/.test(lower)) updates.locale = 'ko';
  if (/영어|english|en/.test(lower)) updates.locale = 'en';

  Object.keys(updates).forEach((key) => {
    if (!updates[key]) delete updates[key];
  });
  return updates;
}

async function resolveLocale(chatId, text) {
  const { data } = await fetchTelegramSettings();
  const chats = data.chats || {};
  const defaults = normalizeDefaultSettings(data);
  const entry = chatId ? chats[String(chatId)] : null;
  const normalized = normalizeChatSettings(entry, defaults);
  if (normalized && normalized.locale) return normalized.locale;
  const detected = detectLocaleFromText(text);
  if (detected === 'ko') return 'ko';
  return data.default_locale || 'en';
}

async function setLocale(chatId, locale) {
  if (!chatId) return;
  const { sha, data } = await fetchTelegramSettings();
  const next = data || { version: 1, default_locale: 'en', default_settings: {}, chats: {} };
  next.chats = next.chats || {};
  const defaults = normalizeDefaultSettings(next);
  const current = normalizeChatSettings(next.chats[String(chatId)], defaults) || defaults;
  next.chats[String(chatId)] = { ...current, locale };
  next.default_locale = locale;
  await saveTelegramSettings(sha, next);
}

async function updateChatSettings(chatId, updates) {
  if (!chatId) return null;
  const { sha, data } = await fetchTelegramSettings();
  const next = data || { version: 1, default_locale: 'en', default_settings: {}, chats: {} };
  next.chats = next.chats || {};
  const defaults = normalizeDefaultSettings(next);
  const current = normalizeChatSettings(next.chats[String(chatId)], defaults) || defaults;
  const merged = { ...current, ...updates };
  next.chats[String(chatId)] = merged;
  await saveTelegramSettings(sha, next);
  return merged;
}

async function ensureChatRegistered(chatId, locale) {
  if (!chatId) return;
  try {
    const { sha, data } = await fetchTelegramSettings();
    const next = data || { version: 1, default_locale: 'en', default_settings: {}, chats: {} };
    next.chats = next.chats || {};
    if (next.chats[String(chatId)]) return;
    const defaults = normalizeDefaultSettings(next);
    next.chats[String(chatId)] = { ...defaults, locale: locale || defaults.locale };
    await saveTelegramSettings(sha, next);
    await reply(chatId, buildWelcomeMessage(locale || defaults.locale));
  } catch {
    await reply(chatId, buildWelcomeMessage(locale || 'en'));
  }
}

function L(locale, en, ko) {
  return locale === 'ko' ? ko : en;
}

// Telegram reply
async function reply(chatId, text, extra = null) {
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (extra && typeof extra === 'object') {
    Object.assign(payload, extra);
  }
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function answerCallbackQuery(callbackQueryId, text = '처리 완료') {
  if (!callbackQueryId) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function markDecisionMessageDone(chatId, messageId, originalText, action) {
  if (!chatId || !messageId) return;
  const suffix = `\n\n✅ 처리 완료: ${action}`;
  const text = `${originalText}${suffix}`;
  const urls = extractUrls(originalText);
  const prUrl = urls.find(u => u.includes('github.com') && u.includes('/pull/'));
  const previewUrl = urls.find(u => isPreviewUrl(u));
  const infoKeyboard = [];
  if (prUrl) infoKeyboard.push([{ text: 'PR 보기', url: prUrl }]);
  if (previewUrl) infoKeyboard.push([{ text: 'Preview 보기', url: previewUrl }]);
  const replyMarkup = infoKeyboard.length ? { inline_keyboard: infoKeyboard } : { inline_keyboard: [] };
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    }),
  });
}

async function fetchDecisionLog() {
  try {
    const data = await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/contents/${DECISION_LOG_PATH}`);
    const content = Buffer.from(data.content || '', 'base64').toString('utf8');
    const parsed = content ? JSON.parse(content) : { version: 1, items: [] };
    return { sha: data.sha, data: parsed };
  } catch (err) {
    if (String(err.message || err).includes('404')) {
      return { sha: null, data: { version: 1, items: [] } };
    }
    throw err;
  }
}

async function saveDecisionLog(sha, data) {
  const body = {
    message: 'log: decision',
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64'),
    branch: 'main',
    ...(sha ? { sha } : {}),
  };
  await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/contents/${DECISION_LOG_PATH}`, 'PUT', body);
}

async function logDecision(entry, attempt = 0) {
  if (!GITHUB_TOKEN) return;
  const { sha, data } = await fetchDecisionLog();
  const items = Array.isArray(data.items) ? data.items : [];
  items.push(entry);
  data.items = items.slice(-200);
  data.updated_at = new Date().toISOString();
  try {
    await saveDecisionLog(sha, data);
  } catch (err) {
    if (attempt < 1) {
      return logDecision(entry, attempt + 1);
    }
  }
}

async function resolveProjectByPrNumber(prNumber) {
  const hits = [];
  for (const [key, proj] of Object.entries(PROJECTS)) {
    try {
      await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls/${prNumber}`);
      hits.push(key);
    } catch {
      // ignore not found
    }
  }
  return hits;
}

async function buildStatusSummary(locale, includeDate = false) {
  const today = new Date().toISOString().slice(0, 10);
  let msg = includeDate
    ? L(locale, `📌 Daily briefing (${today})\n\n`, `📌 데일리 브리핑 (${today})\n\n`)
    : L(locale, `📊 <b>Overall status</b>\n\n`, `📊 <b>전체 현황</b>\n\n`);

  const now = Date.now();
  let decisionPending = 0;

  for (let i = 0; i < PROJECT_ORDER.length; i += 1) {
    const key = PROJECT_ORDER[i];
    const proj = PROJECTS[key];
    try {
      const prs = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=open&per_page=5`);
      const icon = prs.length > 0 ? '🟡' : '🟢';
      msg += L(locale,
        `${i + 1}) ${icon} <b>${proj.repo}</b> PRs ${prs.length}\n`,
        `${i + 1}) ${icon} <b>${proj.repo}</b> PR ${prs.length}\n`
      );
      for (const pr of prs.slice(0, 2)) {
        const agent = identifyAgent(pr.head?.ref || '');
        const age = formatAge(now - new Date(pr.created_at).getTime());
        const decision = await getDecisionStatus(proj.repo, pr.number);
        if (decision === '🔴' || decision === '🕒') decisionPending += 1;
        msg += L(locale,
          `   - #${pr.number} (${agent}, ${age}, ${decision}) ${escapeHtml(pr.title).slice(0, 48)}\n`,
          `   - #${pr.number} (${agent}, ${age}, ${decision}) ${escapeHtml(pr.title).slice(0, 48)}\n`
        );
      }
      if (prs.length > 2) msg += L(locale,
        `   - +${prs.length - 2} more\n`,
        `   - +${prs.length - 2} more\n`
      );
    } catch {
      msg += L(locale,
        `${i + 1}) 🔴 <b>${proj.repo}</b> fetch failed\n`,
        `${i + 1}) 🔴 <b>${proj.repo}</b> 조회 실패\n`
      );
    }
  }

  msg += L(locale,
    `\n🧭 Decisions pending: ${decisionPending} (🔴 blocker/🕒 pending)`,
    `\n🧭 결정 대기: ${decisionPending}건 (🔴 blocker/🕒 pending 기준)`
  );
  const issues = await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/issues?state=open&per_page=20`);
  msg += L(locale,
    `\n🧩 Orchestrator issues: ${issues.length} open`,
    `\n🧩 오케스트레이터 이슈: ${issues.length} open`
  );
  msg += L(locale,
    `\nCommand: “project 1 status” or /review myproject`,
    `\n명령: “프로젝트 1 현황” 또는 /review myproject`
  );
  msg += L(locale,
    `\nDecision queue: /pending`,
    `\n결정 대기 상세: /pending`
  );
  return msg;
}

// Commands

async function cmdDecisionResponse(chatId, decision, locale) {
  let projectKey = decision.projectKey;
  if (!projectKey) {
    const matches = await resolveProjectByPrNumber(decision.prNumber);
    if (matches.length === 1) {
      projectKey = matches[0];
    } else if (matches.length === 0) {
      return reply(chatId, L(locale,
        `PR #${decision.prNumber} not found. Use "project PR${decision.prNumber} approve".`,
        `PR #${decision.prNumber} 를 찾지 못했습니다. “프로젝트 PR${decision.prNumber} 승인” 형식으로 보내주세요.`
      ));
    } else {
      const list = matches.map((k) => PROJECTS[k]?.repo || k).join(', ');
      return reply(chatId, L(locale,
        `PR #${decision.prNumber} exists in multiple repos: ${list}\nUse "project PR${decision.prNumber} approve".`,
        `PR #${decision.prNumber} 가 여러 repo에 있습니다: ${list}\n“프로젝트 PR${decision.prNumber} 승인”으로 보내주세요.`
      ));
    }
  }

  const proj = PROJECTS[projectKey];
  if (!proj) return reply(chatId, L(locale, 'Project not found.', '프로젝트를 찾을 수 없습니다.'));

  const prNumber = decision.prNumber;
  try {
    await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls/${prNumber}`);
  } catch {
    return reply(chatId, L(locale, `${proj.repo} PR #${prNumber} not found.`, `${proj.repo} PR #${prNumber} 를 찾을 수 없습니다.`));
  }
  const prLink = `https://github.com/${GITHUB_OWNER}/${proj.repo}/pull/${prNumber}`;

  if (decision.action === 'DETAIL') {
    return cmdBlocker(chatId, projectKey, prNumber, locale);
  }

  const reasonLine = decision.reason ? `\n\nReason: ${decision.reason}` : '';
  await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/issues/${prNumber}/comments`, 'POST', {
    body: `## [${decision.action} via Telegram]\n\nSource: decision-message${reasonLine}`,
  });
  await logDecision({
    ts: new Date().toISOString(),
    repo: proj.repo,
    pr: prNumber,
    action: decision.action,
    reason: decision.reason || '',
    source: 'telegram',
  });

  if (decision.action === 'APPROVE') {
    const mergeResult = await tryAutoMerge(proj.repo, prNumber);
    if (mergeResult.ok) {
      return reply(chatId, L(locale,
        `✅ ${proj.repo} PR #${prNumber} approved + auto-merged\n${prLink}`,
        `✅ ${proj.repo} PR #${prNumber} 승인 기록 + 자동 머지 완료\n${prLink}`
      ));
    }
    const fallback = decision.reason ? `\n사유: ${decision.reason}` : '';
    return reply(chatId, L(locale,
      `⚠️ ${proj.repo} PR #${prNumber} approval recorded\nAuto-merge failed: ${mergeResult.reason}\nManual merge needed\n${prLink}`,
      `⚠️ ${proj.repo} PR #${prNumber} 승인 기록 완료\n자동 머지 실패: ${mergeResult.reason}\n수동 머지 필요${fallback}\n${prLink}`
    ));
  }

  const suffix = decision.reason ? `\n사유: ${decision.reason}` : '';
  return reply(chatId, L(locale,
    `✅ ${proj.repo} PR #${prNumber} ${decision.action} recorded\n${prLink}`,
    `✅ ${proj.repo} PR #${prNumber} ${decision.action} 기록 완료${suffix}\n${prLink}`
  ));
}

async function cmdStatus(chatId, locale) {
  const msg = await buildStatusSummary(locale, false);
  return reply(chatId, msg);
}

async function cmdBriefing(chatId, locale) {
  const msg = await buildStatusSummary(locale, true);
  return reply(chatId, msg);
}

async function cmdProjectStatus(chatId, projectKey, locale) {
  const proj = PROJECTS[projectKey];
  const prs = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=open&per_page=5`);
  if (!prs.length) return reply(chatId, L(locale, `${proj.repo}: no open PRs`, `${proj.repo}: 열린 PR 없음`));

  const now = Date.now();
  let msg = L(locale,
    `📌 <b>${proj.repo}</b> status (PRs ${prs.length})\n\n`,
    `📌 <b>${proj.repo}</b> 현황 (PR ${prs.length})\n\n`
  );
  for (const pr of prs.slice(0, 3)) {
    const agent = identifyAgent(pr.head?.ref || '');
    const age = formatAge(now - new Date(pr.created_at).getTime());
    msg += `#${pr.number} (${agent}, ${age}) ${escapeHtml(pr.title).slice(0, 60)}\n${pr.html_url}\n\n`;
  }
  return reply(chatId, msg.trim());
}

async function cmdReview(chatId, projectKey, locale) {
  const proj = PROJECTS[projectKey];
  const prs = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=open&per_page=5`);
  if (!prs.length) return reply(chatId, L(locale, `${proj.repo}: no open PRs`, `${proj.repo}: 열린 PR 없음`));

  let msg = L(locale,
    `🧪 <b>${proj.repo}</b> review status\n\n`,
    `🧪 <b>${proj.repo}</b> 리뷰 상태\n\n`
  );
  for (const pr of prs) {
    const reviews = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls/${pr.number}/reviews`);
    const reviewText = reviews.length
      ? reviews.map(r => `${r.user.login}: ${r.state}`).join(', ')
      : L(locale, 'No reviews', '리뷰 없음');
    msg += L(locale,
      `PR #${pr.number} ${escapeHtml(pr.title)}\n  reviews: ${escapeHtml(reviewText)}\n  ${pr.html_url}\n\n`,
      `PR #${pr.number} ${escapeHtml(pr.title)}\n  리뷰: ${escapeHtml(reviewText)}\n  ${pr.html_url}\n\n`
    );
  }
  return reply(chatId, msg);
}

async function cmdBlocker(chatId, projectKey, prNumber, locale) {
  let project = projectKey;
  if (!project) {
    const matches = await resolveProjectByPrNumber(prNumber);
    if (matches.length === 1) project = matches[0];
    else if (matches.length === 0) return reply(chatId, L(locale, `PR #${prNumber} not found.`, `PR #${prNumber} 를 찾지 못했습니다.`));
    else return reply(chatId, L(locale, `PR #${prNumber} exists in multiple repos: ${matches.map(k => PROJECTS[k].repo).join(', ')}`, `PR #${prNumber} 가 여러 repo에 있습니다: ${matches.map(k => PROJECTS[k].repo).join(', ')}`));
  }

  const repo = PROJECTS[project]?.repo;
  if (!repo) return reply(chatId, L(locale, 'Project not found.', '프로젝트를 찾을 수 없습니다.'));

  const pr = await gh(`/repos/${GITHUB_OWNER}/${repo}/pulls/${prNumber}`);
  const reviews = await gh(`/repos/${GITHUB_OWNER}/${repo}/pulls/${prNumber}/reviews`);
  const issueComments = await gh(`/repos/${GITHUB_OWNER}/${repo}/issues/${prNumber}/comments?per_page=50`);
  const previewUrl = await findPreviewUrl(GITHUB_OWNER, repo, pr, issueComments);
  const previewLine = previewUrl ? previewUrl : L(locale, '⏳ Preview pending', '⏳ Preview 준비 중');

  const blockerReviews = reviews.filter(r =>
    r.state === 'CHANGES_REQUESTED' || /blocker|블로커|조치|개선|needs work/i.test(r.body || '')
  );
  const blockerComments = issueComments.filter(c =>
    /blocker|블로커|조치|개선|needs work/i.test(c.body || '')
  );

  if (!blockerReviews.length && !blockerComments.length) {
    return reply(chatId, L(locale,
      `🔎 ${repo} PR #${prNumber}\nNo blocker reviews/comments found.`,
      `🔎 ${repo} PR #${prNumber}\n블로커 표시된 리뷰/코멘트가 없습니다.`
    ));
  }

  let msg = L(locale,
    `🔴 <b>Blocking issues</b>\n${repo} PR #${prNumber}\n`,
    `🔴 <b>막는 문제 확인</b>\n${repo} PR #${prNumber}\n`
  );
  if (blockerReviews.length) {
    const latest = blockerReviews[blockerReviews.length - 1];
    msg += L(locale,
      `\n- Review summary: ${latest.user?.login || 'reviewer'} (${latest.state})\n${escapeHtml((latest.body || '').slice(0, 300))}\n`,
      `\n- 리뷰 요약: ${latest.user?.login || 'reviewer'} (${latest.state})\n${escapeHtml((latest.body || '').slice(0, 300))}\n`
    );
  }
  if (blockerComments.length) {
    const latest = blockerComments[blockerComments.length - 1];
    msg += L(locale,
      `\n- Comment summary: ${latest.user?.login || 'comment'}\n${escapeHtml((latest.body || '').slice(0, 300))}\n`,
      `\n- 코멘트 요약: ${latest.user?.login || 'comment'}\n${escapeHtml((latest.body || '').slice(0, 300))}\n`
    );
  }
  const combined = [
    blockerReviews.map(r => r.body || '').join('\n'),
    blockerComments.map(c => c.body || '').join('\n')
  ].join('\n');
  msg += `\n${inferNextAction(combined, locale)}`;
  msg += L(locale,
    `\n\nDecision: "${repo} PR${prNumber} approve" or "${repo} PR${prNumber} revise" or "${repo} PR${prNumber} hold"`,
    `\n\n결정: "${repo} PR${prNumber} 승인" 또는 "${repo} PR${prNumber} 수정" 또는 "${repo} PR${prNumber} 보류"`
  );
  msg += L(locale,
    `\nPreview: ${previewLine}\nLink: https://github.com/${GITHUB_OWNER}/${repo}/pull/${prNumber}`,
    `\nPreview: ${previewLine}\n링크: https://github.com/${GITHUB_OWNER}/${repo}/pull/${prNumber}`
  );
  return reply(chatId, msg);
}

async function cmdBlockerLatest(chatId, projectKey, locale) {
  const queue = await buildDecisionQueue(6);
  if (!queue.length) {
    return reply(chatId, L(locale, '✅ No pending decisions found.', '✅ 결정 대기 항목이 없습니다.'));
  }

  let target = null;
  if (projectKey) {
    const repoName = PROJECTS[projectKey]?.repo;
    target = queue.find(q => q.repo === repoName) || null;
  }
  if (!target) target = queue[0];

  const resolvedProject = resolveProjectByRepo(target.repo) || projectKey;
  return cmdBlocker(chatId, resolvedProject, target.prNumber, locale);
}

async function cmdCompare(chatId, projectKey, prNumber, locale) {
  let project = projectKey;
  if (!project) {
    const matches = await resolveProjectByPrNumber(prNumber);
    if (matches.length === 1) project = matches[0];
    else if (matches.length === 0) return reply(chatId, L(locale, `PR #${prNumber} not found.`, `PR #${prNumber} 를 찾지 못했습니다.`));
    else return reply(chatId, L(locale, `PR #${prNumber} exists in multiple repos: ${matches.map(k => PROJECTS[k].repo).join(', ')}`, `PR #${prNumber} 가 여러 repo에 있습니다: ${matches.map(k => PROJECTS[k].repo).join(', ')}`));
  }

  const repo = PROJECTS[project]?.repo;
  if (!repo) return reply(chatId, L(locale, 'Project not found.', '프로젝트를 찾을 수 없습니다.'));

  const pr = await gh(`/repos/${GITHUB_OWNER}/${repo}/pulls/${prNumber}`);
  await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/dispatches`, 'POST', {
    event_type: 'comparison-ready',
    client_payload: {
      repo: `${GITHUB_OWNER}/${repo}`,
      pr: prNumber,
      title: pr.title,
      url: pr.html_url
    }
  });
  return reply(chatId, L(locale, `✅ Comparison report triggered\n${pr.html_url}`, `✅ 비교 리포트 트리거 완료\n${pr.html_url}`));
}

async function cmdRework(chatId, projectKey, prNumber, reason, locale) {
  let project = projectKey;
  if (!project) {
    const matches = await resolveProjectByPrNumber(prNumber);
    if (matches.length === 1) project = matches[0];
    else if (matches.length === 0) return reply(chatId, L(locale, `PR #${prNumber} not found.`, `PR #${prNumber} 를 찾지 못했습니다.`));
    else return reply(chatId, L(locale, `PR #${prNumber} exists in multiple repos: ${matches.map(k => PROJECTS[k].repo).join(', ')}`, `PR #${prNumber} 가 여러 repo에 있습니다: ${matches.map(k => PROJECTS[k].repo).join(', ')}`));
  }

  const repo = PROJECTS[project]?.repo;
  if (!repo) return reply(chatId, L(locale, 'Project not found.', '프로젝트를 찾을 수 없습니다.'));

  if (reason && reason.trim()) {
    await gh(`/repos/${GITHUB_OWNER}/${repo}/issues/${prNumber}/comments`, 'POST', {
      body: `[human-feedback via Telegram]\n\n${reason.trim()}`,
    });
  }

  await triggerRework(repo, prNumber);
  return reply(chatId, L(locale, `✅ ${repo} PR #${prNumber} rework requested`, `✅ ${repo} PR #${prNumber} 재작업 요청 완료`));
}

async function cmdFeedback(chatId, projectKey, feedback, locale) {
  const proj = PROJECTS[projectKey];
  const prs = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=open&per_page=5`);
  if (!prs.length) return reply(chatId, L(locale, `${proj.repo}: no open PRs`, `${proj.repo}: 열린 PR 없음`));

  for (const pr of prs) {
    await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/issues/${pr.number}/comments`, 'POST', {
      body: `[human-feedback via Telegram]\n\n${feedback}`,
    });
  }
  return reply(chatId, L(locale, `✅ Sent feedback to ${proj.repo} PRs (${prs.length})`, `✅ ${proj.repo} PR ${prs.length}건에 피드백 전달 완료`));
}

async function cmdApprove(chatId, projectKey, locale) {
  const proj = PROJECTS[projectKey];
  const prs = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=open&per_page=5`);
  if (!prs.length) return reply(chatId, L(locale, `${proj.repo}: no open PRs`, `${proj.repo}: 열린 PR 없음`));

  for (const pr of prs) {
    await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/issues/${pr.number}/comments`, 'POST', {
      body: `[APPROVED via Telegram]`,
    });
  }
  return reply(chatId, L(locale, `✅ ${proj.repo} approvals recorded`, `✅ ${proj.repo} 승인 기록 완료`));
}

async function cmdMerge(chatId, projectKey, locale) {
  const proj = PROJECTS[projectKey];
  const prs = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=open&per_page=5`);
  if (!prs.length) return reply(chatId, L(locale, `${proj.repo}: no open PRs`, `${proj.repo}: 열린 PR 없음`));

  if (prs.length > 1) {
    let msg = L(locale,
      `🔎 There are ${prs.length} PRs. Specify a number:\n\n`,
      `🔎 PR ${prs.length}개가 있습니다. 번호를 지정해주세요:\n\n`
    );
    for (const pr of prs) msg += `"${projectKey} ${pr.number} merge" → ${escapeHtml(pr.title)}\n`;
    return reply(chatId, msg);
  }

  const mergeResult = await tryAutoMerge(proj.repo, prs[0].number, prs[0].title);
  if (mergeResult.ok) {
    return reply(chatId, L(locale, `✅ Merged: ${proj.repo} PR #${prs[0].number}`, `✅ Merged: ${proj.repo} PR #${prs[0].number}`));
  }
  return reply(chatId, L(locale, `❌ Merge failed: ${mergeResult.reason}`, `❌ Merge 실패: ${mergeResult.reason}`));
}

async function tryAutoMerge(repo, prNumber, prTitle = '') {
  try {
    await gh(`/repos/${GITHUB_OWNER}/${repo}/pulls/${prNumber}/merge`, 'PUT', {
      merge_method: 'squash',
      commit_title: prTitle ? `${prTitle} (#${prNumber})` : `Merge PR #${prNumber}`,
    });
    return { ok: true };
  } catch (err) {
    const message = String(err.message || 'merge failed');
    const safe = message.length > 180 ? `${message.slice(0, 180)}...` : message;
    return { ok: false, reason: safe };
  }
}

async function cmdIssue(chatId, projectKey, title, locale) {
  const safeTitle = (title || '').trim();
  if (!safeTitle) {
    return reply(chatId, L(locale, 'Please include an issue description. Example: “Sample Store seller page not loading”', '이슈 내용을 함께 보내주세요. 예: “Sample Store 셀러 페이지 로딩 안됨”'));
  }

  const issue = await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/issues`, 'POST', {
    title: projectKey ? `[${projectKey}] ${safeTitle}` : safeTitle,
    body: `Telegram에서 생성\n\n## Goal\n${safeTitle}`,
    labels: ['dual-agent', 'agent-codex', 'agent-claude'],
  });
  return reply(chatId, L(locale, `✅ Issue #${issue.number} created\n${issue.html_url}`, `✅ Issue #${issue.number} 생성\n${issue.html_url}`));
}

async function cmdHelp(chatId, locale) {
  return reply(chatId, L(locale,
    `🧭 <b>BDA Commands</b>\n\n"status" or /status\n"decision queue" or /pending\n"project 1 status"\n"sample-store review"\n"sample-store approve" (auto-merge)\n"sample-store merge"\n"PR17 approve"\n"PR17 detail" or "PR17 blocker check"\n"{{PRODUCT_REPO_4}} PR1 rework"\n"{{PRODUCT_REPO_4}} PR1 compare" (report)\n"sample-store seller page not loading" -> create issue\n\nSetup: /setup report=6h format=compact approval=buttons\n\nAliases: sample-store, golf, sample-app, {{PRODUCT_REPO_4}}, sample-event\n\nLanguage: /lang en | /lang ko`,
    `🧭 <b>BDA 명령어</b>\n\n"현황" 또는 /현황\n"결정 대기" 또는 /pending\n"프로젝트 1 현황"\n"sample-store 리뷰"\n"sample-store 승인" (승인 시 자동 머지)\n"sample-store merge"\n"PR17 승인"\n"PR17 확인" 또는 "PR17 blocker 확인"\n"{{PRODUCT_REPO_4}} PR1 재작업"\n"{{PRODUCT_REPO_4}} PR1 비교" (비교 리포트)\n"sample-store 셀러 페이지 로딩 안됨" → 이슈 자동 생성\n\n설정: /setup report=6h format=compact approval=buttons\n\n프로젝트 별칭: sample-store, golf, sample-app, sample-events, sample-event\n\n언어: /lang en | /lang ko`
  ));
}

async function cmdLang(chatId, locale) {
  const normalized = (locale || '').toLowerCase();
  const next = normalized.startsWith('ko') ? 'ko' : 'en';
  await setLocale(chatId, next);
  return reply(chatId, L(next, '✅ Language set to English', '✅ 언어가 한국어로 설정되었습니다'));
}

async function cmdSetup(chatId, text, locale) {
  const updates = parseSetupInput(text);
  const { data } = await fetchTelegramSettings();
  const defaults = normalizeDefaultSettings(data || {});
  const existing = normalizeChatSettings((data?.chats || {})[String(chatId)], defaults) || defaults;

  if (!Object.keys(updates).length) {
    const guide = L(locale,
      `Current: ${formatSettings(existing)}\n\nSetup examples:\n/setup report=6h format=compact approval=buttons\n/setup report=daily format=detail\n/setup report=off\n\nOptions:\nreport: 6h | daily | off\nformat: compact | detail\napproval: buttons | text\nlocale: en | ko`,
      `현재 설정: ${formatSettings(existing)}\n\n설정 예시:\n/setup report=6h format=compact approval=buttons\n/setup report=daily format=detail\n/setup report=off\n\n옵션:\nreport: 6h | daily | off\nformat: compact | detail\napproval: buttons | text\nlocale: en | ko`
    );
    return reply(chatId, guide);
  }

  const updated = await updateChatSettings(chatId, updates);
  const nextLocale = updated?.locale || locale;
  return reply(chatId, L(nextLocale,
    `✅ Settings updated\n${formatSettings(updated)}`,
    `✅ 설정 완료\n${formatSettings(updated)}`
  ));
}

async function cmdPending(chatId, locale) {
  const queue = await buildDecisionQueue(4);
  if (!queue.length) return reply(chatId, L(locale, '✅ No pending decisions', '✅ 현재 결정 대기 없음'));

  const lines = queue.map((q) => {
    const age = formatAge(q.ageMs);
    const status = q.status === 'BLOCKER' ? '🔴 BLOCKER' : q.status === 'PENDING' ? '🕒 PENDING' : '✅ APPROVED';
    const previewLine = q.previewUrl ? q.previewUrl : L(locale, '⏳ Preview pending', '⏳ Preview 준비 중');
    return `- ${q.repo} PR #${q.prNumber} (${q.agent}, ${age}) ${status}\n  ${escapeHtml(q.title).slice(0, 80)}\n  ${previewLine}`;
  });

  const text = L(locale,
    `🚨 <b>Decision queue</b>\n\n${lines.join('\n')}\n\nUse the buttons to open and decide.`,
    `🚨 <b>결정 대기 큐</b>\n\n${lines.join('\n')}\n\n버튼으로 바로 열람/결정 가능합니다.`
  );
  const replyMarkup = buildDecisionKeyboard(queue);
  return reply(chatId, text, { reply_markup: replyMarkup });
}

// Natural language parser
function parseNaturalLanguage(text) {
  const lower = text.toLowerCase();
  const projectKey = resolveProject(text);
  const projectByIndex = parseProjectIndex(text);
  const prNumber = parsePrNumber(text) || parseLoosePrNumberForBlocker(text);
  const detailIntent = /blocker|블로커|조치|detail|상세|자세|자세히|내용|보기|확인|check|show/.test(lower);
  const blockerSignal = /blocker|블로커|조치/.test(lower);

  if (/브리핑|데일리/.test(lower)) return { cmd: 'briefing' };
  if (/결정\s*대기|결정큐|결정\s*필요|pending|decision/.test(lower)) return { cmd: 'pending' };
  if (/언어|language|lang/.test(lower) && /한국|korean|ko/.test(lower)) return { cmd: 'lang', locale: 'ko' };
  if (/언어|language|lang/.test(lower) && /영어|english|en/.test(lower)) return { cmd: 'lang', locale: 'en' };
  if (/전체\s*현황|프로젝트\s*전체/.test(lower) && !projectKey) return { cmd: 'status' };
  if (projectByIndex && /현황|상태|리뷰|review/.test(lower)) return { cmd: 'project-status', project: projectByIndex };
  if (/현황|상태|status/.test(lower) && !projectKey) return { cmd: 'status' };
  if (/리뷰|review/.test(lower) && projectKey) return { cmd: 'review', project: projectKey };
  if (/승인|approve|ok/.test(lower) && projectKey) return { cmd: 'approve', project: projectKey };
  if (/merge|머지/.test(lower) && projectKey) return { cmd: 'merge', project: projectKey };
  if (detailIntent && prNumber) return { cmd: 'blocker', project: projectKey, prNumber };
  if (detailIntent && (projectKey || blockerSignal)) return { cmd: 'blocker-latest', project: projectKey };
  if ((/비교|리포트|compare/.test(lower)) && prNumber) return { cmd: 'compare', project: projectKey, prNumber };
  if ((/재작업|리워크|rework|fix/.test(lower)) && prNumber) return { cmd: 'rework', project: projectKey, prNumber, text };
  if (/피드백|feedback/.test(lower) && projectKey) return { cmd: 'feedback', project: projectKey, text };
  if (/이슈|issue|버그|추가|개선/.test(lower)) return { cmd: 'issue', project: projectKey, text };
  if (/blocker|블로커|조치|확인/.test(lower)) return { cmd: 'blocker-help' };

  if (projectKey && ISSUE_KEYWORDS.some(k => lower.includes(k))) {
    return { cmd: 'issue', project: projectKey, text };
  }

  return null;
}

// Main handler
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'BDA webhook active' });
  }

  try {
    const callback = req.body?.callback_query;
    if (callback) {
      const chatId = callback.message?.chat?.id;
      const data = callback.data || '';
      if (String(chatId) !== String(AUTHORIZED_CHAT_ID)) {
        await answerCallbackQuery(callback.id, '권한 없음');
        return res.status(200).json({ ok: true });
      }
      const locale = await resolveLocale(chatId, callback.message?.text || '');

      // --- New ACTION|repo|pr callbacks routed through the shared module. ---
      const callbackHead = String(data).split('|')[0];
      if (tc.ACTION_CALLBACK_PREFIXES.includes(callbackHead)) {
        const ctx = _buildSharedCtx(chatId, callback);
        const result = await tc.dispatchCallback(data, ctx);
        if (result.handled) {
          const response = result.response || {};
          await answerCallbackQuery(callback.id, response.text || (response.ok ? 'Done' : 'Failed'));
          try {
            await markDecisionMessageDone(
              chatId,
              callback.message?.message_id,
              callback.message?.text || '',
              response.text || result.action,
            );
          } catch {}
          return res.status(200).json({ ok: true });
        }
      }

      const parsed = parseDecisionCallback(data);
      if (!parsed) {
        await answerCallbackQuery(callback.id, '알 수 없는 요청');
        return res.status(200).json({ ok: true });
      }

      if (parsed.action === 'FEEDBACK') {
        await answerCallbackQuery(callback.id, '의견 입력 요청');
        await reply(
          chatId,
          `🧩 [feedback-target] repo=${parsed.repo} pr=${parsed.prNumber}\n아래에 의견을 답장으로 보내주세요.`,
          { force_reply: true }
        );
        return res.status(200).json({ ok: true });
      }

      const projectKey = resolveProjectByRepo(parsed.repo) || resolveProject(parsed.repo);
      await cmdDecisionResponse(chatId, {
        projectKey,
        prNumber: parsed.prNumber,
        action: parsed.action,
        reason: '',
      }, locale);
      await markDecisionMessageDone(chatId, callback.message?.message_id, callback.message?.text || '', parsed.action);
      await answerCallbackQuery(callback.id, '처리 완료');
      return res.status(200).json({ ok: true });
    }

    const message = req.body?.message;
    if (!message?.text) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (String(chatId) !== String(AUTHORIZED_CHAT_ID)) {
      await reply(chatId, '권한 없음');
      return res.status(200).json({ ok: true });
    }

    const locale = await resolveLocale(chatId, text);
    await ensureChatRegistered(chatId, locale);

    // Feedback reply to button prompt
    const feedbackTarget = parseFeedbackTarget(message.reply_to_message?.text || '');
    if (feedbackTarget) {
      const repo = feedbackTarget.repo;
      const prNumber = feedbackTarget.prNumber;
      const reason = text.trim();
      await gh(`/repos/${GITHUB_OWNER}/${repo}/issues/${prNumber}/comments`, 'POST', {
        body: `[human-feedback via Telegram]\n\n${reason}`,
      });
      await triggerRework(repo, prNumber);
      await reply(chatId, `✅ ${repo} PR #${prNumber} 의견 기록 완료`);
      return res.status(200).json({ ok: true });
    }

    // Decision/feedback via reply to decision message
    const replyDecision = parseDecisionFromReply(text, message.reply_to_message?.text || '');
    if (replyDecision) {
      const repoKey = replyDecision.repo
        ? resolveProjectByRepo(replyDecision.repo) || resolveProject(replyDecision.repo)
        : null;
      const repoName = repoKey ? PROJECTS[repoKey]?.repo : replyDecision.repo;
      if (replyDecision.action) {
        await cmdDecisionResponse(chatId, {
          projectKey: repoKey,
          prNumber: replyDecision.prNumber,
          action: replyDecision.action,
          reason: '',
        }, locale);
      } else if (repoName) {
        const reason = text.trim();
        await gh(`/repos/${GITHUB_OWNER}/${repoName}/issues/${replyDecision.prNumber}/comments`, 'POST', {
          body: `[human-feedback via Telegram]\n\n${reason}`,
        });
        await triggerRework(repoName, replyDecision.prNumber);
        await reply(chatId, `✅ ${repoName} PR #${replyDecision.prNumber} 의견 기록 완료`);
      }
      return res.status(200).json({ ok: true });
    }

    // Decision response (repo-safe format)
    const decision = parseDecisionResponse(text);
    if (decision) {
      await cmdDecisionResponse(chatId, decision, locale);
      return res.status(200).json({ ok: true });
    }

    // Slash commands
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const projInput = parts[1];
      const projectKey = resolveProject(projInput);

      // --- Shared CTO command surface takes precedence for the new commands
      // when explicitly triggered. /status keeps its legacy behaviour below
      // unless TRACKED_REPOS is set (explicit CTO-mode opt-in).
      const parsedCto = tc.parseCommand(text);
      const ctoCommands = ['/list', '/rework', '/approve', '/do', '/digest', '/merge'];
      const trackedRepos = _defaultTrackedRepos({ ...process.env, GITHUB_OWNER });
      const useCto = parsedCto && (
        ctoCommands.includes(parsedCto.cmd)
        || (parsedCto.cmd === '/status' && !!process.env.TRACKED_REPOS)
      );
      if (useCto) {
        const ctx = _buildSharedCtx(chatId, message);
        const result = await tc.dispatchCommand(parsedCto, ctx);
        if (result.handled) {
          const response = result.response || {};
          if (response.text) {
            await reply(chatId, response.text, response.extra || null);
          }
          return res.status(200).json({ ok: true });
        }
      }

      switch (cmd) {
        case '/start':
        case '/help':
        case '/?':
          await reply(chatId, buildWelcomeMessage(locale));
          await cmdHelp(chatId, locale); break;
        case '/setup':
        case '/설정':
        case '/settings':
          await cmdSetup(chatId, text, locale); break;
        case '/status':
        case '/현황':
          await cmdStatus(chatId, locale); break;
        case '/pending':
        case '/결정':
        case '/decision':
        case '/queue':
          await cmdPending(chatId, locale); break;
        case '/briefing':
        case '/브리핑':
          await cmdBriefing(chatId, locale); break;
        case '/review':
        case '/리뷰':
          projectKey ? await cmdReview(chatId, projectKey, locale) : await reply(chatId, L(locale, 'Please specify a project.', '프로젝트를 지정해주세요.'));
          break;
        case '/approve':
        case '/승인':
          projectKey ? await cmdApprove(chatId, projectKey, locale) : await reply(chatId, L(locale, 'Please specify a project.', '프로젝트를 지정해주세요.'));
          break;
        case '/merge':
        case '/머지':
          projectKey ? await cmdMerge(chatId, projectKey, locale) : await reply(chatId, L(locale, 'Please specify a project.', '프로젝트를 지정해주세요.'));
          break;
        case '/feedback':
        case '/피드백':
          projectKey ? await cmdFeedback(chatId, projectKey, parts.slice(2).join(' '), locale) : await reply(chatId, L(locale, 'Please specify a project.', '프로젝트를 지정해주세요.'));
          break;
        case '/issue':
        case '/이슈':
          await cmdIssue(chatId, projectKey, parts.slice(projectKey ? 2 : 1).join(' '), locale);
          break;
        case '/blocker':
        case '/블로커':
        case '/조치':
          if (!projectKey || !parts[2]) {
            await reply(chatId, L(locale, 'Example: /blocker {{PRODUCT_REPO_4}} 1', '예: /blocker {{PRODUCT_REPO_4}} 1'));
          } else {
            await cmdBlocker(chatId, projectKey, parseInt(parts[2], 10), locale);
          }
          break;
        case '/rework':
        case '/재작업':
        case '/리워크':
          if (!projectKey || !parts[2]) {
            await reply(chatId, L(locale, 'Example: /rework {{PRODUCT_REPO_4}} 1 (reason)', '예: /rework {{PRODUCT_REPO_4}} 1 (사유)'));
          } else {
            await cmdRework(chatId, projectKey, parseInt(parts[2], 10), parts.slice(3).join(' '), locale);
          }
          break;
        case '/compare':
        case '/비교':
        case '/report':
          if (!projectKey || !parts[2]) {
            await reply(chatId, L(locale, 'Example: /compare {{PRODUCT_REPO_4}} 1', '예: /compare {{PRODUCT_REPO_4}} 1'));
          } else {
            await cmdCompare(chatId, projectKey, parseInt(parts[2], 10), locale);
          }
          break;
        case '/prs':
        case '/pr':
          projectKey ? await cmdReview(chatId, projectKey, locale) : await cmdStatus(chatId, locale);
          break;
        case '/lang':
          await cmdLang(chatId, parts[1] || 'en');
          break;
        case '/ping':
          await reply(chatId, 'pong');
          break;
        default:
          await reply(chatId, L(locale, 'Unknown command. Try /help', '명령어 확인: /help'));
          break;
      }
      return res.status(200).json({ ok: true });
    }

    // Natural language
    const parsed = parseNaturalLanguage(text);
    if (parsed) {
      switch (parsed.cmd) {
        case 'status': await cmdStatus(chatId, locale); break;
        case 'briefing': await cmdBriefing(chatId, locale); break;
        case 'pending': await cmdPending(chatId, locale); break;
        case 'project-status': await cmdProjectStatus(chatId, parsed.project, locale); break;
        case 'review': await cmdReview(chatId, parsed.project, locale); break;
        case 'approve': await cmdApprove(chatId, parsed.project, locale); break;
        case 'merge': await cmdMerge(chatId, parsed.project, locale); break;
        case 'blocker': await cmdBlocker(chatId, parsed.project, parsed.prNumber, locale); break;
        case 'blocker-latest': await cmdBlockerLatest(chatId, parsed.project, locale); break;
        case 'compare': await cmdCompare(chatId, parsed.project, parsed.prNumber, locale); break;
        case 'rework': await cmdRework(chatId, parsed.project, parsed.prNumber, parsed.text, locale); break;
        case 'feedback': await cmdFeedback(chatId, parsed.project, parsed.text, locale); break;
        case 'issue': await cmdIssue(chatId, parsed.project, parsed.text, locale); break;
        case 'lang': await cmdLang(chatId, parsed.locale || 'en'); break;
        case 'blocker-help':
          await reply(chatId, L(locale, 'PR number required. Example: "PR17 blocker check"', 'PR 번호가 필요합니다. 예: "PR17 blocker 확인" 또는 "{{PRODUCT_REPO_4}} PR1 blocker"'));
          break;
      }
    } else {
      await reply(chatId, L(locale,
        `🧩 I didn't understand that.\n\nTry "status", "project 1 status", or "sample-store approve".\nUse /help for all commands.`,
        `🧩 인식하지 못한 메시지입니다.\n\n"현황", "프로젝트 1 현황", "sample-store 승인"처럼 보내주세요.\n/help 로 전체 명령어 확인`
      ));
    }
  } catch (err) {
    console.error(err);
    try { await reply(req.body?.message?.chat?.id, `오류: ${err.message}`); } catch {}
  }

  return res.status(200).json({ ok: true });
};
