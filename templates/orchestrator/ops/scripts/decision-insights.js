const fs = require('fs');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const LOG_PATH = 'ops/orchestrator/decision-log.json';
const SETTINGS_PATH = 'ops/orchestrator/telegram-settings.json';

function L(locale, en, ko) {
  return locale === 'ko' ? ko : en;
}

function loadLocale() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return data.default_locale || 'en';
  } catch {
    return 'en';
  }
}

function loadLog() {
  try {
    const raw = fs.readFileSync(LOG_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

function formatPercent(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function countThemes(items) {
  const themes = {
    uiux: 0,
    tests: 0,
    auth: 0,
    perf: 0,
    data: 0,
    preview: 0,
  };
  for (const item of items) {
    const text = `${item.reason || ''}`.toLowerCase();
    if (/ui|ux|layout|design|spacing|contrast|a11y/.test(text)) themes.uiux += 1;
    if (/test|jest|vitest|coverage/.test(text)) themes.tests += 1;
    if (/auth|login|permission|role/.test(text)) themes.auth += 1;
    if (/perf|slow|latency|optimiz/.test(text)) themes.perf += 1;
    if (/db|data|query|sql|migration/.test(text)) themes.data += 1;
    if (/preview|deploy|vercel/.test(text)) themes.preview += 1;
  }
  return themes;
}

function buildSuggestions(counts, themes, locale) {
  const suggestions = [];
  const total = counts.total;
  if (!total) return suggestions;

  const reviseRate = counts.revise / total;
  const holdRate = counts.hold / total;

  if (reviseRate >= 0.3) {
    suggestions.push(L(locale, 'Tighten review guidance to reduce revise churn.', '수정 비율이 높습니다. 리뷰 기준/가이드 강화 권장.'));
  }
  if (holdRate >= 0.25) {
    suggestions.push(L(locale, 'Strengthen preview gating and preflight checks.', '보류 비율이 높습니다. 프리뷰/사전 점검 강화 필요.'));
  }
  if (themes.uiux >= 3) {
    suggestions.push(L(locale, 'Increase UI/UX checks in craft skill.', 'UI/UX 지적이 많습니다. craft 스킬 강화 추천.'));
  }
  if (themes.tests >= 3) {
    suggestions.push(L(locale, 'Add test coverage checklist to build/ship.', '테스트 관련 지적이 많습니다. build/ship 체크리스트 강화 추천.'));
  }
  if (themes.auth >= 2) {
    suggestions.push(L(locale, 'Add auth/role verification step in build.', '인증/권한 관련 지적이 있습니다. build 단계 검증 추가 추천.'));
  }
  if (!suggestions.length) {
    suggestions.push(L(locale, 'No major drift detected. Keep current settings.', '큰 이상 징후 없음. 현재 설정 유지.'));
  }
  return suggestions;
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  });
}

async function main() {
  const locale = loadLocale();
  const items = loadLog();
  const now = Date.now();
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const recent = items.filter((item) => {
    const ts = Date.parse(item.ts || '');
    return ts && now - ts <= windowMs;
  });

  const counts = {
    total: recent.length,
    approve: recent.filter(i => i.action === 'APPROVE').length,
    revise: recent.filter(i => i.action === 'REVISE').length,
    hold: recent.filter(i => i.action === 'HOLD').length,
  };
  const themes = countThemes(recent);
  const suggestions = buildSuggestions(counts, themes, locale);

  const msg = [
    L(locale, '📊 <b>Decision insights (7d)</b>', '📊 <b>결정 인사이트 (최근 7일)</b>'),
    '',
    L(locale, `Total: ${counts.total}`, `총 결정: ${counts.total}`),
    L(locale, `Approve: ${counts.approve} (${formatPercent(counts.approve, counts.total)})`, `승인: ${counts.approve} (${formatPercent(counts.approve, counts.total)})`),
    L(locale, `Revise: ${counts.revise} (${formatPercent(counts.revise, counts.total)})`, `수정: ${counts.revise} (${formatPercent(counts.revise, counts.total)})`),
    L(locale, `Hold: ${counts.hold} (${formatPercent(counts.hold, counts.total)})`, `보류: ${counts.hold} (${formatPercent(counts.hold, counts.total)})`),
    '',
    L(locale, 'Top themes:', '주요 테마:'),
    `- UI/UX: ${themes.uiux}`,
    `- Tests: ${themes.tests}`,
    `- Auth: ${themes.auth}`,
    `- Perf: ${themes.perf}`,
    `- Data: ${themes.data}`,
    '',
    L(locale, 'Suggested improvements:', '개선 제안:'),
    ...suggestions.map((s) => `- ${s}`),
  ].join('\n');

  await sendTelegram(msg);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
