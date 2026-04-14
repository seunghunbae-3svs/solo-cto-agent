#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execSync } = require("child_process");

const { syncCommand } = require("./sync");
const { runWizard, hasWizardFlag } = require("./wizard");
const i18n = require("./i18n");
const { localReview, knowledgeCapture, dualReview, detectMode, sessionSave, sessionRestore, sessionList, recordFeedback, setLogChannel } = require("./cowork-engine");
// Lazy-load optional modules so missing files don't break older installs.
let uiux, rework, watch, notify, inboundFeedback;
try { uiux = require("./uiux-engine"); } catch (_) { uiux = null; }
try { rework = require("./rework"); } catch (_) { rework = null; }
try { watch = require("./watch"); } catch (_) { watch = null; }
try { notify = require("./notify"); } catch (_) { notify = null; }
try { inboundFeedback = require("./inbound-feedback"); } catch (_) { inboundFeedback = null; }
let pluginManager;
try { pluginManager = require("./plugin-manager"); } catch (_) { pluginManager = null; }
let telegramWizard;
try { telegramWizard = require("./telegram-wizard"); } catch (_) { telegramWizard = null; }

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CATALOG = path.join(ROOT, "failure-catalog.json");
const SKILLS_ROOT = path.join(ROOT, "skills");
const TIERS_FILE = path.join(ROOT, "tiers.json");
const ORCH_TEMPLATE = path.join(ROOT, "templates", "orchestrator");
const PRODUCT_TEMPLATE = path.join(ROOT, "templates", "product-repo");
const BUILDER_DEFAULTS = path.join(ROOT, "templates", "builder-defaults");
const PRESETS = {
  maker: ["spark", "review", "memory", "craft"],
  builder: ["spark", "review", "memory", "craft", "build", "ship"],
  cto: ["spark", "review", "memory", "craft", "build", "ship", "orchestrate"],
};
const DEFAULT_PRESET = "builder";

// ─── Helpers ────────────────────────────────────────────────

function printHelp() {
  console.log(`solo-cto-agent — ${i18n.t("cli.tagline")}

Usage:
  solo-cto-agent init [--force] [--preset maker|builder|cto] [--wizard]
  solo-cto-agent setup-pipeline --org <github-org> [--tier builder|cto] [--repos <repo1,repo2,...>]
  solo-cto-agent setup-repo <repo-path> --org <github-org> [--tier builder|cto]
  solo-cto-agent upgrade --org <github-org> [--repos <repo1,repo2,...>]
  solo-cto-agent sync --org <github-org> [--apply] [--repos <repo1,repo2,...>]
  solo-cto-agent review [--staged|--branch [--target <base>]|--file <path>] [--dry-run] [--solo] [--json|--markdown]
  solo-cto-agent dual-review [--staged|--branch [--target <base>]]
  solo-cto-agent knowledge [--session|--file <path>|--manual] [--project <tag>]
  solo-cto-agent session save|restore|list [--project <tag>] [--session <file>] [--limit <n>]
  solo-cto-agent status
  solo-cto-agent lint [path]
  solo-cto-agent doctor
  solo-cto-agent --help
  solo-cto-agent --lang <en|ko> <command>      # override CLI locale (or SOLO_CTO_LANG env)

Commands:
  init              Install skills to ~/.claude/skills/ (add --wizard for interactive setup)
  setup-pipeline    Full pipeline setup: create orchestrator repo + install workflows to product repos
  setup-repo        Install dual-agent workflows to a single product repo
  upgrade           Upgrade Builder (Lv4) → CTO (Lv5+6): add multi-agent workflows + config
  sync              Fetch CI/CD results from GitHub (dry-run by default, --apply to write)
  review            Local code review via Claude API (auto-detects dual mode if both keys set)
  dual-review       Explicit dual-agent cross-review (Claude + OpenAI)
  knowledge         Extract session decisions into knowledge articles via Claude API
  session           Save/restore/list session context (cowork-main mode)
  status            Check skill health, error catalog, sync status (local only, no network)
  lint              Check skill files for size and structure issues
  doctor            Complete system health check (skills, engine, API keys, lint, sync, catalog)

Presets / Tiers:
  maker       Spark + Review + Memory + Craft (idea validation only)
  builder     Lv4 — Maker + Build + Ship (default, full dev/deploy cycle)
  cto         Lv5+6 — Builder + Orchestrate + UI/UX quality gate + analytics + Telegram

Examples:
  npx solo-cto-agent init --wizard                 # interactive setup (recommended)
  npx solo-cto-agent init --preset builder         # install skills (default)
  npx solo-cto-agent init --preset cto             # install all skills
  npx solo-cto-agent setup-pipeline --org myorg    # deploy Lv4 pipeline
  npx solo-cto-agent setup-pipeline --org myorg --tier cto --repos app1,app2,app3
  npx solo-cto-agent setup-repo ./my-project --org myorg
  npx solo-cto-agent sync --org myorg --repos app1,app2   # dry-run: fetch + display
  npx solo-cto-agent sync --org myorg --apply              # apply: merge remote data into local
  npx solo-cto-agent review                                # Claude review of staged changes
  npx solo-cto-agent review --branch                       # review branch diff vs auto-detected default
  npx solo-cto-agent review --branch --target develop      # review branch diff vs explicit base
  npx solo-cto-agent review --staged --json | jq .verdict  # pipe-safe JSON
  npx solo-cto-agent dual-review                           # Claude + OpenAI cross-review
  npx solo-cto-agent knowledge                             # extract decisions from recent commits
  npx solo-cto-agent knowledge --project tribo             # tag with project name
  npx solo-cto-agent session save --project tribo          # save session context
  npx solo-cto-agent session restore                       # load most recent session
  npx solo-cto-agent session list --limit 5                # show 5 recent sessions
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest, replacements) {
  ensureDir(path.dirname(dest));
  if (fs.statSync(src).isDirectory()) {
    ensureDir(dest);
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item), replacements);
    }
  } else if (replacements) {
    copyFileWithReplace(src, dest, replacements);
  } else {
    fs.copyFileSync(src, dest);
  }
}

const TEXT_EXTENSIONS = new Set([".yml", ".yaml", ".js", ".ts", ".md", ".json", ".sh", ".html", ".txt"]);

function copyFileWithReplace(src, dest, replacements) {
  ensureDir(path.dirname(dest));
  const ext = path.extname(src).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) || !replacements) {
    fs.copyFileSync(src, dest);
    return;
  }
  let content = fs.readFileSync(src, "utf8");
  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.split(placeholder).join(value);
  }
  fs.writeFileSync(dest, content, "utf8");
}

function writeFileIfMissing(filePath, content, force) {
  if (fs.existsSync(filePath) && !force) return false;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(srcPath);
      try {
        fs.symlinkSync(link, destPath);
      } catch (_) {
        // Fallback: treat symlink as a regular file copy when symlink creation fails.
        const real = fs.readFileSync(srcPath);
        fs.writeFileSync(destPath, real);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyDirSafe(src, dest, force) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dest) && !force) return false;
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  copyDirRecursive(src, dest);
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

function setupPipelineCommand(tier, org, repos, orchName, force) {
  if (!org) {
    console.error("❌ --org is required. Specify your GitHub org/username.");
    console.error("   Example: solo-cto-agent setup-pipeline --org myorg --tier builder");
    process.exit(1);
  }

  // Normalize tier: builder=base(Lv4), cto=pro(Lv5+6)
  const normalizedTier = (tier === "cto" || tier === "pro") ? "cto" : "builder";
  const isPro = normalizedTier === "cto";

  const orchestratorRepo = orchName || "dual-agent-orchestrator";
  const productRepoList = repos ? repos.split(",").map(r => r.trim()) : [];

  // Build template replacement map
  const replacements = {
    "{{GITHUB_OWNER}}": org,
    "{{ORCHESTRATOR_REPO}}": orchestratorRepo,
  };
  // Map product repos to numbered placeholders
  productRepoList.forEach((repo, i) => {
    replacements[`{{PRODUCT_REPO_${i + 1}}}`] = path.basename(repo);
  });
  // Fill remaining placeholders with generic names
  for (let i = productRepoList.length + 1; i <= 10; i++) {
    replacements[`{{PRODUCT_REPO_${i}}}`] = `your-product-repo-${i}`;
  }

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  solo-cto-agent — Pipeline Setup                ║");
  console.log(`║  Tier: ${(isPro ? "CTO (Lv5+6)" : "Builder (Lv4)").padEnd(42)}║`);
  console.log(`║  Org:  ${org.padEnd(42)}║`);
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");

  if (!gitAvailable()) {
    console.error("❌ git is required. Install git and try again.");
    process.exit(1);
  }

  const tiersData = loadTiers();
  const baseTier = tiersData.tiers.base;
  const proTier = tiersData.tiers.pro;

  // ── Step 1: Create orchestrator repo ──
  console.log("[1/4] Setting up orchestrator repo...");

  const orchDir = path.resolve(orchestratorRepo);
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
      copyFileWithReplace(src, path.join(workflowDest, wf), replacements);
    }
  }

  // If pro, add pro workflows
  if (isPro) {
    for (const wf of proTier.additional_orchestrator_workflows) {
      const src = path.join(ORCH_TEMPLATE, ".github", "workflows", wf);
      if (fs.existsSync(src)) {
        copyFileWithReplace(src, path.join(workflowDest, wf), replacements);
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
      copyFileWithReplace(path.join(agentsSrc, f), path.join(orchDir, "ops", "agents", f), replacements);
    }
  }

  // Copy base scripts
  for (const s of baseTier.ops_scripts) {
    const src = path.join(ORCH_TEMPLATE, "ops", "scripts", s);
    if (fs.existsSync(src)) {
      copyFileWithReplace(src, path.join(orchDir, "ops", "scripts", s), replacements);
    }
  }

  // Copy pro scripts
  if (isPro) {
    for (const s of proTier.ops_scripts) {
      const src = path.join(ORCH_TEMPLATE, "ops", "scripts", s);
      if (fs.existsSync(src)) {
        copyFileWithReplace(src, path.join(orchDir, "ops", "scripts", s), replacements);
      }
    }
  }

  // Copy base libs
  for (const l of baseTier.ops_libs) {
    const src = path.join(ORCH_TEMPLATE, "ops", "lib", l);
    if (fs.existsSync(src)) {
      copyFileWithReplace(src, path.join(orchDir, "ops", "lib", l), replacements);
    }
  }

  // Copy pro libs
  if (isPro) {
    for (const l of proTier.ops_libs) {
      const src = path.join(ORCH_TEMPLATE, "ops", "lib", l);
      if (fs.existsSync(src)) {
        copyFileWithReplace(src, path.join(orchDir, "ops", "lib", l), replacements);
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
      if (fs.existsSync(src)) copyRecursive(src, dest, replacements);
    } else {
      const src = path.join(ORCH_TEMPLATE, "ops", "orchestrator", item);
      if (fs.existsSync(src)) {
        copyFileWithReplace(src, path.join(orchDir, "ops", "orchestrator", item), replacements);
      }
    }
  }

  // Builder tier: override routing-policy + agent-scores for single-agent mode
  if (!isPro) {
    const policyReplacements = {};
    const scoresReplacements = { "{{SETUP_TIMESTAMP}}": new Date().toISOString() };
    copyFileWithReplace(
      path.join(BUILDER_DEFAULTS, "routing-policy.json"),
      path.join(orchDir, "ops", "orchestrator", "routing-policy.json"),
      policyReplacements
    );
    copyFileWithReplace(
      path.join(BUILDER_DEFAULTS, "agent-scores.json"),
      path.join(orchDir, "ops", "orchestrator", "agent-scores.json"),
      scoresReplacements
    );
    console.log("   ✅ Single-agent config applied (routing-policy + agent-scores)");
  }

  // Copy pro orchestrator extras
  if (isPro) {
    for (const item of proTier.ops_orchestrator_extras) {
      const src = path.join(ORCH_TEMPLATE, "ops", "orchestrator", item);
      if (fs.existsSync(src)) {
        copyFileWithReplace(src, path.join(orchDir, "ops", "orchestrator", item), replacements);
      }
    }

    // Pro config
    ensureDir(path.join(orchDir, "ops", "config"));
    for (const c of proTier.ops_config) {
      const src = path.join(ORCH_TEMPLATE, "ops", "config", c);
      if (fs.existsSync(src)) {
        copyFileWithReplace(src, path.join(orchDir, "ops", "config", c), replacements);
      }
    }

    // Pro integrations
    ensureDir(path.join(orchDir, "ops", "integrations"));
    for (const i of proTier.ops_integrations) {
      const src = path.join(ORCH_TEMPLATE, "ops", "integrations", i);
      if (fs.existsSync(src)) {
        copyFileWithReplace(src, path.join(orchDir, "ops", "integrations", i), replacements);
      }
    }

    // Pro codex extras
    for (const c of proTier.ops_codex_extras) {
      const src = path.join(ORCH_TEMPLATE, "ops", c);
      if (fs.existsSync(src)) {
        copyFileWithReplace(src, path.join(orchDir, "ops", c), replacements);
      }
    }
  }

  // Copy root config files
  for (const f of baseTier.root_config) {
    const src = path.join(ORCH_TEMPLATE, f);
    if (fs.existsSync(src)) {
      copyFileWithReplace(src, path.join(orchDir, f), replacements);
    }
  }

  // Copy 'other' directories (api, .claude, .codex, lib, docs)
  for (const item of baseTier.other) {
    const dirName = item.replace("/*", "").replace("/", "");
    const src = path.join(ORCH_TEMPLATE, dirName);
    const dest = path.join(orchDir, dirName);
    if (fs.existsSync(src)) copyRecursive(src, dest, replacements);
  }

  // Copy ops package.json
  const opsPackageSrc = path.join(ORCH_TEMPLATE, "ops", "package.json");
  if (fs.existsSync(opsPackageSrc)) {
    copyFileWithReplace(opsPackageSrc, path.join(orchDir, "ops", "package.json"), replacements);
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

  // Build product-repo workflow list based on tier
  const builderWorkflows = tiersData.product_repo_templates.builder.workflows;
  const ctoAdditional = tiersData.product_repo_templates.cto.additional_workflows;
  const optionalWorkflows = tiersData.product_repo_templates.optional.workflows;
  const productOther = tiersData.product_repo_templates.other;

  // Builder = single-agent (Claude), CTO = dual/triple (Claude + Codex + cross-review)
  const productWorkflows = isPro
    ? [...builderWorkflows, ...ctoAdditional, ...optionalWorkflows]
    : [...builderWorkflows, ...optionalWorkflows];

  if (productRepoList.length === 0) {
    console.log("   No product repos specified. Use --repos <repo1,repo2,...>");
    console.log("   You can also run: solo-cto-agent setup-repo <path> --org <org> later");
  } else {
    for (const repo of productRepoList) {
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
          copyFileWithReplace(src, path.join(wfDir, wf), replacements);
        }
      }

      // Copy other product-repo templates
      for (const item of productOther) {
        const src = path.join(PRODUCT_TEMPLATE, item);
        const dest = path.join(repoDir, item);
        if (fs.existsSync(src)) {
          ensureDir(path.dirname(dest));
          if (fs.statSync(src).isDirectory()) {
            copyRecursive(src, dest, replacements);
          } else {
            copyFileWithReplace(src, dest, replacements);
          }
        }
      }

      const agentLabel = isPro ? "dual/triple-agent" : "single-agent";
      console.log(`   ✅ ${repo} — ${productWorkflows.length} workflows (${agentLabel})`);

      // Detect services in each product repo
      printServiceDetection(repoDir, isPro);
    }
  }

  // ── Step 3: Generate .env template ──
  console.log("");
  console.log("[3/4] Generating environment config...");

  const envContent = generateEnvGuide(isPro, org);
  const envPath = path.join(orchDir, ".env.setup-guide");
  fs.writeFileSync(envPath, envContent, "utf8");
  console.log(`   ✅ Setup guide: ${envPath}`);

  // ── Step 4: Summary + Secret Guide ──
  const wfCount = isPro
    ? baseTier.orchestrator_workflows.length + proTier.additional_orchestrator_workflows.length
    : baseTier.orchestrator_workflows.length;

  console.log("");
  console.log("[4/4] Pipeline setup complete!");
  console.log("");
  console.log(`  Tier:          ${isPro ? "CTO (Lv5+6)" : "Builder (Lv4)"}`);
  console.log(`  Orchestrator:  ${orchDir}`);
  console.log(`  Workflows:     ${wfCount}`);
  console.log(`  Product repos: ${productRepoList.length || "none"}`);
  console.log("");
  console.log("═══ NEXT STEPS ═══");
  console.log("");
  console.log(`  1. cd ${orchestratorRepo}`);
  console.log("     git add -A && git commit -m 'feat: init dual-agent orchestrator'");
  console.log(`     gh repo create ${org}/${orchestratorRepo} --push --source . --private`);
  console.log("");
  console.log("  2. Set secrets on orchestrator repo:");
  console.log("");
  console.log("     # GitHub PAT with repo + workflow scope (cross-repo dispatch)");
  console.log("     gh secret set ORCHESTRATOR_PAT");
  console.log("");
  console.log("     # Anthropic API key (Claude code review + visual analysis)");
  console.log("     gh secret set ANTHROPIC_API_KEY");
  console.log("");
  if (isPro) {
    console.log("     # OpenAI API key (Codex agent, AI-powered analysis)");
    console.log("     gh secret set OPENAI_API_KEY");
    console.log("");
  }
  console.log("     # Telegram notifications (optional, both tiers)");
  console.log("     gh secret set TELEGRAM_BOT_TOKEN");
  console.log("     gh secret set TELEGRAM_CHAT_ID");
  console.log("");
  console.log("  3. Set SAME secrets on each product repo:");
  console.log("");
  const secretList = isPro
    ? "ORCHESTRATOR_PAT && gh secret set ANTHROPIC_API_KEY && gh secret set OPENAI_API_KEY"
    : "ORCHESTRATOR_PAT && gh secret set ANTHROPIC_API_KEY";
  if (productRepoList.length > 0) {
    for (const repo of productRepoList) {
      console.log(`     cd ${repo} && gh secret set ${secretList}`);
    }
  } else {
    console.log("     cd your-product-repo");
    console.log(`     gh secret set ${secretList}`);
  }
  console.log("");
  console.log("  4. Push product repos with new workflows:");
  console.log("     git add .github/ && git commit -m 'ci: add dual-agent workflows' && git push");
  console.log("");
  console.log("═══ WHY EACH SECRET ═══");
  console.log("");
  console.log("  ORCHESTRATOR_PAT  Cross-repo dispatch (product → orchestrator)");
  console.log("                    Scope: repo + workflow");
  console.log("                    Create: https://github.com/settings/tokens");
  console.log("");
  console.log("  ANTHROPIC_API_KEY Claude code review, visual analysis, UI/UX gate");
  console.log("                    Get: https://console.anthropic.com");
  console.log("");
  if (isPro) {
    console.log("  OPENAI_API_KEY    Codex agent, AI-powered code analysis (CTO tier)");
    console.log("                    Get: https://platform.openai.com/api-keys");
    console.log("");
  }
  console.log("  TELEGRAM_*        Real-time PR/review notifications (optional, both tiers)");
  console.log("                    Get: https://t.me/BotFather");
  console.log("");
  console.log("  GITHUB_TOKEN      Auto-provided by GitHub Actions (no action needed)");
}

// ─── Service Detection ─────────────────────────────────────

const SERVICE_PATTERNS = {
  "next-auth": { files: ["**/next-auth*", "**/[...nextauth]*"], imports: ["next-auth", "@auth/"], secrets: ["NEXTAUTH_SECRET", "NEXTAUTH_URL"], guide: "OAuth provider credentials (Google, GitHub, etc.)" },
  supabase: { files: ["**/supabase*"], imports: ["@supabase/"], secrets: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"], guide: "https://app.supabase.com → Settings → API" },
  stripe: { files: [], imports: ["@stripe/stripe-js", "stripe"], secrets: ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"], guide: "https://dashboard.stripe.com/apikeys" },
  prisma: { files: ["**/schema.prisma"], imports: ["@prisma/client"], secrets: ["DATABASE_URL"], guide: "Connection string from your database provider" },
  firebase: { files: [], imports: ["firebase", "firebase-admin"], secrets: ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"], guide: "Firebase Console → Project Settings → Service accounts" },
  paymongo: { files: [], imports: ["paymongo"], secrets: ["PAYMONGO_SECRET_KEY", "PAYMONGO_PUBLIC_KEY"], guide: "https://dashboard.paymongo.com/developers" },
  resend: { files: [], imports: ["resend"], secrets: ["RESEND_API_KEY"], guide: "https://resend.com/api-keys" },
  aws: { files: [], imports: ["@aws-sdk/", "aws-sdk"], secrets: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"], guide: "AWS IAM Console" },
};

function detectServicesInRepo(repoDir) {
  const detected = [];
  if (!fs.existsSync(repoDir)) return detected;

  // Scan package.json for dependencies
  const pkgPath = path.join(repoDir, "package.json");
  let deps = {};
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {}
  }

  for (const [service, config] of Object.entries(SERVICE_PATTERNS)) {
    // Check imports in package.json deps
    const found = config.imports.some((imp) =>
      Object.keys(deps).some((dep) => dep.startsWith(imp) || dep === imp)
    );

    // Check for config files
    const hasFile = config.files.some((pattern) => {
      const baseName = pattern.replace("**/", "");
      return findFileRecursive(repoDir, baseName, 3);
    });

    if (found || hasFile) {
      detected.push({ service, ...config });
    }
  }

  return detected;
}

function findFileRecursive(dir, name, maxDepth) {
  if (maxDepth <= 0) return false;
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name === "node_modules" || item.name === ".git" || item.name === ".next") continue;
      if (item.name.includes(name.replace("*", ""))) return true;
      if (item.isDirectory() && maxDepth > 1) {
        if (findFileRecursive(path.join(dir, item.name), name, maxDepth - 1)) return true;
      }
    }
  } catch {}
  return false;
}

function printServiceDetection(repoDir, isPro) {
  const services = detectServicesInRepo(repoDir);
  if (services.length === 0) return;

  console.log("");
  console.log("═══ DETECTED SERVICES ═══");
  console.log("");
  console.log(`  Scanned: ${path.basename(repoDir)}`);
  console.log(`  Found ${services.length} service(s) requiring configuration:`);
  console.log("");

  const allSecrets = new Set();

  for (const svc of services) {
    console.log(`  📦 ${svc.service}`);
    console.log(`     Secrets: ${svc.secrets.join(", ")}`);
    console.log(`     Guide:   ${svc.guide}`);
    console.log("");
    svc.secrets.forEach((s) => allSecrets.add(s));
  }

  // Generate one-shot gh secret set script
  if (allSecrets.size > 0) {
    console.log("═══ ONE-SHOT SECRET SETUP ═══");
    console.log("");
    console.log("  Copy-paste this block to set all secrets at once:");
    console.log("");
    const repoName = path.basename(repoDir);
    for (const secret of allSecrets) {
      console.log(`  gh secret set ${secret} -R ${repoName}`);
    }
    // Always include pipeline secrets
    console.log(`  gh secret set ORCHESTRATOR_PAT -R ${repoName}`);
    console.log(`  gh secret set ANTHROPIC_API_KEY -R ${repoName}`);
    if (isPro) {
      console.log(`  gh secret set OPENAI_API_KEY -R ${repoName}`);
    }
    console.log("");
  }
}

function generateEnvGuide(isPro, org) {
  let guide = `# solo-cto-agent — Environment Setup Guide
# Generated: ${new Date().toISOString()}
# Tier: ${isPro ? "CTO (Lv5+6) — dual/triple-agent" : "Builder (Lv4) — single-agent"}

# ═══ REQUIRED ═══

# GitHub PAT with repo + workflow scope (cross-repo dispatch)
ORCHESTRATOR_PAT=

# Anthropic API key (Claude code review + visual analysis)
ANTHROPIC_API_KEY=

# GitHub token (auto-provided in GitHub Actions, no action needed)
GITHUB_TOKEN=

# Your GitHub org/user (used for repository_dispatch between repos)
GITHUB_OWNER=${org || "your-github-org"}

# ═══ ORCHESTRATOR REPOS ═══
# Comma-separated list of product repos to monitor
PRODUCT_REPOS=

# ═══ OPTIONAL (both tiers) ═══

# Telegram bot token for real-time PR/review notifications
TELEGRAM_BOT_TOKEN=

# Telegram chat/channel ID
TELEGRAM_CHAT_ID=
`;

  if (isPro) {
    guide += `
# ═══ CTO TIER ONLY ═══

# OpenAI API key (Codex agent + AI-powered analysis)
OPENAI_API_KEY=

# UI/UX VERIFICATION
# Puppeteer is auto-installed via ops/package.json
# Design guidelines are in ops/config/design-guidelines.json
`;
  }

  return guide;
}

// ─── setup-repo: Single Product Repo ────────────────────────

function setupRepoCommand(repoPath, tier, org, orchName) {
  if (!org) {
    console.error("❌ --org is required. Specify your GitHub org/username.");
    console.error("   Example: solo-cto-agent setup-repo ./my-repo --org myorg");
    process.exit(1);
  }

  const isPro = tier === "cto" || tier === "pro";
  const orchestratorRepo = orchName || "dual-agent-orchestrator";
  const replacements = {
    "{{GITHUB_OWNER}}": org,
    "{{ORCHESTRATOR_REPO}}": orchestratorRepo,
    "{{PRODUCT_REPO_1}}": path.basename(repoPath),
  };
  for (let i = 2; i <= 10; i++) {
    replacements[`{{PRODUCT_REPO_${i}}}`] = `your-product-repo-${i}`;
  }

  const resolved = path.resolve(repoPath);
  if (!fs.existsSync(resolved)) {
    console.error(`❌ Directory not found: ${resolved}`);
    process.exit(1);
  }

  const tiersData = loadTiers();
  const builderWorkflows = tiersData.product_repo_templates.builder.workflows;
  const ctoAdditional = tiersData.product_repo_templates.cto.additional_workflows;
  const optionalWorkflows = tiersData.product_repo_templates.optional.workflows;
  const productOther = tiersData.product_repo_templates.other;

  const productWorkflows = isPro
    ? [...builderWorkflows, ...ctoAdditional, ...optionalWorkflows]
    : [...builderWorkflows, ...optionalWorkflows];

  const wfDir = path.join(resolved, ".github", "workflows");
  ensureDir(wfDir);

  let count = 0;
  for (const wf of productWorkflows) {
    const src = path.join(PRODUCT_TEMPLATE, ".github", "workflows", wf);
    if (fs.existsSync(src)) {
      copyFileWithReplace(src, path.join(wfDir, wf), replacements);
      count++;
    }
  }

  for (const item of productOther) {
    const src = path.join(PRODUCT_TEMPLATE, item);
    const dest = path.join(resolved, item);
    if (fs.existsSync(src)) {
      ensureDir(path.dirname(dest));
      if (fs.statSync(src).isDirectory()) {
        copyRecursive(src, dest, replacements);
      } else {
        copyFileWithReplace(src, dest, replacements);
      }
    }
  }

  const agentLabel = isPro ? "dual/triple-agent" : "single-agent";
  console.log(`✅ ${path.basename(resolved)} — ${count} workflows (${agentLabel}) + ${productOther.length} templates installed`);

  // Detect services in the repo
  printServiceDetection(resolved, isPro);
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

// status is now pure-local — no network calls. Use `sync` to fetch remote data.

function statusCommand() {
  const targetDir = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");
  const skillPath = path.join(targetDir, "SKILL.md");
  const catalogPath = path.join(targetDir, "failure-catalog.json");
  const syncStatusPath = path.join(targetDir, "sync-status.json");
  const agentScoresPath = path.join(targetDir, "agent-scores-local.json");

  const skillOk = fs.existsSync(skillPath);
  const catalogOk = fs.existsSync(catalogPath);
  const count = catalogOk ? readCatalogCount(catalogPath) : 0;

  // Check if wizard was used (configured SKILL.md has table format)
  let wizardConfigured = false;
  if (skillOk) {
    try {
      const content = fs.readFileSync(skillPath, "utf8");
      wizardConfigured = content.includes("| Item | Value |") || !content.includes("{{YOUR_");
    } catch {}
  }

  // Check orchestrator
  const orchDir = path.resolve("{{ORCHESTRATOR_REPO}}");
  const orchExists = fs.existsSync(orchDir);
  let orchWorkflows = 0;
  try {
    if (orchExists) orchWorkflows = fs.readdirSync(path.join(orchDir, ".github", "workflows")).filter(f => f.endsWith(".yml")).length;
  } catch {}

  // Detect tier
  const hasUiux = orchExists && fs.existsSync(path.join(orchDir, ".github", "workflows", "uiux-quality-gate.yml"));

  // Check sync status
  let syncStatus = null;
  try {
    if (fs.existsSync(syncStatusPath)) {
      syncStatus = JSON.parse(fs.readFileSync(syncStatusPath, "utf8"));
    }
  } catch {}

  // Check local agent scores
  let agentCount = 0;
  try {
    if (fs.existsSync(agentScoresPath)) {
      const scores = JSON.parse(fs.readFileSync(agentScoresPath, "utf8"));
      agentCount = Object.keys(scores.agents || {}).length;
    }
  } catch {}

  console.log("");
  console.log("solo-cto-agent status");
  console.log("─────────────────────");
  console.log(`  Skills:        ${skillOk ? (wizardConfigured ? "✅ configured" : "⚠️  installed (run init --wizard to configure)") : "❌ not found"}`);
  console.log(`  Error catalog: ${catalogOk ? `✅ ${count} patterns` : "❌ not found"}`);
  console.log(`  Orchestrator:  ${orchExists ? `✅ ${orchWorkflows} workflows` : "❌ not found"}`);
  console.log(`  Tier:          ${orchExists ? (hasUiux ? "CTO (Lv5+6)" : "Builder (Lv4)") : "N/A"}`);

  // Sync info
  if (syncStatus) {
    const syncAge = Math.round((Date.now() - new Date(syncStatus.lastSync).getTime()) / 60000);
    const syncLabel = syncAge < 60 ? `${syncAge}m ago` : syncAge < 1440 ? `${Math.round(syncAge / 60)}h ago` : `${Math.round(syncAge / 1440)}d ago`;
    console.log(`  Last sync:     ${syncLabel} (${syncStatus.lastSync})`);
    if (agentCount > 0) console.log(`  Agent scores:  ${agentCount} agents tracked locally`);
  } else {
    console.log(`  Last sync:     never (run: solo-cto-agent sync --org <org>)`);
  }

  // CI status from local sync cache only — no network calls
  if (syncStatus && syncStatus.summary) {
    const s = syncStatus.summary;
    const ciLabel = s.workflowRuns === "ok" ? "✅ data available (from last sync)" : "⚠️  no data (run sync first)";
    console.log(`  CI data:       ${ciLabel}`);
  } else {
    console.log(`  CI data:       no data (run: solo-cto-agent sync --org <org>)`);
  }
  console.log("");
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

// ─── doctor: System Health Check ─────────────────────────────

function doctorCommand() {
  const targetDir = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");
  const skillPath = path.join(targetDir, "SKILL.md");
  const catalogPath = path.join(targetDir, "failure-catalog.json");
  const syncStatusPath = path.join(targetDir, "sync-status.json");
  const coworkEnginePath = path.join(ROOT, "bin", "cowork-engine.js");

  const issues = [];
  let criticalCount = 0;

  console.log("");
  console.log("solo-cto-agent doctor — health check");
  console.log("─".repeat(40));
  console.log("");

  // ─── Skills Check ───────────────────────────────
  console.log("📦 Skills");
  const skillOk = fs.existsSync(skillPath);
  if (skillOk) {
    try {
      const content = fs.readFileSync(skillPath, "utf8");
      const wizardConfigured = content.includes("| Item | Value |") || !content.includes("{{YOUR_");
      const hasMode = content.includes("mode:");
      if (wizardConfigured) {
        console.log("   ✅ SKILL.md installed & configured");
        if (hasMode) {
          const modeMatch = content.match(/mode:\s*([^\n]+)/);
          const mode = modeMatch ? modeMatch[1].trim() : "unknown";
          console.log(`   ✅ Mode detected: ${mode}`);
        } else {
          console.log("   ⚠️  No mode field in SKILL.md");
          issues.push({ level: "warn", msg: "No mode: field in SKILL.md (cowork-main or codex-main)" });
        }
      } else {
        console.log("   ⚠️  SKILL.md exists but not configured");
        issues.push({ level: "warn", msg: "SKILL.md not configured (run: init --wizard)" });
      }
    } catch (err) {
      console.log(`   ❌ Error reading SKILL.md: ${err.message}`);
      issues.push({ level: "error", msg: `Error reading SKILL.md: ${err.message}` });
      criticalCount++;
    }
  } else {
    console.log("   ❌ SKILL.md not found");
    issues.push({ level: "error", msg: "SKILL.md not found (run: init)" });
    criticalCount++;
  }

  // ─── Cowork Engine Check ───────────────────────
  console.log("");
  console.log("⚙️  Engine");
  if (fs.existsSync(coworkEnginePath)) {
    console.log("   ✅ cowork-engine.js found");
    try {
      const engine = require(coworkEnginePath);
      const hasLocalReview = typeof engine.localReview === "function";
      const hasKnowledge = typeof engine.knowledgeCapture === "function";
      const hasDualReview = typeof engine.dualReview === "function";
      const hasDetectDefaultBranch = typeof engine.detectDefaultBranch === "function";
      const sessionSave = typeof engine.sessionSave === "function";
      const sessionRestore = typeof engine.sessionRestore === "function";
      const sessionList = typeof engine.sessionList === "function";

      if (hasLocalReview && hasKnowledge && hasDualReview) {
        console.log("   ✅ Core functions available (localReview, knowledgeCapture, dualReview)");
      } else {
        console.log("   ⚠️  Some core functions missing");
        issues.push({ level: "warn", msg: "Engine missing some core functions" });
      }

      if (sessionSave && sessionRestore && sessionList) {
        console.log("   ✅ Session functions available (save, restore, list)");
      } else {
        console.log("   ⚠️  Session functions not available");
        issues.push({ level: "warn", msg: "Engine missing session functions" });
      }

      const isGitRepo = fs.existsSync(path.join(process.cwd(), ".git"));
      if (hasDetectDefaultBranch && isGitRepo) {
        try {
          const base = engine.detectDefaultBranch({ cwd: process.cwd() });
          console.log(`   ℹ️  Default branch: ${base}`);
        } catch (err) {
          console.log(`   ⚠️  Default branch detection failed: ${err.message}`);
          issues.push({ level: "warn", msg: "Default branch detection failed" });
        }
      } else if (!isGitRepo) {
        console.log("   ℹ️  Default branch: N/A (not a git repo)");
      }
    } catch (err) {
      console.log(`   ⚠️  Engine load failed: ${err.message}`);
      issues.push({ level: "warn", msg: `Engine load failed: ${err.message}` });
    }
  } else {
    console.log("   ❌ cowork-engine.js not found");
    issues.push({ level: "error", msg: "cowork-engine.js not found" });
    criticalCount++;
  }

  // ─── API Keys Check ─────────────────────────────
  console.log("");
  console.log("🔑 API Keys");
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasAnthropic) {
    console.log("   ✅ ANTHROPIC_API_KEY is set");
  } else {
    console.log("   ⚠️  ANTHROPIC_API_KEY not set");
    issues.push({ level: "warn", msg: "ANTHROPIC_API_KEY not set (needed for local review)" });
  }

  if (hasOpenAI) {
    console.log("   ✅ OPENAI_API_KEY is set");
  } else {
    console.log("   ℹ️  OPENAI_API_KEY not set (optional, only for dual-review)");
  }

  const detectedMode = hasAnthropic && hasOpenAI ? "dual" : hasAnthropic ? "solo" : "none";
  console.log(`   ℹ️  Detected mode: ${detectedMode}`);

  if (detectedMode === "none") {
    issues.push({ level: "warn", msg: "No API keys found (set ANTHROPIC_API_KEY for local review)" });
  }

  // ─── Lint Check ─────────────────────────────────
  console.log("");
  console.log("📋 Lint");
  const skillsDir = path.join(ROOT, "skills");
  if (fs.existsSync(skillsDir)) {
    const lintDir = skillsDir;
    const MAX_LINES = 150;
    const entries = fs.readdirSync(lintDir, { withFileTypes: true });
    const skillDirs = entries.filter(e => e.isDirectory()).length;
    let lintIssues = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(lintDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillPath)) {
        lintIssues++;
        continue;
      }

      const content = fs.readFileSync(skillPath, "utf8");
      const lines = content.split("\n");

      if (lines[0].trim() !== "---") {
        lintIssues++;
      }

      if (lines.length > MAX_LINES) {
        lintIssues++;
      }
    }

    if (lintIssues === 0) {
      console.log(`   ✅ ${skillDirs} skills clean`);
    } else {
      console.log(`   ⚠️  ${lintIssues} lint issue(s) found`);
      issues.push({ level: "warn", msg: `${lintIssues} lint issues in skills/ directory` });
    }
  } else {
    console.log("   ℹ️  No skills/ directory found (local development only)");
  }

  // ─── Sync Check ─────────────────────────────────
  console.log("");
  console.log("🔄 Sync");
  if (fs.existsSync(syncStatusPath)) {
    try {
      const syncStatus = JSON.parse(fs.readFileSync(syncStatusPath, "utf8"));
      const syncAge = Math.round((Date.now() - new Date(syncStatus.lastSync).getTime()) / 60000);
      const syncLabel = syncAge < 60 ? `${syncAge}m ago` : syncAge < 1440 ? `${Math.round(syncAge / 60)}h ago` : `${Math.round(syncAge / 1440)}d ago`;
      console.log(`   ✅ Last sync: ${syncLabel}`);
      if (syncStatus.summary && syncStatus.summary.workflowRuns === "ok") {
        console.log(`   ✅ CI data available`);
      } else {
        console.log(`   ⚠️  CI data not available`);
        issues.push({ level: "warn", msg: "Sync CI data not available (run: sync --org <org>)" });
      }
    } catch (err) {
      console.log(`   ⚠️  Sync status corrupted: ${err.message}`);
      issues.push({ level: "warn", msg: "Sync status corrupted" });
    }
  } else {
    console.log("   ℹ️  No sync data (run: sync --org <github-org>)");
  }

  // ─── Error Catalog Check ────────────────────────
  console.log("");
  console.log("📚 Error Catalog");
  if (fs.existsSync(catalogPath)) {
    try {
      const count = readCatalogCount(catalogPath);
      console.log(`   ✅ ${count} failure patterns loaded`);
    } catch (err) {
      console.log(`   ⚠️  Catalog corrupted: ${err.message}`);
      issues.push({ level: "warn", msg: "Error catalog corrupted" });
    }
  } else {
    console.log("   ⚠️  failure-catalog.json not found");
    issues.push({ level: "warn", msg: "failure-catalog.json not found" });
  }

  // ─── Summary ─────────────────────────────────────
  console.log("");
  console.log("─".repeat(40));

  const errors = issues.filter(i => i.level === "error");
  const warns = issues.filter(i => i.level === "warn");

  if (errors.length === 0 && warns.length === 0) {
    console.log("✅ System healthy");
    console.log("");
    process.exit(0);
  }

  if (errors.length > 0) {
    console.log("");
    console.log("Critical Issues:");
    for (const err of errors) {
      console.log(`❌ ${err.msg}`);
    }
  }

  if (warns.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warn of warns) {
      console.log(`⚠️  ${warn.msg}`);
    }
  }

  console.log("");
  process.exit(errors.length > 0 ? 1 : 0);
}

// ─── upgrade: Builder → CTO ────────────────────────────────

function upgradeCommand(org, repos, orchName) {
  if (!org) {
    console.error("❌ --org is required.");
    console.error("   Usage: solo-cto-agent upgrade --org <github-org> [--repos repo1,repo2]");
    process.exit(1);
  }

  const orchestratorRepo = orchName || "dual-agent-orchestrator";
  const orchDir = path.resolve(orchestratorRepo);

  if (!fs.existsSync(orchDir) || !fs.existsSync(path.join(orchDir, ".git"))) {
    console.error(`❌ Orchestrator not found at ${orchDir}`);
    console.error("   Run setup-pipeline first, or use --orchestrator-name to specify.");
    process.exit(1);
  }

  // Check current tier
  const hasCodexAuto = fs.existsSync(path.join(orchDir, ".github", "workflows", "codex-auto.yml"));
  if (hasCodexAuto) {
    console.log("ℹ️  Already at CTO tier (codex-auto.yml detected). Nothing to upgrade.");
    return;
  }

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  solo-cto-agent — Upgrade Builder → CTO         ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");

  const tiersData = loadTiers();
  const proTier = tiersData.tiers.pro;
  const replacements = { "{{GITHUB_OWNER}}": org, "{{ORCHESTRATOR_REPO}}": orchestratorRepo };
  const productRepoList = repos ? repos.split(",").map(r => r.trim()) : [];
  productRepoList.forEach((repo, i) => {
    replacements[`{{PRODUCT_REPO_${i + 1}}}`] = path.basename(repo);
  });
  for (let i = productRepoList.length + 1; i <= 10; i++) {
    replacements[`{{PRODUCT_REPO_${i}}}`] = `your-product-repo-${i}`;
  }

  // Step 1: Add CTO orchestrator workflows
  console.log("[1/4] Adding multi-agent orchestrator workflows...");
  const workflowDest = path.join(orchDir, ".github", "workflows");
  let added = 0;
  for (const wf of proTier.additional_orchestrator_workflows) {
    const src = path.join(ORCH_TEMPLATE, ".github", "workflows", wf);
    if (fs.existsSync(src)) {
      copyFileWithReplace(src, path.join(workflowDest, wf), replacements);
      added++;
    }
  }
  console.log(`   ✅ ${added} workflows added`);

  // Step 2: Add CTO scripts, libs, config, integrations
  console.log("[2/4] Adding CTO ops scripts + config...");
  for (const s of proTier.ops_scripts) {
    const src = path.join(ORCH_TEMPLATE, "ops", "scripts", s);
    if (fs.existsSync(src)) copyFileWithReplace(src, path.join(orchDir, "ops", "scripts", s), replacements);
  }
  for (const l of proTier.ops_libs) {
    const src = path.join(ORCH_TEMPLATE, "ops", "lib", l);
    if (fs.existsSync(src)) copyFileWithReplace(src, path.join(orchDir, "ops", "lib", l), replacements);
  }
  ensureDir(path.join(orchDir, "ops", "config"));
  for (const c of proTier.ops_config) {
    const src = path.join(ORCH_TEMPLATE, "ops", "config", c);
    if (fs.existsSync(src)) copyFileWithReplace(src, path.join(orchDir, "ops", "config", c), replacements);
  }
  for (const item of proTier.ops_orchestrator_extras) {
    const src = path.join(ORCH_TEMPLATE, "ops", "orchestrator", item);
    if (fs.existsSync(src)) copyFileWithReplace(src, path.join(orchDir, "ops", "orchestrator", item), replacements);
  }
  ensureDir(path.join(orchDir, "ops", "integrations"));
  for (const i of proTier.ops_integrations) {
    const src = path.join(ORCH_TEMPLATE, "ops", "integrations", i);
    if (fs.existsSync(src)) copyFileWithReplace(src, path.join(orchDir, "ops", "integrations", i), replacements);
  }
  for (const c of proTier.ops_codex_extras) {
    const src = path.join(ORCH_TEMPLATE, "ops", c);
    if (fs.existsSync(src)) copyFileWithReplace(src, path.join(orchDir, "ops", c), replacements);
  }
  console.log("   ✅ Scripts, libs, config added");

  // Step 3: Upgrade routing config to dual-agent
  console.log("[3/4] Upgrading to dual-agent routing config...");
  const dualPolicy = path.join(ORCH_TEMPLATE, "ops", "orchestrator", "routing-policy.json");
  const dualScores = path.join(ORCH_TEMPLATE, "ops", "orchestrator", "agent-scores.json");
  if (fs.existsSync(dualPolicy)) {
    copyFileWithReplace(dualPolicy, path.join(orchDir, "ops", "orchestrator", "routing-policy.json"), replacements);
  }
  if (fs.existsSync(dualScores)) {
    copyFileWithReplace(dualScores, path.join(orchDir, "ops", "orchestrator", "agent-scores.json"), replacements);
  }
  console.log("   ✅ Dual-agent routing-policy + agent-scores applied");

  // Step 4: Upgrade product repos
  console.log("[4/4] Upgrading product repo workflows...");
  const ctoAdditional = tiersData.product_repo_templates.cto.additional_workflows;

  if (productRepoList.length === 0) {
    console.log("   No --repos specified. Add multi-agent workflows manually:");
    console.log("   solo-cto-agent setup-repo <path> --org " + org + " --tier cto");
  } else {
    for (const repo of productRepoList) {
      const repoDir = path.resolve(repo);
      if (!fs.existsSync(repoDir)) { console.log(`   ⚠️  ${repo} — not found`); continue; }
      const wfDir = path.join(repoDir, ".github", "workflows");
      ensureDir(wfDir);
      let count = 0;
      for (const wf of ctoAdditional) {
        const src = path.join(PRODUCT_TEMPLATE, ".github", "workflows", wf);
        if (fs.existsSync(src)) { copyFileWithReplace(src, path.join(wfDir, wf), replacements); count++; }
      }
      console.log(`   ✅ ${repo} — ${count} multi-agent workflows added`);
    }
  }

  console.log("");
  console.log("═══ UPGRADE COMPLETE ═══");
  console.log("");
  console.log("  New secrets needed:");
  console.log("    gh secret set OPENAI_API_KEY    # Codex agent");
  console.log("    gh secret set TELEGRAM_BOT_TOKEN  # optional");
  console.log("    gh secret set TELEGRAM_CHAT_ID    # optional");
  console.log("");
  console.log("  Commit and push:");
  console.log(`    cd ${orchestratorRepo} && git add -A && git commit -m 'feat: upgrade to CTO tier' && git push`);
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // i18n: resolve locale from --lang flag, env, or default. Must happen before
  // any user-facing output so printHelp() and error messages respect the choice.
  i18n.setLocale(i18n.parseLangFlag(args));

  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    return;
  }

  const force = args.includes("--force");

  if (cmd === "init") {
    const presetIndex = args.indexOf("--preset");
    const preset = presetIndex >= 0 ? args[presetIndex + 1] : DEFAULT_PRESET;
    // Run wizard if --wizard or -w flag
    if (hasWizardFlag(args)) {
      const targetDir = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");
      initCommand(force, preset);
      await runWizard(process.cwd(), force);
      return;
    }
    initCommand(force, preset);
    return;
  }

  // Check mode-aware guards for setup commands
  function checkCoworkMainMode() {
    const skillPath = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent", "SKILL.md");
    try {
      if (fs.existsSync(skillPath)) {
        const content = fs.readFileSync(skillPath, "utf8");
        const modeMatch = content.match(/mode:\s*([^\n]+)/);
        if (modeMatch && modeMatch[1].trim() === "cowork-main") {
          return true;
        }
      }
    } catch {}
    return false;
  }

  if (cmd === "setup-pipeline") {
    if (checkCoworkMainMode()) {
      console.log("ℹ️  Not needed in cowork-main mode. Use `review`, `knowledge`, and `sync` commands instead.");
      return;
    }
    const tierIndex = args.indexOf("--tier");
    const tier = tierIndex >= 0 ? args[tierIndex + 1] : "builder";
    const orgIndex = args.indexOf("--org");
    const org = orgIndex >= 0 ? args[orgIndex + 1] : null;
    const reposIndex = args.indexOf("--repos");
    const repos = reposIndex >= 0 ? args[reposIndex + 1] : null;
    const orchIndex = args.indexOf("--orchestrator-name");
    const orchName = orchIndex >= 0 ? args[orchIndex + 1] : null;
    setupPipelineCommand(tier, org, repos, orchName, force);
    return;
  }

  if (cmd === "setup-repo") {
    if (checkCoworkMainMode()) {
      console.log("ℹ️  Not needed in cowork-main mode. Use `review`, `knowledge`, and `sync` commands instead.");
      return;
    }
    const repoPath = args[1];
    if (!repoPath) {
      console.error("Usage: solo-cto-agent setup-repo <path> --org <github-org> [--tier builder|cto]");
      process.exit(1);
    }
    const tierIndex = args.indexOf("--tier");
    const tier = tierIndex >= 0 ? args[tierIndex + 1] : "builder";
    const orgIndex = args.indexOf("--org");
    const org = orgIndex >= 0 ? args[orgIndex + 1] : null;
    const orchIndex = args.indexOf("--orchestrator-name");
    const orchName = orchIndex >= 0 ? args[orchIndex + 1] : null;
    setupRepoCommand(repoPath, tier, org, orchName);
    return;
  }

  if (cmd === "upgrade") {
    const orgIndex = args.indexOf("--org");
    const org = orgIndex >= 0 ? args[orgIndex + 1] : null;
    const reposIndex = args.indexOf("--repos");
    const repos = reposIndex >= 0 ? args[reposIndex + 1] : null;
    const orchIndex = args.indexOf("--orchestrator-name");
    const orchName = orchIndex >= 0 ? args[orchIndex + 1] : null;
    upgradeCommand(org, repos, orchName);
    return;
  }

  if (cmd === "sync") {
    const orgIndex = args.indexOf("--org");
    const org = orgIndex >= 0 ? args[orgIndex + 1] : null;
    const reposIndex = args.indexOf("--repos");
    const repos = reposIndex >= 0 ? args[reposIndex + 1] : null;
    const orchIndex = args.indexOf("--orchestrator-name");
    const orchName = orchIndex >= 0 ? args[orchIndex + 1] : "dual-agent-orchestrator";
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.ORCHESTRATOR_PAT;
    if (!org) {
      console.error("❌ --org is required.");
      console.error("   Usage: solo-cto-agent sync --org <github-org> [--repos repo1,repo2]");
      process.exit(1);
    }
    const repoList = repos ? repos.split(",").map(r => r.trim()) : [];
    const apply = args.includes("--apply");
    await syncCommand(org, orchName, token, repoList, apply);
    return;
  }

  if (cmd === "review") {
    const mode = detectMode();
    if (mode === "none") {
      console.error("❌ ANTHROPIC_API_KEY required for local review.");
      console.error("   export ANTHROPIC_API_KEY=sk-ant-...");
      process.exit(1);
    }
    const diffSource = args.includes("--branch") ? "branch" : args.includes("--file") ? "file" : "staged";
    // Branch-mode target comes from --target <branch>; file-mode target comes from --file <path>.
    // Keeping the two semantically distinct prevents the accidental
    // "review --branch --file x.json" / "review --json --file out.json" collisions.
    const fileIndex = args.indexOf("--file");
    const targetIndex = args.indexOf("--target");
    let target = null;
    if (diffSource === "branch") {
      target = targetIndex >= 0 ? args[targetIndex + 1] : null; // null → auto-detect default branch
    } else if (diffSource === "file") {
      target = fileIndex >= 0 ? args[fileIndex + 1] : null;
    }
    const dryRun = args.includes("--dry-run");
    const outputFormat = args.includes("--json") ? "json" : args.includes("--markdown") ? "markdown" : "terminal";

    // B5: when --json is requested, route banner / info / success to stderr so
    // stdout stays pure JSON and `solo-cto-agent review --json | jq` works.
    if (outputFormat === "json" && typeof setLogChannel === "function") {
      setLogChannel("stderr");
    }

    if (mode === "dual" && !args.includes("--solo")) {
      if (outputFormat !== "json") {
        console.log("  Both API keys detected. Running dual review (Claude + OpenAI).");
        console.log("  Use --solo to force Claude-only mode.\n");
      }
      await dualReview({ diffSource, target });
    } else {
      await localReview({ diffSource, target, dryRun, outputFormat });
    }
    return;
  }

  if (cmd === "dual-review") {
    if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY) {
      console.error("❌ Both ANTHROPIC_API_KEY and OPENAI_API_KEY required for dual review.");
      process.exit(1);
    }
    const diffSource = args.includes("--branch") ? "branch" : "staged";
    const targetIndex = args.indexOf("--target");
    const target = diffSource === "branch" && targetIndex >= 0 ? args[targetIndex + 1] : null;
    await dualReview({ diffSource, target });
    return;
  }

  if (cmd === "knowledge") {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("❌ ANTHROPIC_API_KEY required for knowledge generation.");
      process.exit(1);
    }
    const source = args.includes("--file") ? "file" : args.includes("--manual") ? "manual" : "session";
    const fileIndex = args.indexOf("--file");
    const inputIndex = args.indexOf("--input");
    const projectIndex = args.indexOf("--project");
    const input = fileIndex >= 0 ? args[fileIndex + 1] : inputIndex >= 0 ? args[inputIndex + 1] : null;
    const projectTag = projectIndex >= 0 ? args[projectIndex + 1] : null;
    await knowledgeCapture({ source, input, projectTag });
    return;
  }

  if (cmd === "status") {
    statusCommand();
    return;
  }

  if (cmd === "lint") {
    lintCommand(args[1]);
    return;
  }

  if (cmd === "doctor") {
    doctorCommand();
    return;
  }

  // ─── uiux-review (cowork: code + vision + cross-verify + suggest-fixes) ─
  if (cmd === "uiux-review" || cmd === "uiux") {
    if (!uiux) {
      console.error("❌ uiux-engine module not installed. Reinstall solo-cto-agent.");
      process.exit(1);
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("❌ ANTHROPIC_API_KEY required for uiux-review.");
      process.exit(1);
    }
    const sub = args[1] || "code";
    const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
    try {
      if (sub === "code") {
        const diffSource = args.includes("--branch") ? "branch" : args.includes("--file") ? "file" : "staged";
        await uiux.uiuxCodeReview({ diffSource, target: get("--file"), projectDir: get("--cwd") || process.cwd() });
      } else if (sub === "vision") {
        await uiux.uiuxVisionReview({
          screenshotPath: get("--screenshot"),
          url: get("--url"),
          viewport: get("--viewport") || "desktop",
          projectSlug: get("--project") || path.basename(process.cwd()),
        });
      } else if (sub === "capture") {
        // PR-G5 — standalone URL→screenshot capture (no Playwright)
        const url = get("--url");
        if (!url) { console.error("❌ --url required for 'uiux capture'"); process.exit(1); }
        const out = get("--out") || null;
        const cap = await uiux.captureScreenshotFromUrl(url, {
          viewport: get("--viewport") || "desktop",
          outPath: out,
        });
        if (!cap.ok) { console.error(`❌ capture failed: ${cap.error}`); process.exit(1); }
        console.log(`✓ captured ${(cap.bytes / 1024).toFixed(1)} KB via ${cap.source} → ${cap.path}`);
      } else if (sub === "cross-verify") {
        await uiux.uiuxCrossVerify({
          diffSource: args.includes("--branch") ? "branch" : "staged",
          screenshotPath: get("--screenshot"),
          url: get("--url"),
          viewport: get("--viewport") || "desktop",
          projectSlug: get("--project") || path.basename(process.cwd()),
          projectDir: get("--cwd") || process.cwd(),
        });
      } else if (sub === "suggest-fixes") {
        await uiux.uiuxSuggestFixes({
          reviewFile: get("--review"),
          applyMode: args.includes("--apply") ? "apply" : "dry-run",
        });
      } else if (sub === "baseline") {
        const action = args[2] || "save";
        if (action === "save") uiux.baselineSave({ screenshotPath: get("--screenshot"), projectSlug: get("--project"), viewport: get("--viewport") || "desktop" });
        else if (action === "diff") uiux.baselineDiff({ screenshotPath: get("--screenshot"), projectSlug: get("--project"), viewport: get("--viewport") || "desktop" });
        else { console.error("❌ Use: uiux baseline save|diff"); process.exit(1); }
      } else if (sub === "tokens" || sub === "extract-tokens") {
        const tokens = uiux.extractDesignTokens(get("--cwd") || process.cwd());
        console.log(uiux.summarizeTokens(tokens));
      } else {
        console.error(`❌ Unknown uiux subcommand: ${sub}`);
        console.error(`   Use: uiux-review code|vision|cross-verify|suggest-fixes|baseline|tokens`);
        process.exit(1);
      }
    } catch (e) {
      console.error(`❌ uiux-review failed: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // ─── apply-fixes (rework loop) ─────────────────────────────
  if (cmd === "apply-fixes") {
    if (!rework) {
      console.error("❌ rework module not installed. Reinstall solo-cto-agent.");
      process.exit(1);
    }
    const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
    const reviewFile = get("--review");
    if (!reviewFile) { console.error("❌ --review <file.json> required"); process.exit(1); }
    const opts = {
      reviewFile,
      apply: args.includes("--apply"),
      only: get("--only") ? get("--only").split(",").map((s) => s.trim().toUpperCase()) : ["BLOCKER", "SUGGESTION"],
      maxFixes: get("--max-fixes") ? parseInt(get("--max-fixes"), 10) : 5,
      cleanCheck: !args.includes("--no-clean-check"),
      cwd: get("--cwd") || process.cwd(),
      notifier: notify ? notify.notifyApplyResult : null,
    };
    try {
      const result = await rework.applyFixes(opts);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.failed.length > 0 ? 1 : 0);
    } catch (e) {
      console.error(`❌ apply-fixes failed: ${e.message}`);
      process.exit(1);
    }
  }

  // ─── feedback (accept/reject for personalization) ─────────
  if (cmd === "feedback") {
    const sub = args[1];
    if (!["accept", "reject", "show"].includes(sub)) {
      console.error("❌ Use: feedback accept|reject --location <path> [--severity BLOCKER|SUGGESTION] [--note \"...\"]");
      console.error("       feedback show");
      process.exit(1);
    }
    const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
    if (sub === "show") {
      const { loadPersonalization } = require("./cowork-engine");
      const p = loadPersonalization();
      console.log(JSON.stringify({
        reviewCount: p.reviewCount,
        accepted: p.acceptedPatterns || [],
        rejected: p.rejectedPatterns || [],
      }, null, 2));
      return;
    }
    const location = get("--location");
    if (!location) { console.error("❌ --location <path[:line]> required"); process.exit(1); }
    try {
      const result = recordFeedback({
        verdict: sub,
        location,
        severity: get("--severity") || "UNKNOWN",
        note: get("--note") || "",
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.error(`❌ feedback failed: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // ─── feedback-inbound (parse Slack/GitHub payload → recordFeedback) ─
  if (cmd === "feedback-inbound") {
    if (!inboundFeedback) { console.error("❌ inbound-feedback module not installed."); process.exit(1); }
    const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
    const source = get("--source") || "generic";
    const payloadArg = get("--payload");
    const payloadFile = get("--payload-file");
    let payloadRaw = null;
    try {
      if (args.includes("--stdin")) {
        payloadRaw = fs.readFileSync(0, "utf8");
      } else if (payloadFile) {
        payloadRaw = fs.readFileSync(path.resolve(payloadFile), "utf8");
      } else if (payloadArg) {
        payloadRaw = payloadArg;
      } else {
        console.error("❌ feedback-inbound requires --payload <json>, --payload-file <path>, or --stdin");
        process.exit(1);
      }
      const payload = JSON.parse(payloadRaw);
      const result = inboundFeedback.handleInbound({ source, payload });
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    } catch (e) {
      console.error(`❌ feedback-inbound failed: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // ─── external-loop (one-shot T2 + T3 ping, no diff review) ─
  if (cmd === "external-loop") {
    if (!watch) { console.error("❌ watch module not installed."); process.exit(1); }
    try {
      const result = await watch.externalLoopPing({});
      if (args.includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(watch.formatExternalLoopPing(result));
      }
      // Exit non-zero if inactive or alerts present so cron can react.
      if (!result.ok) process.exit(2);
      if (result.alerts && result.alerts.length) process.exit(1);
    } catch (e) {
      console.error(`❌ external-loop failed: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // ─── watch (file watcher with tier gate) ──────────────────
  if (cmd === "watch") {
    if (!watch) { console.error("❌ watch module not installed."); process.exit(1); }
    const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
    await watch.startWatch({
      rootDir: get("--root") ? path.resolve(get("--root")) : process.cwd(),
      auto: args.includes("--auto"),
      force: args.includes("--force"),
      debounceMs: get("--debounce-ms") ? parseInt(get("--debounce-ms"), 10) : 1500,
      dryRun: args.includes("--dry-run"),
    });
    return;
  }

  // ─── notify (manual outbound message) ─────────────────────
  if (cmd === "notify") {
    if (!notify) { console.error("❌ notify module not installed."); process.exit(1); }
    if (args.includes("--detect")) {
      console.log(JSON.stringify({ detected: notify.detectChannels() }, null, 2));
      return;
    }
    const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

    // PR-G9-ship-emit — deploy-event convenience subcommands. The ship
    // skill (skills/ship/SKILL.md) hooks these after a preview/production
    // deploy so users get a tagged event that the notify-config filter
    // can mute or surface per channel.
    const sub = args[1];
    if (sub === "deploy-ready" || sub === "deploy-error") {
      const status = sub === "deploy-ready" ? "success" : "failed";
      const r = await notify.notifyDeployResult({
        target: get("--target") || "preview",
        status,
        url: get("--url") || "",
        commit: get("--commit") || "",
        summary: get("--body") || "",
      });
      const ok = r.results.filter((x) => x.ok).map((x) => x.channel).join(", ") || "(none)";
      process.stderr.write(`sent: ${ok}\n`);
      return;
    }

    const title = get("--title");
    if (!title) { console.error("❌ --title required (or use --detect)"); process.exit(1); }
    const channels = get("--channels") ? get("--channels").split(",") : undefined;
    const meta = {};
    args.forEach((a, i) => { if (a === "--meta" && args[i + 1]) { const eq = args[i + 1].indexOf("="); if (eq > 0) meta[args[i + 1].slice(0, eq)] = args[i + 1].slice(eq + 1); }});
    const r = await notify.notify({
      severity: get("--severity") || "info",
      title, body: get("--body") || "", meta, channels,
    });
    const ok = r.results.filter((x) => x.ok).map((x) => x.channel).join(", ") || "(none)";
    process.stderr.write(`sent: ${ok}\n`);
    return;
  }

  if (cmd === "session") {
    const subcommand = args[1] || "list";

    if (subcommand === "save") {
      const projectIdx = args.indexOf("--project");
      const projectTag = projectIdx >= 0 ? args[projectIdx + 1] : null;
      sessionSave({ projectTag });
    } else if (subcommand === "restore") {
      const sessionIdx = args.indexOf("--session");
      const sessionFile = sessionIdx >= 0 ? args[sessionIdx + 1] : null;
      const data = sessionRestore({ sessionFile });
      if (data) {
        console.log(JSON.stringify(data, null, 2));
      }
    } else if (subcommand === "list") {
      const limitIdx = args.indexOf("--limit");
      const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 10;
      sessionList({ limit });
    } else {
      console.error(`❌ Unknown session subcommand: ${subcommand}`);
      console.error(`   Use: solo-cto-agent session save|restore|list`);
      process.exit(1);
    }
    return;
  }

  if (cmd === "telegram") {
    if (!telegramWizard) {
      console.error("❌ telegram-wizard module not available in this install.");
      process.exit(1);
    }
    const sub = args[1] || "wizard";

    // Common flag parser (subset relevant to each subcommand).
    const opts = {};
    const tokIdx = args.indexOf("--token");      if (tokIdx >= 0) opts.token = args[tokIdx + 1];
    const chatIdx = args.indexOf("--chat");      if (chatIdx >= 0) opts.chat = args[chatIdx + 1];
    const stoIdx = args.indexOf("--storage");    if (stoIdx >= 0) opts.storage = parseInt(args[stoIdx + 1], 10);
    const toutIdx = args.indexOf("--timeout");   if (toutIdx >= 0) opts.timeout = parseInt(args[toutIdx + 1], 10);
    const eventIdx = args.indexOf("--event");    if (eventIdx >= 0) opts.event = args[eventIdx + 1];
    const fmtIdx = args.indexOf("--format");     if (fmtIdx >= 0) opts.format = args[fmtIdx + 1];
    const textIdx = args.indexOf("--text");      if (textIdx >= 0) opts.text = args[textIdx + 1];
    if (args.includes("--non-interactive")) opts.nonInteractive = true;
    if (args.includes("--force")) opts.force = true;
    if (args.includes("--list")) opts.list = true;
    if (args.includes("--on")) opts.on = true;
    if (args.includes("--off")) opts.off = true;
    if (args.includes("--no-gh")) opts.withGh = false;

    const dispatch = {
      wizard:   () => telegramWizard.runWizard(opts),
      test:     () => telegramWizard.telegramTest(opts),
      verify:   () => telegramWizard.telegramVerify(opts),
      status:   () => Promise.resolve(telegramWizard.telegramStatus(opts)),
      disable:  () => telegramWizard.telegramDisable(opts),
      config:   () => telegramWizard.telegramConfig(opts),
    };

    if (!dispatch[sub]) {
      console.error(`❌ Unknown telegram subcommand: ${sub}`);
      console.error(`   Use: solo-cto-agent telegram wizard|test|verify|status|disable|config`);
      process.exit(1);
    }

    dispatch[sub]().then((res) => {
      if (!res || !res.ok) process.exit(1);
    }).catch((e) => {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    });
    return;
  }

  if (cmd === "plugin") {
    if (!pluginManager) {
      console.error("❌ plugin-manager module not available in this install.");
      process.exit(1);
    }
    const sub = args[1] || "list";

    if (sub === "list") {
      const plugins = pluginManager.listPlugins();
      if (args.includes("--json")) {
        console.log(JSON.stringify(plugins, null, 2));
      } else {
        console.log(pluginManager.formatPluginListText(plugins));
      }
      return;
    }

    if (sub === "show") {
      const name = args[2];
      if (!name) {
        console.error("❌ Usage: solo-cto-agent plugin show <name>");
        process.exit(1);
      }
      const manifest = pluginManager.readManifest();
      const plugin = pluginManager.findPlugin(manifest, name);
      if (!plugin) {
        console.error(`❌ Plugin not found: ${name}`);
        process.exit(1);
      }
      console.log(JSON.stringify(plugin, null, 2));
      return;
    }

    if (sub === "add") {
      const pathIdx = args.indexOf("--path");
      const nameIdx = args.indexOf("--name");
      if (pathIdx < 0) {
        console.error("❌ Usage: solo-cto-agent plugin add --path <dir> [--name <override>]");
        console.error("   (npm install coming in a later release; use --path for local dirs.)");
        process.exit(1);
      }
      const dir = path.resolve(args[pathIdx + 1]);
      const read = pluginManager.readPackageJsonFromPath(dir);
      if (!read.ok) {
        console.error(`❌ ${read.error}`);
        process.exit(1);
      }
      const pkg = nameIdx >= 0 ? { ...read.pkg, name: args[nameIdx + 1] } : read.pkg;
      const source = `path:${dir}`;
      const res = pluginManager.addPlugin({ pkg, source });
      if (!res.ok) {
        console.error("❌ Plugin validation failed:");
        for (const e of res.errors) console.error(`   - ${e}`);
        process.exit(1);
      }
      console.log(`✓ ${res.replaced ? "Updated" : "Added"} ${res.plugin.name}@${res.plugin.version} (${source})`);
      console.log(`  agents: ${res.plugin.agents.join(", ")}`);
      if (res.plugin.capabilities.length) {
        console.log(`  capabilities: ${res.plugin.capabilities.join(", ")}`);
      }
      return;
    }

    if (sub === "test-hooks") {
      let pluginLoader;
      try { pluginLoader = require("./plugin-loader"); }
      catch (e) { console.error(`❌ plugin-loader not available: ${e.message}`); process.exit(1); }
      const evtIdx = args.indexOf("--event");
      const event = evtIdx >= 0 ? args[evtIdx + 1] : "pre-review";
      if (event !== "pre-review" && event !== "post-review") {
        console.error(`❌ --event must be pre-review or post-review`);
        process.exit(1);
      }
      (async () => {
        const manifest = pluginManager.readManifest();
        if (!manifest.plugins || manifest.plugins.length === 0) {
          console.log("No plugins registered. Run `solo-cto-agent plugin add --path <dir>` first.");
          return;
        }
        const payload = { diff: "// sample diff\n+ console.log('hi')\n", metadata: { dryRun: true } };
        const fn = event === "pre-review" ? pluginLoader.runPreReviewHooks : pluginLoader.runPostReviewHooks;
        const result = await fn(payload, { manifest });
        console.log(`${event} → ${Array.isArray(result) ? result.length + " hook(s)" : "patched payload"}:`);
        console.log(JSON.stringify(result, null, 2));
      })().catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
      return;
    }

    if (sub === "remove" || sub === "rm") {
      const name = args[2];
      if (!name) {
        console.error("❌ Usage: solo-cto-agent plugin remove <name>");
        process.exit(1);
      }
      const res = pluginManager.removePlugin(name);
      if (!res.removed) {
        console.error(`❌ Plugin not found: ${name}`);
        process.exit(1);
      }
      console.log(`✓ Removed ${name}`);
      return;
    }

    console.error(`❌ Unknown plugin subcommand: ${sub}`);
    console.error(`   Use: solo-cto-agent plugin list|show|add|remove`);
    process.exit(1);
  }

  printHelp();
  process.exit(1);
}

main();
