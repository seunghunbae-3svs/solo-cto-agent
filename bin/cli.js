#!/usr/bin/env node
/* eslint-disable no-console */

// P0 Security: mask secrets in all console output before anything else
require("./safe-log").wrapConsole();

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const { execSync } = require("child_process");

const { syncCommand } = require("./sync");
const { applyFixes, auditManagedRepos, defaultAuditSettings, loadManifest, makeManagedRepoEntry, upsertManagedRepo, writeManifest } = require("./template-audit");
const { runWizard, hasWizardFlag } = require("./wizard");
const i18n = require("./i18n");
const { localReview, knowledgeCapture, dualReview, detectMode, sessionSave, sessionRestore, sessionList, recordFeedback, setLogChannel, fireRoutine, buildRoutineSchedules, managedAgentReview, getDiff } = require("./cowork-engine");
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
let telegramBot;
try { telegramBot = require("./telegram-bot"); } catch (_) { telegramBot = null; }
let selfEvolve;
try { selfEvolve = require("./self-evolve"); } catch (_) { selfEvolve = null; }
let repoDiscovery;
try { repoDiscovery = require("./repo-discovery"); } catch (_) { repoDiscovery = null; }

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

function localSkillDir() {
  return path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");
}

function localManagedReposPath() {
  return path.join(localSkillDir(), "managed-repos.json");
}

function orchestratorManagedReposPath(orchestratorDir) {
  return path.join(orchestratorDir, "ops", "orchestrator", "managed-repos.json");
}

// ─── Helpers ────────────────────────────────────────────────

function printHelp() {
  console.log(`solo-cto-agent — ${i18n.t("cli.tagline")}

Usage:
  solo-cto-agent init [--force] [--preset maker|builder|cto] [--wizard]
  solo-cto-agent setup-pipeline --org <github-org> [--tier builder|cto] [--repos <repo1,repo2,...>]
  solo-cto-agent repos list [--org <github-org>]      # show/re-pick the saved repo selection
  solo-cto-agent do "<instruction>" [--dry-run] [--repo owner/name] [--agent claude|codex]
  solo-cto-agent setup-repo <repo-path> --org <github-org> [--tier builder|cto]
  solo-cto-agent auto-setup                 # Install solo-cto-pipeline.yml to your repos (centralized)
  solo-cto-agent setup --central --org <owner> [--orchestrator <repo>] [--repos <r1,r2,...>] [--dry-run]
  solo-cto-agent upgrade --org <github-org> [--repos <repo1,repo2,...>]
  solo-cto-agent sync --org <github-org> [--apply] [--repos <repo1,repo2,...>]
  solo-cto-agent template-audit
  solo-cto-agent review [--staged|--branch [--target <base>]|--file <path>] [--dry-run] [--solo] [--json|--markdown]
  solo-cto-agent dual-review [--staged|--branch [--target <base>]]
  solo-cto-agent deep-review [--staged|--branch|--file <path>] [--dry-run] [--json]  # CTO tier
  solo-cto-agent routine fire [--trigger <id>] [--text <context>] [--dry-run]         # CTO tier
  solo-cto-agent routine schedules [--json]
  solo-cto-agent knowledge [--session|--file <path>|--manual] [--project <tag>]
  solo-cto-agent session save|restore|list [--project <tag>] [--session <file>] [--limit <n>]
  solo-cto-agent benchmark [--json|--html]
  solo-cto-agent status
  solo-cto-agent lint [path]
  solo-cto-agent doctor
  solo-cto-agent notify deploy-ready --target <env> --url <url> --commit <sha> [--body <msg>]
  solo-cto-agent notify deploy-error --target <env> --commit <sha> --body <msg>
  solo-cto-agent telegram wizard|bot [options]
  solo-cto-agent --help
  solo-cto-agent --version | -V
  solo-cto-agent --completions <bash|zsh>      # output shell completions
  solo-cto-agent --lang <en|ko> <command>      # override CLI locale (or SOLO_CTO_LANG env)

Commands:
  init              Install skills to ~/.claude/skills/, then run doctor to verify setup
  setup-pipeline    Full pipeline setup: create orchestrator repo + install workflows to product repos
  repos list        Print current saved repo selection (from init wizard) and re-pick interactively
  do                Natural-language work order: LLM parses intent → creates labeled issue → worker runs
  setup-repo        Install dual-agent workflows to a single product repo
  auto-setup        Install solo-cto-pipeline.yml (centralized thin workflow) to selected repos
  setup --central   Centralize cross-repo workflows (digest, bot-runner) to orchestrator repo
  upgrade           Upgrade Builder (Lv4) → CTO (Lv5+6): add multi-agent workflows + config
  sync              Fetch CI/CD results from GitHub (dry-run by default, --apply to write)
  template-audit    Scan managed repos for missing, drifted, or customized templates
  review            Local code review via Claude API (auto-detects dual mode if both keys set)
  dual-review       Explicit dual-agent cross-review (Claude + OpenAI)
  knowledge         Extract session decisions into knowledge articles via Claude API
  session           Save/restore/list session context (cowork-main mode)
  benchmark         Display metrics dashboard (--json for raw data, --html to open web dashboard)
  status            Check skill health, error catalog, sync status (local only, no network)
  lint              Check skill files for size and structure issues
  doctor            Complete system health check (skills, engine, API keys, notifications, catalog)
  notify            Send event-tagged notification (deploy-ready / deploy-error)
  telegram wizard   Interactive setup for Telegram notifications
  telegram bot      Start long-polling bot for PR decision callbacks (APPROVE/HOLD/FEEDBACK)
  ci-setup          Deploy 3-pass review workflow to a GitHub repo (auto-creates .github/workflows/)
  deep-review       Managed Agent deep-review with sandboxed code execution (CTO tier, $0.08/session-hr)
  routine fire      Fire a Claude Code Routine via /fire API endpoint (CTO tier)
  routine schedules List configured routine schedules

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
  npx solo-cto-agent template-audit                        # audit managed repos against current templates
  npx solo-cto-agent template-audit --apply --dry-run     # preview fixes without writing
  npx solo-cto-agent template-audit --apply               # apply fixes (restore drifted/missing files)
  npx solo-cto-agent review                                # Claude review of staged changes
  npx solo-cto-agent review --branch                       # review branch diff vs auto-detected default
  npx solo-cto-agent review --branch --target develop      # review branch diff vs explicit base
  npx solo-cto-agent review --staged --json | jq .verdict  # pipe-safe JSON
  npx solo-cto-agent dual-review                           # Claude + OpenAI cross-review
  npx solo-cto-agent knowledge                             # extract decisions from recent commits
  npx solo-cto-agent knowledge --project sample-store      # tag with project name
  npx solo-cto-agent session save --project sample-store   # save session context
  npx solo-cto-agent session restore                       # load most recent session
  npx solo-cto-agent session list --limit 5                # show 5 recent sessions
  npx solo-cto-agent benchmark                             # display metrics in terminal
  npx solo-cto-agent benchmark --json                      # output JSON metrics
  npx solo-cto-agent benchmark --html                      # open web dashboard
  npx solo-cto-agent notify deploy-ready --target production --url https://myapp.com --commit abc1234
  npx solo-cto-agent notify deploy-error --target preview --body "$(tail -50 build.log)"
  npx solo-cto-agent ci-setup --repo owner/repo              # deploy 3-pass review workflow
  npx solo-cto-agent ci-setup --repo owner/repo --branch master  # specify default branch
  npx solo-cto-agent telegram wizard                          # setup Telegram alerts
  npx solo-cto-agent telegram bot                             # start PR decision bot

  # Claude Code Routines (CTO tier — cloud-based, laptop can be closed)
  npx solo-cto-agent routine fire --text "Nightly review"       # fire routine manually
  npx solo-cto-agent routine schedules                          # list configured schedules

  # Managed Agent Deep Review (CTO tier — sandboxed code execution)
  npx solo-cto-agent deep-review                                # deep-review staged changes
  npx solo-cto-agent deep-review --dry-run                      # preview cost without sending
`);
  console.log(`
Cloud Features (CTO tier only — requires config):
  Routines       Schedule/trigger reviews on Anthropic cloud. Daily caps: Pro=5, Max=15, Team=25.
                 Cost: standard Claude token rates.
  Deep Review    Managed Agent with sandboxed execution for higher-confidence reviews.
                 Cost: standard token rates + $0.08/session-hour active runtime.
  See: https://github.com/seunghunbae-3svs/solo-cto-agent/blob/main/docs/configuration.md#cloud-features
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

function registerManagedRepoForLocal(managedRepo) {
  upsertManagedRepo(localManagedReposPath(), managedRepo);
}

function writeOrchestratorManagedRepos(orchestratorDir, managedRepos) {
  const manifestPath = orchestratorManagedReposPath(orchestratorDir);
  const manifest = loadManifest(manifestPath);
  manifest.templateAudit = defaultAuditSettings();
  manifest.repos = managedRepos.map((repo) => sanitizeRepoForOrchestratorManifest(repo));
  writeManifest(manifestPath, manifest);
}

function sanitizeRepoForOrchestratorManifest(repo) {
  return {
    type: repo.type,
    tier: repo.tier,
    mode: repo.mode,
    owner: repo.owner,
    repoName: repo.repoName,
    repoSlug: repo.repoSlug,
    repoPath: repo.type === "orchestrator" ? repo.repoPath : null,
    orchestratorName: repo.orchestratorName || null,
    templateAudit: defaultAuditSettings(),
    lastInstalledAt: repo.lastInstalledAt,
    files: (repo.files || []).map((file) => ({
      targetPath: file.targetPath,
      installedHash: file.installedHash,
      optional: !!file.optional,
      category: file.category || "template",
    })),
  };
}

function upsertOrchestratorManagedRepo(orchestratorDir, repo) {
  if (!fs.existsSync(path.join(orchestratorDir, "ops", "orchestrator"))) return;
  upsertManagedRepo(orchestratorManagedReposPath(orchestratorDir), sanitizeRepoForOrchestratorManifest(repo));
}

function findLikelyOrchestratorDir(orchestratorRepo, productRepoDir) {
  const candidates = [
    path.resolve(orchestratorRepo),
    path.resolve(process.cwd(), orchestratorRepo),
    path.resolve(path.dirname(productRepoDir), orchestratorRepo),
    path.resolve(productRepoDir, "..", orchestratorRepo),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "ops", "orchestrator"))) return candidate;
  }
  return null;
}

function summarizeTemplateAudit(audit) {
  const repoCount = audit.repos.length;
  const driftRepos = audit.repos.filter((repo) => repo.summary.drift > 0 || repo.summary.missing > 0 || repo.summary.custom > 0);
  return {
    repoCount,
    driftRepos: driftRepos.length,
    totals: audit.totals,
  };
}

function printTemplateAudit(audit, opts = {}) {
  const quietOk = opts.quietOk === true;
  const summary = summarizeTemplateAudit(audit);
  if (audit.repos.length === 0) {
    console.log("   INFO No managed repos registered yet");
    return summary;
  }

  console.log(`   INFO Managed repos: ${summary.repoCount}`);
  for (const repo of audit.repos) {
    const label = repo.entry.repoSlug || repo.entry.repoPath || repo.entry.repoName;
    const parts = [];
    if (repo.summary.drift) parts.push(`drift ${repo.summary.drift}`);
    if (repo.summary.custom) parts.push(`custom ${repo.summary.custom}`);
    if (repo.summary.missing) parts.push(`missing ${repo.summary.missing}`);
    if (repo.summary.optionalMissing) parts.push(`optional-missing ${repo.summary.optionalMissing}`);
    if (parts.length === 0 && !quietOk) parts.push(`ok ${repo.summary.ok}`);
    if (parts.length === 0) continue;
    console.log(`   ${parts[0].startsWith("ok") ? "OK" : "WARN"} ${label}: ${parts.join(", ")}`);
  }
  return summary;
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
  const targetDir = localSkillDir();
  ensureDir(targetDir);
  writeManifest(localManagedReposPath(), loadManifest(localManagedReposPath()));

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
  console.log("Running doctor --quick to check remaining setup...");
  console.log("");
  doctorCommand({ exitOnError: false, quick: true });
}

// ─── repos: show/re-pick saved selection ────────────────────

async function reposCommand(args) {
  if (!repoDiscovery) {
    console.error("❌ repo-discovery module not available in this install.");
    process.exit(1);
  }
  const sub = args[1] || "list";
  if (sub !== "list") {
    console.error(`Unknown repos subcommand: ${sub}`);
    console.error("Usage: solo-cto-agent repos list [--org <github-org>]");
    process.exit(1);
  }

  const orgIndex = args.indexOf("--org");
  let org = orgIndex >= 0 ? args[orgIndex + 1] : null;

  const saved = repoDiscovery.loadSelection();
  if (saved) {
    console.log(`Saved selection (${repoDiscovery.selectionPath()}):`);
    console.log(`  org:     ${saved.org || "(user-scoped)"}`);
    console.log(`  updated: ${saved.updatedAt || "—"}`);
    console.log(`  repos:   ${saved.selected.length ? saved.selected.join(", ") : "(none)"}`);
    if (!org && saved.org) org = saved.org;
  } else {
    console.log("No saved selection yet. Run `solo-cto-agent init --wizard` first, or re-pick below.");
  }

  // Non-TTY callers (CI) just get the print-out.
  const { isTTY, createRl } = require("./prompt-utils");
  const { ask } = require("./prompt-utils");
  if (!isTTY()) {
    console.log("\nℹ️  Non-interactive terminal — skipping re-pick prompt.");
    return;
  }

  const rl = createRl();
  try {
    const again = await ask(rl, "\nRe-pick repos now?", "n");
    if (!/^y(es)?$/i.test(again.trim())) {
      rl.close();
      return;
    }

    let repos = null;
    try {
      repos = repoDiscovery.fetchRepos({ org });
    } catch (err) {
      console.log(`⚠️  ${err.message}`);
    }

    if (repos == null) {
      console.log("`gh` CLI not found. Install from https://cli.github.com/ then `gh auth login`.");
      const manual = await ask(rl, "Paste repo slugs manually (comma-separated, or blank to cancel)", "");
      const selected = manual.split(",").map((s) => s.trim()).filter(Boolean);
      if (selected.length) {
        const file = repoDiscovery.saveSelection({ org, selected, discovered: [] });
        console.log(`✅ Saved ${selected.length} repo(s) to ${file}`);
      } else {
        console.log("No changes.");
      }
    } else if (repos.length === 0) {
      console.log("No repositories returned from gh.");
    } else {
      const preselected = saved && Array.isArray(saved.selected) && saved.selected.length
        ? saved.selected
        : repoDiscovery.defaultPreselect(repos);
      const selected = await repoDiscovery.pickReposInteractive(rl, ask, repos, preselected);
      const file = repoDiscovery.saveSelection({ org, selected, discovered: repos });
      console.log(`✅ Saved ${selected.length} repo(s) to ${file}`);
    }
  } finally {
    rl.close();
  }
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
  const managedRepoEntries = [];
  const orchestratorEntry = makeManagedRepoEntry({
    packageRoot: ROOT,
    tiersData,
    type: "orchestrator",
    tier: normalizedTier,
    mode: "codex-main",
    owner: org,
    repoName: orchestratorRepo,
    repoPath: orchDir,
    orchestratorName: orchestratorRepo,
    replacements,
  });
  managedRepoEntries.push(orchestratorEntry);
  registerManagedRepoForLocal(orchestratorEntry);


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

      const productEntry = makeManagedRepoEntry({
        packageRoot: ROOT,
        tiersData,
        type: "product-repo",
        tier: normalizedTier,
        mode: "codex-main",
        owner: org,
        repoName: path.basename(repo),
        repoPath: repoDir,
        orchestratorName: orchestratorRepo,
        replacements: {
          ...replacements,
          "{{PRODUCT_REPO_1}}": path.basename(repo),
        },
      });
      managedRepoEntries.push(productEntry);
      registerManagedRepoForLocal(productEntry);
    }
  }

  // ── Step 3: Generate .env template ──
  console.log("");
  console.log("[3/4] Generating environment config...");

  const envContent = generateEnvGuide(isPro, org);
  const envPath = path.join(orchDir, ".env.setup-guide");
  fs.writeFileSync(envPath, envContent, "utf8");
  console.log(`   ✅ Setup guide: ${envPath}`);
  writeOrchestratorManagedRepos(orchDir, managedRepoEntries);
  console.log(`   Template audit manifest: ${orchestratorManagedReposPath(orchDir)}`);

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

  const managedRepo = makeManagedRepoEntry({
    packageRoot: ROOT,
    tiersData,
    type: "product-repo",
    tier: isPro ? "cto" : "builder",
    mode: "codex-main",
    owner: org,
    repoName: path.basename(resolved),
    repoPath: resolved,
    orchestratorName: orchestratorRepo,
    replacements,
  });
  registerManagedRepoForLocal(managedRepo);

  const linkedOrchestratorDir = findLikelyOrchestratorDir(orchestratorRepo, resolved);
  if (linkedOrchestratorDir) {
    upsertOrchestratorManagedRepo(linkedOrchestratorDir, managedRepo);
    console.log(`   Audit manifest updated: ${orchestratorManagedReposPath(linkedOrchestratorDir)}`);
  }
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

function benchmarkCommand(args) {
  const metricsPath = path.join(ROOT, "benchmarks", "metrics-latest.json");

  if (!fs.existsSync(metricsPath)) {
    console.error("❌ No benchmark metrics found. Run: npm run benchmark:collect");
    process.exit(1);
  }

  try {
    const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8"));

    if (args.includes("--html")) {
      // Open HTML dashboard
      const dashboardPath = path.join(ROOT, "benchmarks", "dashboard.html");
      if (!fs.existsSync(dashboardPath)) {
        console.error("❌ dashboard.html not found");
        process.exit(1);
      }
      const { execSync } = require("child_process");
      const platform = process.platform;
      const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
      execSync(`${cmd} "${dashboardPath}"`);
      console.log(`📊 Dashboard opened: ${dashboardPath}`);
      return;
    }

    // Feature 2: Handle --diff mode
    if (args.includes("--diff")) {
      const historyDir = path.join(ROOT, "benchmarks", "history");
      if (!fs.existsSync(historyDir)) {
        console.error("❌ No history directory found. Run benchmark collection first.");
        process.exit(1);
      }
      const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).sort().reverse();
      if (files.length < 2) {
        console.error("❌ Need at least 2 snapshots for diff. Collect metrics again tomorrow.");
        process.exit(1);
      }
      const previousPath = path.join(historyDir, files[1]);
      const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));

      const deltaFormat = (curr, prev, label, isPercent = false) => {
        if (curr == null || prev == null) return "n/a";
        const delta = curr - prev;
        const symbol = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
        const format = isPercent ? ((delta * 100).toFixed(1) + "%") : delta.toFixed(2);
        return `${symbol} ${format}`;
      };

      if (args.includes("--json")) {
        const diff = {
          latest_date: files[0],
          previous_date: files[1],
          pr_count_delta: metrics.pr_count - previous.pr_count,
          merged_count_delta: metrics.merged_count - previous.merged_count,
          mean_time_to_merge_delta: (metrics.mean_time_to_merge_hours || 0) - (previous.mean_time_to_merge_hours || 0),
          cross_review_rate_delta: (metrics.cross_review_rate || 0) - (previous.cross_review_rate || 0),
          rework_cycle_avg_delta: (metrics.rework_cycle_avg || 0) - (previous.rework_cycle_avg || 0),
        };
        console.log(JSON.stringify(diff, null, 2));
        return;
      }

      console.log("");
      console.log("solo-cto-agent benchmark --diff");
      console.log("─".repeat(50));
      console.log(`  Comparing: ${files[1]} → ${files[0]}`);
      console.log("");
      console.log("Changes:");
      console.log(`  PR Count:           ${deltaFormat(metrics.pr_count, previous.pr_count, 'PRs')}`);
      console.log(`  Merged Count:       ${deltaFormat(metrics.merged_count, previous.merged_count, 'merged')}`);
      console.log(`  Time to Merge:      ${deltaFormat(metrics.mean_time_to_merge_hours, previous.mean_time_to_merge_hours, 'h')} h`);
      console.log(`  Cross-Review Rate:  ${deltaFormat(metrics.cross_review_rate, previous.cross_review_rate, 'rate', true)}`);
      console.log(`  Avg Rework Cycles:  ${deltaFormat(metrics.rework_cycle_avg, previous.rework_cycle_avg, 'cycles')}`);
      console.log("");
      return;
    }

    // Feature 2: Handle --trend mode
    if (args.includes("--trend")) {
      const historyDir = path.join(ROOT, "benchmarks", "history");
      if (!fs.existsSync(historyDir)) {
        console.error("❌ No history directory found. Run benchmark collection first.");
        process.exit(1);
      }
      const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 7);
      if (files.length === 0) {
        console.error("❌ No snapshots found. Collect metrics first.");
        process.exit(1);
      }

      const snapshots = files.map(f => JSON.parse(fs.readFileSync(path.join(historyDir, f), "utf8")));

      const sparkline = (values) => {
        if (!values.length) return "n/a";
        const min = Math.min(...values.filter(v => v != null));
        const max = Math.max(...values.filter(v => v != null));
        const range = max - min || 1;
        const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
        return values.map(v => {
          if (v == null) return "?";
          return chars[Math.floor(((v - min) / range) * (chars.length - 1))];
        }).join("");
      };

      if (args.includes("--json")) {
        const trends = {
          snapshot_count: snapshots.length,
          dates: files.reverse(),
          pr_count_trend: snapshots.reverse().map(s => s.pr_count),
          merged_count_trend: snapshots.map(s => s.merged_count),
          time_to_merge_trend: snapshots.map(s => s.mean_time_to_merge_hours),
          cross_review_trend: snapshots.map(s => s.cross_review_rate),
          rework_avg_trend: snapshots.map(s => s.rework_cycle_avg),
        };
        console.log(JSON.stringify(trends, null, 2));
        return;
      }

      snapshots.reverse(); // oldest first for display

      console.log("");
      console.log("solo-cto-agent benchmark --trend (last 7 days)");
      console.log("─".repeat(50));
      console.log(`  PR Count:          ${sparkline(snapshots.map(s => s.pr_count))}`);
      console.log(`  Merged Count:      ${sparkline(snapshots.map(s => s.merged_count))}`);
      console.log(`  Time to Merge (h): ${sparkline(snapshots.map(s => s.mean_time_to_merge_hours))}`);
      console.log(`  Cross-Review %:    ${sparkline(snapshots.map(s => (s.cross_review_rate || 0) * 100))}`);
      console.log(`  Rework Cycles:     ${sparkline(snapshots.map(s => s.rework_cycle_avg))}`);
      console.log("");
      return;
    }

    if (args.includes("--json")) {
      // Output raw JSON
      console.log(JSON.stringify(metrics, null, 2));
      return;
    }

    // Default: terminal display
    console.log("");
    console.log("solo-cto-agent benchmark — metrics for last 30 days");
    console.log("─".repeat(50));
    console.log(`  Repo:              ${metrics.repo}`);
    console.log(`  Window:            ${metrics.window_days} days`);
    console.log(`  Collected:         ${new Date(metrics.collected_at).toLocaleString()}`);
    console.log("");
    console.log("PR Metrics:");
    console.log(`  Total PRs:         ${metrics.pr_count}`);
    console.log(`  Merged:            ${metrics.merged_count} (${((metrics.merged_count / metrics.pr_count) * 100).toFixed(1)}%)`);
    console.log(`  Mean Time to Merge: ${metrics.mean_time_to_merge_hours.toFixed(2)}h`);
    console.log(`  Cross-Review Rate: ${(metrics.cross_review_rate * 100).toFixed(1)}%`);
    console.log("");
    console.log("Review Decisions:");
    console.log(`  Total:             ${metrics.decision_count}`);
    console.log(`  Approve Rate:      ${(metrics.decision_approve_rate * 100).toFixed(1)}%`);
    console.log(`  Revise Rate:       ${(metrics.decision_revise_rate * 100).toFixed(1)}%`);
    console.log(`  Hold Rate:         ${(metrics.decision_hold_rate * 100).toFixed(1)}%`);
    console.log(`  Mean Latency:      ${metrics.decision_mean_latency_hours.toFixed(2)}h`);
    console.log("");
    console.log("Rework Metrics:");
    console.log(`  Total Cycles:      ${metrics.rework_cycle_total}`);
    console.log(`  Average:           ${metrics.rework_cycle_avg.toFixed(2)}`);
    console.log(`  Rework Rate:       ${(metrics.prs_with_rework_rate * 100).toFixed(1)}%`);
    console.log("");
    console.log("Managed Repos:");
    console.log(`  Count:             ${metrics.managed_repo_count}`);
    console.log(`  Cross-Repo PRs:    ${metrics.cross_repo_pr_count}`);
    console.log(`  Cross-Repo Merged: ${metrics.cross_repo_merged_count}`);
    console.log(`  Repos:             ${metrics.managed_repos.join(", ")}`);

    // Feature 4: Per-repo breakdown if managed_repos data exists
    if (metrics.managed_repos && Array.isArray(metrics.managed_repos) && metrics.managed_repos.length > 0) {
      console.log("");
      console.log("Per-Repo Status:");
      const mergeRate = (merged, total) => total === 0 ? "n/a" : ((merged / total) * 100).toFixed(1) + "%";

      // Note: Per-repo metrics would be populated by collect-metrics.js in a full implementation
      // For now, we show the placeholder structure
      if (metrics.managed_repo_metrics && Array.isArray(metrics.managed_repo_metrics)) {
        for (const rm of metrics.managed_repo_metrics) {
          const rate = mergeRate(rm.merged_count || 0, rm.pr_count || 0);
          const icon = rate === "n/a" || parseFloat(rate) < 50 ? "⚠️" : "✅";
          console.log(`  ${icon} ${rm.name}: ${rm.pr_count || 0} PRs, ${rate} merged`);
        }
      }
    }

    console.log("");
    console.log(`💡 Tip: Use 'solo-cto-agent benchmark --html' to open the dashboard`);
  } catch (e) {
    console.error(`❌ Error reading metrics: ${e.message}`);
    process.exit(1);
  }
}

function statusCommand() {
  const targetDir = localSkillDir();
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

  const audit = auditManagedRepos(localManagedReposPath(), ROOT);
  if (audit.repos.length === 0) {
    console.log("  Template audit: no managed repos yet");
  } else if (audit.totals.drift || audit.totals.missing || audit.totals.custom) {
    console.log(`  Template audit: WARN drift ${audit.totals.drift} / custom ${audit.totals.custom} / missing ${audit.totals.missing}`);
  } else {
    console.log(`  Template audit: OK ${audit.totals.ok} tracked files`);
  }
  console.log("");
}

function templateAuditCommand(opts = {}) {
  const apply = opts.apply === true;
  const dryRun = opts.dryRun === true;
  const exclude = opts.exclude || [];

  const audit = auditManagedRepos(localManagedReposPath(), ROOT);

  console.log("");
  console.log("solo-cto-agent template-audit" + (apply ? " --apply" : ""));
  console.log("-".repeat(40));
  const summary = printTemplateAudit(audit);
  console.log("");

  if (summary.repoCount === 0) {
    console.log("No managed repos registered yet.");
    console.log("Run setup-pipeline or setup-repo first.");
    console.log("");
    return;
  }

  console.log("Summary");
  console.log(`  Repos:            ${summary.repoCount}`);
  console.log(`  Drifted files:    ${summary.totals.drift}`);
  console.log(`  Customized files: ${summary.totals.custom}`);
  console.log(`  Missing files:    ${summary.totals.missing}`);
  console.log(`  Optional missing: ${summary.totals.optionalMissing}`);
  console.log(`  OK files:         ${summary.totals.ok}`);
  console.log("");

  if (apply) {
    console.log("Applying fixes...");
    const result = applyFixes(audit, ROOT, { dryRun, exclude });

    console.log("");
    console.log("Fix Results");
    console.log(`  Fixed:   ${result.fixed}`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Errors:  ${result.errors}`);

    if (dryRun) {
      console.log("");
      console.log("DRY RUN: No changes were written. Use --apply without --dry-run to apply fixes.");
    }

    if (result.details.errors.length > 0) {
      console.log("");
      console.log("Errors");
      for (const err of result.details.errors) {
        console.log(`  ${err.repoPath}/${err.targetPath}: ${err.error}`);
      }
    }
  } else {
    console.log("Default policy");
    console.log("  Audit:   enabled");
    console.log("  Mode:    report-only");
    console.log("  When:    daily");
    console.log("");
    console.log("To apply fixes:");
    console.log("  solo-cto-agent template-audit --apply --dry-run");
    console.log("  solo-cto-agent template-audit --apply");
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

function doctorCommand(opts = {}) {
  const isQuick = opts.quick === true;
  const targetDir = localSkillDir();
  const skillPath = path.join(targetDir, "SKILL.md");
  const catalogPath = path.join(targetDir, "failure-catalog.json");
  const syncStatusPath = path.join(targetDir, "sync-status.json");
  const coworkEnginePath = path.join(ROOT, "bin", "cowork-engine.js");

  const issues = [];
  const isWindows = process.platform === "win32";
  const anthropicSet = isWindows
    ? '$env:ANTHROPIC_API_KEY="sk-ant-..."'
    : 'export ANTHROPIC_API_KEY="sk-ant-..."';
  const openAISet = isWindows
    ? '$env:OPENAI_API_KEY="sk-..."'
    : 'export OPENAI_API_KEY="sk-..."';
  const patSet = isWindows
    ? '$env:ORCHESTRATOR_PAT="github_pat_..."'
    : 'export ORCHESTRATOR_PAT="github_pat_..."';

  console.log("");
  console.log(`solo-cto-agent doctor${isQuick ? " --quick" : ""} - health check`);
  console.log("-".repeat(40));
  console.log("");

  console.log("Skills");
  const skillOk = fs.existsSync(skillPath);
  let isCodexMain = false;
  if (skillOk) {
    try {
      const content = fs.readFileSync(skillPath, "utf8");
      const wizardConfigured = content.includes("| Item | Value |") || !content.includes("{{YOUR_");
      const modeMatch = content.match(/mode:\s*([^\n]+)/);
      const mode = modeMatch ? modeMatch[1].trim() : null;
      isCodexMain = mode === "codex-main";

      if (wizardConfigured) {
        console.log("   OK SKILL.md installed & configured");
        console.log(`   OK Mode detected: ${mode || "missing"}`);
        if (!mode) issues.push({ level: "warn", msg: "No mode: field in SKILL.md (cowork-main or codex-main)" });
      } else {
        console.log("   WARN SKILL.md exists but is not configured");
        issues.push({ level: "warn", msg: "SKILL.md not configured (run: init --wizard)" });
      }
    } catch (err) {
      console.log(`   ERROR Error reading SKILL.md: ${err.message}`);
      issues.push({ level: "error", msg: `Error reading SKILL.md: ${err.message}` });
    }
  } else {
    console.log("   ERROR SKILL.md not found");
    issues.push({ level: "error", msg: "SKILL.md not found (run: init)" });
  }

  console.log("");
  console.log("Engine");
  if (fs.existsSync(coworkEnginePath)) {
    console.log("   OK cowork-engine.js found");
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
        console.log("   OK Core functions available");
      } else {
        console.log("   WARN Some core functions are missing");
        issues.push({ level: "warn", msg: "Engine missing some core functions" });
      }

      if (sessionSave && sessionRestore && sessionList) {
        console.log("   OK Session functions available");
      } else {
        console.log("   WARN Session functions missing");
        issues.push({ level: "warn", msg: "Engine missing session functions" });
      }

      const isGitRepo = fs.existsSync(path.join(process.cwd(), ".git"));
      if (hasDetectDefaultBranch && isGitRepo) {
        try {
          const base = engine.detectDefaultBranch({ cwd: process.cwd() });
          console.log(`   INFO Default branch: ${base}`);
        } catch (err) {
          console.log(`   WARN Default branch detection failed: ${err.message}`);
          issues.push({ level: "warn", msg: "Default branch detection failed" });
        }
      } else if (!isGitRepo) {
        console.log("   INFO Default branch: N/A (not a git repo)");
      }
    } catch (err) {
      console.log(`   WARN Engine load failed: ${err.message}`);
      issues.push({ level: "warn", msg: `Engine load failed: ${err.message}` });
    }
  } else {
    console.log("   ERROR cowork-engine.js not found");
    issues.push({ level: "error", msg: "cowork-engine.js not found" });
  }

  console.log("");
  console.log("API Keys");
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasAnthropic) {
    console.log("   OK ANTHROPIC_API_KEY is set");
  } else {
    console.log("   ERROR ANTHROPIC_API_KEY not set (required)");
    console.log("      Get your key: https://console.anthropic.com/settings/keys");
    console.log(`      Then run:     ${anthropicSet}`);
    issues.push({ level: "error", msg: "ANTHROPIC_API_KEY not set - reviews will not work" });
  }

  if (hasOpenAI) {
    console.log("   OK OPENAI_API_KEY is set");
  } else if (isCodexMain) {
    console.log("   ERROR OPENAI_API_KEY not set (required for codex-main)");
    console.log("      Get your key: https://platform.openai.com/api-keys");
    console.log(`      Then run:     ${openAISet}`);
    issues.push({ level: "error", msg: "OPENAI_API_KEY required in codex-main mode" });
  } else {
    console.log("   INFO OPENAI_API_KEY not set (optional - enables dual-review)");
    console.log("      Get one at:   https://platform.openai.com/api-keys");
    console.log(`      Then run:     ${openAISet}`);
  }

  const detectedMode = hasAnthropic && hasOpenAI ? "dual" : hasAnthropic ? "solo" : "none";
  console.log(`   INFO Detected key state: ${detectedMode}`);
  if (detectedMode === "none") {
    issues.push({ level: "error", msg: "No API keys found - set ANTHROPIC_API_KEY to use reviews" });
  }

  if (isCodexMain) {
    console.log("");
    console.log("Codex-main pipeline");
    const hasOrchPAT = !!process.env.ORCHESTRATOR_PAT;
    if (hasOrchPAT) {
      console.log("   OK ORCHESTRATOR_PAT is set");
    } else {
      console.log("   WARN ORCHESTRATOR_PAT not set (needed for cross-repo dispatch)");
      console.log("      Get one at:   https://github.com/settings/personal-access-tokens/new");
      console.log("      Scope:        repo + workflow");
      console.log(`      Then run:     ${patSet}`);
      issues.push({ level: "warn", msg: "ORCHESTRATOR_PAT not set - cross-repo dispatch will not work" });
    }

    const orchDir = path.join(process.cwd(), "..", "dual-agent-orchestrator");
    const orchDirCwd = path.join(process.cwd(), "dual-agent-orchestrator");
    const orchExists = fs.existsSync(orchDir) || fs.existsSync(orchDirCwd);
    if (orchExists) {
      console.log("   OK dual-agent-orchestrator directory found nearby");
    } else {
      console.log("   WARN dual-agent-orchestrator not found nearby");
      console.log("      Run:   solo-cto-agent setup-pipeline --org <your-org> --repos <repo1,repo2>");
      console.log("      Guide: docs/codex-main-install.md");
      issues.push({ level: "warn", msg: "Orchestrator repo not found - run setup-pipeline" });
    }
  }

  if (!isQuick) {
    console.log("");
    console.log("Lint");
    const skillsDir = path.join(ROOT, "skills");
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      const skillDirs = entries.filter((e) => e.isDirectory()).length;
      let lintIssues = 0;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const localSkillPath = path.join(skillsDir, entry.name, "SKILL.md");
        if (!fs.existsSync(localSkillPath)) {
          lintIssues++;
          continue;
        }
        const content = fs.readFileSync(localSkillPath, "utf8");
        const lines = content.split("\n");
        if (lines[0].trim() !== "---") lintIssues++;
        if (lines.length > 250) lintIssues++;
      }
      if (lintIssues === 0) {
        console.log(`   OK ${skillDirs} skills clean`);
      } else {
        console.log(`   WARN ${lintIssues} lint issue(s) found`);
        issues.push({ level: "warn", msg: `${lintIssues} lint issues in skills/ directory` });
      }
    } else {
      console.log("   INFO No local skills/ directory found (package user mode)");
    }
  }

  console.log("");
  console.log("Sync");
  if (fs.existsSync(syncStatusPath)) {
    try {
      const syncStatus = JSON.parse(fs.readFileSync(syncStatusPath, "utf8"));
      const syncAge = Math.round((Date.now() - new Date(syncStatus.lastSync).getTime()) / 60000);
      const syncLabel = syncAge < 60 ? `${syncAge}m ago` : syncAge < 1440 ? `${Math.round(syncAge / 60)}h ago` : `${Math.round(syncAge / 1440)}d ago`;
      console.log(`   OK Last sync: ${syncLabel}`);
      if (syncStatus.summary && syncStatus.summary.workflowRuns === "ok") {
        console.log("   OK CI data available");
      } else {
        console.log("   WARN CI data not available");
        issues.push({ level: "warn", msg: "Sync CI data not available (run: sync --org <org>)" });
      }
    } catch (err) {
      console.log(`   WARN Sync status corrupted: ${err.message}`);
      issues.push({ level: "warn", msg: "Sync status corrupted" });
    }
  } else {
    console.log("   INFO No sync data yet (run: sync --org <github-org>)");
  }

  console.log("");
  console.log("Template Audit");
  const managedManifestPath = localManagedReposPath();
  const managedManifest = loadManifest(managedManifestPath);
  if (managedManifest.templateAudit && managedManifest.templateAudit.enabled === false) {
    console.log("   INFO Template audit disabled");
  } else {
    const audit = auditManagedRepos(managedManifestPath, ROOT);
    const auditSummary = printTemplateAudit(audit, { quietOk: isQuick });
    if (isCodexMain) {
      console.log(`   INFO Default policy: ${managedManifest.templateAudit.mode} / ${managedManifest.templateAudit.schedule}`);
    }
    if (auditSummary.repoCount > 0 && (auditSummary.totals.drift > 0 || auditSummary.totals.missing > 0 || auditSummary.totals.custom > 0)) {
      issues.push({
        level: "warn",
        msg: `Template drift detected - drift ${auditSummary.totals.drift}, custom ${auditSummary.totals.custom}, missing ${auditSummary.totals.missing}`
      });
    }
  }

  console.log("");
  console.log("Error Catalog");
  if (fs.existsSync(catalogPath)) {
    try {
      const count = readCatalogCount(catalogPath);
      console.log(`   OK ${count} failure patterns loaded`);
    } catch (err) {
      console.log(`   WARN Catalog corrupted: ${err.message}`);
      issues.push({ level: "warn", msg: "Error catalog corrupted" });
    }
  } else {
    console.log("   WARN failure-catalog.json not found");
    issues.push({ level: "warn", msg: "failure-catalog.json not found" });
  }

  console.log("");
  console.log("Notifications");
  const hasTgToken = !!process.env.TELEGRAM_BOT_TOKEN;
  const hasTgChat = !!process.env.TELEGRAM_CHAT_ID;
  const hasSlack = !!process.env.SLACK_WEBHOOK_URL;
  const hasDiscord = !!process.env.DISCORD_WEBHOOK_URL;

  if (hasTgToken && hasTgChat) {
    console.log("   OK Telegram configured");
  } else if (hasTgToken || hasTgChat) {
    console.log("   WARN Telegram partially configured (need both TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)");
    console.log("      Run: SOLO_CTO_EXPERIMENTAL=1 solo-cto-agent telegram wizard");
    issues.push({ level: "warn", msg: "Telegram partially configured" });
  } else {
    console.log("   INFO Telegram not configured (optional - enables deploy/review alerts)");
    console.log("      Setup: SOLO_CTO_EXPERIMENTAL=1 solo-cto-agent telegram wizard");
  }

  if (hasSlack) console.log("   OK Slack configured");
  if (hasDiscord) console.log("   OK Discord configured");
  if (!hasTgToken && !hasSlack && !hasDiscord) {
    console.log("   INFO No notification channels - alerts stay local");
  }

  console.log("");
  console.log("-".repeat(40));

  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");

  if (errors.length === 0 && warns.length === 0) {
    console.log("OK All checks passed");
    console.log("");
    if (isCodexMain) {
      console.log("Next:");
      console.log("   1. Run: solo-cto-agent setup-pipeline --org <your-org> --repos <repo1,repo2>");
      console.log("   2. Add GitHub Actions secrets in each product repo");
      console.log("   3. Run: solo-cto-agent template-audit");
      console.log("   4. Open a PR and verify auto-review starts");
    } else {
      console.log("Try your first review:");
      console.log("   cd <your-git-repo>");
      console.log("   git add -A && solo-cto-agent review");
    }
    console.log("");
    if (opts.exitOnError !== false) process.exit(0);
    return;
  }

  if (errors.length > 0) {
    console.log("");
    console.log("Fix these before using solo-cto-agent:");
    for (const err of errors) console.log(`   - ${err.msg}`);
  }

  if (warns.length > 0) {
    console.log("");
    console.log("Warnings (non-blocking):");
    for (const warn of warns) console.log(`   - ${warn.msg}`);
  }

  console.log("");
  console.log("Quick links:");
  console.log("   Anthropic keys: https://console.anthropic.com/settings/keys");
  console.log("   OpenAI keys:    https://platform.openai.com/api-keys");
  if (isCodexMain) {
    console.log("   GitHub CLI:     https://cli.github.com/");
    console.log("   GitHub PAT:     https://github.com/settings/personal-access-tokens/new");
    console.log("   Install guide:  docs/codex-main-install.md");
    console.log("   Audit command:  solo-cto-agent template-audit");
  } else {
    console.log("   Install guide:  docs/cowork-main-install.md");
  }

  console.log("");
  console.log(`After fixing, run 'solo-cto-agent doctor${isQuick ? " --quick" : ""}' again to verify.`);
  console.log("");
  if (opts.exitOnError !== false) process.exit(errors.length > 0 ? 1 : 0);
}

// ??? upgrade: Builder → CTO ────────────────────────────────

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

  // Step 5: Refresh managed-repos manifest
  console.log("[5/5] Refreshing template audit manifest...");
  const orchManifestEntry = makeManagedRepoEntry({
    packageRoot: ROOT,
    tiersData,
    type: "orchestrator",
    tier: "cto",
    mode: "codex-main",
    owner: org,
    repoName: orchestratorRepo,
    repoPath: orchDir,
    orchestratorName: orchestratorRepo,
    replacements,
  });
  upsertOrchestratorManagedRepo(orchDir, orchManifestEntry);
  registerManagedRepoForLocal(orchManifestEntry);

  for (const repo of productRepoList) {
    const repoDir = path.resolve(repo);
    if (!fs.existsSync(repoDir)) continue;
    const productEntry = makeManagedRepoEntry({
      packageRoot: ROOT,
      tiersData,
      type: "product-repo",
      tier: "cto",
      mode: "codex-main",
      owner: org,
      repoName: path.basename(repo),
      repoPath: repoDir,
      orchestratorName: orchestratorRepo,
      replacements,
    });
    upsertOrchestratorManagedRepo(orchDir, productEntry);
    registerManagedRepoForLocal(productEntry);
  }
  console.log("   ✅ Manifest refreshed for orchestrator" + (productRepoList.length ? ` + ${productRepoList.length} product repos` : ""));

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

  if (cmd === "--version" || cmd === "-V") {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    console.log(pkg.version);
    return;
  }

  if (cmd === "--completions") {
    const shell = args[1] || "bash";
    const completionsDir = path.join(ROOT, "completions");
    const file = shell === "zsh"
      ? path.join(completionsDir, "solo-cto-agent.zsh")
      : path.join(completionsDir, "solo-cto-agent.bash");
    if (fs.existsSync(file)) {
      console.log(fs.readFileSync(file, "utf8"));
    } else {
      console.error(`Completion file not found: ${file}`);
      process.exit(1);
    }
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

  if (cmd === "repos") {
    await reposCommand(args);
    return;
  }

  if (cmd === "do") {
    const doModule = require("./do");
    await doModule.main();
    return;
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
    let repos = reposIndex >= 0 ? args[reposIndex + 1] : null;
    // Fall back to the selection persisted by `init --wizard` / `repos list`.
    if (!repos && repoDiscovery) {
      const saved = repoDiscovery.loadSelection();
      if (saved && Array.isArray(saved.selected) && saved.selected.length) {
        repos = saved.selected.join(",");
        console.log(`ℹ️  Using saved repo selection (${saved.selected.length} repos from ${repoDiscovery.selectionPath()}).`);
      }
    }
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

  if (cmd === "auto-setup") {
    // Spawn auto-setup.js as child process and forward stdio
    const { spawn } = require("child_process");
    const autoSetupPath = path.join(__dirname, "auto-setup.js");
    const child = spawn("node", [autoSetupPath], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      process.exit(code || 0);
    });
    child.on("error", (err) => {
      console.error("❌ Failed to run auto-setup:", err.message);
      process.exit(1);
    });
    return;
  }

  // setup --central: centralize cross-repo workflows
  if (cmd === "setup" && args.includes("--central")) {
    const { centralSetup } = require("./central-setup.js");
    const orgIndex = args.indexOf("--org");
    const org = orgIndex >= 0 ? args[orgIndex + 1] : (process.env.GITHUB_ORG || "");
    const orchIndex = args.indexOf("--orchestrator");
    const orch = orchIndex >= 0 ? args[orchIndex + 1] : "dual-agent-review-orchestrator";
    const reposIndex = args.indexOf("--repos");
    const repos = reposIndex >= 0 ? args[reposIndex + 1].split(",").map(r => r.trim()) : [];
    const dryRun = args.includes("--dry-run");
    centralSetup({ org, orchestrator: orch, repos, token: process.env.GITHUB_TOKEN || "", dryRun })
      .then(() => process.exit(0))
      .catch((err) => { console.error("❌", err.message); process.exit(1); });
    return;
  }

  if (cmd === "upgrade") {
    const orgIndex = args.indexOf("--org");
    const org = orgIndex >= 0 ? args[orgIndex + 1] : null;
    const reposIndex = args.indexOf("--repos");
    let repos = reposIndex >= 0 ? args[reposIndex + 1] : null;
    if (!repos && repoDiscovery) {
      const saved = repoDiscovery.loadSelection();
      if (saved && Array.isArray(saved.selected) && saved.selected.length) {
        repos = saved.selected.join(",");
        console.log(`ℹ️  Using saved repo selection (${saved.selected.length} repos).`);
      }
    }
    const orchIndex = args.indexOf("--orchestrator-name");
    const orchName = orchIndex >= 0 ? args[orchIndex + 1] : null;
    upgradeCommand(org, repos, orchName);
    return;
  }

  if (cmd === "sync") {
    const orgIndex = args.indexOf("--org");
    const org = orgIndex >= 0 ? args[orgIndex + 1] : null;
    const reposIndex = args.indexOf("--repos");
    let repos = reposIndex >= 0 ? args[reposIndex + 1] : null;
    if (!repos && repoDiscovery) {
      const saved = repoDiscovery.loadSelection();
      if (saved && Array.isArray(saved.selected) && saved.selected.length) {
        repos = saved.selected.join(",");
        console.log(`ℹ️  Using saved repo selection (${saved.selected.length} repos).`);
      }
    }
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
      await localReview({ diffSource, target, dryRun, outputFormat, redact: args.includes("--redact"), force: args.includes("--force") });
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

  if (cmd === "template-audit") {
    const apply = args.includes("--apply");
    const dryRun = args.includes("--dry-run");
    const exclude = (args.indexOf("--exclude") >= 0) ? args[args.indexOf("--exclude") + 1] : null;
    const excludeList = exclude ? exclude.split(",").map(s => s.trim()) : [];
    templateAuditCommand({ apply, dryRun, exclude: excludeList });
    return;
  }

  if (cmd === "lint") {
    lintCommand(args[1]);
    return;
  }

  if (cmd === "doctor") {
    doctorCommand({ quick: args.includes("--quick") });
    return;
  }

  if (cmd === "benchmark") {
    benchmarkCommand(args);
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

  // =========================================================================
  // Claude Code Routines — fire / list schedules (PR-G26)
  // =========================================================================
  if (cmd === "routine") {
    const sub = args[1] || "fire";
    const dryRun = args.includes("--dry-run");
    const forceFlag = args.includes("--force");

    if (sub === "fire") {
      const trigIdx = args.indexOf("--trigger");
      const textIdx = args.indexOf("--text");
      const triggerId = trigIdx >= 0 ? args[trigIdx + 1] : null;
      const text = textIdx >= 0 ? args[textIdx + 1] : null;

      fireRoutine({ triggerId, text, dryRun, force: forceFlag }).then((result) => {
        if (!result && !dryRun) process.exit(1);
      }).catch((e) => {
        console.error(`❌ ${e.message}`);
        process.exit(1);
      });
      return;
    }

    if (sub === "schedules") {
      const schedules = buildRoutineSchedules();
      if (args.includes("--json")) {
        console.log(JSON.stringify(schedules, null, 2));
      } else {
        if (schedules.length === 0) {
          console.log("No routine schedules configured.");
          console.log("Set routines.enabled=true and routines.triggerId in config.");
        } else {
          console.log(`Routine schedules (${schedules.length}):\n`);
          for (const s of schedules) {
            console.log(`  ${s.name || "unnamed"}`);
            console.log(`    cron: ${s.cron || "manual"}`);
            console.log(`    trigger: ${s.triggerId}`);
            if (s.text) console.log(`    context: ${s.text.slice(0, 80)}...`);
            console.log();
          }
        }
      }
      return;
    }

    console.error(`❌ Unknown routine subcommand: ${sub}`);
    console.error(`   Use: solo-cto-agent routine fire|schedules`);
    process.exit(1);
    return;
  }

  // =========================================================================
  // Claude Managed Agents — deep-review (PR-G26)
  // =========================================================================
  if (cmd === "deep-review") {
    const dryRun = args.includes("--dry-run");
    const forceFlag = args.includes("--force");
    const staged = args.includes("--staged") || (!args.includes("--branch") && !args.includes("--file"));
    const branchFlag = args.includes("--branch");
    const fileIdx = args.indexOf("--file");
    const targetIdx = args.indexOf("--target");
    const target = targetIdx >= 0 ? args[targetIdx + 1] : null;

    let diffSource = "staged";
    if (branchFlag) diffSource = "branch";
    else if (fileIdx >= 0) { diffSource = "file"; }

    const cwd = process.cwd();
    const diff = getDiff(diffSource, target || (fileIdx >= 0 ? args[fileIdx + 1] : null), { cwd });
    if (!diff || diff.trim().length === 0) {
      console.log("No changes found.");
      return;
    }

    managedAgentReview({ diff, dryRun, force: forceFlag, redact: args.includes("--redact") }).then((result) => {
      if (result) {
        if (args.includes("--json")) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`\n[VERDICT] ${result.verdict}`);
          if (result.issues && result.issues.length > 0) {
            console.log(`\n[ISSUES] (${result.issues.length})`);
            for (const issue of result.issues) {
              const icon = issue.severity === "BLOCKER" ? "⛔" : issue.severity === "SUGGESTION" ? "⚠️" : "💡";
              console.log(`${icon} [${issue.location}] ${issue.issue}`);
              if (issue.suggestion) console.log(`  → ${issue.suggestion}`);
            }
          }
          if (result.summary) console.log(`\n[SUMMARY] ${result.summary}`);
          if (result.cost) {
            console.log(`\n[COST] Token: $${result.cost.token} | Runtime: $${result.cost.runtime} | Total: $${result.cost.total}`);
          }
        }
      } else if (!dryRun) {
        process.exit(1);
      }
    }).catch((e) => {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    });
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
    // PR-G10 — the top-level --lang flag is already parsed into
    // i18n.setLocale() at cli.js main() startup. Passing it through
    // opts lets the wizard runtime honor a last-moment override too.
    const langIdx = args.indexOf("--lang");
    if (langIdx >= 0) opts.lang = args[langIdx + 1];

    const dispatch = {
      wizard:   () => telegramWizard.runWizard(opts),
      test:     () => telegramWizard.telegramTest(opts),
      verify:   () => telegramWizard.telegramVerify(opts),
      status:   () => Promise.resolve(telegramWizard.telegramStatus(opts)),
      disable:  () => telegramWizard.telegramDisable(opts),
      config:   () => telegramWizard.telegramConfig(opts),
      bot:      () => {
        if (!telegramBot) {
          return Promise.reject(new Error("telegram-bot module not available in this install."));
        }
        return telegramBot.startBot(opts);
      },
    };

    if (!dispatch[sub]) {
      console.error(`❌ Unknown telegram subcommand: ${sub}`);
      console.error(`   Use: solo-cto-agent telegram wizard|test|verify|status|disable|config|bot`);
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

  // ─── ci-setup: Deploy 3-pass review workflow to a GitHub repo ───
  if (cmd === "ci-setup") {
    const repoIdx = args.indexOf("--repo");
    const branchIdx = args.indexOf("--branch");
    const repo = repoIdx >= 0 ? args[repoIdx + 1] : null;
    const branch = branchIdx >= 0 ? args[branchIdx + 1] : null;
    const dryRun = args.includes("--dry-run");

    if (!repo || !repo.includes("/")) {
      console.error("❌ --repo owner/name is required.");
      console.error("   Usage: solo-cto-agent ci-setup --repo owner/repo [--branch main]");
      process.exit(1);
    }

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) {
      console.error("❌ GITHUB_TOKEN or GH_TOKEN environment variable is required.");
      process.exit(1);
    }

    const templatePath = path.join(ROOT, "templates", "workflows", "solo-cto-review.yml");
    if (!fs.existsSync(templatePath)) {
      console.error("❌ Workflow template not found:", templatePath);
      process.exit(1);
    }

    const templateContent = fs.readFileSync(templatePath, "utf8");
    const filePath = ".github/workflows/solo-cto-review.yml";
    const [owner, repoName] = repo.split("/");

    /** GitHub API helper */
    function ghApi(method, apiPath, body) {
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

    (async () => {
      console.log(`\n🚀 Solo CTO CI Setup — ${repo}`);
      console.log("─".repeat(50));

      // 1. Detect default branch if not specified
      let defaultBranch = branch;
      if (!defaultBranch) {
        console.log("🔍 Detecting default branch...");
        const repoInfo = await ghApi("GET", `/repos/${owner}/${repoName}`);
        defaultBranch = repoInfo.default_branch || "main";
      }
      console.log(`   Branch: ${defaultBranch}`);

      if (dryRun) {
        console.log("\n📋 [DRY RUN] Would deploy:");
        console.log(`   File: ${filePath}`);
        console.log(`   Repo: ${repo} (${defaultBranch})`);
        console.log(`   Template: ${templatePath}`);
        console.log("\n✅ Dry run complete — no changes made.");
        return;
      }

      // 2. Check if workflow already exists
      let existingSha = null;
      try {
        const existing = await ghApi("GET", `/repos/${owner}/${repoName}/contents/${filePath}?ref=${defaultBranch}`);
        existingSha = existing.sha;
        console.log("📝 Existing workflow found — will update.");
      } catch (_) {
        console.log("📝 No existing workflow — will create.");
      }

      // 3. Push workflow file via Contents API
      const content = Buffer.from(templateContent).toString("base64");
      const commitMsg = existingSha
        ? "chore: update solo-cto 3-pass review workflow"
        : "chore: add solo-cto 3-pass review workflow";

      const putBody = {
        message: commitMsg,
        content,
        branch: defaultBranch,
        committer: {
          name: "solo-cto-agent",
          email: "solo-cto-agent@users.noreply.github.com",
        },
      };
      if (existingSha) putBody.sha = existingSha;

      await ghApi("PUT", `/repos/${owner}/${repoName}/contents/${filePath}`, putBody);
      console.log(`✅ Workflow deployed: ${filePath}`);

      // 4. Check if ANTHROPIC_API_KEY secret exists
      console.log("\n🔑 Checking secrets...");
      try {
        await ghApi("GET", `/repos/${owner}/${repoName}/actions/secrets/ANTHROPIC_API_KEY`);
        console.log("   ✅ ANTHROPIC_API_KEY secret exists.");
      } catch (_) {
        console.log("   ⚠️  ANTHROPIC_API_KEY secret NOT found.");
        console.log("   → Set it: gh secret set ANTHROPIC_API_KEY --repo " + repo);
        console.log("   → Or: Settings → Secrets and variables → Actions → New repository secret");
      }

      console.log("\n─".repeat(50));
      console.log("🎉 Setup complete!");
      console.log(`   Workflow triggers on: pull_request [opened, synchronize]`);
      console.log(`   Create a PR on ${repo} to test the 3-pass review.`);
    })().catch((err) => {
      console.error("❌ ci-setup failed:", err.message);
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

    if (sub === "search") {
      const query = args[2];
      if (!query) {
        console.error("❌ Usage: solo-cto-agent plugin search <query>");
        console.error("   Example: solo-cto-agent plugin search typescript");
        process.exit(1);
      }
      (async () => {
        const result = await pluginManager.searchRegistry(query);
        if (!result.ok) {
          console.error(`❌ ${result.error}`);
          process.exit(1);
        }
        if (args.includes("--json")) {
          console.log(JSON.stringify(result.results, null, 2));
        } else {
          console.log(pluginManager.formatSearchResults(result.results, query));
        }
      })().catch((e) => {
        console.error(`❌ ${e.message}`);
        process.exit(1);
      });
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

    if (sub === "install") {
      const nameOrPath = args[2];
      if (!nameOrPath) {
        console.error("❌ Usage: solo-cto-agent plugin install <name|path>");
        console.error("   Example: solo-cto-agent plugin install my-plugin");
        console.error("   Example: solo-cto-agent plugin install ./plugins/my-plugin");
        process.exit(1);
      }

      // Detect if it's a path (contains / or \ or .) or a plugin name
      const isPath = nameOrPath.includes("/") || nameOrPath.includes("\\") || nameOrPath.startsWith(".");

      (async () => {
        let res;
        if (isPath) {
          res = pluginManager.installFromPath(nameOrPath);
        } else {
          res = await pluginManager.installFromRegistry(nameOrPath);
        }

        if (!res.ok) {
          console.error(`❌ ${res.error}`);
          process.exit(1);
        }

        console.log(`✓ ${res.message}`);
        console.log(`  agents: ${res.plugin.agents.join(", ")}`);
        if (res.plugin.capabilities.length) {
          console.log(`  capabilities: ${res.plugin.capabilities.join(", ")}`);
        }
      })().catch((e) => {
        console.error(`❌ ${e.message}`);
        process.exit(1);
      });
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
    console.error(`   Use: solo-cto-agent plugin list|show|search|install|add|remove`);
    process.exit(1);
  }

  // ─── self-evolve (error tracking, quality checks, feedback, reports) ─
  if (cmd === "self-evolve" || cmd === "evolve") {
    if (!selfEvolve) {
      console.error("❌ self-evolve module not installed. Reinstall solo-cto-agent.");
      process.exit(1);
    }
    const sub = args[1] || "status";
    const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
    const projectDir = get("--project-dir") || process.cwd();
    const skillsDir = get("--skills-dir") || path.join(projectDir, ".solo-cto-agent", "skills");

    if (sub === "init") {
      selfEvolve.initializeDataFiles(projectDir);
      console.log("✅ Self-evolve data files initialized.");
      return;
    }

    if (sub === "status") {
      const status = selfEvolve.getStatus(projectDir);
      const icon = status.health === "ok" ? "✅" : status.health === "degraded" ? "⚠️" : "❌";
      console.log(`\n${icon} Self-Evolve Status: ${status.health}\n`);
      console.log("Files:");
      for (const [file, exists] of Object.entries(status.files)) {
        console.log(`  ${exists ? "✅" : "❌"} ${file}`);
      }
      console.log("\nModules:");
      for (const [mod, loaded] of Object.entries(status.modules)) {
        console.log(`  ${loaded ? "✅" : "❌"} ${mod}`);
      }
      if (status.issues.length) {
        console.log(`\nIssues (${status.issues.length}):`);
        for (const issue of status.issues) console.log(`  - ${issue}`);
      }
      return;
    }

    if (sub === "error") {
      const skill = get("--skill");
      const symptom = get("--symptom");
      if (!skill || !symptom) {
        console.error("❌ Usage: solo-cto-agent self-evolve error --skill <name> --symptom <text>");
        console.error("         [--category build|design|api|deploy|type|runtime|other]");
        console.error("         [--cause <text>] [--fix <text>] [--severity critical|high|medium|low]");
        process.exit(1);
      }
      const result = selfEvolve.collectError(projectDir, {
        skill,
        symptom,
        category: get("--category") || "other",
        cause: get("--cause") || "Unknown",
        fix: get("--fix") || "Pending",
        severity: get("--severity") || "medium",
      });
      if (result.isNew) {
        console.log(`✅ E-${result.id}: New error pattern recorded (${skill})`);
      } else {
        console.log(`🔄 E-${result.id}: Repeat count → ${result.repeatCount}`);
      }
      if (result.triggerImprovement) {
        console.log(`🔴 Skill improvement trigger fired! (${skill}, ${result.repeatCount}x)`);
      }
      return;
    }

    if (sub === "quality") {
      const type = get("--type") || "code";
      const skill = get("--skill") || "unknown";
      const checksRaw = get("--checks") || "";
      const checks = {};
      for (const pair of checksRaw.split(",").filter(Boolean)) {
        const [k, v] = pair.split(":");
        if (k && v) checks[k.trim()] = v.trim();
      }
      if (Object.keys(checks).length === 0) {
        console.error("❌ Usage: solo-cto-agent self-evolve quality --type code --skill <name> --checks 'build:pass,ts:warn'");
        process.exit(1);
      }
      const result = selfEvolve.analyzeQuality(projectDir, {
        type, skill, checks,
        notes: get("--notes") || "",
        feedbackScore: get("--feedback") ? parseInt(get("--feedback"), 10) : null,
      });
      const icon = result.overallScore === "pass" ? "✅" : result.overallScore === "warn" ? "⚠️" : "❌";
      console.log(`${icon} Quality: ${result.overallScore} (${type}/${skill})`);
      console.log(`   Pass: ${result.passCount}  Warn: ${result.warnCount}  Fail: ${result.failCount}`);
      if (result.triggerImprovement) {
        console.log(`🔴 Skill improvement trigger fired! (${skill}, ${type})`);
      }
      return;
    }

    if (sub === "feedback" || sub === "score") {
      const skill = get("--skill");
      const scoreStr = get("--score");
      if (!skill || !scoreStr) {
        console.error("❌ Usage: solo-cto-agent self-evolve feedback --skill <name> --score <1-5>");
        console.error("         [--task <text>] [--reason <text>]");
        process.exit(1);
      }
      const score = parseInt(scoreStr, 10);
      if (score < 1 || score > 5) {
        console.error("❌ Score must be between 1 and 5.");
        process.exit(1);
      }
      const result = selfEvolve.recordSatisfaction(projectDir, {
        skill,
        score,
        task: get("--task") || "",
        reason: get("--reason") || "",
      });
      console.log(`📝 Feedback recorded: ${skill} → ${score}/5`);
      if (result.triggerL2) {
        console.log(`🔴 L2 auto-patch trigger fired! (${skill}, ${result.lowCount}x low scores)`);
      }
      return;
    }

    if (sub === "improve") {
      if (args.includes("--check") || args.includes("--apply") === false) {
        const triggers = selfEvolve.checkTriggers(projectDir);
        if (triggers.length === 0) {
          console.log("✅ No improvement triggers pending.");
        } else {
          console.log(`⚠️  ${triggers.length} improvement trigger(s):`);
          for (const t of triggers) {
            console.log(`  - [${t.source}] ${t.skill}: ${t.reason} (count: ${t.count})`);
          }
          if (!args.includes("--apply")) {
            console.log("\nRun with --apply to auto-patch skills.");
          }
        }
      }
      if (args.includes("--apply")) {
        const triggers = selfEvolve.checkTriggers(projectDir);
        if (triggers.length === 0) {
          console.log("✅ Nothing to apply.");
          return;
        }
        for (const t of triggers) {
          try {
            selfEvolve.applyImprovement(skillsDir, t, projectDir);
            console.log(`✅ Applied improvement: ${t.skill} (${t.source})`);
          } catch (err) {
            console.error(`❌ Failed to improve ${t.skill}: ${err.message}`);
          }
        }
      }
      return;
    }

    if (sub === "report") {
      const weeks = parseInt(get("--weeks") || "1", 10);
      const report = selfEvolve.generateWeeklyReport(projectDir, { weeks });
      console.log(report.content);
      console.log(`\n📄 Report saved: ${report.filePath}`);
      return;
    }

    if (sub === "trends") {
      const npmDir = get("--npm-dir") || projectDir;
      const report = selfEvolve.generateTrendsReport(projectDir, { npmDir });
      console.log(report.content);
      console.log(`\n📄 Trends report saved: ${report.filePath}`);
      return;
    }

    if (sub === "scout") {
      if (args.includes("--installed")) {
        const skills = selfEvolve.getInstalledSkills(skillsDir);
        console.log(`📦 Installed skills (${skills.length}):`);
        for (const s of skills) {
          console.log(`  - ${s.name}: ${s.description || "(no description)"}`);
        }
        return;
      }
      console.error("❌ Usage: solo-cto-agent self-evolve scout --installed");
      process.exit(1);
    }

    if (sub === "errors") {
      const n = parseInt(get("--top") || "10", 10);
      const top = selfEvolve.getTopErrors ? selfEvolve.getTopErrors(projectDir, n) : [];
      if (top.length === 0) {
        console.log("✅ No error patterns recorded.");
      } else {
        console.log(`Top ${top.length} error patterns:`);
        for (const e of top) {
          console.log(`  E-${e.id}: ${e.symptom} (${e.repeatCount}x, ${e.skill})`);
        }
      }
      return;
    }

    if (sub === "summary") {
      const trend = selfEvolve.getQualityTrend ? selfEvolve.getQualityTrend(projectDir, 20) : [];
      const fbSummary = selfEvolve.getFeedbackSummary ? selfEvolve.getFeedbackSummary(projectDir) : null;
      console.log("=== Quality Trend (last 20) ===");
      if (trend.length === 0) {
        console.log("  No quality records yet.");
      } else {
        for (const r of trend) {
          const icon = r.overallScore === "pass" ? "✅" : r.overallScore === "warn" ? "⚠️" : "❌";
          console.log(`  ${icon} ${r.date} ${r.type}/${r.skill}: ${r.overallScore}`);
        }
      }
      if (fbSummary) {
        console.log("\n=== Feedback Summary ===");
        console.log(`  Total: ${fbSummary.totalCount}, Average: ${fbSummary.averageScore.toFixed(1)}`);
        if (fbSummary.bySkill && Object.keys(fbSummary.bySkill).length > 0) {
          for (const [sk, data] of Object.entries(fbSummary.bySkill)) {
            console.log(`  ${sk}: avg ${data.average.toFixed(1)} (${data.count} records)`);
          }
        }
      }
      return;
    }

    console.error(`❌ Unknown self-evolve subcommand: ${sub}`);
    console.error("   Use: solo-cto-agent self-evolve init|status|error|quality|feedback|improve|report|trends|scout|errors|summary");
    process.exit(1);
  }

  printHelp();
  process.exit(1);
}

// Global safety net — catch unhandled async errors so the CLI never
// exits silently on a rejected promise.
process.on("unhandledRejection", (err) => {
  console.error("❌ Unexpected error:", err && err.message ? err.message : err);
  process.exit(1);
});

main().catch((err) => {
  console.error("❌ Fatal:", err && err.message ? err.message : err);
  process.exit(1);
});
