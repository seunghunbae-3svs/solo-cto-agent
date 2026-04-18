const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_TITLE = process.env.ISSUE_TITLE;
const ISSUE_BODY = process.env.ISSUE_BODY;
const OWNER = '{{GITHUB_OWNER}}';

// ?? Embedded skill knowledge (from Cowork skills) ??
const SKILL_CONTEXT = `
## Ship-Zero Protocol 寃利?泥댄겕由ъ뒪??
- Prisma: schema validate, generate ??대컢, postinstall ?ㅽ겕由쏀듃
- NextAuth: import 寃쎈줈 (@/lib/), 肄쒕갚 濡쒖쭅, ?몄뀡 ?ㅼ젙
- Vercel 鍮뚮뱶: env 蹂??議댁옱 ?뺤씤, build command, output directory
- TypeScript: strict 紐⑤뱶, any ????쒓굅, ????꾨씫
- Supabase: RLS ?뺤콉, service_role vs anon key 援щ텇, N+1 荑쇰━

## Project Dev Guide ?먮윭 ?⑦꽩
- import 寃쎈줈 ?먮윭: ./relative ??@/absolute 蹂???꾩닔
- Prisma + Drizzle ?쇱옱 湲덉?: ?섎굹留??ъ슜
- NextAuth 肄쒕갚?먯꽌 session.user ?뺤옣 ??types ?뚯씪 ?꾩슂
- Vercel 諛고룷 ?ㅽ뙣 80%: env 蹂???꾨씫 ?먮뒗 prisma generate ??대컢

## 肄붾뵫 洹쒖튃
- 理쒖냼 ?덉쟾 ?섏젙: ?붿껌 踰붿쐞 諛?由ы뙥?곕쭅 湲덉?
- ?먮윭 泥섎━: 議곗슜???쇳궎吏 ?딆쓬, 援ъ“?붾맂 ?먮윭 諛섑솚
- PR 蹂몃Ц ?꾩닔: 蹂寃??붿빟, 由ъ뒪?? 濡ㅻ갚 諛⑸쾿, Preview 留곹겕
- ?⑺듃 湲곕컲: 異붿젙怨??뺤젙 援щ텇 [?뺤젙] / [異붿젙] / [誘멸?利?
`;

async function gh(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'BDA-Claude-Worker',
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
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        if (err.includes('rate_limit') || err.includes('overloaded')) {
          console.log(`Rate limited, waiting ${(attempt+1)*30}s...`);
          await new Promise(r => setTimeout(r, (attempt+1) * 30000));
          continue;
        }
        throw new Error(`Anthropic ${res.status}: ${err}`);
      }
      const data = await res.json();
      return data.content[0].text;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, (attempt+1) * 15000));
    }
  }
}

function parseTargetRepo() {
  const match = ISSUE_TITLE.match(/\[([^\]]+)\]/);
  if (!match) return null;
  const key = match[1].toLowerCase();
  const map = {
    {{PRODUCT_REPO_4}}: '{{PRODUCT_REPO_4}}', '{{PRODUCT_REPO_5}}': '{{PRODUCT_REPO_5}}', 'sample-event': '{{PRODUCT_REPO_5}}',
    '{{PRODUCT_REPO_2}}': '{{PRODUCT_REPO_2}}', golf: '{{PRODUCT_REPO_2}}',
    '{{PRODUCT_REPO_1}}': '{{PRODUCT_REPO_1}}', 'sample-store': '{{PRODUCT_REPO_1}}',
    '{{PRODUCT_REPO_3}}': '{{PRODUCT_REPO_3}}', 'sample-app': '{{PRODUCT_REPO_3}}',
  };
  return map[key] || null;
}

async function readRepoFiles(repoName) {
  const tree = await gh(`/repos/${OWNER}/${repoName}/git/trees/main?recursive=1`);
  const files = {};
  const important = tree.tree
    .filter(f => f.type === 'blob')
    .filter(f => {
      const ext = f.path.split('.').pop();
      return ['ts','tsx','js','jsx','json','prisma','mjs'].includes(ext)
        && !f.path.includes('node_modules') && !f.path.includes('.next')
        && f.size < 30000;
    })
    .sort((a, b) => {
      const p = f => {
        if (f.path.includes('package.json') || f.path.includes('config')) return 0;
        if (f.path.includes('schema.prisma')) return 1;
        if (f.path.includes('api/') || f.path.includes('route')) return 2;
        if (f.path.includes('lib/') || f.path.includes('utils')) return 3;
        if (f.path.includes('auth')) return 4;
        return 5;
      };
      return p(a) - p(b);
    })
    .slice(0, 15);

  for (const f of important) {
    try {
      const content = await gh(`/repos/${OWNER}/${repoName}/contents/${f.path}?ref=main`);
      files[f.path] = Buffer.from(content.content, 'base64').toString('utf-8').substring(0, 2000);
    } catch {}
  }
  return files;
}

async function findPreviewUrl(repoName, pr) {
  const sha = pr?.head?.sha;
  if (!sha) return null;
  try {
    const deploys = await gh(`/repos/${OWNER}/${repoName}/deployments?sha=${sha}&per_page=5`);
    for (const d of deploys) {
      const statuses = await gh(`/repos/${OWNER}/${repoName}/deployments/${d.id}/statuses`);
      const success = statuses.find(s => s.state === 'success');
      if (success) return success.environment_url || success.target_url || null;
    }
  } catch {}
  return null;
}

function previewScreenshotUrl(previewUrl) {
  if (!previewUrl) return null;
  if (!/^https?:\/\//i.test(previewUrl)) return null;
  const safe = encodeURIComponent(previewUrl);
  return `https://image.thum.io/get/width/1200/${safe}`;
}

async function createPR(repoName, branchName, changes, prTitle, prBody) {
  const mainRef = await gh(`/repos/${OWNER}/${repoName}/git/ref/heads/main`);
  try {
    await gh(`/repos/${OWNER}/${repoName}/git/refs`, 'POST', {
      ref: `refs/heads/${branchName}`, sha: mainRef.object.sha,
    });
  } catch (e) { if (!e.message.includes('Reference already exists')) throw e; }

  for (const [path, content] of Object.entries(changes)) {
    try {
      const existing = await gh(`/repos/${OWNER}/${repoName}/contents/${path}?ref=${branchName}`);
      await gh(`/repos/${OWNER}/${repoName}/contents/${path}`, 'PUT', {
        message: `fix: ${path.split('/').pop()}`, branch: branchName,
        content: Buffer.from(content).toString('base64'), sha: existing.sha,
      });
    } catch {
      await gh(`/repos/${OWNER}/${repoName}/contents/${path}`, 'PUT', {
        message: `add: ${path.split('/').pop()}`, branch: branchName,
        content: Buffer.from(content).toString('base64'),
      });
    }
  }

  const pr = await gh(`/repos/${OWNER}/${repoName}/pulls`, 'POST', {
    title: prTitle, body: prBody, head: branchName, base: 'main',
  });
  try { await gh(`/repos/${OWNER}/${repoName}/issues/${pr.number}/labels`, 'POST', { labels: ['agent-claude'] }); } catch {}
  return pr;
}

async function main() {
  const repoName = parseTargetRepo();
  if (!repoName) { console.log('No target repo'); return; }

  await telegram(`?윢 Claude Worker ?쒖옉\n\n#${ISSUE_NUMBER}: ${ISSUE_TITLE}\nRepo: ${repoName}`);

  const repoFiles = await readRepoFiles(repoName);
  console.log(`Read ${Object.keys(repoFiles).length} files`);

  let fileContext = '';
  for (const [path, content] of Object.entries(repoFiles)) {
    fileContext += `\n=== ${path} ===\n${content}\n`;
  }

  const raw = await claude(`You are Claude, a senior developer working for the team.

${SKILL_CONTEXT}

ISSUE:
${ISSUE_BODY}

CODEBASE:
${fileContext}

TASK:
1. ???ㅽ궗 泥댄겕由ъ뒪??湲곗??쇰줈 肄붾뱶瑜?遺꾩꽍?섏꽭??
2. 踰꾧렇, ????먮윭, 蹂댁븞 臾몄젣, ?깅뒫 臾몄젣瑜?李얠븘 ?섏젙?섏꽭??
3. 蹂寃쎌씠 ?꾩슂???뚯씪留??섏젙蹂몄쓣 諛섑솚?섏꽭??

OUTPUT FORMAT (strict JSON, no markdown wrapping):
{
  "analysis": "?쒓뎅?대줈 ?듭떖 諛쒓껄?ы빆 3以??붿빟",
  "changes": { "path/to/file.ts": "full fixed content" },
  "pr_body": "?쒓뎅??PR 蹂몃Ц: 蹂寃??붿빟, 由ъ뒪?? 濡ㅻ갚 諛⑸쾿",
  "risk_level": "LOW|MEDIUM|HIGH",
  "confidence": 0-100,
  "diff_summary": "蹂寃쎈맂 ?댁슜???뚯씪蹂꾨줈 ??以꾩뵫 ?붿빟 (?쒓뎅??"
}`);

  let result;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    result = JSON.parse(m ? m[0] : raw);
  } catch (e) {
    await telegram(`?좑툘 Claude Worker: ?묐떟 ?뚯떛 ?ㅽ뙣\n${e.message}\n\n?묐떟 ?욌?遺?\n${raw.substring(0, 300)}`);
    return;
  }

  const changes = result.changes || {};
  const changedCount = Object.keys(changes).length;

  if (changedCount === 0) {
    await telegram(`?윢 Claude ?꾨즺: ${repoName}\n\n蹂寃??꾩슂 ?놁쓬\n${result.analysis}`);
    return;
  }

  const branchName = `feature/${ISSUE_NUMBER}-claude`;
  const prTitle = `[Claude] ${repoName}: Issue #${ISSUE_NUMBER} ?ㅽ궗 湲곕컲 ?섏젙`;
  const pr = await createPR(repoName, branchName, changes, prTitle, result.pr_body);

  await gh(`/repos/${OWNER}/${repoName}/issues/${pr.number}/comments`, 'POST', {
    body: `## ?윢 Claude Self-Review (Automated + Skill-based)\n\n**遺꾩꽍**: ${result.analysis}\n**蹂寃??뚯씪**: ${changedCount}媛?n**?꾪뿕??*: ${result.risk_level}\n**?좊ː??*: ${result.confidence}/100\n\n**?곸슜 ?ㅽ궗**: bae-ship-zero, sample-store-dev-guide, coding-rules\n\n?먮룞 ?앹꽦 PR ??援먯감 由щ럭媛 ?먮룞 ?몃━嫄곕맗?덈떎.`,
  });

  // ?? Visual Telegram report ??
  const diffLines = result.diff_summary || Object.keys(changes).map(f => `??${f}`).join('\n');
  
  // Resolve preview URL (if available)
  const previewUrl = await findPreviewUrl(repoName, pr);
  const previewLine = previewUrl || 'Preview pending';

  const report = `?윢 <b>Claude ?묒뾽 ?꾨즺</b>

?벀 <b>${repoName}</b>
?뵕 PR #${pr.number}: ${prTitle}

?곣봺??蹂寃??댁슜 ?곣봺??
${diffLines}

?곣봺??遺꾩꽍 ?곣봺??
${result.analysis}

?뱤 ?꾪뿕?? ${result.risk_level} | ?좊ː?? ${result.confidence}/100
?뵇 Preview: ${previewLine}
?뤇 ?곸슜 ?ㅽ궗: ship-zero, sample-store-dev-guide

?곣봺???ㅼ쓬 ?④퀎 ?곣봺??
援먯감 由щ럭 ?먮룞 吏꾪뻾 以?
"${repoName.split('-')[0]} ?뱀씤" ??merge
"${repoName.split('-')[0]} ?쇰뱶諛?[?댁슜]" ???섏젙 吏??

${pr.html_url}`;

  await telegram(report);

  if (previewUrl) {
    try { await telegramPhoto(previewScreenshotUrl(previewUrl), `${repoName} preview`); } catch {}
  } else {
    try {
      await telegramPhoto(
        `https://opengraph.githubassets.com/1/${OWNER}/${repoName}/pull/${pr.number}`,
        `${repoName} - Claude PR #${pr.number}`
      );
    } catch {}
  }

  console.log(`Done: PR #${pr.number}`);
}

main().catch(async (err) => {
  console.error(err);
  await telegram(`??Claude Worker ?ㅽ뙣: ${err.message}`).catch(() => {});
  process.exit(1);
});






