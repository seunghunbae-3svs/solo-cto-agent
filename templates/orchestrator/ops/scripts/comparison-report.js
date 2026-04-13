const fs = require('fs');

const TOKEN = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const EVENT_TYPE = process.env.EVENT_TYPE;
const PR_REPO = process.env.PR_REPO;
const PR_NUMBER = parseInt(process.env.PR_NUMBER || '0', 10);
const PR_TITLE = process.env.PR_TITLE || '';
const PR_URL = process.env.PR_URL || '';

const PROJECT_ORDER = ['{{PRODUCT_REPO_1}}', '{{PRODUCT_REPO_2}}', '{{PRODUCT_REPO_3}}', '{{PRODUCT_REPO_4}}', '{{PRODUCT_REPO_5}}', '{{ORCHESTRATOR_REPO}}'];

async function gh(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'orchestrator-compare-report',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
  });
}

async function sendPhoto(url, caption) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  if (!url || url === 'N/A') return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      photo: url,
      caption: caption || '',
    }),
  });
}

function maskProject(repo) {
  const idx = PROJECT_ORDER.indexOf(repo);
  if (idx === -1) return 'Project X';
  return `Project ${String.fromCharCode(65 + idx)}`;
}

function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/\S+/g);
  return matches || [];
}

function isPreviewUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes('vercel.app') || lower.includes('preview');
}

async function findPreviewUrl(owner, repo, pr, comments) {
  const prUrls = extractUrls(pr?.body || '').filter(isPreviewUrl);
  if (prUrls.length) return prUrls[0];

  for (const c of comments || []) {
    const urls = extractUrls(c.body || '').filter(isPreviewUrl);
    if (urls.length) return urls[0];
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

function countTags(text) {
  const lower = (text || '').toLowerCase();
  const blockers = (lower.match(/blocker|블로커/g) || []).length;
  const suggestions = (lower.match(/suggestion|제안|개선/g) || []).length;
  const nits = (lower.match(/\bnit\b|사소/g) || []).length;
  const uiux = (lower.match(/ui|ux|layout|design|접근성|a11y|contrast|spacing/g) || []).length;
  const personalization = (lower.match(/personalization|personalised|개인화|맞춤|추천/g) || []).length;
  return { blockers, suggestions, nits, uiux, personalization };
}

function extractFindings(text, label) {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const findings = [];
  for (const line of lines) {
    if (line.toUpperCase().includes(label)) {
      const cleaned = line.replace(/^-+\s*/, '').replace(new RegExp(label, 'i'), '').replace(/[:\-]/g, '').trim();
      if (cleaned) findings.push(cleaned);
    }
  }
  return findings.slice(0, 3);
}

function getCrossReviewComments(comments) {
  return (comments || []).filter(c => /cross-reviewer:/i.test(c.body || ''));
}

function summarizeDiff(base, current) {
  return {
    blockers: `${base.blockers} → ${current.blockers}`,
    suggestions: `${base.suggestions} → ${current.suggestions}`,
    nits: `${base.nits} → ${current.nits}`,
    uiux: `${base.uiux} → ${current.uiux}`,
    personalization: `${base.personalization} → ${current.personalization}`,
  };
}

function buildUserSummary(baseCounts, finalCounts, findings) {
  const summary = [];
  if (finalCounts.blockers < baseCounts.blockers) summary.push('치명적 이슈 감소');
  if (finalCounts.uiux < baseCounts.uiux) summary.push('UI/UX 품질 개선');
  if (finalCounts.personalization > 0) summary.push('개인화 개선 포인트 반영');
  if (!summary.length) summary.push('품질 안정화 진행');

  const highlights = [];
  if (findings.blockers.length) highlights.push(`Blocker: ${findings.blockers[0]}`);
  if (findings.uiux.length) highlights.push(`UI/UX: ${findings.uiux[0]}`);
  if (findings.suggestions.length) highlights.push(`개선: ${findings.suggestions[0]}`);

  return { summary, highlights };
}

function buildReport(maskedName, baseUrl, finalUrl, baseCounts, finalCounts, findings, prStats) {
  const diff = summarizeDiff(baseCounts, finalCounts);
  const beforeShot = baseUrl ? `https://image.thum.io/get/width/1200/${encodeURIComponent(baseUrl)}` : 'N/A';
  const afterShot = finalUrl ? `https://image.thum.io/get/width/1200/${encodeURIComponent(finalUrl)}` : 'N/A';
  const summary = buildUserSummary(baseCounts, finalCounts, findings);

  const promo = summary.summary;

  return {
    beforeShot,
    afterShot,
    markdown: `# CTO Comparison Report — ${maskedName}

## 핵심 요약 (비개발자용)
- ${promo.join(', ')}
- 가장 눈에 띄는 변화: ${summary.highlights.length ? summary.highlights.join(' | ') : '리뷰 요약 기반 개선 진행 중'}
- 사용자 체감: 화면 안정성, 오류 위험, 사용 편의성 중심으로 개선

## 변경 내용 (쉽게 설명)
- 1차에서 지적된 문제를 2차까지 수정 반영
- 실제 사용자 화면/동작 품질이 좋아지도록 개선
- 반복 점검으로 신뢰도를 높이는 방식으로 진행

## Screenshot (Before / After)
- Before: ${beforeShot}
- After: ${afterShot}

## 비교 표 (숫자가 작아질수록 좋음)
| 항목 | 1차 | 2차 |
| --- | --- | --- |
| 치명 문제 | ${diff.blockers} | ${diff.blockers.split('→')[1].trim()} |
| 개선 포인트 | ${diff.suggestions} | ${diff.suggestions.split('→')[1].trim()} |
| 사소한 수정 | ${diff.nits} | ${diff.nits.split('→')[1].trim()} |
| UI/UX 이슈 | ${diff.uiux} | ${diff.uiux.split('→')[1].trim()} |
| 개인화 이슈 | ${diff.personalization} | ${diff.personalization.split('→')[1].trim()} |

## Development Impact
- 변경 파일: ${prStats.files}개
- 코드 변경량: +${prStats.additions} / -${prStats.deletions}

## 자세한 이슈 요약
- 치명 문제: ${findings.blockers.length ? findings.blockers.join(' / ') : '없음'}
- 개선 포인트: ${findings.suggestions.length ? findings.suggestions.join(' / ') : '없음'}
- UI/UX: ${findings.uiux.length ? findings.uiux.join(' / ') : '없음'}
- 개인화: ${findings.personalization.length ? findings.personalization.join(' / ') : '없음'}

## Internal Link
- ${PR_URL}
`
  };
}

async function ensureBaselineComment(owner, repo, prNumber, url, counts) {
  const body = `## [compare-baseline]\nPreview: ${url || 'N/A'}\nBlocker: ${counts.blockers}\nSuggestion: ${counts.suggestions}\nNIT: ${counts.nits}\nUIUX: ${counts.uiux}\nPersonalization: ${counts.personalization}\nCapturedAt: ${new Date().toISOString()}`;
  await gh(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, 'POST', { body });
}

function parseBaseline(comments) {
  const baseline = (comments || []).find(c => /\[compare-baseline\]/i.test(c.body || ''));
  if (!baseline) return null;
  const url = extractUrls(baseline.body || '').find(isPreviewUrl) || null;
  const blocker = parseInt((baseline.body.match(/Blocker:\s*(\d+)/i) || [])[1] || '0', 10);
  const suggestion = parseInt((baseline.body.match(/Suggestion:\s*(\d+)/i) || [])[1] || '0', 10);
  const nit = parseInt((baseline.body.match(/NIT:\s*(\d+)/i) || [])[1] || '0', 10);
  const uiux = parseInt((baseline.body.match(/UIUX:\s*(\d+)/i) || [])[1] || '0', 10);
  const personalization = parseInt((baseline.body.match(/Personalization:\s*(\d+)/i) || [])[1] || '0', 10);
  return { url, counts: { blockers: blocker, suggestions: suggestion, nits: nit, uiux, personalization } };
}

async function markCompareReport(owner, repo, prNumber, reportUrl) {
  const body = `## [compare-report]\nReport: ${reportUrl}\nGeneratedAt: ${new Date().toISOString()}`;
  await gh(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, 'POST', { body });
}

async function markCompareHold(owner, repo, prNumber, reason) {
  const body = `## [compare-hold]\nReason: ${reason}\nGeneratedAt: ${new Date().toISOString()}`;
  await gh(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, 'POST', { body });
}

function hasHold(comments) {
  return (comments || []).some(c => /\[compare-hold\]/i.test(c.body || ''));
}

async function createMetaIssue(title, body) {
  const issue = await gh(`/repos/{{GITHUB_OWNER}}/{{ORCHESTRATOR_REPO}}/issues`, 'POST', {
    title,
    body,
    labels: ['meta-validation']
  });
  return issue.html_url;
}

async function main() {
  if (!TOKEN || !PR_REPO || !PR_NUMBER) return;
  const [owner, repo] = PR_REPO.split('/');
  const pr = await gh(`/repos/${owner}/${repo}/pulls/${PR_NUMBER}`);
  const comments = await gh(`/repos/${owner}/${repo}/issues/${PR_NUMBER}/comments?per_page=100`);
  const cross = getCrossReviewComments(comments);

  const masked = maskProject(repo);
  const previewUrl = await findPreviewUrl(owner, repo, pr, comments);

  if (EVENT_TYPE === 'comparison-baseline') {
    if (!previewUrl) {
      if (!hasHold(comments)) {
        await markCompareHold(owner, repo, PR_NUMBER, 'Preview not available');
        await sendTelegram(`⏸️ 비교 리포트 보류 (${masked})\nPreview 미존재 → Baseline 캡처 대기`);
      }
      return;
    }
    const latest = cross[cross.length - 1];
    const counts = countTags(latest?.body || '');
    await ensureBaselineComment(owner, repo, PR_NUMBER, previewUrl, counts);
    if (process.env.COMPARE_BASELINE_NOTIFY === 'true') {
      await sendTelegram(`📌 Baseline captured (${masked})\nPR #${PR_NUMBER}`);
    }
    return;
  }

  if (EVENT_TYPE === 'comparison-ready') {
    const baseline = parseBaseline(comments);
    const latest = cross[cross.length - 1];
    if (!baseline || !latest) {
      await sendTelegram(`⚠️ 비교 리포트 실패 (${masked})\nBaseline 또는 리뷰 데이터 없음`);
      return;
    }
    if (!previewUrl || !baseline.url) {
      if (!hasHold(comments)) {
        await markCompareHold(owner, repo, PR_NUMBER, 'Preview not available');
        await sendTelegram(`⏸️ 비교 리포트 보류 (${masked})\nPreview 미존재 → 비교 리포트 생성 대기`);
      }
      return;
    }

    const finalCounts = countTags(latest.body || '');
    const findings = {
      blockers: extractFindings(latest.body || '', 'BLOCKER'),
      suggestions: extractFindings(latest.body || '', 'SUGGESTION'),
      uiux: extractFindings(latest.body || '', 'UI')
        .concat(extractFindings(latest.body || '', 'UX')),
      personalization: extractFindings(latest.body || '', 'PERSONAL'),
    };

    const prStats = {
      files: pr.changed_files || 0,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
    };

    const report = buildReport(masked, baseline.url, previewUrl, baseline.counts, finalCounts, findings, prStats);
    const issueUrl = await createMetaIssue(`[compare] ${masked} PR#${PR_NUMBER}`, report.markdown);
    await markCompareReport(owner, repo, PR_NUMBER, issueUrl);

    const summary = buildUserSummary(baseline.counts, finalCounts, findings);
    const beforeLine = baseline.url ? 'Before: OK' : 'Before: N/A (no preview)';
    const afterLine = previewUrl ? 'After: OK' : 'After: N/A (no preview)';

    await sendTelegram(`📈 비교 리포트 완료 (${masked})\n${issueUrl}\n${beforeLine}\n${afterLine}\n요약: ${summary.summary.join(', ')}`);
    await sendPhoto(report.beforeShot, `Before (${masked})`);
    await sendPhoto(report.afterShot, `After (${masked})`);
  }
}

main().catch(async (err) => {
  console.error(err);
  await sendTelegram(`❌ 비교 리포트 실패: ${err.message}`).catch(() => {});
  process.exit(1);
});
