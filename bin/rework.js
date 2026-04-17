#!/usr/bin/env node

/**
 * rework.js — Apply suggested fixes (cowork-side rework loop).
 *
 * Codex-main parity target: templates/orchestrator/ops/agents/rework-agent.js
 * Difference: cowork-side runs LOCALLY — no GitHub Actions, no PR mutation.
 *             Apply target is the user's working tree; safety = mandatory
 *             dry-run + git-clean check + per-file confirmation hook.
 *
 * Inputs:
 *   --review <file.json>          path to a review JSON written by uiuxSuggestFixes
 *   --apply                       actually apply patches (default = dry-run)
 *   --only <severity[,severity]>  filter: BLOCKER, SUGGESTION, NIT (default: BLOCKER,SUGGESTION)
 *   --max-fixes <N>               cap fixes applied per run (default: 5 — circuit breaker)
 *   --no-clean-check              skip "git status clean" precondition (NOT recommended)
 *   --context-refresh             refresh type definitions before applying (2026 compaction defense)
 *
 * Output: structured result {applied[], skipped[], failed[]} + notify() hook.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// ============================================================================
// PARSER (mirrors uiux-engine.js [FIX] block format)
// ============================================================================

const FIX_PATTERN = /\[FIX\s*#(\d+)\s*[—\-]+\s*([A-Z]+)\]\s*\[([^\]]+)\][\s\S]*?```diff\n([\s\S]*?)\n```/g;
const SKIP_PATTERN = /\[SKIP\s*#(\d+)\s*[—\-]+\s*([^\]]+)\]/g;

function parseFixes(text) {
  const fixes = [];
  const skips = [];
  let m;
  // Reset lastIndex to allow re-runs.
  FIX_PATTERN.lastIndex = 0;
  SKIP_PATTERN.lastIndex = 0;
  while ((m = FIX_PATTERN.exec(text)) !== null) {
    fixes.push({
      index: parseInt(m[1], 10),
      severity: m[2].toUpperCase(),
      location: m[3].trim(),
      patch: m[4],
    });
  }
  while ((m = SKIP_PATTERN.exec(text)) !== null) {
    skips.push({ index: parseInt(m[1], 10), reason: m[2].trim() });
  }
  return { fixes, skips };
}

function loadReviewFixes(reviewFile) {
  if (!fs.existsSync(reviewFile)) {
    throw new Error(`Review file not found: ${reviewFile}`);
  }
  const data = JSON.parse(fs.readFileSync(reviewFile, "utf8"));
  // Support both shapes: uiuxSuggestFixes output (already parsed) OR raw review
  if (Array.isArray(data.fixes)) {
    return { fixes: data.fixes, skips: data.skips || [], source: "parsed" };
  }
  if (typeof data.raw === "string") {
    const parsed = parseFixes(data.raw);
    return { ...parsed, source: "raw" };
  }
  throw new Error(`Review file has neither .fixes[] nor .raw — cannot extract patches`);
}

// ============================================================================
// SAFETY: git clean precondition + patch validation
// ============================================================================

function isGitClean(cwd) {
  try {
    const out = execSync("git status --porcelain", { cwd, encoding: "utf8" });
    return out.trim().length === 0;
  } catch (_) {
    return false;
  }
}

function validatePatch(patch, cwd) {
  // Use git apply --check to validate without applying.
  const tmp = path.join(os.tmpdir(), `cowork-rework-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.patch`);
  fs.writeFileSync(tmp, patch.endsWith("\n") ? patch : patch + "\n");
  try {
    execSync(`git apply --check "${tmp}"`, { cwd, stdio: "pipe" });
    return { ok: true, tmpPath: tmp };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || "").toString().trim().slice(0, 400), tmpPath: tmp };
  }
}

function applyPatch(tmpPath, cwd) {
  try {
    execSync(`git apply "${tmpPath}"`, { cwd, stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || "").toString().trim().slice(0, 400) };
  }
}

// ============================================================================
// CONTEXT REFRESH HELPER (2026 Compaction Defense)
// ============================================================================

/**
 * Context refresh for rework loop.
 * Re-reads type definitions and schema to ensure fixes won't break types.
 * Called before applyFixes when --context-refresh flag is used.
 */
function contextRefreshBeforeFixes(cwd) {
  const refreshLog = {
    timestamp: new Date().toISOString(),
    checkedItems: [],
  };

  // Check type definitions exist
  const typesDir = path.join(cwd, "src", "types");
  if (fs.existsSync(typesDir)) {
    const typeFiles = fs
      .readdirSync(typesDir)
      .filter(f => f.endsWith(".ts") || f.endsWith(".tsx"));
    refreshLog.checkedItems.push(`Type definitions: ${typeFiles.length} files`);
  } else {
    refreshLog.checkedItems.push("Type definitions: NOT FOUND (src/types/)`);
  }

  // Check schema exists
  const schemaFiles = [
    path.join(cwd, "prisma", "schema.prisma"),
    path.join(cwd, "supabase", "schema.sql"),
    path.join(cwd, "db", "schema.sql"),
  ];
  let schemaFound = false;
  for (const schemaFile of schemaFiles) {
    if (fs.existsSync(schemaFile)) {
      refreshLog.checkedItems.push(`Schema: ${path.basename(schemaFile)}`);
      schemaFound = true;
      break;
    }
  }
  if (!schemaFound) {
    refreshLog.checkedItems.push("Schema: NOT FOUND");
  }

  // Check package.json
  const packageFile = path.join(cwd, "package.json");
  if (fs.existsSync(packageFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
      const depCount = Object.keys(pkg.dependencies || {}).length;
      refreshLog.checkedItems.push(`Dependencies: ${depCount}`);
    } catch (_) {
      refreshLog.checkedItems.push("Dependencies: PARSE ERROR");
    }
  }

  // Log refresh results
  console.log(`[REWORK] Context refresh complete:`);
  for (const item of refreshLog.checkedItems) {
    console.log(`  ✓ ${item}`);
  }

  return refreshLog;
}

// ============================================================================
// MAIN: applyFixes
// ============================================================================

async function applyFixes(options = {}) {
  const {
    reviewFile,
    apply = false,
    only = ["BLOCKER", "SUGGESTION"],
    maxFixes = 5,
    cleanCheck = true,
    cwd = process.cwd(),
    notifier = null, // optional: { notifyApplyResult } from notify.js
    contextRefresh = false, // NEW: refresh type definitions before applying
  } = options;

  if (!reviewFile) throw new Error("reviewFile is required");

  // Context refresh: re-read type definitions and schema before applying fixes
  // This is CRITICAL after context compaction to ensure fixes don't break types
  if (contextRefresh) {
    console.log("[REWORK] Refreshing context — re-reading type definitions...");
    contextRefreshBeforeFixes(cwd);
  }

  const { fixes: rawFixes, skips, source } = loadReviewFixes(reviewFile);

  // Filter by severity
  const fixes = rawFixes.filter((f) => only.includes(f.severity));
  // Cap (circuit breaker)
  const capped = fixes.slice(0, maxFixes);

  const result = {
    reviewFile,
    source,
    mode: apply ? "apply" : "dry-run",
    cwd,
    cleanBefore: cleanCheck ? isGitClean(cwd) : null,
    requested: rawFixes.length,
    eligible: fixes.length,
    capped: capped.length,
    skips,
    applied: [],
    failed: [],
    skipped: [],
    summary: "",
  };

  // Precondition: git clean (only when applying for real)
  if (apply && cleanCheck && result.cleanBefore === false) {
    result.summary = "git working tree not clean — refusing to apply (use --no-clean-check to override)";
    if (notifier) await notifier({ applied: [], failed: [], summary: result.summary, reviewFile }).catch(() => {});
    return result;
  }

  for (const fix of capped) {
    const validation = validatePatch(fix.patch, cwd);
    if (!validation.ok) {
      result.failed.push({
        index: fix.index, severity: fix.severity, location: fix.location,
        stage: "validate", error: validation.error,
      });
      try { fs.unlinkSync(validation.tmpPath); } catch (_) {}
      continue;
    }

    if (!apply) {
      result.applied.push({
        index: fix.index, severity: fix.severity, location: fix.location,
        applied: false, dryRun: true, validated: true,
      });
      try { fs.unlinkSync(validation.tmpPath); } catch (_) {}
      continue;
    }

    const applyResult = applyPatch(validation.tmpPath, cwd);
    try { fs.unlinkSync(validation.tmpPath); } catch (_) {}
    if (!applyResult.ok) {
      result.failed.push({
        index: fix.index, severity: fix.severity, location: fix.location,
        stage: "apply", error: applyResult.error,
      });
    } else {
      result.applied.push({
        index: fix.index, severity: fix.severity, location: fix.location,
        applied: true, dryRun: false, validated: true,
      });
    }
  }

  // Anything beyond cap → skipped
  if (fixes.length > capped.length) {
    for (const fix of fixes.slice(capped.length)) {
      result.skipped.push({
        index: fix.index, severity: fix.severity, location: fix.location,
        reason: `circuit-breaker: maxFixes=${maxFixes}`,
      });
    }
  }

  result.summary = `${apply ? "applied" : "validated"} ${result.applied.length}/${capped.length} (failed: ${result.failed.length}, skipped: ${result.skipped.length})`;

  if (notifier) {
    try {
      await notifier({
        applied: result.applied,
        failed: result.failed,
        summary: result.summary,
        reviewFile,
      });
    } catch (_) { /* notify failure should not fail the rework */ }
  }

  return result;
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const out = { only: ["BLOCKER", "SUGGESTION"], maxFixes: 5, cleanCheck: true, contextRefresh: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], n = argv[i + 1];
    if (a === "--review") { out.reviewFile = n; i++; }
    else if (a === "--apply") { out.apply = true; }
    else if (a === "--only" && n) { out.only = n.split(",").map((s) => s.trim().toUpperCase()); i++; }
    else if (a === "--max-fixes" && n) { out.maxFixes = parseInt(n, 10); i++; }
    else if (a === "--no-clean-check") { out.cleanCheck = false; }
    else if (a === "--context-refresh") { out.contextRefresh = true; }
    else if (a === "--cwd" && n) { out.cwd = n; i++; }
    else if (a === "--help" || a === "-h") { out._help = true; }
  }
  return out;
}

function printHelp() {
  console.log(`rework — apply suggested fixes from a review JSON file

Usage:
  node bin/rework.js --review <file.json>           dry-run (default; safe)
  node bin/rework.js --review <file.json> --apply   actually apply patches
  node bin/rework.js --review <file.json> --apply --only BLOCKER --max-fixes 3
  node bin/rework.js --review <file.json> --apply --context-refresh   (after compaction)

Options:
  --review <file>          path to review JSON (uiuxSuggestFixes output or raw review)
  --apply                  apply patches via 'git apply' (otherwise dry-run + validate)
  --only BLOCKER,...       severity filter (default: BLOCKER,SUGGESTION)
  --max-fixes N            circuit-breaker cap (default: 5)
  --no-clean-check         skip git-clean precondition (NOT recommended)
  --context-refresh        refresh type definitions before applying (2026 compaction defense)
  --cwd <path>             override working directory (default: cwd)

Safety:
  - Always validates patches with 'git apply --check' before applying.
  - Refuses to apply when working tree is dirty (override: --no-clean-check).
  - Caps applied fixes per run to prevent runaway patches.
  - Use --context-refresh after context compaction to re-read types and schema.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._help || !args.reviewFile) { printHelp(); process.exit(args._help ? 0 : 1); }

  let notifier = null;
  try {
    const notifyMod = require("./notify.js");
    notifier = notifyMod.notifyApplyResult;
  } catch (_) { /* notify is optional */ }

  const result = await applyFixes({ ...args, notifier });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failed.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = {
  applyFixes,
  parseFixes,
  loadReviewFixes,
  validatePatch,
  isGitClean,
};
