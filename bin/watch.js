#!/usr/bin/env node

/**
 * watch.js — Cowork-side file watcher with tier-gated auto-trigger.
 *
 * Behavior:
 *   - Default: prints suggestion ("run 'solo-cto-agent review' on these changes")
 *   - --auto: auto-runs review on changes (cowork CTO + cowork+codex only by default)
 *
 * Tier gate (cost guardrail):
 *   - maker / builder         → --auto refused (manual signal only)
 *   - cto + cowork-only       → --auto refused unless --force
 *   - cto + cowork+codex      → --auto allowed
 *   - --force                 → bypass gate (user takes responsibility)
 *
 * Zero external dependencies — uses fs.watch with manual recursion.
 *
 * Scheduled-tasks MCP integration:
 *   - Emits a manifest at ~/.claude/skills/solo-cto-agent/scheduled-tasks.yaml
 *     describing the watch as a recurring task. Cowork's scheduled-tasks MCP
 *     can pick this up via list_scheduled_tasks if registered.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

// Load engine to read tier/mode/agent + notify hook
const engine = require("./cowork-engine.js");
let notify;
try { notify = require("./notify.js"); } catch (_) { notify = null; }

const DEFAULT_PATTERNS = [/\.tsx?$/, /\.jsx?$/, /\.css$/, /\.scss$/, /\.html$/, /\.svelte$/, /\.vue$/];
const IGNORE_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".turbo", ".cache", ".vercel", "coverage"]);

function isWatchable(filename) {
  if (!filename) return false;
  return DEFAULT_PATTERNS.some((re) => re.test(filename));
}

function detectAgent() {
  return process.env.OPENAI_API_KEY ? "cowork+codex" : "cowork";
}

/**
 * Returns { allowed: bool, reason: string }
 */
function checkTierGate({ tier, agent, force }) {
  if (force) return { allowed: true, reason: "force override (user responsibility)" };
  if (tier === "cto" && agent === "cowork+codex") return { allowed: true, reason: "cto + dual agent — auto allowed" };
  if (tier === "cto" && agent === "cowork") return {
    allowed: false,
    reason: "cto + cowork-only — auto needs --force (Bae policy 2026-04-14: dual-agent only by default)",
  };
  return {
    allowed: false,
    reason: `tier=${tier} agent=${agent} — auto blocked. Use manual 'solo-cto-agent review' instead.`,
  };
}

/**
 * Recursive file watcher. Returns a stop() function.
 */
function watchRecursive(rootDir, onChange) {
  const watchers = new Set();
  const watched = new Set();

  function attach(dir) {
    if (watched.has(dir)) return;
    if (IGNORE_DIRS.has(path.basename(dir))) return;
    let stat;
    try { stat = fs.statSync(dir); } catch (_) { return; }
    if (!stat.isDirectory()) return;
    watched.add(dir);
    try {
      const w = fs.watch(dir, { persistent: true }, (event, filename) => {
        if (!filename) return;
        const full = path.join(dir, filename);
        // Recurse into newly-created subdirs (best-effort)
        try {
          const s = fs.statSync(full);
          if (s.isDirectory()) { attach(full); return; }
        } catch (_) { /* deleted file */ }
        if (isWatchable(filename)) onChange({ event, filename, path: full });
      });
      watchers.add(w);
    } catch (_) { /* permission etc. */ }

    // Recurse one level (we'll attach more lazily on dir-create events)
    try {
      for (const entry of fs.readdirSync(dir)) {
        const child = path.join(dir, entry);
        try {
          if (fs.statSync(child).isDirectory()) attach(child);
        } catch (_) {}
      }
    } catch (_) {}
  }

  attach(rootDir);
  return () => { watchers.forEach((w) => { try { w.close(); } catch (_) {} }); };
}

function emitScheduledTasksManifest({ rootDir, intervalSec = 60, autoApply = false }) {
  // Minimal YAML emit (no dep). Cowork scheduled-tasks MCP can read this.
  const out = [
    "# solo-cto-agent — scheduled tasks manifest",
    "# Picked up by Cowork scheduled-tasks MCP if installed.",
    "tasks:",
    "  - id: cowork-review-watch",
    `    description: \"Review staged/branch changes when files change in ${rootDir}\"`,
    `    interval_seconds: ${intervalSec}`,
    "    command: \"solo-cto-agent review --branch\"",
    `    auto: ${autoApply ? "true" : "false"}`,
    "    cwd: " + rootDir,
    "",
  ].join("\n");
  const outFile = path.join(os.homedir(), ".claude", "skills", "solo-cto-agent", "scheduled-tasks.yaml");
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, out);
    return outFile;
  } catch (e) {
    return null;
  }
}

/**
 * Main watch loop.
 * @param opts.rootDir       directory to watch (default: cwd)
 * @param opts.auto          attempt automatic review trigger (default: false)
 * @param opts.force         bypass tier gate (default: false)
 * @param opts.debounceMs    debounce changes (default: 1500)
 * @param opts.dryRun        don't actually spawn review; print decision (test/CI mode)
 */
async function startWatch(opts = {}) {
  const {
    rootDir = process.cwd(),
    auto = false,
    force = false,
    debounceMs = 1500,
    dryRun = false,
  } = opts;

  const tier = engine.readTier();
  const mode = engine.readMode();
  const agent = detectAgent();

  // Emit scheduled-tasks manifest regardless (so MCP discovery works)
  const manifestPath = emitScheduledTasksManifest({ rootDir, intervalSec: Math.max(60, Math.floor(debounceMs / 1000) * 60), autoApply: auto });

  let willAuto = false;
  let gateReason = "";
  if (auto) {
    const gate = checkTierGate({ tier, agent, force });
    willAuto = gate.allowed;
    gateReason = gate.reason;
  } else {
    gateReason = "auto not requested — manual signal mode";
  }

  console.log(`watch — root=${rootDir}`);
  console.log(`        tier=${tier} mode=${mode} agent=${agent}`);
  console.log(`        auto=${willAuto ? "ON" : "OFF"} (${gateReason})`);
  console.log(`        debounce=${debounceMs}ms`);
  if (manifestPath) console.log(`        manifest: ${manifestPath}`);

  if (dryRun) {
    return { rootDir, tier, mode, agent, willAuto, gateReason, manifestPath };
  }

  let pending = new Set();
  let timer = null;

  const flush = async () => {
    const changes = Array.from(pending);
    pending = new Set();
    timer = null;
    if (!changes.length) return;
    const head = changes.slice(0, 5).join(", ");
    const more = changes.length > 5 ? ` (+${changes.length - 5} more)` : "";

    if (willAuto) {
      console.log(`\n[auto] running review for changes: ${head}${more}`);
      const child = spawn("node", [path.join(__dirname, "cli.js"), "review", "--branch"], {
        cwd: rootDir, stdio: "inherit", env: process.env,
      });
      child.on("exit", (code) => {
        if (notify) {
          notify.notify({
            severity: code === 0 ? "info" : "warn",
            title: `watch auto-review exited ${code}`,
            body: `Changes: ${head}${more}`,
          }).catch(() => {});
        }
      });
    } else {
      console.log(`\n[manual] ${changes.length} file(s) changed: ${head}${more}`);
      console.log(`         → run 'solo-cto-agent review --branch' when ready`);
      if (notify) {
        notify.notify({
          severity: "info",
          title: `watch detected ${changes.length} change(s)`,
          body: `Files: ${head}${more}\nGate: ${gateReason}`,
        }).catch(() => {});
      }
    }
  };

  const stop = watchRecursive(rootDir, ({ filename, path: full }) => {
    pending.add(path.relative(rootDir, full));
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });

  // Keep alive until SIGINT
  return new Promise((resolve) => {
    process.on("SIGINT", () => {
      console.log("\nwatch stopped.");
      stop();
      resolve({ rootDir, willAuto });
    });
  });
}

// ─── CLI ────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { rootDir: process.cwd(), debounceMs: 1500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], n = argv[i + 1];
    if (a === "--root" && n) { out.rootDir = path.resolve(n); i++; }
    else if (a === "--auto") { out.auto = true; }
    else if (a === "--force") { out.force = true; }
    else if (a === "--debounce-ms" && n) { out.debounceMs = parseInt(n, 10); i++; }
    else if (a === "--dry-run") { out.dryRun = true; }
    else if (a === "--help" || a === "-h") { out._help = true; }
  }
  return out;
}

function printHelp() {
  console.log(`watch — file watcher with tier-gated auto review

Usage:
  node bin/watch.js                          manual signal mode (safe default)
  node bin/watch.js --auto                   request auto review (gated by tier)
  node bin/watch.js --auto --force           bypass tier gate (NOT recommended)
  node bin/watch.js --root ./src --debounce-ms 3000
  node bin/watch.js --dry-run                print decision and exit

Tier gate (Bae policy 2026-04-14):
  - maker / builder       → --auto refused
  - cto + cowork-only     → --auto refused unless --force
  - cto + cowork+codex    → --auto allowed

Scheduled-tasks MCP:
  Emits ~/.claude/skills/solo-cto-agent/scheduled-tasks.yaml on every start.
  Cowork's scheduled-tasks MCP can register the task automatically.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._help) { printHelp(); return; }
  await startWatch(args);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = {
  startWatch,
  checkTierGate,
  detectAgent,
  isWatchable,
  emitScheduledTasksManifest,
  watchRecursive,
};
