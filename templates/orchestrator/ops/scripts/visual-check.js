const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TOKEN = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MODE = process.env.VISUAL_MODE || "check"; // check | baseline
const AUTO_BASELINE = process.env.VISUAL_AUTO_BASELINE !== "false";

const OWNER = "{{GITHUB_OWNER}}";
const ORCH_REPO = "{{ORCHESTRATOR_REPO}}";
const BASELINE_PATH = path.join(process.cwd(), "ops/orchestrator/visual-baselines.json");
const BASELINE_DIR = path.join(process.cwd(), "ops/orchestrator/visual-baselines");
const SCREENSHOT_DIR = path.join(process.cwd(), "ops/orchestrator/visual-screenshots");

// ── PR context (set by workflow when triggered by deployment_status) ──
const PR_NUMBER = process.env.PR_NUMBER || null;
const DEPLOY_URL = process.env.DEPLOY_URL || null;
const PRODUCT_REPO = process.env.PRODUCT_REPO || null;

const CHECKS = [
  { id: "{{PRODUCT_REPO_1}}-home", repo: "{{PRODUCT_REPO_1}}", url: "https://{{PRODUCT_REPO_1}}.vercel.app", title: "Home" },
  { id: "{{PRODUCT_REPO_2}}-home", repo: "{{PRODUCT_REPO_2}}", url: "https://{{PRODUCT_REPO_2}}.vercel.app", title: "Home" },
  { id: "{{PRODUCT_REPO_3}}-home", repo: "{{PRODUCT_REPO_3}}", url: "https://{{PRODUCT_REPO_3}}.vercel.app", title: "Home" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 375, height: 812 },
];

// ── GitHub API ──

async function gh(endpoint, method = "GET", body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "orchestrator-visual-check",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
  });
}

// ── Playwright screenshot ──

async function takeScreenshot(url, viewport, outputPath) {
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    // Fallback to thum.io if Playwright not installed
    return takeScreenshotFallback(url, viewport, outputPath);
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    // Wait for any lazy-loaded content
    await page.waitForTimeout(2000);
    await page.screenshot({ path: outputPath, fullPage: false });

    // Collect console errors
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    return { success: true, errors, method: "playwright" };
  } catch (err) {
    return { success: false, error: err.message, method: "playwright" };
  } finally {
    await browser.close();
  }
}

async function takeScreenshotFallback(url, viewport, outputPath) {
  const safe = encodeURIComponent(url);
  const shotUrl = `https://image.thum.io/get/width/${viewport.width}/${safe}`;
  try {
    const res = await fetch(shotUrl);
    if (!res.ok) throw new Error(`thum.io ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return { success: true, errors: [], method: "thum.io" };
  } catch (err) {
    return { success: false, error: err.message, method: "thum.io" };
  }
}

// ── Baselines ──

function loadBaselines() {
  if (!fs.existsSync(BASELINE_PATH)) return { version: 2, items: {} };
  try { return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")); }
  catch { return { version: 2, items: {} }; }
}

function saveBaselines(data) {
  data.version = 2;
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function hashFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ── Issue / PR comment ──

async function issueExists(id) {
  const query = `repo:${OWNER}/${ORCH_REPO} is:issue is:open "visual-check:id=${id}"`;
  const res = await gh(`/search/issues?q=${encodeURIComponent(query)}`);
  return (res?.total_count || 0) > 0;
}

async function createIssue(check, viewport, baselineHash, currentHash, screenshotPath) {
  try { await gh(`/repos/${OWNER}/${ORCH_REPO}/labels`, "POST", { name: "visual-check", color: "FBCA04", description: "Visual regression check" }); } catch {}

  const body = [
    `## Visual Regression Detected`,
    `- **Repo**: ${check.repo}`,
    `- **Page**: ${check.title}`,
    `- **URL**: ${check.url}`,
    `- **Viewport**: ${viewport.name} (${viewport.width}x${viewport.height})`,
    `- **Baseline hash**: \`${baselineHash || "none"}\``,
    `- **Current hash**: \`${currentHash}\``,
    ``,
    `<!-- visual-check:id=${check.id}-${viewport.name} -->`,
  ].join("\n");

  await gh(`/repos/${OWNER}/${ORCH_REPO}/issues`, "POST", {
    title: `[visual] ${check.repo}: ${check.title} (${viewport.name})`,
    body,
    labels: ["visual-check"],
  });
}

async function commentOnPR(prNumber, repo, results) {
  const lines = [`## Visual Check — ${repo}`, ""];

  for (const r of results) {
    const status = r.changed ? "⚠️ Changed" : "✅ Match";
    lines.push(`- **${r.viewport}** (${r.page}): ${status}`);
    if (r.errors && r.errors.length > 0) {
      lines.push(`  - Console errors: ${r.errors.length}`);
    }
  }

  lines.push("", `_Method: ${results[0]?.method || "unknown"}_`);

  await gh(`/repos/${OWNER}/${repo}/issues/${prNumber}/comments`, "POST", {
    body: lines.join("\n"),
  });
}

// ── Main: PR-triggered mode ──

async function runPRCheck() {
  console.log(`PR mode: #${PR_NUMBER} on ${PRODUCT_REPO} → ${DEPLOY_URL}`);
  ensureDir(SCREENSHOT_DIR);

  const results = [];

  for (const vp of VIEWPORTS) {
    const filename = `pr-${PR_NUMBER}-${vp.name}.png`;
    const outputPath = path.join(SCREENSHOT_DIR, filename);

    const result = await takeScreenshot(DEPLOY_URL, vp, outputPath);

    results.push({
      viewport: `${vp.name} (${vp.width}x${vp.height})`,
      page: DEPLOY_URL,
      success: result.success,
      errors: result.errors || [],
      method: result.method,
      changed: false, // No baseline comparison in PR mode — just screenshot
    });

    if (result.success) {
      console.log(`  ✅ ${vp.name}: screenshot saved`);
    } else {
      console.log(`  ❌ ${vp.name}: ${result.error}`);
    }
  }

  // Comment on PR with results
  if (PR_NUMBER && PRODUCT_REPO) {
    await commentOnPR(PR_NUMBER, PRODUCT_REPO, results);
    console.log(`  💬 PR #${PR_NUMBER} comment posted`);
  }
}

// ── Main: Scheduled baseline mode ──

async function runScheduledCheck() {
  ensureDir(BASELINE_DIR);
  ensureDir(SCREENSHOT_DIR);
  const baselines = loadBaselines();
  let changed = false;

  for (const check of CHECKS) {
    for (const vp of VIEWPORTS) {
      const id = `${check.id}-${vp.name}`;
      const filename = `${id}.png`;
      const outputPath = path.join(SCREENSHOT_DIR, filename);
      const baselinePath = path.join(BASELINE_DIR, filename);

      const result = await takeScreenshot(check.url, vp, outputPath);
      if (!result.success) {
        console.log(`  ⚠️ ${check.repo} ${vp.name}: screenshot failed — ${result.error}`);
        continue;
      }

      const currentHash = hashFile(outputPath);
      const item = baselines.items[id];

      if (!item || MODE === "baseline") {
        // New baseline
        if (!AUTO_BASELINE && MODE !== "baseline") continue;
        fs.copyFileSync(outputPath, baselinePath);
        baselines.items[id] = {
          repo: check.repo,
          url: check.url,
          viewport: vp.name,
          hash: currentHash,
          file: `ops/orchestrator/visual-baselines/${filename}`,
          updated_at: new Date().toISOString(),
        };
        changed = true;
        console.log(`  📸 ${check.repo} ${vp.name}: baseline set`);
        continue;
      }

      if (item.hash !== currentHash) {
        console.log(`  ⚠️ ${check.repo} ${vp.name}: visual change detected`);
        const exists = await issueExists(id);
        if (!exists) {
          await createIssue(check, vp, item.hash, currentHash, outputPath);
          if (process.env.VISUAL_NOTIFY === "true") {
            await sendTelegram(`⚠️ *Visual change*: ${check.repo} ${check.title} (${vp.name})\n${check.url}`);
          }
        }
      } else {
        console.log(`  ✅ ${check.repo} ${vp.name}: no change`);
      }
    }
  }

  if (changed) saveBaselines(baselines);
}

// ── Entry ──

async function main() {
  if (!TOKEN) throw new Error("Missing token");

  if (PR_NUMBER && DEPLOY_URL) {
    await runPRCheck();
  } else {
    await runScheduledCheck();
  }
}

main().catch(async (err) => {
  console.error(err);
  if (process.env.VISUAL_NOTIFY === "true") {
    await sendTelegram(`❌ Visual check failed: ${err.message}`).catch(() => {});
  }
  process.exit(1);
});
