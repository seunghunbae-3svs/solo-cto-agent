// Patch for Codex Worker — enhanced Telegram reporting
// This is called at the end of codex-worker.js

async function sendVisualReport(telegram, telegramPhoto, repoName, pr, result) {
  const diffLines = Object.keys(result.changes || {}).map(f => `• ${f}`).join('\n');
  
  const report = `🟠 <b>Codex 작업 완료</b>

📦 <b>${repoName}</b>
🔗 PR #${pr.number}: ${pr.title}

━━━ 변경 내용 ━━━
${diffLines}

━━━ 분석 ━━━
${result.analysis || '(없음)'}

📊 위험도: ${result.risk_level || '?'} | 신뢰도: ${result.confidence || '?'}/100

━━━ 다음 단계 ━━━
Claude 교차 리뷰 자동 진행 중
"${repoName.split('-')[0]} 승인" → merge
"${repoName.split('-')[0]} 피드백 [내용]" → 수정 지시

${pr.html_url}`;

  await telegram(report);
  
  // PR OG image as visual
  try {
    const OWNER = '{{GITHUB_OWNER}}';
    await telegramPhoto(
      `https://opengraph.githubassets.com/1/${OWNER}/${repoName}/pull/${pr.number}`,
      `${repoName} — Codex PR #${pr.number}`
    );
  } catch {}
}

module.exports = { sendVisualReport };