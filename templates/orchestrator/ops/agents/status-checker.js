const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OWNER = 'seunghunbae-3svs';
const ORCH_REPO = 'dual-agent-review-orchestrator';

const PROJECTS = {
  eventbadge: 'eventbadge',
  '3stripe': '3stripe-event',
  golf: 'golf-now',
  tribo: 'tribo-store',
  palate: 'palate-pilot',
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
  let msg = `📊 6시간 정기 리포트\n${'━'.repeat(20)}\n\n`;
  
  let totalPRs = 0;
  let blockers = 0;
  let needsAction = [];

  for (const [key, repoName] of Object.entries(PROJECTS)) {
    const prs = await gh(`/repos/${OWNER}/${repoName}/pulls?state=open&per_page=10`);
    if (!prs) { msg += `⚪ ${repoName}: 접근 불가\n\n`; continue; }

    const claudePRs = prs.filter(p => p.head.ref.includes('claude'));
    const codexPRs = prs.filter(p => p.head.ref.includes('codex'));
    totalPRs += prs.length;

    msg += `${prs.length > 0 ? '🟢' : '⚪'} ${repoName}\n`;
    msg += `   Claude PR: ${claudePRs.length}개 | Codex PR: ${codexPRs.length}개\n`;

    for (const pr of prs) {
      const comments = await gh(`/repos/${OWNER}/${repoName}/issues/${pr.number}/comments`);
      const hasReview = comments?.some(c => c.body.includes('교차 리뷰'));
      const hasBlocker = comments?.some(c => c.body.toLowerCase().includes('blocker'));
      const hasFeedback = comments?.some(c => c.body.includes('human-feedback'));

      if (hasBlocker) { blockers++; needsAction.push(`${repoName} PR #${pr.number}: blocker`); }
      
      msg += `   └ #${pr.number} ${hasReview ? '✅리뷰됨' : '⏳리뷰대기'}`;
      msg += `${hasBlocker ? ' 🔴blocker' : ''}`;
      msg += `${hasFeedback ? ' 💬피드백' : ''}\n`;
    }
    msg += '\n';
  }

  // Issues
  const issues = await gh(`/repos/${OWNER}/${ORCH_REPO}/issues?state=open&per_page=20`);
  msg += `📋 관제 이슈: ${issues?.length || 0}개 open\n`;
  msg += `📊 전체 PR: ${totalPRs}개 | Blocker: ${blockers}개\n`;

  if (needsAction.length > 0) {
    msg += `\n⚠️ 조치 필요:\n`;
    for (const item of needsAction) msg += `• ${item}\n`;
  }

  if (totalPRs === 0) {
    msg += `\n💤 활성 작업 없음`;
  }

  await telegram(msg);
  console.log('Status check sent');
}

main().catch(async (err) => {
  console.error(err);
  await telegram(`❌ 상태 체크 실패: ${err.message}`).catch(() => {});
  process.exit(1);
});