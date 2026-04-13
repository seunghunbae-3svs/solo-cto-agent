const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OWNER = '{{GITHUB_OWNER}}';
const ORCH_REPO = '{{ORCHESTRATOR_REPO}}';

const PROJECTS = {
  {{PRODUCT_REPO_4}}: '{{PRODUCT_REPO_4}}',
  '3stripe': '{{PRODUCT_REPO_5}}',
  golf: '{{PRODUCT_REPO_2}}',
  tribo: '{{PRODUCT_REPO_1}}',
  palate: '{{PRODUCT_REPO_3}}',
};

async function gh(endpoint) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BDA-Status-Checker',
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function telegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
}

async function main() {
  let msg = `6-hour status report\n${'━'.repeat(20)}\n\n`;
  
  let totalPRs = 0;
  let blockers = 0;
  let needsAction = [];

  for (const [key, repoName] of Object.entries(PROJECTS)) {
    const prs = await gh(`/repos/${OWNER}/${repoName}/pulls?state=open&per_page=10`);
    if (!prs) { msg += `${repoName}: unavailable\n\n`; continue; }

    const claudePRs = prs.filter(p => p.head.ref.includes('claude'));
    const codexPRs = prs.filter(p => p.head.ref.includes('codex'));
    totalPRs += prs.length;

    msg += `${repoName}\n`;
    msg += `   Claude PR: ${claudePRs.length} | Codex PR: ${codexPRs.length}\n`;

    for (const pr of prs) {
      const comments = await gh(`/repos/${OWNER}/${repoName}/issues/${pr.number}/comments`);
      const hasReview = comments?.some(c => c.body.includes('cross-review'));
      const hasBlocker = comments?.some(c => c.body.toLowerCase().includes('blocker'));
      const hasFeedback = comments?.some(c => c.body.includes('human-feedback'));

      if (hasBlocker) { blockers++; needsAction.push(`${repoName} PR #${pr.number}: blocker`); }

      msg += `   # ${pr.number} ${hasReview ? '[REVIEWED]' : '[PENDING]'}`;
      msg += `${hasBlocker ? ' [BLOCKER]' : ''}`;
      msg += `${hasFeedback ? ' [FEEDBACK]' : ''}\n`;
    }
    msg += '\n';
  }

  // Issues
  const issues = await gh(`/repos/${OWNER}/${ORCH_REPO}/issues?state=open&per_page=20`);
  msg += `Orchestrator issues: ${issues?.length || 0} open\n`;
  msg += `Total PR: ${totalPRs} | Blockers: ${blockers}\n`;

  if (needsAction.length > 0) {
    msg += `\nAction Required:\n`;
    for (const item of needsAction) msg += `• ${item}\n`;
  }

  if (totalPRs === 0) {
    msg += `\nNo active work`;
  }

  await telegram(msg);
  console.log('Status check sent');
}

main().catch(async (err) => {
  console.error(err);
  await telegram(`Status check failed: ${err.message}`).catch(() => {});
  process.exit(1);
});