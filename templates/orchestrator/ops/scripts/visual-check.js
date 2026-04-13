const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TOKEN = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MODE = process.env.VISUAL_MODE || "check"; // check | baseline
const AUTO_BASELINE = process.env.VISUAL_AUTO_BASELINE !== "false";
const WIDTH = parseInt(process.env.VISUAL_WIDTH || "800", 10);

const OWNER = "seunghunbae-3svs";
const ORCH_REPO = "dual-agent-review-orchestrator";
const BASELINE_PATH = path.join(process.cwd(), "ops/orchestrator/visual-baselines.json");
const BASELINE_DIR = path.join(process.cwd(), "ops/orchestrator/visual-baselines");

const CHECKS = [
  { id: "tribo-login", repo: "tribo-store", url: "https://tribo-store.vercel.app/admin/login", title: "Tribo 로그인" },
  { id: "tribo-seller", repo: "tribo-store", url: "https://tribo-store.vercel.app/s/beauty-by-kim", title: "Tribo 셀러" },
  { id: "golf-home", repo: "golf-now", url: "https://golf-now.vercel.app", title: "Golf Now 홈" },
  { id: "palate-home", repo: "palate-pilot", url: "https://palate-pilot.vercel.app", title: "Palate Pilot 홈" },
  { id: "eventbadge-home", repo: "eventbadge", url: "https://eventbadge.vercel.app", title: "EventBadge 홈" },
  { id: "3stripe-home", repo: "3stripe-event", url: "https://3stripe-event.vercel.app", title: "3stripe 홈" },
];

function snapshotUrl(url) {
  const safe = encodeURIComponent(url);
  return `https://image.thum.io/get/width/${WIDTH}/${safe}`;
}

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
    body: JSON.stringify({ chat_id: CHAT_ID, text }),
  });
}

function loadBaselines() {
  if (!fs.existsSync(BASELINE_PATH)) return { version: 1, items: {} };
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return { version: 1, items: {} };
  }
}

function saveBaselines(data) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function hashBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function issueExists(id) {
  const query = `repo:${OWNER}/${ORCH_REPO} is:issue is:open \"visual-check:id=${id}\"`;
  const res = await gh(`/search/issues?q=${encodeURIComponent(query)}`);
  return (res?.total_count || 0) > 0;
}

async function ensureLabel(name, color, description) {
  try {
    await gh(`/repos/${OWNER}/${ORCH_REPO}/labels`, "POST", { name, color, description });
  } catch {}
}

async function createIssue(check, baselineFile, baselineHash, currentUrl, currentHash) {
  await ensureLabel("visual-check", "FBCA04", "Visual regression check");
  const beforeUrl = baselineFile
    ? `https://raw.githubusercontent.com/${OWNER}/${ORCH_REPO}/main/${baselineFile}`
    : "(baseline missing)";
  const body = [
    `## 시각 검증 이슈`,
    `- Repo: ${check.repo}`,
    `- Page: ${check.title}`,
    `- URL: ${check.url}`,
    `- Baseline hash: ${baselineHash || "none"}`,
    `- Current hash: ${currentHash}`,
    ``,
    `### 스크린샷`,
    `- Before: ${beforeUrl}`,
    `- After: ${currentUrl}`,
    ``,
    `<!-- visual-check:id=${check.id} -->`,
  ].join("\n");

  await gh(`/repos/${OWNER}/${ORCH_REPO}/issues`, "POST", {
    title: `[visual] ${check.repo}: ${check.title}`,
    body,
    labels: ["visual-check", "agent-codex", "agent-claude", "dual-review"],
  });
}

async function main() {
  if (!TOKEN) throw new Error("Missing token");
  ensureDir(BASELINE_DIR);
  const baselines = loadBaselines();
  let changed = false;

  for (const check of CHECKS) {
    const shotUrl = snapshotUrl(check.url);
    let buffer;
    try {
      buffer = await fetchBuffer(shotUrl);
    } catch (err) {
      continue;
    }
    const currentHash = hashBuffer(buffer);
    const item = baselines.items[check.id];

    if (!item || MODE === "baseline") {
      if (!AUTO_BASELINE && MODE !== "baseline") continue;
      const fileName = `${check.id}.png`;
      const filePath = path.join(BASELINE_DIR, fileName);
      fs.writeFileSync(filePath, buffer);
      baselines.items[check.id] = {
        repo: check.repo,
        url: check.url,
        hash: currentHash,
        file: `ops/orchestrator/visual-baselines/${fileName}`,
        updated_at: new Date().toISOString(),
      };
      changed = true;
      continue;
    }

    if (item.hash !== currentHash) {
      const exists = await issueExists(check.id);
      if (!exists) {
        await createIssue(check, item.file, item.hash, shotUrl, currentHash);
        if (process.env.VISUAL_NOTIFY === "true") {
          await sendTelegram(`⚠️ 시각 변경 감지: ${check.repo} ${check.title}\n${check.url}`);
        }
      }
    }
  }

  if (changed) {
    saveBaselines(baselines);
  }
}

main().catch(async (err) => {
  console.error(err);
  if (process.env.VISUAL_NOTIFY === "true") {
    await sendTelegram(`❌ 시각 검증 실패: ${err.message}`).catch(() => {});
  }
  process.exit(1);
});
