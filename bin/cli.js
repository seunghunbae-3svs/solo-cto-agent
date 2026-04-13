#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CATALOG = path.join(ROOT, "failure-catalog.json");
const SKILLS_ROOT = path.join(ROOT, "skills");
const TIERS_FILE = path.join(ROOT, "tiers.json");
const ORCH_TEMPLATE = path.join(ROOT, "templates", "orchestrator");
const PRODUCT_TEMPLATE = path.join(ROOT, "templates", "product-repo");
const PRESETS = {
  maker: ["spark", "review", "memory", "craft"],
  builder: ["spark", "review", "memory", "craft", "build", "ship"],
  cto: ["spark", "review", "memory", "craft", "build", "ship", "orchestrate"],
};
const DEFAULT_PRESET = "builder";

// ─── Helpers ────────────────────────────────────────────────

function printHelp() {
  console.log(`solo-cto-agent — Dual-Agent CI/CD Orchestrator

Usage:
  solo-cto-agent init [--force] [--preset maker|builder|cto]
  solo-cto-agent setup-pipeline [--tier base|pro] [--org <github-org>] [--repos <repo1,repo2,...>]
  solo-cto-agent setup-repo <repo-path> [--tier base|pro]
  solo-cto-agent status
  solo-cto-agent lint [path]
  solo-cto-agent --help

Commands:
  init              Install skills to ~/.claude/skills/
  setup-pipeline    Full pipeline setup: create orchestrator repo + install workflows to product repos
  setup-repo        Install dual-agent workflows to a single product repo
  status            Check skill health, error catalog, and pipeline status
  lint              Check skill files for size and structure issues

Tiers:
  base    Lv4 — Core dual-agent CI/CD (Claude + Codex cross-review, routing, circuit breaker)
  pro     Lv5+6 — Base + UI/UX quality gate + analytics + Telegram notifications

Examples:
  npx solo-cto-agent init --preset cto
  npx solo-cto-agent setup-pipeline --tier pro --org myorg --repos app1,app2,app3
  npx solo-cto-agent setup-repo ./my-project --tier base
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  ensureDir(path.dirname(dest));
  if (fs.statSync(src).isDirectory()) {
    ensureDir(dest);
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function writeFileIfMissing(filePath, content, force) {
  if (fs.existsSync(filePath) && !force) return false;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

function copyDirSafe(src, dest, force) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest) && !force) return false;
  fs.cpSync(src, dest, { recursive: true, force: true });
  return true;
}

function loadTiers() {
  return JSON.parse(fs.readFileSync(TIERS_FILE, "utf8"));
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe", ...opts }).trim();
  } catch (e) {
    if (opts.ignoreError) return "";
    throw e;
  }
}

function gitAvailable() {
  try { run("git --version"); return true; } catch { return false; }
}

function ghAvailable() {
  try { run("gh --version"); return true; } catch { return false; }
}

// ─── init: Install Skills ───────────────────────────────────

function initCommand(force, preset) {
  const resolvedPreset = PRESETS[preset] ? preset : DEFAULT_PRESET;
  const targetDir = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");
  ensureDir(targetDir);

  // Copy failure-catalog.json
  const targetCatalog = path.join(targetDir, "failure-catalog.json");
  const catalogContent = fs.readFileSync(DEFAULT_CATALOG, "utf8");
  const catalogWritten = writeFileIfMissing(targetCatalog, catalogContent, force);

  // Create starter SKILL.md
  const targetSkill = path.join(targetDir, "SKILL.md");
  const starter = `---
name: solo-cto-agent
description: "Project-specific CTO skill pack. Replace placeholders with real stack info."
user-invocable: true
---

# Project Stack
OS: {{YOUR_OS}}
Editor: {{YOUR_EDITOR}}
Deploy: {{YOUR_DEPLOY}}
DB: {{YOUR_DB}}
Framework: {{YOUR_FRAMEWORK}}
Style: {{YOUR_STYLE}}
`;
  const skillWritten = writeFileIfMissing(targetSkill, starter, force);

  const skillTargets = PRESETS[resolvedPreset] || [];
  const installed = [];
  const skipped = [];
  for (const name of skillTargets) {
    const src = path.join(SKILLS_ROOT, name);
    const dest = path.join(os.homedir(), ".claude", "skills", name);
    const copied = copyDirSafe(src, dest, force);
    if (copied) installed.push(name);
    else skipped.push(name);
  }

  console.log("✅ solo-cto-agent initialized");
  console.log(`   preset: ${resolvedPreset}`);
  console.log(`   skills installed: ${installed.length ? installed.join(", ") : "none (already exist)"}`);
  if (skipped.length) console.log(`   skills skipped: ${skipped.join(", ")}`);
  console.log("");
  console.log("Next: run 'solo-cto-agent setup-pipeline' to deploy CI/CD automation");
}

// ─── setup-pipeline: Full Pipeline Deploy ───────────────────

function setupPipelineCommand(tier, org, repos, force) {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  solo-cto-agent — Pipeline Setup                ║");
  console.log(`║  Tier: ${(tier === "pro" ? "Pro (Lv5+6)" : "Base (Lv4)").padEnd(42)}║`);
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");

  if (!gitAvailable()) {
    console.error("❌ git is required. Install git and try again.");
    process.exit(1);
  }

  const tiersData = loadTiers();
  const baseTier = tiersData.tiers.base;
  const proTier = tiersData.tiers.pro;
  const isPro = tier === "pro";

  // ── Step 1: Create orchestrator repo ──
  console.log("[1/4] Setting up orchestrator repo...");

  const orchDir = path.resolve("dual-agent-review-orchestrator");
  let orchCreated = false;

  if (fs.existsSync(orchDir) && fs.existsSync(path.join(orchDir, ".git"))) {
    console.log(`   Found existing: ${orchDir}`);
  } else {
    ensureDir(orchDir);
    run("git init", { cwd: orchDir });
    orchCreated = true;
    console.log(`   Created: ${orchDir}`);
  }

  // Copy orchestrator files based on tier
  console.log("   Copying orchestrator template...");

  // Always copy base workflows
  const workflowDest = path.join(orchDir, ".github", "workflows");
  ensureDir(workflowDest);

  for (const wf of baseTier.orchestrator_workflows) {
    const src = path.join(ORCH_TEMPLATE, ".github", "workflows", wf);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(workflowDest, wf));
    }
  }

  // If pro, add pro workflows
  if (isPro) {
    for (const wf of proTier.additional_orchestrator_workflows) {
      const src = path.join(ORCH_TEMPLATE, ".github", "workflows", wf);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(workflowDest, wf));
      }
    }
  }

  // Copy ops directory structure
  const opsDirs = ["ops/agents", "ops/scripts", "ops/lib", "ops/orchestrator", "ops/orchestrator/schemas"];
  for (const d of opsDirs) {
    ensureDir(path.join(orchDir, d));
  }

  // Copy agents (all for both tiers)
  const agentsSrc = path.join(ORCH_TEMPLATE, "ops", "agents");
  if (fs.existsSync(agentsSrc)) {
    for (const f of fs.readdirSync(agentsSrc)) {
      fs.copyFileSync(path.join(agentsSrc, f), path.join(orchDir, "ops", "agents", f));
    }
  }

  // Copy base scripts
  for (const s of baseTier.ops_scripts) {
    const src = path.join(ORCH_TEMPLATE, "ops", "scripts", s);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(orchDir, "ops", "scripts", s));
    }
  }

  // Copy pro scripts
  if (isPro) {
    for (const s of proTier.ops_scripts) {
      const src = path.join(ORCH_TEMPLATE, "ops", "scripts", s);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(orchDir, "ops", "scripts", s));
      }
    }
  }

  // Copy base libs
  for (const l of baseTier.ops_libs) {
    const src = path.join(ORCH_TEMPLATE, "ops", "lib", l);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(orchDir, "ops", "lib", l));
    }
  }

  // Copy pro libs
  if (isPro) {
    for (const l of proTier.ops_libs) {
      const src = path.join(ORCH_TEMPLATE, "ops", "lib", l);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(orchDir, "ops", "lib", l));
      }
    }
  }

  // Copy orchestrator core files
  for (const item of baseTier.ops_orchestrator) {
    if (item.endsWith("/")) {
      // Directory copy
      const dirName = item.replace("/", "");
      const src = path.join(ORCH_TEMPLATE, "ops", "orchestrator", dirName);
      const dest = path.join(orchDir, "ops", "orchestrator", dirName);
      if (fs.existsSync(src)) copyRecursive(src, dest);
    } else {
      const src = path.join(ORCH_TEMPLATE, "ops", "orchestrator", item);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(orchDir, "ops", "orchestrator", item));
      }
    }
  }

  // Copy pro orchestrator extras
  if (isPro) {
    for (const item of proTier.ops_orchestrator_extras) {
      const src = path.join(ORCH_TEMPLATE, "ops", "orchestrator", item);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(orchDir, "ops", "orchestrator", item));
      }
    }

    // Pro config
    ensureDir(path.join(orchDir, "ops", "config"));
    for (const c of proTier.ops_config) {
      const src = path.join(ORCH_TEMPLATE, "ops", "config", c);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(orchDir, "ops", "config", c));
      }
    }

    // Pro integrations
    ensureDir(path.join(orchDir, "ops", "integrations"));
    for (const i of proTier.ops_integrations) {
      const src = path.join(ORCH_TEMPLATE, "ops", "integrations", i);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(orchDir, "ops", "integrations", i));
      }
    }

    // Pro codex extras
    for (const c of proTier.ops_codex_extras) {
      const src = path.join(ORCH_TEMPLATE, "ops", c);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(orchDir, "ops", c));
      }
    }
  }

  // Copy root config files
  for (const f of baseTier.root_config) {
    const src = path.join(ORCH_TEMPLATE, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(orchDir, f));
    }
  }

  // Copy 'other' directories (api, .claude, .codex, lib, docs)
  for (const item of baseTier.other) {
    const dirName = item.replace("/*", "").replace("/", "");
    const src = path.join(ORCH_TEMPLATE, dirName);
    const dest = path.join(orchDir, dirName);
    if (fs.existsSync(src)) copyRecursive(src, dest);
  }

  // Copy ops package.json
  const opsPackageSrc = path.join(ORCH_TEMPLATE, "ops", "package.json");
  if (fs.existsSync(opsPackageSrc)) {
    fs.copyFileSync(opsPackageSrc, path.join(orchDir, "ops", "package.json"));
  }
  const opsLockSrc = path.join(ORCH_TEMPLATE, "ops", "package-lock.json");
  if (fs.existsSync(opsLockSrc)) {
    fs.copyFileSync(opsLockSrc, path.join(orchDir, "ops", "package-lock.json"));
  }

  const orchFileCount = countFiles(orchDir);
  console.log(`   ✅ Orchestrator: ${orchFileCount} files deployed`);

  // ── Step 2: Install product-repo workflows ──
  console.log("");
  console.log("[2/4] Installing product-repo workflows...");

  const productRepos = repos ? repos.split(",").map(r => r.trim()) : [];
  const productWorkflows = tiersData.product_repo_templates.workflows;
  const productOther = tiersData.product_repo_templates.other;

  if (productRepos.length === 0) {
    console.log("   No product repos specified. Use --repos <repo1,repo2,...>");
    console.log("   You can also run: solo-cto-agent setup-repo <path> later");
  } else {
    for (const repo of productRepos) {
      const repoDir = path.resolve(repo);
      if (!fs.existsSync(repoDir)) {
        console.log(`   ⚠️  ${repo} — not found, skipping`);
        continue;
      }

      const wfDir = path.join(repoDir, ".github", "workflows");
      ensureDir(wfDir);

      for (const wf of productWorkflows) {
        const src = path.join(PRODUCT_TEMPLATE, ".github", "workflows", wf);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(wfDir, wf));
        }
      }

      // Copy other product-repo templates
      for (const item of productOther) {
        const src = path.join(PRODUCT_TEMPLATE, item);
        const dest = path.join(repoDir, item);
        if (fs.existsSync(src)) {
          ensureDir(path.dirname(dest));
          if (fs.statSync(src).isDirectory()) {
            copyRecursive(src, dest);
          } else {
            fs.copyFileSync(src, dest);
          }
        }
      }

      console.log(`   ✅ ${repo} — ${productWorkflows.length} workflows installed`);
    }
  }

  // ── Step 3: Generate .env template ──
  console.log("");
  console.log("[3/4] Generating environment config...");

  const envContent = generateEnvGuide(isPro, org);
  const envPath = path.join(orchDir, ".env.setup-guide");
  fs.writeFileSync(envPath, envContent, "utf8");
  console.log(`   ✅ Setup guide: ${envPath}`);

  // ── Step 4: Summary ──
  console.log("");
  console.log("[4/4] Pipeline setup complete!");
  console.log("");
  console.log("┌──────────────────────────────────────────────────┐");
  console.log("│  Setup Summary                                   │");
  console.log("├──────────────────────────────────────────────────┤");
  console.log(`│  Tier:         ${isPro ? "Pro (Lv5+6)" : "Base (Lv4)"}${" ".repeat(isPro ? 24 : 26)}│`);
  console.log(`│  Orchestrator: ${orchDir.length > 33 ? "..." + orchDir.slice(-30) : orchDir.padEnd(33)}│`);
  console.log(`│  Workflows:    ${String(isPro ? baseTier.orchestrator_workflows.length + proTier.additional_orchestrator_workflows.length : baseTier.orchestrator_workflows.length).padEnd(33)}│`);
  console.log(`│  Product repos: ${productRepos.length || "none"}${" ".repeat(31 - String(productRepos.length || "none").length)}│`);
  console.log("└──────────────────────────────────────────────────┘");
  console.log("");
  console.log("Required GitHub Secrets:");
  console.log("  GITHUB_TOKEN          — auto-provided by GitHub Actions");
  console.log("  ANTHROPIC_API_KEY     — for Claude code/visual review");
  if (isPro) {
    console.log("  TELEGRAM_BOT_TOKEN    — for Telegram notifications (optional)");
    console.log("  TELEGRAM_CHAT_ID      — for Telegram channel (optional)");
  }
  console.log("");
  console.log("Next steps:");
  console.log("  1. cd dual-agent-review-orchestrator && git add -A && git commit -m 'feat: init orchestrator'");
  console.log("  2. gh repo create <name> --push --source . --private");
  console.log("  3. Add secrets: gh secret set ANTHROPIC_API_KEY");
  if (productRepos.length > 0) {
    console.log(`  4. cd each product repo → git add . && git commit -m 'ci: add dual-agent workflows' && git push`);
  }
}

function generateEnvGuide(isPro, org) {
  let guide = `# solo-cto-agent — Environment Setup Guide
# Generated: ${new Date().toISOString()}
# Tier: ${isPro ? "Pro (Lv5+6)" : "Base (Lv4)"}

# ═══ REQUIRED ═══

# GitHub token (auto-provided in GitHub Actions, needed locally for testing)
GITHUB_TOKEN=

# Anthropic API key (for Claude-powered code review and visual analysis)
ANTHROPIC_API_KEY=

# Your GitHub org/user (used for repository_dispatch between repos)
GITHUB_OWNER=${org || "your-github-org"}

# ═══ ORCHESTRATOR REPOS ═══
# Comma-separated list of product repos to monitor
PRODUCT_REPOS=
`;

  if (isPro) {
    guide += `
# ═══ PRO TIER: TELEGRAM (optional) ═══

# Telegram bot token for real-time notifications
TELEGRAM_BOT_TOKEN=

# Telegram chat/channel ID
TELEGRAM_CHAT_ID=

# ═══ PRO TIER: UI/UX VERIFICATION ═══

# Puppeteer is auto-installed via ops/package.json
# Design guidelines are in ops/config/design-guidelines.json
`;
  }

  return guide;
}

// ─── setup-repo: Single Product Repo ────────────────────────

function setupRepoCommand(repoPath, tier) {
  const resolved = path.resolve(repoPath);
  if (!fs.existsSync(resolved)) {
    console.error(`❌ Directory not found: ${resolved}`);
    process.exit(1);
  }

  const tiersData = loadTiers();
  const productWorkflows = tiersData.product_repo_templates.workflows;
  const productOther = tiersData.product_repo_templates.other;

  const wfDir = path.join(resolved, ".github", "workflows");
  ensureDir(wfDir);

  let count = 0;
  for (const wf of productWorkflows) {
    const src = path.join(PRODUCT_TEMPLATE, ".github", "workflows", wf);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(wfDir, wf));
      count++;
    }
  }

  for (const item of productOther) {
    const src = path.join(PRODUCT_TEMPLATE, item);
    const dest = path.join(resolved, item);
    if (fs.existsSync(src)) {
      ensureDir(path.dirname(dest));
      if (fs.statSync(src).isDirectory()) {
        copyRecursive(src, dest);
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  }

  console.log(`✅ ${path.basename(resolved)} — ${count} workflows + ${productOther.length} templates installed`);
  console.log(`   Location: ${wfDir}`);
  console.log("");
  console.log("Next: git add .github/ && git commit -m 'ci: add dual-agent workflows' && git push");
}

// ─── status ─────────────────────────────────────────────────

function readCatalogCount(catalogPath) {
  try {
    const data = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (Array.isArray(data.items)) return data.items.length;
    return 0;
  } catch { return 0; }
}

function countFiles(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name === ".git" || item.name === "node_modules") continue;
    if (item.isDirectory()) {
      count += countFiles(path.join(dir, item.name));
    } else {
      count++;
    }
  }
  return count;
}

function getLatestCiStatus(repo, token) {
  return new Promise((resolve) => {
    if (!repo || !token) {
      resolve({ status: "unavailable", conclusion: "missing token or repo" });
      return;
    }
    const options = {
      hostname: "api.github.com",
      path: `/repos/${repo}/actions/runs?per_page=1`,
      headers: {
        "User-Agent": "solo-cto-agent",
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    };
    https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const run = json.workflow_runs && json.workflow_runs[0];
          if (!run) return resolve({ status: "unavailable", conclusion: "no runs" });
          resolve({ status: run.status || "unknown", conclusion: run.conclusion || "unknown" });
        } catch { resolve({ status: "unavailable", conclusion: "parse error" }); }
      });
    }).on("error", () => resolve({ status: "unavailable", conclusion: "request failed" }));
  });
}

async function statusCommand() {
  const targetDir = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");
  const skillPath = path.join(targetDir, "SKILL.md");
  const catalogPath = path.join(targetDir, "failure-catalog.json");

  const skillOk = fs.existsSync(skillPath);
  const catalogOk = fs.existsSync(catalogPath);
  const count = catalogOk ? readCatalogCount(catalogPath) : 0;

  // Check orchestrator
  const orchDir = path.resolve("dual-agent-review-orchestrator");
  const orchExists = fs.existsSync(orchDir);
  const orchWorkflows = orchExists
    ? fs.readdirSync(path.join(orchDir, ".github", "workflows")).filter(f => f.endsWith(".yml")).length
    : 0;

  // Detect tier
  const hasUiux = orchExists && fs.existsSync(path.join(orchDir, ".github", "workflows", "uiux-quality-gate.yml"));

  console.log("solo-cto-agent status");
  console.log("─────────────────────");
  console.log(`  Skills:        ${skillOk ? "✅ installed" : "❌ not found"}`);
  console.log(`  Error catalog: ${catalogOk ? `✅ ${count} patterns` : "❌ not found"}`);
  console.log(`  Orchestrator:  ${orchExists ? `✅ ${orchWorkflows} workflows` : "❌ not found"}`);
  console.log(`  Tier:          ${orchExists ? (hasUiux ? "Pro (Lv5+6)" : "Base (Lv4)") : "N/A"}`);

  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const ci = await getLatestCiStatus(repo, token);
  console.log(`  Last CI:       ${ci.status} (${ci.conclusion})`);
}

// ─── lint ───────────────────────────────────────────────────

function lintCommand(targetPath) {
  const dir = targetPath || path.join(process.cwd(), "skills");
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const MAX_LINES = 150;
  const issues = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(dir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      issues.push({ skill: entry.name, level: "warn", msg: "no SKILL.md found" });
      continue;
    }

    const content = fs.readFileSync(skillPath, "utf8");
    const lines = content.split("\n");

    if (lines[0].trim() !== "---") {
      issues.push({ skill: entry.name, level: "error", msg: "missing frontmatter" });
    }

    if (lines.length > MAX_LINES) {
      const hasRefs = fs.existsSync(path.join(dir, entry.name, "references"));
      issues.push({
        skill: entry.name,
        level: "warn",
        msg: `${lines.length} lines (max ${MAX_LINES})${hasRefs ? "" : " — consider using references/"}`,
      });
    }

    let inBlock = false, blockStart = 0, blockLines = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith("```")) {
        if (inBlock) {
          if (blockLines > 30) {
            issues.push({
              skill: entry.name, level: "warn",
              msg: `code block at line ${blockStart + 1} is ${blockLines} lines — move to references/`,
            });
          }
          inBlock = false; blockLines = 0;
        } else { inBlock = true; blockStart = i; blockLines = 0; }
      } else if (inBlock) { blockLines++; }
    }
  }

  const checked = entries.filter(e => e.isDirectory()).length;
  const errors = issues.filter(i => i.level === "error");
  const warns = issues.filter(i => i.level === "warn");

  console.log(`solo-cto-agent lint — checked ${checked} skills`);
  if (issues.length === 0) {
    console.log("✅ all clean");
  } else {
    for (const issue of issues) {
      console.log(`${issue.level === "error" ? "❌" : "⚠️"} ${issue.skill}: ${issue.msg}`);
    }
  }
  console.log(`\n${errors.length} errors, ${warns.length} warnings`);
  process.exit(errors.length > 0 ? 1 : 0);
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    return;
  }

  const force = args.includes("--force");

  if (cmd === "init") {
    const presetIndex = args.indexOf("--preset");
    const preset = presetIndex >= 0 ? args[presetIndex + 1] : DEFAULT_PRESET;
    initCommand(force, preset);
    return;
  }

  if (cmd === "setup-pipeline") {
    const tierIndex = args.indexOf("--tier");
    const tier = tierIndex >= 0 ? args[tierIndex + 1] : "base";
    const orgIndex = args.indexOf("--org");
    const org = orgIndex >= 0 ? args[orgIndex + 1] : null;
    const reposIndex = args.indexOf("--repos");
    const repos = reposIndex >= 0 ? args[reposIndex + 1] : null;
    setupPipelineCommand(tier, org, repos, force);
    return;
  }

  if (cmd === "setup-repo") {
    const repoPath = args[1];
    if (!repoPath) {
      console.error("Usage: solo-cto-agent setup-repo <path> [--tier base|pro]");
      process.exit(1);
    }
    const tierIndex = args.indexOf("--tier");
    const tier = tierIndex >= 0 ? args[tierIndex + 1] : "base";
    setupRepoCommand(repoPath, tier);
    return;
  }

  if (cmd === "status") {
    await statusCommand();
    return;
  }

  if (cmd === "lint") {
    lintCommand(args[1]);
    return;
  }

  printHelp();
  process.exit(1);
}

main();
