/**
 * onboard.js — Interactive onboarding for solo-cto-agent.
 *
 * Features:
 *   - Welcome banner with GitHub URL + sponsor link
 *   - Auto-detect user's GitHub repos (no manual config)
 *   - P0-P4 priority classification config
 *   - Confirmation level & notification threshold config
 *   - Deploy review workflow to selected repos
 *   - Batch digest settings (per-project aggregation)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const readline = require("readline");

const CONFIG_DIR = path.join(os.homedir(), ".solo-cto-agent");
const CONFIG_FILE = path.join(CONFIG_DIR, "onboard.json");
const GITHUB_URL = "https://github.com/seunghunbae-3svs/solo-cto-agent";
const SPONSOR_URL = "https://github.com/sponsors/seunghunbae-3svs";
const _NPM_URL = "https://www.npmjs.com/package/solo-cto-agent";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
};

// ─── Priority System ───────────────────────────────────────

const PRIORITIES = Object.freeze({
  P0: { label: "CRITICAL",   icon: "🔴", desc: "Security vulnerability, data loss, production down" },
  P1: { label: "BLOCKER",    icon: "🟠", desc: "Must fix before merge — logic errors, breaking changes" },
  P2: { label: "IMPORTANT",  icon: "🟡", desc: "Should fix — performance, maintainability, test gaps" },
  P3: { label: "SUGGESTION", icon: "🔵", desc: "Nice to have — style, naming, minor improvements" },
  P4: { label: "NIT",        icon: "⚪", desc: "Trivial — cosmetic, preference, optional tweaks" },
});

// ─── Default Config ────────────────────────────────────────

function defaultConfig() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    repos: [],
    confirmation: {
      // What actions need user approval before executing
      autoMerge: false,          // never auto-merge without confirmation
      deployWorkflow: true,      // ask before deploying workflow to repo
      postPrComment: true,       // auto-post review comments on PRs
      requestChanges: true,      // auto-request changes on PRs when blockers found
      autoFix: false,            // auto-commit fixes (dangerous)
    },
    notifications: {
      // Minimum priority to trigger notification
      minPriority: "P1",         // P0=always, P1=blockers+, P2=important+, P3=suggestions+, P4=everything
      batchDigest: true,         // aggregate per-project instead of per-PR
      digestInterval: "daily",   // "immediate" | "hourly" | "daily"
      channels: ["console"],     // auto-detected: console, telegram, slack, discord
      quietHours: null,          // e.g. { start: "22:00", end: "08:00", tz: "Asia/Seoul" }
    },
    review: {
      passes: 3,                 // 1-pass, 2-pass (cross-check), or 3-pass (+ UI/UX)
      priorityLevels: ["P0", "P1", "P2", "P3", "P4"],
      skipThreshold: 3,          // skip review if diff < N lines
      maxDiffLines: 5000,        // truncate diff if > N lines
    },
  };
}

// ─── GitHub API ────────────────────────────────────────────

function ghApi(apiPath, token, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: "api.github.com",
      path: apiPath,
      method,
      headers: {
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "solo-cto-agent",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 300)}`));
        } else {
          resolve(data ? JSON.parse(data) : {});
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Welcome Banner ────────────────────────────────────────

function printBanner() {
  const ver = (() => {
    try {
      return require(path.join(__dirname, "..", "package.json")).version;
    } catch (_) {
      return "1.x";
    }
  })();

  const lines = [
    "",
    `${C.bold}${C.cyan}  ╔══════════════════════════════════════════════════════════╗${C.reset}`,
    `${C.bold}${C.cyan}  ║                                                          ║${C.reset}`,
    `${C.bold}${C.cyan}  ║${C.reset}   ${C.bold}${C.white}solo-cto-agent${C.reset}${C.gray} v${ver}${C.reset}                                ${C.bold}${C.cyan}║${C.reset}`,
    `${C.bold}${C.cyan}  ║${C.reset}   ${C.dim}Your AI-powered CTO in the terminal${C.reset}                  ${C.bold}${C.cyan}║${C.reset}`,
    `${C.bold}${C.cyan}  ║                                                          ║${C.reset}`,
    `${C.bold}${C.cyan}  ╠══════════════════════════════════════════════════════════╣${C.reset}`,
    `${C.bold}${C.cyan}  ║                                                          ║${C.reset}`,
    `${C.bold}${C.cyan}  ║${C.reset}   ${C.green}◆${C.reset} 3-pass automated code review (Claude API)         ${C.bold}${C.cyan}║${C.reset}`,
    `${C.bold}${C.cyan}  ║${C.reset}   ${C.green}◆${C.reset} P0-P4 priority classification                    ${C.bold}${C.cyan}║${C.reset}`,
    `${C.bold}${C.cyan}  ║${C.reset}   ${C.green}◆${C.reset} Batch digest — no notification fatigue             ${C.bold}${C.cyan}║${C.reset}`,
    `${C.bold}${C.cyan}  ║${C.reset}   ${C.green}◆${C.reset} GitHub Actions CI/CD integration                  ${C.bold}${C.cyan}║${C.reset}`,
    `${C.bold}${C.cyan}  ║                                                          ║${C.reset}`,
    `${C.bold}${C.cyan}  ╠══════════════════════════════════════════════════════════╣${C.reset}`,
    `${C.bold}${C.cyan}  ║                                                          ║${C.reset}`,
    `${C.bold}${C.cyan}  ║${C.reset}   ${C.blue}GitHub${C.reset}  ${C.dim}${GITHUB_URL}${C.reset}`,
    `${C.bold}${C.cyan}  ║${C.reset}   ${C.magenta}Sponsor${C.reset} ${C.dim}${SPONSOR_URL}${C.reset}`,
    `${C.bold}${C.cyan}  ║                                                          ║${C.reset}`,
    `${C.bold}${C.cyan}  ╚══════════════════════════════════════════════════════════╝${C.reset}`,
    "",
  ];
  console.log(lines.join("\n"));
}

// ─── Repo Discovery ────────────────────────────────────────

async function discoverRepos(token) {
  console.log(`\n${C.bold}🔍 Discovering your GitHub repos...${C.reset}\n`);

  const repos = await ghApi("/user/repos?sort=pushed&per_page=50&affiliation=owner,collaborator,organization_member", token);

  if (!Array.isArray(repos) || repos.length === 0) {
    console.log(`${C.yellow}  No repos found.${C.reset}`);
    return [];
  }

  // Detect which repos already have solo-cto-review.yml
  const results = [];
  for (const repo of repos) {
    let hasWorkflow = false;
    try {
      await ghApi(`/repos/${repo.full_name}/contents/.github/workflows/solo-cto-review.yml`, token);
      hasWorkflow = true;
    } catch (_) { /* not found */ }

    // Detect if repo has ANTHROPIC_API_KEY secret
    let hasApiKey = false;
    try {
      await ghApi(`/repos/${repo.full_name}/actions/secrets/ANTHROPIC_API_KEY`, token);
      hasApiKey = true;
    } catch (_) { /* not found or no permission */ }

    results.push({
      name: repo.name,
      fullName: repo.full_name,
      language: repo.language || "unknown",
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
      url: repo.html_url,
      hasWorkflow,
      hasApiKey,
      pushedAt: repo.pushed_at,
    });
  }

  return results;
}

function formatRepoList(repos) {
  if (!repos.length) return "";

  let out = `${C.bold}  #  Repo                              Lang        Status${C.reset}\n`;
  out += `${C.gray}  ${"─".repeat(70)}${C.reset}\n`;

  for (let i = 0; i < repos.length; i++) {
    const r = repos[i];
    const idx = String(i + 1).padStart(3);
    const name = r.fullName.padEnd(35);
    const lang = (r.language || "—").padEnd(12);

    const status = r.hasWorkflow && r.hasApiKey
      ? `${C.green}✅ Active${C.reset}`
      : r.hasWorkflow
      ? `${C.yellow}⚠️  No API Key${C.reset}`
      : `${C.gray}○ Not enabled${C.reset}`;

    const priv = r.isPrivate ? `${C.dim}🔒${C.reset}` : `${C.dim}🌐${C.reset}`;
    out += `  ${C.bold}${idx}${C.reset}  ${priv} ${name} ${lang} ${status}\n`;
  }

  const active = repos.filter(r => r.hasWorkflow).length;
  out += `\n${C.gray}  Total: ${repos.length} repos · ${active} with review enabled${C.reset}\n`;
  return out;
}

// ─── Priority Format Helpers ───────────────────────────────

function formatPriorityTable() {
  let out = `\n${C.bold}  Priority Levels:${C.reset}\n`;
  for (const [key, val] of Object.entries(PRIORITIES)) {
    out += `  ${val.icon} ${C.bold}${key}${C.reset} ${val.label.padEnd(12)} ${C.gray}${val.desc}${C.reset}\n`;
  }
  return out;
}

// ─── Interactive Prompt ────────────────────────────────────

function createPrompt() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ─── Config Persistence ────────────────────────────────────

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch (_) { /* corrupt — reset */ }
  return defaultConfig();
}

function saveConfig(config) {
  ensureConfigDir();
  config.updatedAt = new Date().toISOString();
  const tmp = CONFIG_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), "utf8");
  fs.renameSync(tmp, CONFIG_FILE);
  return CONFIG_FILE;
}

// ─── Workflow Deployment ───────────────────────────────────

async function deployWorkflow(repo, token, templatePath) {
  const templateContent = fs.readFileSync(templatePath, "utf8");
  const filePath = ".github/workflows/solo-cto-review.yml";
  const [owner, repoName] = repo.fullName.split("/");

  // Check existing
  let existingSha = null;
  try {
    const existing = await ghApi(`/repos/${owner}/${repoName}/contents/${filePath}?ref=${repo.defaultBranch}`, token);
    existingSha = existing.sha;
  } catch (_) { /* not found */ }

  const content = Buffer.from(templateContent).toString("base64");
  const commitMsg = existingSha
    ? "chore: update solo-cto 3-pass review workflow (onboard)"
    : "chore: add solo-cto 3-pass review workflow (onboard)";

  const putBody = {
    message: commitMsg,
    content,
    branch: repo.defaultBranch,
    committer: { name: "solo-cto-agent", email: "solo-cto-agent@users.noreply.github.com" },
  };
  if (existingSha) putBody.sha = existingSha;

  await ghApi(`/repos/${owner}/${repoName}/contents/${filePath}`, token, "PUT", putBody);
  return { created: !existingSha, path: filePath };
}

// ─── Main Onboard Flow ─────────────────────────────────────

async function runOnboard(options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const nonInteractive = options.yes || options.nonInteractive || false;
  const jsonOutput = options.json || false;
  const templatePath = options.templatePath || path.join(__dirname, "..", "templates", "workflows", "solo-cto-review.yml");

  // 1. Welcome Banner
  if (!jsonOutput) {
    printBanner();
  }

  // 2. Check prerequisites
  if (!token) {
    console.error(`${C.red}${C.bold}  ❌ GITHUB_TOKEN not found.${C.reset}`);
    console.error(`${C.gray}  Set it: export GITHUB_TOKEN=ghp_...${C.reset}`);
    console.error(`${C.gray}  Or pass: solo-cto-agent onboard --token ghp_...${C.reset}`);
    process.exit(1);
  }

  if (!fs.existsSync(templatePath)) {
    console.error(`${C.red}  ❌ Workflow template not found: ${templatePath}${C.reset}`);
    process.exit(1);
  }

  // 3. Load existing config
  const config = loadConfig();

  // 4. Discover repos
  const repos = await discoverRepos(token);

  if (jsonOutput) {
    const result = { repos, config, priorities: PRIORITIES };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(formatRepoList(repos));
  console.log(formatPriorityTable());

  // 5. Interactive setup
  if (nonInteractive) {
    // Auto-select repos that don't have workflow yet
    const toEnable = repos.filter(r => !r.hasWorkflow);
    console.log(`\n${C.bold}  Auto-enabling ${toEnable.length} repos...${C.reset}\n`);

    for (const repo of toEnable) {
      try {
        const result = await deployWorkflow(repo, token, templatePath);
        console.log(`  ${C.green}✅${C.reset} ${repo.fullName} — workflow ${result.created ? "created" : "updated"}`);
        config.repos.push({
          fullName: repo.fullName,
          enabledAt: new Date().toISOString(),
          defaultBranch: repo.defaultBranch,
        });
      } catch (err) {
        console.log(`  ${C.red}❌${C.reset} ${repo.fullName} — ${err.message}`);
      }
    }

    saveConfig(config);
    printSummary(config, repos);
    return config;
  }

  // Interactive mode
  const rl = createPrompt();

  try {
    // Ask which repos to enable
    const notEnabled = repos.filter(r => !r.hasWorkflow);

    if (notEnabled.length > 0) {
      console.log(`\n${C.bold}  Which repos would you like to enable? ${C.reset}`);
      console.log(`${C.gray}  Enter numbers separated by commas (e.g., 1,3,5), "all", or "skip":${C.reset}\n`);

      const answer = await ask(rl, `${C.cyan}  > ${C.reset}`);

      let selectedRepos = [];
      if (answer.toLowerCase() === "all") {
        selectedRepos = notEnabled;
      } else if (answer.toLowerCase() !== "skip" && answer !== "") {
        const indices = answer.split(",").map(s => parseInt(s.trim(), 10) - 1);
        selectedRepos = indices.filter(i => i >= 0 && i < repos.length).map(i => repos[i]).filter(r => !r.hasWorkflow);
      }

      if (selectedRepos.length > 0) {
        console.log(`\n${C.bold}  Deploying workflow to ${selectedRepos.length} repos...${C.reset}\n`);
        for (const repo of selectedRepos) {
          try {
            const result = await deployWorkflow(repo, token, templatePath);
            console.log(`  ${C.green}✅${C.reset} ${repo.fullName} — workflow ${result.created ? "created" : "updated"}`);
            if (!config.repos.find(r => r.fullName === repo.fullName)) {
              config.repos.push({
                fullName: repo.fullName,
                enabledAt: new Date().toISOString(),
                defaultBranch: repo.defaultBranch,
              });
            }
          } catch (err) {
            console.log(`  ${C.red}❌${C.reset} ${repo.fullName} — ${err.message}`);
          }
        }
      }
    } else {
      console.log(`${C.green}  All repos already have review workflow enabled.${C.reset}\n`);
    }

    // Configure notification threshold
    console.log(`\n${C.bold}  Notification threshold — minimum priority to trigger alerts:${C.reset}`);
    console.log(`${C.gray}  P0=critical only, P1=blockers+, P2=important+, P3=suggestions+, P4=everything${C.reset}`);
    const notifAnswer = await ask(rl, `${C.cyan}  Minimum priority [${config.notifications.minPriority}]: ${C.reset}`);
    if (notifAnswer && ["P0", "P1", "P2", "P3", "P4"].includes(notifAnswer.toUpperCase())) {
      config.notifications.minPriority = notifAnswer.toUpperCase();
    }

    // Configure batch digest
    console.log(`\n${C.bold}  Batch digest — aggregate findings per project?${C.reset}`);
    console.log(`${C.gray}  Reduces notification fatigue by batching per-project instead of per-PR${C.reset}`);
    const digestAnswer = await ask(rl, `${C.cyan}  Enable batch digest? [Y/n]: ${C.reset}`);
    config.notifications.batchDigest = digestAnswer.toLowerCase() !== "n";

    if (config.notifications.batchDigest) {
      console.log(`${C.gray}  Digest interval: immediate / hourly / daily${C.reset}`);
      const intervalAnswer = await ask(rl, `${C.cyan}  Interval [${config.notifications.digestInterval}]: ${C.reset}`);
      if (intervalAnswer && ["immediate", "hourly", "daily"].includes(intervalAnswer.toLowerCase())) {
        config.notifications.digestInterval = intervalAnswer.toLowerCase();
      }
    }

    // Configure confirmation levels
    console.log(`\n${C.bold}  Confirmation levels — what needs your approval?${C.reset}`);

    const confirmItems = [
      { key: "deployWorkflow", label: "Deploy workflow to new repos", default: true },
      { key: "postPrComment",  label: "Post review comments on PRs", default: true },
      { key: "requestChanges", label: "Request changes on PRs (when blockers found)", default: true },
      { key: "autoMerge",      label: "Auto-merge approved PRs", default: false },
      { key: "autoFix",        label: "Auto-commit suggested fixes", default: false },
    ];

    for (const item of confirmItems) {
      const current = config.confirmation[item.key] !== undefined ? config.confirmation[item.key] : item.default;
      const currentLabel = current ? "Y" : "n";
      const answer = await ask(rl, `${C.cyan}  ${item.label}? [${currentLabel}]: ${C.reset}`);
      if (answer !== "") {
        config.confirmation[item.key] = answer.toLowerCase() !== "n";
      }
    }

    // Save config
    const savedPath = saveConfig(config);
    console.log(`\n${C.green}  ✅ Config saved: ${savedPath}${C.reset}`);

    printSummary(config, repos);

  } finally {
    rl.close();
  }

  return config;
}

function printSummary(config, repos) {
  const enabled = repos.filter(r => r.hasWorkflow || config.repos.find(cr => cr.fullName === r.fullName));

  console.log(`\n${C.bold}${C.cyan}  ╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}  ${C.bold}Setup Complete!${C.reset}                                         ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ╠══════════════════════════════════════════════════════════╣${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}                                                          ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}  ${C.green}Repos enabled:${C.reset} ${enabled.length}                                       ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}  ${C.green}Notifications:${C.reset} ${config.notifications.minPriority}+ (${config.notifications.digestInterval})              ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}  ${C.green}Batch digest:${C.reset}  ${config.notifications.batchDigest ? "ON" : "OFF"}                                      ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║                                                          ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}  ${C.bold}Next steps:${C.reset}                                             ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}  1. Create a PR on an enabled repo to trigger review     ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}  2. Set ANTHROPIC_API_KEY as a GitHub secret              ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}     ${C.dim}gh secret set ANTHROPIC_API_KEY --repo owner/repo${C.reset}    ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}  3. Run ${C.bold}solo-cto-agent review${C.reset} for local reviews         ${C.bold}${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║                                                          ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║${C.reset}  ${C.magenta}❤ Sponsor: ${SPONSOR_URL}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ║                                                          ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ╚══════════════════════════════════════════════════════════╝${C.reset}`);
  console.log("");
}

// ─── Digest Aggregator ─────────────────────────────────────

/**
 * Aggregate review findings per project for batch digest.
 * Called by CI workflow after review completes.
 *
 * @param {Object} finding - { repo, pr, priority, issue, suggestion, pass }
 */
function addToDigest(finding) {
  ensureConfigDir();
  const digestFile = path.join(CONFIG_DIR, "digest-queue.json");
  let queue = [];
  try {
    if (fs.existsSync(digestFile)) {
      queue = JSON.parse(fs.readFileSync(digestFile, "utf8"));
    }
  } catch (_) { queue = []; }

  queue.push({
    ...finding,
    timestamp: new Date().toISOString(),
  });

  fs.writeFileSync(digestFile, JSON.stringify(queue, null, 2), "utf8");
  return queue.length;
}

/**
 * Flush digest queue — aggregate per project and format for notification.
 * Returns structured digest grouped by repo.
 */
function flushDigest() {
  ensureConfigDir();
  const digestFile = path.join(CONFIG_DIR, "digest-queue.json");

  let queue = [];
  try {
    if (fs.existsSync(digestFile)) {
      queue = JSON.parse(fs.readFileSync(digestFile, "utf8"));
    }
  } catch (_) { queue = []; }

  if (queue.length === 0) return null;

  // Group by repo
  const grouped = {};
  for (const item of queue) {
    const repo = item.repo || "unknown";
    if (!grouped[repo]) {
      grouped[repo] = { repo, findings: [], prCount: new Set(), priorityCounts: {} };
    }
    grouped[repo].findings.push(item);
    if (item.pr) grouped[repo].prCount.add(item.pr);

    const p = item.priority || "P4";
    grouped[repo].priorityCounts[p] = (grouped[repo].priorityCounts[p] || 0) + 1;
  }

  // Convert sets to counts
  for (const key of Object.keys(grouped)) {
    grouped[key].prCount = grouped[key].prCount.size;
  }

  // Clear queue
  fs.writeFileSync(digestFile, "[]", "utf8");

  return grouped;
}

/**
 * Format digest as terminal output or notification body.
 */
function formatDigest(grouped) {
  if (!grouped || Object.keys(grouped).length === 0) {
    return `${C.gray}No pending findings.${C.reset}`;
  }

  let out = `\n${C.bold}${C.cyan}═══ Solo CTO Review Digest ═══${C.reset}\n\n`;

  for (const [repoName, data] of Object.entries(grouped)) {
    out += `${C.bold}📦 ${repoName}${C.reset} (${data.prCount} PR${data.prCount !== 1 ? "s" : ""})\n`;

    // Priority summary line
    const pLine = Object.entries(data.priorityCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, count]) => `${PRIORITIES[p]?.icon || "?"} ${p}: ${count}`)
      .join("  ");
    out += `  ${pLine}\n`;

    // Top findings (max 5 per repo)
    const topFindings = data.findings
      .sort((a, b) => (a.priority || "P4").localeCompare(b.priority || "P4"))
      .slice(0, 5);

    for (const f of topFindings) {
      const p = PRIORITIES[f.priority] || PRIORITIES.P4;
      out += `  ${p.icon} ${C.bold}${f.priority}${C.reset} ${f.issue || ""}`;
      if (f.suggestion) out += ` ${C.gray}→ ${f.suggestion}${C.reset}`;
      out += "\n";
    }

    if (data.findings.length > 5) {
      out += `  ${C.gray}... and ${data.findings.length - 5} more${C.reset}\n`;
    }
    out += "\n";
  }

  out += `${C.gray}${C.dim}─────────────────────────────────${C.reset}\n`;
  out += `${C.gray}solo-cto-agent | ${GITHUB_URL}${C.reset}\n`;
  out += `${C.magenta}❤ Sponsor: ${SPONSOR_URL}${C.reset}\n`;

  return out;
}

// ─── Exports ───────────────────────────────────────────────

module.exports = {
  runOnboard,
  printBanner,
  discoverRepos,
  formatRepoList,
  deployWorkflow,
  loadConfig,
  saveConfig,
  defaultConfig,
  addToDigest,
  flushDigest,
  formatDigest,
  formatPriorityTable,
  PRIORITIES,
  CONFIG_DIR,
  CONFIG_FILE,
  GITHUB_URL,
  SPONSOR_URL,
};
