// Patch for Codex Worker — enhanced Telegram reporting
// This is called at the end of codex-worker.js

async function sendVisualReport(telegram, telegramPhoto, repoName, pr, result) {
  const diffLines = Object.keys(result.changes || {}).map(f => `• ${f}`).join('\n');
  
  const report = `Codex completed

Package: <b>${repoName}</b>
PR #${pr.number}: ${pr.title}

Changes:
${diffLines}

Analysis:
${result.analysis || '(none)'}

Risk: ${result.risk_level || '?'} | Confidence: ${result.confidence || '?'}/100

Next steps:
Claude cross-review in progress
Approval → merge
Feedback → revision

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