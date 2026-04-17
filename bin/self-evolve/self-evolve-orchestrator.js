#!/usr/bin/env node
/**
 * self-evolve-orchestrator.js — Master orchestrator for all self-evolve features
 *
 * Runs the full self-evolve cycle:
 *   1. Error collection check (are there unprocessed triggers?)
 *   2. Quality analysis (pending checks?)
 *   3. Skill improvement (apply triggered improvements)
 *   4. Feedback analysis (L2 patterns?)
 *   5. Weekly report (if Monday or manual)
 *   6. External trends (L3, if scheduled)
 *   7. Skill scouting (if scheduled)
 *
 * Usage:
 *   node self-evolve-orchestrator.js --project-dir DIR --skills-dir DIR --full    # Full cycle
 *   node self-evolve-orchestrator.js --project-dir DIR --post-task                # After task completion
 *   node self-evolve-orchestrator.js --project-dir DIR --session-end              # Session end
 *   node self-evolve-orchestrator.js --project-dir DIR --weekly                   # Weekly report only
 *   node self-evolve-orchestrator.js --project-dir DIR --status                   # System health check
 *
 * Module API:
 *   const { runPostTask, runSessionEnd, runWeekly, runFull, getStatus } = require('./self-evolve-orchestrator');
 */

const fs = require("fs");
const path = require("path");

// Lazy-load engine modules
function loadModule(name) {
  try {
    return require(`./${name}`);
  } catch (e) {
    console.warn(`⚠️  Failed to load ${name}: ${e.message}`);
    return null;
  }
}

/**
 * Run post-task checks (silent unless issues found).
 * Called after every significant task completion.
 *
 * @param {string} projectDir - Path to user-projects/
 * @param {Object} taskInfo
 * @param {string} taskInfo.type - "code"|"design"|"document"|"analysis"
 * @param {string} taskInfo.skill - Skill used
 * @param {Object} taskInfo.checks - Quality check results
 * @param {string} [taskInfo.notes] - Additional notes
 *
 * @returns {Object} { qualityResult, improvementTriggered }
 */
function runPostTask(projectDir, taskInfo) {
  const results = { qualityResult: null, improvementTriggered: false };

  // Quality check
  const qa = loadModule("quality-analyzer");
  if (qa) {
    results.qualityResult = qa.analyzeQuality(projectDir, taskInfo);

    if (results.qualityResult.triggerImprovement) {
      results.improvementTriggered = true;
    }
  }

  return results;
}

/**
 * Run session-end processes.
 * Checks all triggers, generates improvements, updates logs.
 *
 * @param {string} projectDir
 * @param {string} skillsDir
 * @returns {Object} Summary of actions taken
 */
function runSessionEnd(projectDir, skillsDir) {
  const actions = [];

  // 1. Check improvement triggers
  const improver = loadModule("skill-improver");
  if (improver) {
    const triggers = improver.checkTriggers(projectDir);
    if (triggers.length > 0) {
      actions.push(`${triggers.length}건 개선 트리거 감지`);
      // Auto-apply improvements (Level 2 — 실행 후 보고)
      for (const trigger of triggers) {
        const result = improver.applyImprovement(skillsDir, trigger, projectDir);
        if (result.applied) {
          actions.push(`C-${result.changeId}: ${trigger.skill} — ${trigger.description}`);
        }
      }
    }
  }

  // 2. Check L2 feedback patterns
  const feedback = loadModule("feedback-collector");
  if (feedback) {
    const lowPatterns = feedback.getLowScorePatterns(projectDir, 3);
    if (lowPatterns.length > 0) {
      actions.push(`L2 패턴 감지: ${lowPatterns.map(p => p.skill).join(", ")}`);
    }
  }

  // 3. Generate session summary
  const summary = {
    timestamp: new Date().toISOString(),
    actions,
    triggerCount: actions.length,
  };

  return summary;
}

/**
 * Generate weekly report.
 *
 * @param {string} projectDir
 * @param {Object} [options]
 * @returns {Object} Report result
 */
function runWeekly(projectDir, options = {}) {
  const report = loadModule("weekly-report");
  if (!report) return { error: "weekly-report module not available" };

  return report.generateWeeklyReport(projectDir, options);
}

/**
 * Run full self-evolve cycle.
 */
function runFull(projectDir, skillsDir) {
  console.log("\n🔄 Self-Evolve Full Cycle\n");

  const results = {
    improvements: [],
    weekly: null,
    trends: null,
    scouting: null,
  };

  // 1. Check and apply improvements
  console.log("── Phase 1: Check Improvement Triggers ──");
  const sessionResult = runSessionEnd(projectDir, skillsDir);
  results.improvements = sessionResult.actions;
  if (sessionResult.actions.length) {
    for (const a of sessionResult.actions) console.log(`  ${a}`);
  } else {
    console.log("  ✅ 개선 트리거 없음");
  }

  // 2. Weekly report
  console.log("\n── Phase 2: Weekly Report ──");
  results.weekly = runWeekly(projectDir);
  if (results.weekly.path) {
    console.log(`  📄 ${results.weekly.path}`);
  }

  // 3. External trends (L3)
  console.log("\n── Phase 3: External Trends (L3) ──");
  const trends = loadModule("external-trends");
  if (trends) {
    results.trends = trends.generateTrendsReport(projectDir, {});
    if (results.trends.path) {
      console.log(`  📄 ${results.trends.path}`);
    }
  }

  // 4. Skill scouting
  console.log("\n── Phase 4: Skill Scouting ──");
  const scout = loadModule("skill-scout");
  if (scout) {
    const installed = scout.getInstalledSkills(skillsDir);
    console.log(`  Installed: ${installed.length} skills`);
    results.scouting = { installed: installed.length };
  }

  console.log("\n✅ Full cycle complete.\n");
  return results;
}

/**
 * Get system health status.
 */
function getStatus(projectDir) {
  const status = {
    files: {},
    modules: {},
    health: "ok",
    issues: [],
  };

  // Check data files
  const files = [
    "error-patterns.md",
    "quality-log.md",
    "skill-changelog.md",
    "feedback-log.md",
    "scout-log.md",
  ];

  for (const file of files) {
    const filePath = path.join(projectDir, file);
    const exists = fs.existsSync(filePath);
    status.files[file] = exists;
    if (!exists) {
      status.issues.push(`Missing: ${file}`);
    }
  }

  // Check directories
  const dirs = ["reports", "memory", "memory/episodes", "memory/knowledge", "LOGS"];
  for (const dir of dirs) {
    const dirPath = path.join(projectDir, dir);
    if (!fs.existsSync(dirPath)) {
      status.issues.push(`Missing dir: ${dir}`);
    }
  }

  // Check modules
  const modules = [
    "error-collector",
    "quality-analyzer",
    "skill-improver",
    "feedback-collector",
    "weekly-report",
    "skill-scout",
    "external-trends",
  ];

  for (const mod of modules) {
    const loaded = loadModule(mod);
    status.modules[mod] = loaded !== null;
    if (!loaded) {
      status.health = "degraded";
      status.issues.push(`Module failed: ${mod}`);
    }
  }

  if (status.issues.length > 3) status.health = "critical";
  else if (status.issues.length > 0) status.health = "degraded";

  return status;
}

/**
 * Initialize all data files if missing.
 */
function initializeDataFiles(projectDir) {
  const dirs = ["reports", "memory", "memory/episodes", "memory/knowledge", "memory/archive", "LOGS"];
  for (const dir of dirs) {
    const dirPath = path.join(projectDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  // Initialize each module's data file
  const modules = ["error-collector", "quality-analyzer", "skill-improver", "feedback-collector"];
  for (const mod of modules) {
    const m = loadModule(mod);
    if (m) {
      // Reading triggers auto-creation of missing files
      const readFn = Object.values(m).find(fn => typeof fn === "function" && fn.name.startsWith("read"));
      if (readFn) {
        try { readFn(projectDir); } catch (e) {}
      }
    }
  }

  return { initialized: true };
}

// ── CLI ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };

  const projectDir = get("--project-dir") || process.cwd();
  const skillsDir = get("--skills-dir") || path.join(projectDir, "..", ".claude", "skills");

  if (args.includes("--init")) {
    initializeDataFiles(projectDir);
    console.log("✅ Data files initialized.");
    process.exit(0);
  }

  if (args.includes("--status")) {
    const status = getStatus(projectDir);
    const icon = status.health === "ok" ? "✅" : status.health === "degraded" ? "⚠️" : "❌";
    console.log(`${icon} Self-Evolve Status: ${status.health}`);
    console.log("\nFiles:");
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
    process.exit(0);
  }

  if (args.includes("--post-task")) {
    const type = get("--type") || "code";
    const skill = get("--skill") || "unknown";
    const result = runPostTask(projectDir, { type, skill, checks: {} });
    console.log("Post-task check:", JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (args.includes("--session-end")) {
    const result = runSessionEnd(projectDir, skillsDir);
    console.log("Session end:", JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (args.includes("--weekly")) {
    const result = runWeekly(projectDir);
    if (result.markdown) console.log(result.markdown);
    process.exit(0);
  }

  if (args.includes("--full")) {
    runFull(projectDir, skillsDir);
    process.exit(0);
  }

  console.error("Usage: node self-evolve-orchestrator.js --project-dir DIR [--skills-dir DIR]");
  console.error("  --init         Initialize data files");
  console.error("  --status       System health check");
  console.error("  --post-task    After task completion");
  console.error("  --session-end  Session end processing");
  console.error("  --weekly       Weekly report");
  console.error("  --full         Full cycle");
  process.exit(1);
}

module.exports = {
  runPostTask,
  runSessionEnd,
  runWeekly,
  runFull,
  getStatus,
  initializeDataFiles,
};
