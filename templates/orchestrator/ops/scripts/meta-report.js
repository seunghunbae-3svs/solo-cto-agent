const fs = require('fs');
const path = require('path');

const GITHUB_OWNER = 'seunghunbae-3svs';
const ORCH_REPO = 'dual-agent-review-orchestrator';
const TOKEN = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const PROJECTS = [
  { key: 'tribo', repo: 'tribo-store' },
  { key: 'golf', repo: 'golf-now' },
  { key: 'palate', repo: 'palate-pilot' },
  { key: 'eventbadge', repo: 'eventbadge' },
  { key: '3stripe', repo: '3stripe-event' },
  { key: 'orchestrator', repo: 'dual-agent-review-orchestrator' },
];

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

async function gh(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'orchestrator-meta-report',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  const payload = { chat_id: CHAT_ID, text, parse_mode: 'HTML' };
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function loadAgentScores() {
  try {
    const p = path.join(__dirname, '..', 'orchestrator', 'agent-scores.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

async function buildReport() {
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const agentScores = loadAgentScores();
  const stats = {
    codex: { merged: 0, leadTime: 0 },
    claude: { merged: 0, leadTime: 0 },
    unknown: { merged: 0, leadTime: 0 },
  };

  let openTotal = 0;

  for (const proj of PROJECTS) {
    const open = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=open&per_page=10`);
    openTotal += open.length;

    const closed = await gh(`/repos/${GITHUB_OWNER}/${proj.repo}/pulls?state=closed&per_page=20`);
    for (const pr of closed) {
      if (!pr.merged_at) continue;
      const mergedAt = new Date(pr.merged_at).getTime();
      if (mergedAt < cutoff) continue;
      const agent = identifyAgent(pr.head?.ref || '');
      stats[agent].merged += 1;
      stats[agent].leadTime += mergedAt - new Date(pr.created_at).getTime();
    }
  }

  const codexScore = agentScores?.agents?.codex || {};
  const claudeScore = agentScores?.agents?.claude || {};

  const codexAcc = codexScore.accuracy ?? 0.5;
  const claudeAcc = claudeScore.accuracy ?? 0.5;
  const codexRework = codexScore.rework_rate ?? 0;
  const claudeRework = claudeScore.rework_rate ?? 0;

  const recommendations = [];
  if (Math.abs(codexAcc - claudeAcc) >= 0.1) {
    recommendations.push(`정확도 차이가 큽니다. ${codexAcc > claudeAcc ? 'Codex' : 'Claude'}를 lead 우선 고려하세요.`);
  }
  if (codexRework >= 0.3) recommendations.push('Codex rework_rate가 높습니다. 테스트 강화 또는 범위 축소 필요.');
  if (claudeRework >= 0.3) recommendations.push('Claude rework_rate가 높습니다. 사양 정합성 검토 필요.');
  if (!recommendations.length) recommendations.push('현재 운영 지표는 안정적입니다.');

  const report = `# Meta Report ${month}

## Activity (Last 7 days)
- Open PRs: ${openTotal}
- Codex merged: ${stats.codex.merged} (avg lead time ${stats.codex.merged ? formatAge(stats.codex.leadTime / stats.codex.merged) : '0h'})
- Claude merged: ${stats.claude.merged} (avg lead time ${stats.claude.merged ? formatAge(stats.claude.leadTime / stats.claude.merged) : '0h'})

## Agent Scores
- Codex: accuracy ${codexAcc.toFixed(2)}, rework ${codexRework.toFixed(2)}, review_hit ${ (codexScore.review_hit_rate ?? 0).toFixed(2) }
- Claude: accuracy ${claudeAcc.toFixed(2)}, rework ${claudeRework.toFixed(2)}, review_hit ${ (claudeScore.review_hit_rate ?? 0).toFixed(2) }

## Recommendations
${recommendations.map(r => `- ${r}`).join('\n')}
`;

  return { month, report };
}

async function upsertMetaIssue(title, body) {
  const issues = await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/issues?state=open&per_page=50`);
  const existing = issues.find(i => i.title === title);
  if (existing) {
    await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/issues/${existing.number}/comments`, 'POST', { body });
    return existing.html_url;
  }
  const issue = await gh(`/repos/${GITHUB_OWNER}/${ORCH_REPO}/issues`, 'POST', {
    title,
    body,
    labels: ['meta-validation']
  });
  return issue.html_url;
}

async function main() {
  if (!TOKEN) throw new Error('Missing GitHub token');
  const { month, report } = await buildReport();
  const title = `[meta] Orchestrator Report ${month}`;
  const url = await upsertMetaIssue(title, report);
  await sendTelegram(`📊 Meta report updated (${month})\n${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
