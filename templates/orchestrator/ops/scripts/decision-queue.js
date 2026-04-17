const GITHUB_OWNER = '{{GITHUB_OWNER}}';
const ORCH_REPO = '{{ORCHESTRATOR_REPO}}';
const fs = require('fs');
const TOKEN = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SETTINGS_PATH = 'ops/orchestrator/telegram-settings.json';

const PROJECTS = [
  { key: 'sample-store', repo: '{{PRODUCT_REPO_1}}' },
  { key: 'golf', repo: '{{PRODUCT_REPO_2}}' },
  { key: 'sample-app', repo: '{{PRODUCT_REPO_3}}' },
  { key: '{{PRODUCT_REPO_4}}', repo: '{{PRODUCT_REPO_4}}' },
  { key: 'sample-event', repo: '{{PRODUCT_REPO_5}}' },
  { key: 'orchestrator', repo: '{{ORCHESTRATOR_REPO}}' },
];

const LIMIT = parseInt(process.env.DECISION_QUEUE_LIMIT || '3', 10);

function identifyAgent(branch) {
  const name = (branch || '').toLowerCase();
  if (name.includes('codex')) return 'codex';
  if (name.includes('claude')) return 'claude';
  if (name.includes('combined')) return 'combined';
  return 'unknown';
}

function formatAge(ms) {
  const hours = Math.max(0, Math.round(ms / 36e5));
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days}d ${rem}h` : `${days}d`;
}

function L(locale, en, ko) {
  return locale === 'ko' ? ko : en;
}

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

function getRecipients(settings) {
  const defaults = normalizeDefaultSettings(settings || {});
  const chats = settings?.chats || {};
  const list = Object.entries(chats)
    .map(([id, entry]) => ({ id, ...normalizeChatSettings(entry, defaults) }))
    .filter(item => item && item.id);
  if (!list.length && CHAT_ID) {
    list.push({ id: CHAT_ID, ...defaults });
  }
  return list;
}

function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

function isPreviewUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes('vercel.app') || lower.includes('preview');
}

async function gh(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'orchestrator-decision-queue',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendTelegram(chatId, text, replyMarkup = null) {
  if (!BOT_TOKEN || !chatId) return;
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
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

function buildDecisionKeyboard(item, allowButtons = true) {
  if (!allowButtons) return null;
  const rows = [
    [{ text: `${item.repo} PR#${item.prNumber} 열기`, url: item.url }],
  ];
  if (item.previewUrl) rows.push([{ text: 'Preview 보기', url: item.previewUrl }]);
  rows.push([
    { text: '승인', callback_data: `DECISION|${item.repo}|${item.prNumber}|APPROVE` },
    { text: '수정', callback_data: `DECISION|${item.repo}|${item.prNumber}|REVISE` },
    { text: '보류', callback_data: `DECISION|${item.repo}|${item.prNumber}|HOLD` },
  ]);
  return { inline_keyboard: rows };
}

async function buildQueue() {
  const queue = [];
  const now = Date.now();

  for (const proj of PROJECTS) {
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
        pr,
      });
    }
  }

  queue.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return b.ageMs - a.ageMs;
  });

  const top = queue.filter(q => q.status !== 'APPROVED').slice(0, LIMIT);
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

async function main() {
  if (!TOKEN) throw new Error('Missing GitHub token');
  const settings = loadSettings();
  const recipients = getRecipients(settings);
  const queue = await buildQueue();
  for (const recipient of recipients) {
    if (!['6h', 'both', 'all'].includes(recipient.report_mode || '')) continue;
    const locale = recipient.locale || 'en';
    const isDetail = recipient.report_format === 'detail';
    const allowButtons = recipient.approval_mode !== 'text';
    if (!queue.length) {
      await sendTelegram(recipient.id, L(locale, '✅ No pending decisions', '✅ 결정 대기 없음'));
      continue;
    }
    for (const item of queue) {
      const age = formatAge(item.ageMs);
      const status = item.status === 'BLOCKER' ? '🔴 BLOCKER' : '🕒 PENDING';
      const previewLine = item.previewUrl
        ? L(locale, `Preview: ${item.previewUrl}`, `Preview: ${item.previewUrl}`)
        : L(locale, 'Preview: pending', 'Preview: 준비 중');
      const detailLine = isDetail ? `\n${previewLine}` : '';
      const text = L(locale,
        `🚨 <b>Decision needed</b>\n${item.repo} PR #${item.prNumber}\n${item.title}\n\nStatus: ${status} (${item.agent}, ${age})${detailLine}`,
        `🚨 <b>결정 필요</b>\n${item.repo} PR #${item.prNumber}\n${item.title}\n\n상태: ${status} (${item.agent}, ${age})${detailLine}`
      );
      await sendTelegram(recipient.id, text, buildDecisionKeyboard(item, allowButtons));
    }
  }
}

main().catch(async (err) => {
  console.error(err);
  await sendTelegram(CHAT_ID, `❌ 결정 큐 실패: ${err.message}`).catch(() => {});
  process.exit(1);
});
