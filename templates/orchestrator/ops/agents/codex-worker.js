const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_TITLE = process.env.ISSUE_TITLE;
const ISSUE_BODY = process.env.ISSUE_BODY;

const OWNER = '{{GITHUB_OWNER}}';

// ── Helpers ──
async function gh(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'BDA-Codex-Worker',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function telegramPhoto(imageUrl, caption) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: imageUrl, caption }),
  });
}

async function telegram(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
}

async function openai(messages, model = 'gpt-4o') {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 8000 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ── Parse target repo from issue title [project-name] ──
function parseTargetRepo() {
  const match = ISSUE_TITLE.match(/\[([^\]]+)\]/);
  if (!match) return null;
  const key = match[1].toLowerCase();
  const map = {
    {{PRODUCT_REPO_4}}: '{{PRODUCT_REPO_4}}',
    '{{PRODUCT_REPO_5}}': '{{PRODUCT_REPO_5}}',
    '3stripe': '{{PRODUCT_REPO_5}}',
    '{{PRODUCT_REPO_2}}': '{{PRODUCT_REPO_2}}',
    golf: '{{PRODUCT_REPO_2}}',
    '{{PRODUCT_REPO_1}}': '{{PRODUCT_REPO_1}}',
    tribo: '{{PRODUCT_REPO_1}}',
    '{{PRODUCT_REPO_3}}': '{{PRODUCT_REPO_3}}',
    palate: '{{PRODUCT_REPO_3}}',
  };
  return map[key] || null;
}

// ── Read key files from repo ──
async function readRepoFiles(repoName) {
  const tree = await gh(`/repos/${OWNER}/${repoName}/git/trees/main?recursive=1`);
  const files = {};
  const important = tree.tree
    .filter(f => f.type === 'blob')
    .filter(f => {
      const ext = f.path.split('.').pop();
      return ['ts', 'tsx', 'js', 'jsx', 'json', 'prisma', 'mjs', 'css'].includes(ext)
        && !f.path.includes('node_modules')
        && !f.path.includes('.next')
        && f.size < 30000;
    })
    .sort((a, b) => {
      // Prioritize: config > API routes > components > utils
      const priority = f => {
        if (f.path.includes('package.json') || f.path.includes('config')) return 0;
        if (f.path.includes('schema.prisma')) return 1;
        if (f.path.includes('api/') || f.path.includes('route')) return 2;
        if (f.path.includes('lib/') || f.path.includes('utils')) return 3;
        if (f.path.includes('auth')) return 4;
        return 5;
      };
      return priority(a) - priority(b);
    })
    .slice(0, 15); // Token limit — stay under 30K TPM

  for (const f of important) {
    try {
      const content = await gh(`/repos/${OWNER}/${repoName}/contents/${f.path}?ref=main`);
      const full = Buffer.from(content.content, 'base64').toString('utf-8');
      files[f.path] = full.substring(0, 2000); // Truncate for token limit
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

// ── Create branch + commit changes + PR ──
async function createPR(repoName, branchName, changes, prTitle, prBody) {
  // Get main SHA
  const mainRef = await gh(`/repos/${OWNER}/${repoName}/git/ref/heads/main`);
  const mainSha = mainRef.object.sha;

  // Create branch
  try {
    await gh(`/repos/${OWNER}/${repoName}/git/refs`, 'POST', {
      ref: `refs/heads/${branchName}`,
      sha: mainSha,
    });
  } catch (e) {
    if (!e.message.includes('Reference already exists')) throw e;
  }

  // Commit each file
  for (const [path, content] of Object.entries(changes)) {
    try {
      const existing = await gh(`/repos/${OWNER}/${repoName}/contents/${path}?ref=${branchName}`);
      await gh(`/repos/${OWNER}/${repoName}/contents/${path}`, 'PUT', {
        message: `fix: ${path.split('/').pop()}`,
        content: Buffer.from(content).toString('base64'),
        sha: existing.sha,
        branch: branchName,
      });
    } catch {
      await gh(`/repos/${OWNER}/${repoName}/contents/${path}`, 'PUT', {
        message: `add: ${path.split('/').pop()}`,
        content: Buffer.from(content).toString('base64'),
        branch: branchName,
      });
    }
  }

  // Create PR
  const pr = await gh(`/repos/${OWNER}/${repoName}/pulls`, 'POST', {
    title: prTitle,
    body: prBody,
    head: branchName,
    base: 'main',
  });

  // Add label
  try {
    await gh(`/repos/${OWNER}/${repoName}/issues/${pr.number}/labels`, 'POST', {
      labels: ['agent-codex'],
    });
  } catch {}

  return pr;
}

// ── Main ──
async function main() {
  const repoName = parseTargetRepo();
  if (!repoName) {
    console.log('No target repo found in issue title');
    return;
  }

  await telegram(`🤖 Codex Worker 시작\n\nIssue #${ISSUE_NUMBER}: ${ISSUE_TITLE}\nRepo: ${repoName}`);

  // 1. Read repo files
  console.log(`Reading ${repoName}...`);
  const files = await readRepoFiles(repoName);
  console.log(`Read ${Object.keys(files).length} files`);

  // 2. Build context for OpenAI
  let fileContext = '';
  for (const [path, content] of Object.entries(files)) {
    fileContext += `\n=== ${path} ===\n${content}\n`;
  }

  // 3. Ask OpenAI to analyze and fix
  const prompt = `You are a senior code reviewer and fixer. 

ISSUE:
${ISSUE_BODY}

CODEBASE FILES:
${fileContext}

TASK:
1. Analyze the codebase based on the issue requirements
2. Identify bugs, type errors, missing error handling, security issues, performance problems
3. Generate FIXED versions of files that need changes
4. Only return files that actually need changes



## 절대 금지 규칙 (CRITICAL — 위반 시 PR 자동 reject)
1. 비즈니스 로직 삭제 금지 — 타입 정리/리팩토링 중 기존 기능 코드를 절대 삭제하지 마라
2. API 응답 스키마 변경 금지 — 기존 response 구조({ok: true} 등)를 유지해라
3. 함수 삭제 시 호출부도 반드시 함께 수정해라. 호출만 남기면 런타임 크래시
4. try-catch 에러 핸들링 필수 — 모든 async 함수에 에러 핸들링
5. 'as any' 제거 시 proper 타입으로 교체해라. 로직 자체를 삭제하지 마라
6. JSON.stringify() 등 직렬화 로직 제거 금지
7. DB 스키마 컬럼명 임의 변경 금지 (url을 imageUrl로 바꾸는 등의 변경 금지)

OUTPUT FORMAT (strict JSON):
{
  "analysis": "brief summary of findings",
  "changes": {
    "path/to/file.ts": "full fixed file content",
    "path/to/another.js": "full fixed file content"
  },
  "pr_body": "PR description in Korean with: changes summary, risks, test suggestions",
  "risk_level": "LOW|MEDIUM|HIGH",
  "confidence": 0-100
}

RULES:
- Minimal safe changes only. Do NOT refactor unnecessarily.
- Fix actual bugs, type errors, missing error handling
- Keep backward compatibility
- If unsure, leave the file unchanged
- Return valid JSON only, no markdown wrapping`;

  console.log('Calling OpenAI...');
  let raw;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      raw = await openai([{ role: 'user', content: prompt }]);
      break;
    } catch (e) {
      if (e.message.includes('429') && attempt < 2) {
        const wait = (attempt + 1) * 30;
        console.log(`Rate limited, waiting ${wait}s...`);
        await new Promise(r => setTimeout(r, wait * 1000));
      } else throw e;
    }
  }
  
  // Parse response
  let result;
  try {
    // Try to extract JSON from potential markdown wrapping
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    result = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch (e) {
    await telegram(`⚠️ Codex Worker: OpenAI 응답 파싱 실패\n${e.message}`);
    return;
  }

  const changes = result.changes || {};
  const changedCount = Object.keys(changes).length;

  if (changedCount === 0) {
    await telegram(`✅ Codex Worker 완료: ${repoName}\n\n변경 필요 없음.\n분석: ${result.analysis}`);
    return;
  }

  // 4. Create branch + PR
  const branchName = `feature/${ISSUE_NUMBER}-codex`;
  const prTitle = `[Codex] ${repoName}: Issue #${ISSUE_NUMBER} 자동 수정`;
  
  console.log(`Creating PR with ${changedCount} file changes...`);
  const pr = await createPR(repoName, branchName, changes, prTitle, result.pr_body);

  // 5. Self-review comment
  await gh(`/repos/${OWNER}/${repoName}/issues/${pr.number}/comments`, 'POST', {
    body: `## Codex Self-Review (Automated)\n\n**분석**: ${result.analysis}\n**변경 파일**: ${changedCount}개\n**위험도**: ${result.risk_level}\n**신뢰도**: ${result.confidence}/100\n\n자동 생성된 PR입니다. 교차 리뷰가 자동으로 트리거됩니다.`,
  });

  // 6. Report
  // Visual Telegram report
  const diffLines = Object.keys(changes).map(f => `• ${f}`).join('\n');
  const previewUrl = await findPreviewUrl(repoName, pr);
  const previewLine = previewUrl || 'Preview pending';
  const report = `🟠 Codex 작업 완료\n\n📦 ${repoName}\n🔗 PR #${pr.number}: ${prTitle}\n\n━━━ 변경 내용 ━━━\n${diffLines}\n\n━━━ 분석 ━━━\n${result.analysis || '(없음)'}\n\n📊 위험도: ${result.risk_level} | 신뢰도: ${result.confidence}/100\n🔎 Preview: ${previewLine}\n\n━━━ 다음 단계 ━━━\nClaude 교차 리뷰 자동 진행\n\n${pr.html_url}`;
  await telegram(report);
  if (previewUrl) {
    try { await telegramPhoto(previewScreenshotUrl(previewUrl), `${repoName} preview`); } catch {}
  } else {
    try { await telegramPhoto(`https://opengraph.githubassets.com/1/${OWNER}/${repoName}/pull/${pr.number}`, `${repoName} — Codex PR #${pr.number}`); } catch {}
  }

  console.log(`Done: PR #${pr.number}`);
}

main().catch(async (err) => {
  console.error(err);
  await telegram(`❌ Codex Worker 실패: ${err.message}`).catch(() => {});
  process.exit(1);
});
