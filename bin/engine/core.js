/**
 * bin/engine/core.js
 * Core configuration, logging, and utility functions for cowork-engine
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const C = require("../constants");

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

let _skillDirOverride = null;
function _setSkillDirOverride(p) { _skillDirOverride = p; }
const _skillBase = () => _skillDirOverride
  || process.env.COWORK_SKILL_DIR_OVERRIDE
  || path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");

function _validateConfigSchema(config, configPath) {
  try {
    const schemaPath = path.join(__dirname, "..", "..", "config.schema.json");
    if (!fs.existsSync(schemaPath)) return;
    const Ajv = require("ajv");
    const ajv = new Ajv({ allErrors: true });
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const valid = ajv.validate(schema, config);
    if (!valid && ajv.errors) {
      const issues = ajv.errors.map(e =>
        `  - ${e.instancePath || "/"}: ${e.message}`
      ).join("\n");
      console.warn(`⚠ Config schema warnings (${configPath}):\n${issues}`);
      console.warn(`  Config will still be used, but unexpected keys are ignored.`);
    }
  } catch (_) { /* ajv not installed at runtime — skip validation */ }
}

function _loadUserConfig() {
  const configPath = process.env.SOLO_CTO_CONFIG
    || path.join(os.homedir(), ".solo-cto-agent", "config.json");
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      _validateConfigSchema(config, configPath);
      return config;
    }
  } catch (e) {
    if (fs.existsSync(configPath)) {
      console.warn(`⚠ Config file exists but is not valid JSON: ${configPath}`);
      console.warn(`  Using built-in defaults. Fix the file or delete it.`);
    }
  }
  return {};
}
const _userConfig = _loadUserConfig();

const CONFIG = {
  get skillDir() { return _skillBase(); },
  get reviewsDir() { return path.join(_skillBase(), "reviews"); },
  get knowledgeDir() { return path.join(_skillBase(), "knowledge"); },
  get sessionsDir() { return path.join(_skillBase(), "sessions"); },
  get personalizationFile() { return path.join(_skillBase(), "personalization.json"); },
  defaultModel: {
    claude: (_userConfig.models && _userConfig.models.claude) || C.MODELS.claude,
    codex: (_userConfig.models && _userConfig.models.codex) || C.MODELS.codex,
    openai: (_userConfig.models && _userConfig.models.openai) || C.MODELS.openai,
  },
  tierModels: {
    claude: {
      maker:   C.MODELS.tier.maker,
      builder: C.MODELS.tier.builder,
      cto:     C.MODELS.tier.cto,
      ...(_userConfig.tierModels && _userConfig.tierModels.claude),
    },
  },
  providers: {
    anthropicBase: process.env.ANTHROPIC_API_BASE
      || (_userConfig.providers && _userConfig.providers.anthropicBase)
      || C.API_HOSTS.anthropic,
    openaiBase: process.env.OPENAI_API_BASE
      || (_userConfig.providers && _userConfig.providers.openaiBase)
      || C.API_HOSTS.openai,
  },
  diff: {
    maxChunkBytes: (_userConfig.diff && _userConfig.diff.maxChunkBytes) || C.LIMITS.maxChunkBytes,
  },
  tierLimits: {
    maker:   { maxRetries: 2, selfCrossReview: false, autoMcpProbe: false, maxIssuesShown: 5,  managedAgents: false, routines: false },
    builder: { maxRetries: 3, selfCrossReview: true,  autoMcpProbe: true,  maxIssuesShown: 10, managedAgents: false, routines: false },
    cto:     { maxRetries: 3, selfCrossReview: true,  autoMcpProbe: true,  maxIssuesShown: 20, managedAgents: true,  routines: true  },
  },
  routines: {
    enabled: (_userConfig.routines && _userConfig.routines.enabled) || false,
    triggerId: (_userConfig.routines && _userConfig.routines.triggerId) || null,
    betaHeader: C.BETA_HEADERS.routines,
    schedules: (_userConfig.routines && _userConfig.routines.schedules) || [],
  },
  managedAgents: {
    enabled: (_userConfig.managedAgents && _userConfig.managedAgents.enabled) || false,
    model: (_userConfig.managedAgents && _userConfig.managedAgents.model) || C.MODELS.managedAgent,
    betaHeader: C.BETA_HEADERS.managedAgents,
    sessionTimeoutMs: (_userConfig.managedAgents && _userConfig.managedAgents.sessionTimeoutMs) || C.TIMEOUTS.managedAgent,
  },
};

// ============================================================================
// LOGGING FUNCTIONS
// ============================================================================

let LOG_CHANNEL = "stdout";
function setLogChannel(ch) {
  LOG_CHANNEL = ch === "stderr" ? "stderr" : "stdout";
}
function getLogChannel() {
  return LOG_CHANNEL;
}
function log(...args) {
  if (LOG_CHANNEL === "stderr") console.error(...args);
  else console.log(...args);
}

// Import COLORS from review-parser (needed for logging)
let COLORS = null;
function getColors() {
  if (!COLORS) {
    const reviewParser = require("../review-parser");
    COLORS = reviewParser.COLORS;
  }
  return COLORS;
}

function logSection(title) {
  const colors = getColors();
  log(`\n${colors.bold}${title}${colors.reset}`);
  log("─".repeat(Math.min(title.length, 40)));
}

function logSuccess(msg) {
  const colors = getColors();
  log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logError(msg) {
  const colors = getColors();
  log(`${colors.red}✗${colors.reset} ${msg}`);
}

function logWarn(msg) {
  const colors = getColors();
  log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function logInfo(msg) {
  const colors = getColors();
  log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function logDim(msg) {
  const colors = getColors();
  log(`${colors.gray}${msg}${colors.reset}`);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function detectDefaultBranch(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd,
    }).trim();
    const m = ref.match(/refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  } catch {
    // fall through
  }
  try {
    const branches = execSync("git branch -r", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd,
    });
    if (/\borigin\/main\b/.test(branches)) return "main";
    if (/\borigin\/master\b/.test(branches)) return "master";
    if (/\borigin\/develop\b/.test(branches)) return "develop";
  } catch {
    // not a git repo or no remotes
  }
  return "main";
}

function getDiff(source, target, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  try {
    let cmd;
    switch (source) {
      case "staged":
        cmd = "git diff --staged";
        break;
      case "branch": {
        const base = target || detectDefaultBranch({ cwd });
        cmd = `git diff ${base}...HEAD`;
        break;
      }
      case "file":
        if (!target) throw new Error("--file requires target path");
        cmd = `git diff -- ${target}`;
        break;
      default:
        cmd = "git diff --staged";
    }
    return execSync(cmd, { encoding: "utf8", maxBuffer: C.LIMITS.gitDiffBuffer, cwd });
  } catch (e) {
    const stderr = e && e.stderr ? e.stderr.toString() : "";
    const msg = `${e && e.message ? e.message : ""} ${stderr}`.toLowerCase();
    if (msg.includes("not a git repository")) {
      logError("Not a git repository");
      return "";
    }
    if (msg.includes("ambiguous argument") || msg.includes("bad revision") || msg.includes("unknown revision")) {
      logError("Base branch not found. Try --target <branch> (e.g., master) or ensure origin/HEAD is set.");
      return "";
    }
    return "";
  }
}

function readSkillContext() {
  const skillPath = path.join(CONFIG.skillDir, "SKILL.md");
  try {
    return fs.readFileSync(skillPath, "utf8");
  } catch {
    return "";
  }
}

function readFailureCatalog() {
  const catPath = path.join(CONFIG.skillDir, "failure-catalog.json");
  try {
    return JSON.parse(fs.readFileSync(catPath, "utf8"));
  } catch {
    return { patterns: [] };
  }
}

function getRecentCommits(hours = 24) {
  try {
    const since = `${hours}h`;
    const log = execSync(`git log --since="${since}" --format=%B`, {
      encoding: "utf8",
      maxBuffer: C.LIMITS.gitCommandBuffer,
    });
    return log;
  } catch {
    return "";
  }
}

function estimateCost(inputTokens, outputTokens, model) {
  const rates = C.PRICING;
  let rate = rates[model];
  if (!rate) {
    if (/haiku/i.test(model))      rate = { input: 0.0008, output: 0.004 };
    else if (/opus/i.test(model))  rate = { input: 0.015,  output: 0.075 };
    else                           rate = { input: 0.003,  output: 0.015 };
  }
  const cost =
    (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
  return cost.toFixed(4);
}

function resolveModelForTier(tier, opts = {}) {
  const env = opts.env || process.env;
  const normalized = (tier || "").toLowerCase();

  if (normalized) {
    const specific = env[`CLAUDE_MODEL_${normalized.toUpperCase()}`];
    if (specific && specific.trim()) return specific.trim();
  }

  if (env.CLAUDE_MODEL && env.CLAUDE_MODEL.trim()) return env.CLAUDE_MODEL.trim();

  const tierMap = CONFIG.tierModels && CONFIG.tierModels.claude;
  if (tierMap && tierMap[normalized]) return tierMap[normalized];

  return CONFIG.defaultModel.claude;
}

module.exports = {
  CONFIG,
  _setSkillDirOverride,
  _skillBase,
  setLogChannel,
  getLogChannel,
  log,
  logSection,
  logSuccess,
  logError,
  logWarn,
  logInfo,
  logDim,
  timestamp,
  ensureDir,
  detectDefaultBranch,
  getDiff,
  readSkillContext,
  readFailureCatalog,
  getRecentCommits,
  estimateCost,
  resolveModelForTier,
};
