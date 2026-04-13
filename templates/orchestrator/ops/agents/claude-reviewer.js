const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PR_NUMBER = process.env.PR_NUMBER;
const PR_REPO = process.env.PR_REPO;
const PR_TITLE = process.env.PR_TITLE;

const SKILL_REVIEW_CRITERIA = `
## 리뷰 기준 (Ship-Zero Protocol + Project Dev Guide)
1. Import 경로: ./relative 대신 @/ 절대경로 사용했는지
2. Prisma/Drizzle: 혼재 사용 없는지, generate 타이밍 맞는지
3. NextAuth: 콜백 로직, 세션 확장 시 types 파일 있는지
4. Supabase: RLS 정책, service_role vs anon 구분, N+1 쿼리
5. TypeScript: any 타입, 타입 누락, strict 모드 위반
6. 에러 처리: try-catch 누락, 조용한 실패, 구조화 안 된 에러
7. 보안: SQL injection, auth bypass, secret 노출
8. 배포: env 변수 누락, build command, Vercel 설정
`;

async function gh(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'BDA-Claude-Reviewer',
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
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
  });
}

async function telegramPhoto(imageUrl, caption) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: imageUrl, caption }),
  });
}

async function claude(prompt) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        if ((await res.text()).includes('rate_limit')) {
          await new Promise(r => setTimeout(r, (attempt+1) * 30000));
          continue;
        }
        throw new Error(`Anthropic ${res.status}`);
      }
      return (await res.json()).content[0].text;
    } catch (e) { if (attempt === 2) throw e; }
  }
}

async function main() {
  // Get diff
  const diffRes = await fetch(`https://api.github.com/repos/${PR_REPO}/pulls/${PR_NUMBER}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3.diff',
      'User-Agent': 'BDA',
    },
  });
  const diff = (await diffRes.text()).substring(0, 8000);

  const pr = await gh(`/repos/${PR_REPO}/pulls/${PR_NUMBER}`);

  await telegram(`Claude cross-review starting\n${PR_REPO} PR #${PR_NUMBER}\nCodex to Claude review`);

  const review = await claude(`당신은 Claude, the team's senior 개발자입니다. Codex가 만든 PR을 리뷰합니다.

${SKILL_REVIEW_CRITERIA}

PR: ${PR_TITLE}
PR BODY: ${(pr.body || '').substring(0, 2000)}

DIFF:
${diff}

Please review in Korean:
1. Categorize each issue as BLOCKER / SUGGESTION / NIT
2. 파일별로 구체적 라인과 수정 제안
3. 위 스킬 체크리스트 기준 통과 여부
4. 전체 판정: APPROVE / REQUEST_CHANGES / COMMENT
5. 배포 가능 여부 한 줄 판단`);

  await gh(`/repos/${PR_REPO}/issues/${PR_NUMBER}/comments`, 'POST', {
    body: `## Claude Cross-Review (Automated + Skill-based)\n\n${review}\n\n---\nApplied criteria: bae-ship-zero, tribo-dev-guide, coding-rules`,
  });

  const hasBlocker = review.includes('BLOCKER') || review.includes('blocker');
  const verdict = review.includes('APPROVE') && !hasBlocker ? 'APPROVE' : 'REQUEST_CHANGES';

  // Visual Telegram report
  const report = `${hasBlocker ? 'BLOCKED' : 'APPROVED'} Claude cross-review completed

Package: ${PR_REPO}
PR #${PR_NUMBER}: ${PR_TITLE}

Verdict:
${verdict === 'APPROVE' ? 'Ready to merge' : 'Needs revision'}
Blocker: ${hasBlocker ? 'yes' : 'no'}

Review summary:
${review.substring(0, 500)}...

Next action:
${verdict === 'APPROVE'
  ? `Proceed with merge`
  : `Codex notified for revision\nor provide feedback`}

${pr.html_url}`;

  await telegram(report);

  try {
    await telegramPhoto(
      `https://opengraph.githubassets.com/1/${PR_REPO}/pull/${PR_NUMBER}`,
      `Codex PR #${PR_NUMBER} — Claude 리뷰 ${verdict}`
    );
  } catch {}
}

main().catch(async (err) => {
  console.error(err);
  await telegram(`Claude review failed: ${err.message}`).catch(() => {});
  process.exit(1);
});