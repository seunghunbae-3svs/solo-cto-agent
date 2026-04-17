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

const AGENTS = ['codex', 'claude', 'unknown'];

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

async function getDecisionStatus(owner, repo, prNumber) {
  try {
    const reviews = await gh(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=20`);
    if (reviews.some(r => r.state === 'CHANGES_REQUESTED')) return '[CHANGES_REQUESTED]';
    if (reviews.some(r => r.state === 'APPROVED')) return '✅';
  } catch {
    // ignore review fetch issues
  }
  return '[PENDING]';
}

async function gh(endpoint) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'orchestrator-daily-briefing',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function searchIssues(query) {
  const res = await gh(`/search/issues?q=${encodeURIComponent(query)}`);
  return res?.total_count || 0;
}

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN || !chatId) return;
  const payload = { chat_id: chatId, text, parse_mode: 'HTML' };
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function buildBriefing(locale, perProjectLimit = 2) {
  const today = new Date().toISOString().slice(0, 10);
  let msg = L(locale, `Daily briefing (${today})\n\n`, `데일리 브리핑 (${today})\n\n`);

  const agentStats = {
    codex: { open: 0, openAgeSum: 0, merged: 0, mergeTimeSum: 0 },
    claude: { open: 0, openAgeSum: 0, merged: 0, mergeTimeSum: 0 },
    unknown: { open: 0, openAgeSum: 0, merged: 0, mergeTimeSum: 0 },
  };

  const now = Date.now();
  const recentCutoff = now - 24 * 60 * 60 * 1000; // last 24h
  let decisionPending = 0;
  const decisionItems = [];

  for (let i = 0; i < PROJECTS.length; i += 1) {
    const proj = PROJECTS[i];
    try {
      const prs = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=open&per_page=10`);
      msg += L(locale,
        `${i + 1}) <b>${proj.repo}</b> PRs ${prs.length}\n`,
        `${i + 1}) <b>${proj.repo}</b> PR ${prs.length}\n`
      );

    for (const pr of prs.slice(0, perProjectLimit)) {
        const agent = identifyAgent(pr.head?.ref || '');
        const ageMs = now - new Date(pr.created_at).getTime();
        const age = formatAge(ageMs);
        const decision = await getDecisionStatus(GITHUB_OWNER, proj.repo, pr.number);
        if (decision === '[CHANGES_REQUESTED]' || decision === '[PENDING]') decisionPending += 1;
        agentStats[agent].open += 1;
        agentStats[agent].openAgeSum += ageMs;
        msg += `   - #${pr.number} (${agent}, ${age}, ${decision}) ${pr.title.slice(0, 48)}\n`;
        decisionItems.push({
          repo: proj.repo,
          prNumber: pr.number,
          title: pr.title,
          ageMs,
          decision,
          url: pr.html_url,
        });
      }
    if (prs.length > perProjectLimit) msg += L(locale,
      `   - +${prs.length - perProjectLimit} more\n`,
      `   - +${prs.length - perProjectLimit} more\n`
    );

      const closed = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=closed&per_page=10`);
      for (const pr of closed) {
        if (!pr.merged_at) continue;
        const mergedAt = new Date(pr.merged_at).getTime();
        if (mergedAt < recentCutoff) continue;
        const agent = identifyAgent(pr.head?.ref || '');
        agentStats[agent].merged += 1;
        agentStats[agent].mergeTimeSum += mergedAt - new Date(pr.created_at).getTime();
      }
    } catch {
      msg += L(locale,
        `${i + 1}) <b>${proj.repo}</b> fetch failed\n`,
        `${i + 1}) <b>${proj.repo}</b> 조회 실패\n`
      );
    }
  }

  msg += L(locale,
    `\nAgent summary (open/avg age | merged 24h/avg lead time)\n`,
    `\n에이전트 요약 (open/avg age | merged 24h/avg lead time)\n`
  );
  for (const agent of AGENTS) {
    const stat = agentStats[agent];
    const openAvg = stat.open ? formatAge(stat.openAgeSum / stat.open) : '0h';
    const mergeAvg = stat.merged ? formatAge(stat.mergeTimeSum / stat.merged) : '0h';
    msg += `- ${agent}: ${stat.open}/${openAvg} | ${stat.merged}/${mergeAvg}\n`;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let compareSection = '';
  for (const proj of PROJECTS) {
    try {
      const base = await searchIssues(`repo:${GITHUB_OWNER}/${proj.repo} "[compare-baseline]" in:comments updated:>=${since}`);
      const reports = await searchIssues(`repo:${GITHUB_OWNER}/${proj.repo} "[compare-report]" in:comments updated:>=${since}`);
      const holds = await searchIssues(`repo:${GITHUB_OWNER}/${proj.repo} "[compare-hold]" in:comments updated:>=${since}`);
      if (base || reports || holds) {
        compareSection += `- ${proj.repo}: baseline ${base}, report ${reports}, hold ${holds}\n`;
      }
    } catch {
      // ignore search failures
    }
  }
  if (compareSection) {
    msg += L(locale,
      `\nComparison reports (last 24h)\n${compareSection}`,
      `\n비교 리포트 (최근 24h)\n${compareSection}`
    );
  }

  msg += L(locale,
    `\nDecisions pending: ${decisionPending}`,
    `\n결정 대기: ${decisionPending}건`
  );
  if (decisionItems.length) {
    const urgent = decisionItems
      .map(item => ({
        ...item,
        urgent: item.decision === '[CHANGES_REQUESTED]' || (item.decision === '[PENDING]' && item.ageMs >= 24 * 60 * 60 * 1000),
      }))
      .filter(item => item.decision !== '✅')
      .sort((a, b) => {
        if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
        return b.ageMs - a.ageMs;
      })
      .slice(0, 3);

    if (urgent.length) {
      msg += L(locale,
        `\nDecision priority (Top 3)\n`,
        `\n결정 우선순위 (Top 3)\n`
      );
      for (const item of urgent) {
        const age = formatAge(item.ageMs);
        msg += `- ${item.repo} PR #${item.prNumber} (${age}) ${item.decision}\n  ${item.url}\n`;
      }
      msg += L(locale, `Decision queue: /pending`, `결정 상세/버튼: /pending`);
    }
  }

  const issues = await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/issues?state=open&per_page=20`);
  msg += L(locale,
    `\nOrchestrator issues: ${issues.length} open`,
    `\n오케스트레이터 이슈: ${issues.length} open`
  );
  msg += L(locale,
    `\nCommand: “project 1 status” or /review sample-store`,
    `\n명령: “프로젝트 1 현황” 또는 /review sample-store`
  );
  return msg;
}

async function main() {
  if (!TOKEN) throw new Error('Missing GitHub token');
  const settings = loadSettings();
  const recipients = getRecipients(settings);
  for (const recipient of recipients) {
    if (!['daily', 'both', 'all'].includes(recipient.report_mode || '')) continue;
    const locale = recipient.locale || 'en';
    const perProjectLimit = recipient.report_format === 'detail' ? 2 : 1;
    const msg = await buildBriefing(locale, perProjectLimit);
    await sendTelegram(recipient.id, msg);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
