const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PR_NUMBER = process.env.PR_NUMBER;
const PR_REPO = process.env.PR_REPO;
const PR_TITLE = process.env.PR_TITLE;

async function gh(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'BDA-Cross-Reviewer',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function telegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
}

async function openai(messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.2, max_tokens: 4000 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

function extractVerdict(text) {
  const match = text.match(/overall verdict:\s*(APPROVE|REQUEST_CHANGES|COMMENT)/i)
    || text.match(/verdict:\s*(APPROVE|REQUEST_CHANGES|COMMENT)/i)
    || text.match(/최종\s*판정[:\s]*(승인|수정요청|보류)/i);
  if (!match) return null;
  const raw = match[1].toUpperCase();
  if (raw.includes('승인')) return 'APPROVE';
  if (raw.includes('수정')) return 'REQUEST_CHANGES';
  if (raw.includes('보류')) return 'COMMENT';
  if (raw === 'REQUEST_CHANGES') return 'REQUEST_CHANGES';
  if (raw === 'COMMENT') return 'COMMENT';
  return 'APPROVE';
}

async function main() {
  // Get PR diff
  const diff = await fetch(`https://api.github.com/repos/${PR_REPO}/pulls/${PR_NUMBER}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3.diff',
      'User-Agent': 'BDA-Cross-Reviewer',
    },
  }).then(r => r.text());

  // Get PR body
  const pr = await gh(`/repos/${PR_REPO}/pulls/${PR_NUMBER}`);
  const isCodex = pr.head.ref.includes('codex');
  const reviewer = isCodex ? 'Claude' : 'Codex';

  await telegram(`🔍 교차 리뷰 시작\n\n${PR_REPO} PR #${PR_NUMBER}\nBy: ${isCodex ? 'Codex' : 'Claude'}\nReviewer: ${reviewer}`);

  const review = await openai([{
    role: 'user',
    content: `You are ${reviewer}, reviewing a PR from ${isCodex ? 'Codex' : 'Claude'}.

PR TITLE: ${PR_TITLE}
PR BODY: ${pr.body || '(none)'}

DIFF:
${diff.substring(0, 8000)}

Review for:
1. Requirement mismatch
2. Regression risk
3. Missing tests
4. Edge cases
5. Security issues
6. Rollback risk
7. UI/UX quality (layout, accessibility, interaction)

For each issue found, classify as: BLOCKER / SUGGESTION / NIT
Include confidence: HIGH / MEDIUM / LOW

End with overall verdict: APPROVE / REQUEST_CHANGES / COMMENT
Write in Korean.`
  }]);

  const verdict = extractVerdict(review) || (review.toLowerCase().includes('blocker') ? 'REQUEST_CHANGES' : 'COMMENT');

  // Post review comment with machine tags
  await gh(`/repos/${PR_REPO}/issues/${PR_NUMBER}/comments`, 'POST', {
    body: `## 🔍 ${reviewer} 교차 리뷰 (자동)\n\nVerdict: ${verdict}\n\n${review}\n\n<!-- cross-reviewer:${reviewer.toLowerCase()} -->`,
  });

  // Check for blockers
  const hasBlocker = review.toLowerCase().includes('blocker');

  const actionLine = hasBlocker ? '결정 필요: 수정 또는 보류' : '결정 가능: 승인 또는 보류';
  const reasonLine = hasBlocker ? '막는 문제(블로커)가 발견되었습니다.' : '막는 문제는 표시되지 않았습니다.';
  const verdictIcon = hasBlocker ? '⛔' : (verdict === 'REQUEST_CHANGES' ? '❌' : '✅');
  await telegram(`${verdictIcon} 교차 리뷰 완료\n\n${PR_REPO} PR #${PR_NUMBER}\n리뷰어: ${reviewer}\nVerdict: ${verdict}\n요약: ${reasonLine}\n${actionLine}\n\n${pr.html_url}`);

  // Auto-dispatch rework when a blocker is detected so the loop runs without
  // a human label. Opt-out with DISABLE_AUTO_REWORK=true. Circuit breaker and
  // max-rounds in rework-agent.js bound the cost.
  const autoReworkDisabled = (process.env.DISABLE_AUTO_REWORK || '').toLowerCase() === 'true';
  if (hasBlocker && !autoReworkDisabled) {
    const target = process.env.GITHUB_REPOSITORY; // orchestrator's own slug
    try {
      await gh(`/repos/${target}/dispatches`, 'POST', {
        event_type: 'rework-request',
        client_payload: {
          repo: PR_REPO,
          pr: PR_NUMBER,
          branch: pr.head.ref,
          title: PR_TITLE,
          url: pr.html_url,
          reason: 'cross-review-blocker',
        },
      });
      console.log('Dispatched rework-request to orchestrator');
      await telegram(`🔧 자동 rework 디스패치됨\n\n${PR_REPO} PR #${PR_NUMBER}\nReason: cross-review blocker`);
    } catch (err) {
      console.error('Failed to dispatch rework:', err.message);
      await telegram(`⚠️ rework 디스패치 실패: ${err.message}`).catch(() => {});
    }
  }
}

main().catch(async (err) => {
  console.error(err);
  await telegram(`❌ 교차 리뷰 실패: ${err.message}`).catch(() => {});
  process.exit(1);
});
