/**
 * Visual Reporter — Before/After comparison stage.
 *
 * Fires after rework-agent successfully pushes a fix commit. Captures
 * screenshots of up to 3 routes at prevSha and newSha via Vercel preview
 * URLs, composes side-by-side diffs with sharp, commits them to the
 * orchestrator repo at visual-reports/<pr>/, and posts a single PR
 * comment + Telegram sendMediaGroup.
 *
 * Contract:
 *   - Never throws — failure is logged + a skip comment posted. Exits 0.
 *   - Idempotent via circuit breaker (3-strike rule per PR).
 *   - Reads VISUAL_REVIEW_PROVIDER to pick provider; "off" is handled at
 *     the workflow layer (we never see the "off" case here).
 *
 * Required env:
 *   GH_PAT, PR_NUMBER, PR_REPO, PR_BRANCH, PREV_SHA, NEW_SHA,
 *   ORCHESTRATOR_REPO (owner/name of the orchestrator repo).
 *
 * Optional:
 *   VERCEL_TOKEN, VERCEL_PROJECT_ID    — to resolve preview URLs
 *   BROWSERLESS_API_KEY                — if provider=browserless
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 */

const fs = require('fs');
const path = require('path');
const { Octokit } = require('@octokit/rest');
const { detectRoutes } = require('../lib/route-detection');
const { recordFailure, recordSuccess, isBlocked } = require('../lib/circuit-breaker');

const COMMIT_AUTHOR = {
  name: 'solo-cto-agent[bot]',
  email: 'noreply@users.noreply.github.com',
};

function log(...args) {
  console.log('[visual-reporter]', ...args);
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function optional(name) {
  return process.env[name] || '';
}

function loadProvider() {
  const kind = (process.env.VISUAL_REVIEW_PROVIDER || 'playwright').toLowerCase();
  if (kind === 'browserless') {
    return {
      name: 'browserless',
      mod: require('../lib/screenshot-providers/browserless-provider'),
    };
  }
  return {
    name: 'playwright',
    mod: require('../lib/screenshot-providers/playwright-provider'),
  };
}

async function getPRContext(gh, repo, prNumber) {
  const [owner, name] = repo.split('/');
  const pr = await gh.pulls.get({ owner, repo: name, pull_number: prNumber });
  let issueBody = '';
  // Grep "Closes #N" / "Fixes #N" from PR body to pull linked issue text
  const m = (pr.data.body || '').match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  if (m) {
    try {
      const issue = await gh.issues.get({
        owner,
        repo: name,
        issue_number: parseInt(m[1], 10),
      });
      issueBody = issue.data.body || '';
    } catch {}
  }
  return {
    title: pr.data.title || '',
    body: pr.data.body || '',
    issueBody,
  };
}

/**
 * Hit Vercel API to find the deployment for a specific commit SHA.
 * Returns the preview URL or null if not found / not configured.
 */
async function resolvePreviewUrl(sha) {
  const token = optional('VERCEL_TOKEN');
  const projectId = optional('VERCEL_PROJECT_ID');
  if (!token || !projectId) return null;

  const url = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&meta-githubCommitSha=${encodeURIComponent(sha)}&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      log(`vercel api ${res.status} for sha ${sha}`);
      return null;
    }
    const data = await res.json();
    const d = (data.deployments || [])[0];
    if (!d) return null;
    const host = d.url; // e.g. "myapp-abc123.vercel.app"
    if (!host) return null;
    return `https://${host}`;
  } catch (err) {
    log(`vercel lookup failed: ${err.message}`);
    return null;
  }
}

/**
 * Compose a side-by-side (Before | After) PNG using sharp.
 */
async function composeSideBySide(beforePath, afterPath, outPath) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    throw new Error(`sharp not installed: ${e.message}`);
  }

  const [beforeMeta, afterMeta] = await Promise.all([
    sharp(beforePath).metadata(),
    sharp(afterPath).metadata(),
  ]);

  const height = Math.max(beforeMeta.height || 800, afterMeta.height || 800);
  const width = Math.max(beforeMeta.width || 1280, afterMeta.width || 1280);
  const gap = 16;

  // Normalize both to same height so they line up
  const beforeBuf = await sharp(beforePath)
    .resize({ width, height, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
  const afterBuf = await sharp(afterPath)
    .resize({ width, height, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp({
    create: {
      width: width * 2 + gap,
      height,
      channels: 4,
      background: { r: 240, g: 240, b: 240, alpha: 1 },
    },
  })
    .composite([
      { input: beforeBuf, top: 0, left: 0 },
      { input: afterBuf, top: 0, left: width + gap },
    ])
    .png()
    .toFile(outPath);
}

/**
 * Commit a set of files to the orchestrator repo's main branch via the
 * contents API. Uses solo-cto-agent[bot] as author/committer.
 */
async function commitFilesToOrchestrator(gh, orchRepo, prNumber, files) {
  const [owner, name] = orchRepo.split('/');
  for (const file of files) {
    const content = fs.readFileSync(file.localPath);
    const b64 = content.toString('base64');
    const repoPath = `visual-reports/${prNumber}/${file.repoName}`;

    let sha;
    try {
      const existing = await gh.repos.getContent({
        owner,
        repo: name,
        path: repoPath,
      });
      sha = existing.data.sha;
    } catch {}

    await gh.repos.createOrUpdateFileContents({
      owner,
      repo: name,
      path: repoPath,
      message: `chore(visual-report): capture #${prNumber} ${file.repoName}`,
      content: b64,
      sha,
      author: COMMIT_AUTHOR,
      committer: COMMIT_AUTHOR,
    });
  }
}

function rawGithubUrl(orchRepo, prNumber, fileName) {
  const [owner, name] = orchRepo.split('/');
  return `https://raw.githubusercontent.com/${owner}/${name}/main/visual-reports/${prNumber}/${fileName}`;
}

async function postPRComment(gh, prRepo, prNumber, body) {
  const [owner, name] = prRepo.split('/');
  await gh.issues.createComment({
    owner,
    repo: name,
    issue_number: prNumber,
    body,
  });
}

async function telegramSendMediaGroup(photos, caption) {
  const token = optional('TELEGRAM_BOT_TOKEN');
  const chatId = optional('TELEGRAM_CHAT_ID');
  if (!token || !chatId) return;
  if (!photos.length) return;

  // Telegram sendMediaGroup takes up to 10 items; first caption attaches
  // to album. Use single sendPhoto when only one item.
  try {
    if (photos.length === 1) {
      await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photos[0],
          caption,
          parse_mode: 'HTML',
        }),
      });
      return;
    }
    const media = photos.slice(0, 10).map((p, i) => ({
      type: 'photo',
      media: p,
      ...(i === 0 ? { caption, parse_mode: 'HTML' } : {}),
    }));
    await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, media }),
    });
  } catch (err) {
    log(`telegram send failed: ${err.message}`);
  }
}

async function postSkipComment(gh, prRepo, prNumber, reason) {
  try {
    await postPRComment(
      gh,
      prRepo,
      prNumber,
      `[visual-report-skipped: ${reason}]`
    );
  } catch {}
}

async function main() {
  const prRepo = required('PR_REPO');
  const prNumber = parseInt(required('PR_NUMBER'), 10);
  const prBranch = required('PR_BRANCH');
  const prevSha = required('PREV_SHA');
  const newSha = required('NEW_SHA');
  const orchRepo = required('ORCHESTRATOR_REPO');
  const token = required('GH_PAT');

  const gh = new Octokit({ auth: token });

  // Circuit breaker: 3 strikes per PR under agent id "visual-report".
  if (isBlocked(prRepo.split('/')[1], prNumber, 'visual-report')) {
    log('circuit breaker blocked — skipping');
    await postSkipComment(gh, prRepo, prNumber, 'circuit-breaker');
    return;
  }

  try {
    // 1. Resolve preview URLs for both SHAs
    const [beforeBase, afterBase] = await Promise.all([
      resolvePreviewUrl(prevSha),
      resolvePreviewUrl(newSha),
    ]);

    if (!beforeBase || !afterBase) {
      log(`no preview URL — before=${!!beforeBase} after=${!!afterBase}`);
      await postSkipComment(gh, prRepo, prNumber, 'no-preview-url');
      return;
    }

    // 2. Detect routes
    const ctx = await getPRContext(gh, prRepo, prNumber);
    const routes = detectRoutes(ctx, { max: 3 });
    log(`routes: ${routes.join(', ')}`);

    // 3. Screenshot all routes at both SHAs
    const provider = loadProvider();
    log(`using provider: ${provider.name}`);

    const workDir = path.join(process.cwd(), '.visual-report-work', String(prNumber));
    fs.mkdirSync(workDir, { recursive: true });

    const beforeTargets = routes.map((r, i) => ({
      url: beforeBase + r,
      outputPath: path.join(workDir, `before-${i}.png`),
    }));
    const afterTargets = routes.map((r, i) => ({
      url: afterBase + r,
      outputPath: path.join(workDir, `after-${i}.png`),
    }));

    const [beforeRes, afterRes] = await Promise.all([
      provider.mod.capture(beforeTargets),
      provider.mod.capture(afterTargets),
    ]);

    // 4. Compose side-by-side for each route that has both shots
    const composed = [];
    for (let i = 0; i < routes.length; i++) {
      const b = beforeRes[i];
      const a = afterRes[i];
      if (!b.ok || !a.ok) {
        log(`route ${routes[i]}: skipping compose (before.ok=${b.ok} after.ok=${a.ok})`);
        continue;
      }
      const outPath = path.join(workDir, `compare-${i}.png`);
      await composeSideBySide(b.outputPath, a.outputPath, outPath);
      composed.push({
        route: routes[i],
        beforePath: b.outputPath,
        afterPath: a.outputPath,
        comparePath: outPath,
      });
    }

    if (!composed.length) {
      log('no successful composites');
      await postSkipComment(gh, prRepo, prNumber, 'screenshot-failed');
      recordFailure(prRepo.split('/')[1], prNumber, 'visual-report');
      return;
    }

    // 5. Commit images + metadata to orchestrator repo
    const filesToCommit = [];
    for (let i = 0; i < composed.length; i++) {
      const c = composed[i];
      filesToCommit.push(
        { localPath: c.beforePath, repoName: `before-${i}.png` },
        { localPath: c.afterPath, repoName: `after-${i}.png` },
        { localPath: c.comparePath, repoName: `compare-${i}.png` }
      );
    }

    const metadata = {
      pr: prNumber,
      repo: prRepo,
      branch: prBranch,
      prevSha,
      newSha,
      beforeBase,
      afterBase,
      routes: composed.map((c, i) => ({
        index: i,
        route: c.route,
        beforeUrl: beforeBase + c.route,
        afterUrl: afterBase + c.route,
        beforeImage: rawGithubUrl(orchRepo, prNumber, `before-${i}.png`),
        afterImage: rawGithubUrl(orchRepo, prNumber, `after-${i}.png`),
        compareImage: rawGithubUrl(orchRepo, prNumber, `compare-${i}.png`),
      })),
      provider: provider.name,
      generatedAt: new Date().toISOString(),
    };

    const metadataPath = path.join(workDir, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    filesToCommit.push({ localPath: metadataPath, repoName: 'metadata.json' });

    await commitFilesToOrchestrator(gh, orchRepo, prNumber, filesToCommit);

    // 6. Post single PR comment with embedded images
    const commentLines = [
      '## Visual Report — Before / After',
      '',
      `**Before** (\`${prevSha.slice(0, 7)}\`) → **After** (\`${newSha.slice(0, 7)}\`)`,
      `Provider: \`${provider.name}\``,
      '',
    ];
    for (const r of metadata.routes) {
      commentLines.push(
        `### \`${r.route}\``,
        '',
        `![compare](${r.compareImage})`,
        '',
        `<sub>[before](${r.beforeImage}) · [after](${r.afterImage}) · [preview-before](${r.beforeUrl}) · [preview-after](${r.afterUrl})</sub>`,
        ''
      );
    }
    await postPRComment(gh, prRepo, prNumber, commentLines.join('\n'));

    // 7. Telegram
    const photos = metadata.routes.map((r) => r.compareImage);
    const caption = [
      `<b>Visual Report</b> — PR #${prNumber}`,
      `<code>${prRepo}</code>`,
      `Routes: ${metadata.routes.map((r) => r.route).join(', ')}`,
    ].join('\n');
    await telegramSendMediaGroup(photos, caption);

    recordSuccess(prRepo.split('/')[1], prNumber, 'visual-report');
    log('done');
  } catch (err) {
    log(`failure: ${err.stack || err.message}`);
    recordFailure(prRepo.split('/')[1], prNumber, 'visual-report');
    // Best-effort skip comment so humans know what happened
    await postSkipComment(gh, prRepo, prNumber, `error: ${err.message.slice(0, 120)}`);
    // Intentionally exit 0 — visual report must not fail the workflow.
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[visual-reporter] uncaught', err);
    process.exit(0);
  }
);
