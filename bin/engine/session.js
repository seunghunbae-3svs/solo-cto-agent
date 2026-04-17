/**
 * bin/engine/session.js
 * Session management and context checkpoint functions
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const core = require("./core");

const {
  CONFIG,
  logSection,
  logSuccess,
  logError,
  logWarn,
  logInfo,
  log,
  timestamp,
  ensureDir,
} = core;

// ============================================================================
// SESSION FUNCTIONS
// ============================================================================

function sessionSave(options = {}) {
  const {
    projectTag = null,
    decisions = [],
    errors = [],
    reviews = [],
    threads = [],
  } = options;

  ensureDir(CONFIG.sessionsDir);

  const ts = new Date().toISOString();
  const sessionData = {
    timestamp: ts,
    projectTag,
    decisions,
    errors,
    reviews,
    threads,
  };

  const filename = `${timestamp()}-session.json`;
  const sessionFile = path.join(CONFIG.sessionsDir, filename);

  fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
  logSuccess(`Session saved to ${sessionFile}`);

  const latestFile = path.join(CONFIG.sessionsDir, "latest.json");
  fs.writeFileSync(latestFile, JSON.stringify(sessionData, null, 2));
  logSuccess(`Latest session pointer updated`);

  return sessionFile;
}

function sessionRestore(options = {}) {
  const { sessionFile = null } = options;

  const latestFile = path.join(CONFIG.sessionsDir, "latest.json");

  if (!fs.existsSync(latestFile) && !sessionFile) {
    logWarn("No sessions found");
    return null;
  }

  try {
    const targetFile = sessionFile || latestFile;
    if (!fs.existsSync(targetFile)) {
      logError(`Session file not found: ${targetFile}`);
      return null;
    }

    const sessionData = JSON.parse(fs.readFileSync(targetFile, "utf8"));
    logSuccess(`Session restored from ${targetFile}`);
    return sessionData;
  } catch (err) {
    logError(`Failed to restore session: ${err.message}`);
    return null;
  }
}

function sessionList(options = {}) {
  const { limit = 10 } = options;

  if (!fs.existsSync(CONFIG.sessionsDir)) {
    logWarn("No sessions directory found");
    return [];
  }

  const files = fs.readdirSync(CONFIG.sessionsDir)
    .filter(f => f.endsWith("-session.json"))
    .sort()
    .reverse()
    .slice(0, limit);

  if (files.length === 0) {
    logWarn("No sessions found");
    return [];
  }

  logSection("Recent Sessions");

  const reviewParser = require("../review-parser");
  const COLORS = reviewParser.COLORS;

  const sessions = [];
  for (const file of files) {
    try {
      const filePath = path.join(CONFIG.sessionsDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const ts = new Date(data.timestamp);
      const projectLabel = data.projectTag ? ` (${data.projectTag})` : "";
      const decisionCount = (data.decisions || []).length;
      const errorCount = (data.errors || []).length;
      const reviewCount = (data.reviews || []).length;

      log(
        `${COLORS.blue}${file}${COLORS.reset}${projectLabel}`
      );
      log(
        `  ${ts.toLocaleString()} — ` +
        `${decisionCount} decisions, ${errorCount} errors, ${reviewCount} reviews`
      );

      sessions.push({
        file,
        timestamp: data.timestamp,
        projectTag: data.projectTag,
        decisionCount,
        errorCount,
        reviewCount,
      });
    } catch (err) {
      logError(`Failed to parse ${file}: ${err.message}`);
    }
  }

  return sessions;
}

// ============================================================================
// CONTEXT CHECKPOINT SYSTEM
// ============================================================================

function contextCheckpoint(options = {}) {
  const {
    cwd = process.cwd(),
    label = "auto",
    includeTypeSnapshot = true,
  } = options;

  const checkpointDir = path.join(cwd, ".claude");
  const checkpointFile = path.join(checkpointDir, "context-checkpoint.json");

  try {
    if (!fs.existsSync(checkpointDir)) {
      fs.mkdirSync(checkpointDir, { recursive: true });
    }

    let currentBranch = "unknown";
    try {
      currentBranch = execSync("git branch --show-current", {
        cwd,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
    } catch (_) {}

    let modifiedFiles = [];
    try {
      const out = execSync("git diff --name-only HEAD", {
        cwd,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      modifiedFiles = out.split("\n").filter(l => l.length > 0);
    } catch (_) {}

    let typeFilesSnapshot = [];
    if (includeTypeSnapshot) {
      const typesDir = path.join(cwd, "src", "types");
      if (fs.existsSync(typesDir)) {
        typeFilesSnapshot = fs
          .readdirSync(typesDir)
          .filter(f => f.endsWith(".ts") || f.endsWith(".tsx"))
          .map(f => path.join("src/types", f));
      }
    }

    const checkpoint = {
      timestamp: new Date().toISOString(),
      label,
      branch: currentBranch,
      modifiedFiles,
      modifiedCount: modifiedFiles.length,
      typeFilesSnapshot,
      instructions:
        "After compaction, re-read CLAUDE.md and type definitions before resuming edits.",
    };

    fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));
    logSuccess(`Context checkpoint created: ${checkpointFile}`);
    return checkpoint;
  } catch (err) {
    logWarn(`Failed to create context checkpoint: ${err.message}`);
    return null;
  }
}

function contextRestore(options = {}) {
  const {
    cwd = process.cwd(),
    checkpointFile = null,
  } = options;

  const defaultCheckpointFile = path.join(cwd, ".claude", "context-checkpoint.json");
  const targetFile = checkpointFile || defaultCheckpointFile;

  try {
    if (!fs.existsSync(targetFile)) {
      logWarn(`No checkpoint found at ${targetFile}`);
      return null;
    }

    const checkpoint = JSON.parse(fs.readFileSync(targetFile, "utf8"));

    let currentBranch = "unknown";
    try {
      currentBranch = execSync("git branch --show-current", {
        cwd,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
    } catch (_) {}

    const branchMatch = currentBranch === checkpoint.branch;
    const validation = {
      checkpoint,
      currentBranch,
      branchMatch,
      warning: branchMatch
        ? null
        : `Branch mismatch: checkpoint on "${checkpoint.branch}", currently on "${currentBranch}"`,
    };

    logSuccess(`Context restored from checkpoint (${checkpoint.timestamp})`);
    if (validation.warning) {
      logWarn(validation.warning);
    }

    return validation;
  } catch (err) {
    logError(`Failed to restore context checkpoint: ${err.message}`);
    return null;
  }
}

function reworkContextRefresh(options = {}) {
  const {
    cwd = process.cwd(),
    verbose = false,
  } = options;

  const refreshed = {
    timestamp: new Date().toISOString(),
    sources: {},
  };

  const typesDir = path.join(cwd, "src", "types");
  if (fs.existsSync(typesDir)) {
    const files = fs
      .readdirSync(typesDir)
      .filter(f => f.endsWith(".ts") || f.endsWith(".tsx"));
    refreshed.sources.typeDefinitions = files.length;
    if (verbose) {
      logSuccess(`Type definitions: ${files.length} files`);
    }
  }

  const schemaFiles = [
    path.join(cwd, "prisma", "schema.prisma"),
    path.join(cwd, "supabase", "schema.sql"),
    path.join(cwd, "db", "schema.sql"),
  ];
  for (const schemaFile of schemaFiles) {
    if (fs.existsSync(schemaFile)) {
      refreshed.sources.schema = path.basename(schemaFile);
      if (verbose) {
        logSuccess(`Schema found: ${schemaFile}`);
      }
      break;
    }
  }

  const packageFile = path.join(cwd, "package.json");
  if (fs.existsSync(packageFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
      refreshed.sources.project = pkg.name || "unknown";
      refreshed.sources.dependencies = Object.keys(pkg.dependencies || {}).length;
      if (verbose) {
        logSuccess(`Project: ${pkg.name} (${refreshed.sources.dependencies} deps)`);
      }
    } catch (_) {}
  }

  logSuccess(`Rework context refreshed: ${JSON.stringify(refreshed.sources)}`);
  return refreshed;
}

module.exports = {
  sessionSave,
  sessionRestore,
  sessionList,
  contextCheckpoint,
  contextRestore,
  reworkContextRefresh,
};
