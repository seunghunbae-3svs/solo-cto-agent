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

/**
 * Inspect env for active external signals (T1/T2/T3).
 * Mirrors engine.assessExternalSignals but kept local to avoid circular state issues
 * when watch runs under different cwd.
 */
function detectExternalSignals(env = process.env) {
  return {
    t1PeerModel: !!env.OPENAI_API_KEY,
    t2ExternalKnowledge:
      env.COWORK_EXTERNAL_KNOWLEDGE === "1" ||
      !!env.COWORK_WEB_SEARCH ||
      !!env.COWORK_PACKAGE_REGISTRY,
    t3GroundTruth:
      !!env.VERCEL_TOKEN ||
      !!env.SUPABASE_ACCESS_TOKEN ||
      env.COWORK_GROUND_TRUTH === "1",
  };
}

/**
 * Build the list of scheduled tasks to emit.
 *
 * Tasks emitted:
 *  - cowork-review-watch          (always)
 *  - cowork-external-loop-daily   (if any T2/T3 signal present — runs a pinged external-loop pass)
 *  - cowork-dual-review-weekly    (if T1 peer-model key present — periodic dual-review)
 *
 * Tier/agent gate: dual-review is only scheduled when tier permits auto-runs
 * (cto + cowork+codex, or force). Otherwise it's emitted with auto=false so it
 * surfaces as a reminder task instead of a silent auto-run.
 */
function buildScheduledTasks({ rootDir, intervalSec, autoApply, signals, tier, agent, force }) {
  const tasks = [
    {
      id: "cowork-review-watch",
      description: `Review staged/branch changes when files change in ${rootDir}`,
      interval_seconds: intervalSec,
      command: "solo-cto-agent review --branch",
      auto: !!autoApply,
      cwd: rootDir,
    },
  ];

  const anyExternal = !!(signals && (signals.t2ExternalKnowledge || signals.t3GroundTruth));
  if (anyExternal) {
    tasks.push({
      id: "cowork-external-loop-daily",
      description: "Daily external-signal refresh (T2 + T3) — detects new ERROR deployments, deprecated packages, or major version drift even without code changes.",
      interval_seconds: 86400,
      command: "solo-cto-agent external-loop --json",
      auto: true, // ping-only, no file mutation or cost
      cwd: rootDir,
    });
  }

  if (signals && signals.t1PeerModel) {
    const dualAllowed = force || (tier === "cto" && agent === "cowork+codex");
    tasks.push({
      id: "cowork-dual-review-weekly",
      description: "Weekly cross-verify with peer model (OpenAI). Catches model-family-specific blind spots periodically.",
      interval_seconds: 604800,
      command: "solo-cto-agent dual-review --branch",
      auto: dualAllowed,
      cwd: rootDir,
      note: dualAllowed
        ? "auto-enabled (tier+agent allow)"
        : "auto-disabled (tier gate — run manually or use --force)",
    });
  }

  return tasks;
}

function serializeYamlTasks(tasks) {
  const lines = [
    "# solo-cto-agent — scheduled tasks manifest",
    "# Picked up by Cowork scheduled-tasks MCP if installed.",
    "tasks:",
  ];
  for (const t of tasks) {
    lines.push(`  - id: ${t.id}`);
    lines.push(`    description: "${t.description.replace(/"/g, '\\"')}"`);
    lines.push(`    interval_seconds: ${t.interval_seconds}`);
    lines.push(`    command: "${t.command}"`);
    lines.push(`    auto: ${t.auto ? "true" : "false"}`);
    lines.push(`    cwd: ${t.cwd}`);
    if (t.note) lines.push(`    note: "${t.note.replace(/"/g, '\\"')}"`);
  }
  lines.push("");
  return lines.join("\n");
}

function emitScheduledTasksManifest({ rootDir, intervalSec = 60, autoApply = false, env = process.env, tier = null, agent = null, force = false, signals = null, outPath = null }) {
  const resolvedSignals = signals || detectExternalSignals(env);
  const tasks = buildScheduledTasks({ rootDir, intervalSec, autoApply, signals: resolvedSignals, tier, agent, force });
  const yaml = serializeYamlTasks(tasks);
  const outFile = outPath || path.join(os.homedir(), ".claude", "skills", "solo-cto-agent", "scheduled-tasks.yaml");
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, yaml);
    return { path: outFile, tasks };
  } catch (e) {
    return null;
  }
}

/**
 * Run a single external-loop pass: fetches T2 + T3 in parallel (no diff review),
 * returns a status snapshot. Suitable for cron-style periodic refresh.
 *
 * @param opts.fetchImpl   optional fetch stub (for tests/offline)
 * @param opts.env         env override (defaults to process.env)
 * @param opts.cwd         cwd for project resolution (defaults to process.cwd)
 */
async function externalLoopPing(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const signals = detectExternalSignals(env);

  const activeCount =
    (signals.t1PeerModel ? 1 : 0) +
    (signals.t2ExternalKnowledge ? 1 : 0) +
    (signals.t3GroundTruth ? 1 : 0);

  if (activeCount === 0) {
    return {
      ok: false,
      reason: "no external signals active — set OPENAI_API_KEY / COWORK_EXTERNAL_KNOWLEDGE / VERCEL_TOKEN",
      signals,
      activeCount: 0,
      timestamp: new Date().toISOString(),
    };
  }

  const tasks = [];
  if (signals.t3GroundTruth) tasks.push(engine.fetchGroundTruth({ env, cwd, fetchImpl: opts.fetchImpl }).catch((e) => ({ error: e.message })));
  else tasks.push(Promise.resolve(null));

  if (signals.t2ExternalKnowledge) tasks.push(engine.fetchExternalKnowledge({ env, cwd, fetchImpl: opts.fetchImpl }).catch((e) => ({ error: e.message })));
  else tasks.push(Promise.resolve(null));

  const [groundTruth, externalKnowledge] = await Promise.all(tasks);

  // Build a compact summary
  const alerts = [];
  if (groundTruth && groundTruth.vercel && groundTruth.vercel.ok && groundTruth.vercel.summary) {
    const s = groundTruth.vercel.summary;
    if (s.errorCount > 0 && s.latestError) {
      alerts.push({ tier: "T3", kind: "vercel-error", detail: `${s.errorCount} ERROR deployment(s); latest uid=${s.latestError.uid}` });
    }
  }
  if (externalKnowledge && externalKnowledge.enabled && externalKnowledge.packageCurrency && externalKnowledge.packageCurrency.summary) {
    const s = externalKnowledge.packageCurrency.summary;
    if (s.deprecated > 0) alerts.push({ tier: "T2", kind: "deprecated", detail: `${s.deprecated} deprecated package(s)` });
    if (s.major > 0) alerts.push({ tier: "T2", kind: "major-drift", detail: `${s.major} package(s) on an old major version` });
  }

  return {
    ok: true,
    signals,
    activeCount,
    alerts,
    groundTruth,
    externalKnowledge,
    timestamp: new Date().toISOString(),
  };
}

function formatExternalLoopPing(result) {
  if (!result) return "";
  const lines = [];
  if (!result.ok) {
    lines.push(`[external-loop] inactive — ${result.reason}`);
    return lines.join("\n");
  }
  lines.push(`[external-loop] active=${result.activeCount}/3  (T1=${result.signals.t1PeerModel ? "on" : "off"} T2=${result.signals.t2ExternalKnowledge ? "on" : "off"} T3=${result.signals.t3GroundTruth ? "on" : "off"})`);
  if (!result.alerts.length) {
    lines.push("                all clear — no deprecated packages, no ERROR deployments.");
  } else {
    for (const a of result.alerts) {
      lines.push(`  ⚠️  [${a.tier}] ${a.kind} — ${a.detail}`);
    }
  }
  return lines.join("\n");
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

  // Emit scheduled-tasks manifest regardless (so MCP discovery works).
  // Now also includes external-loop-daily (if T2/T3 signals) and dual-review-weekly (if T1).
  const signals = detectExternalSignals(process.env);
  const manifest = emitScheduledTasksManifest({
    rootDir,
    intervalSec: Math.max(60, Math.floor(debounceMs / 1000) * 60),
    autoApply: auto,
    signals,
    tier,
    agent,
    force,
  });
  const manifestPath = manifest ? manifest.path : null;

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
  if (manifest && manifest.tasks && manifest.tasks.length > 1) {
    console.log(`        periodic tasks: ${manifest.tasks.slice(1).map((t) => t.id + (t.auto ? "" : "(manual)")).join(", ")}`);
  }

  if (dryRun) {
    return { rootDir, tier, mode, agent, willAuto, gateReason, manifestPath, tasks: manifest ? manifest.tasks : [] };
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
            meta: { event: code === 0 ? "ci.success" : "ci.failure" },
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
  detectExternalSignals,
  isWatchable,
  emitScheduledTasksManifest,
  buildScheduledTasks,
  serializeYamlTasks,
  watchRecursive,
  externalLoopPing,
  formatExternalLoopPing,
};
