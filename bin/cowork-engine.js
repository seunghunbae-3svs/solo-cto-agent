#!/usr/bin/env node

/**
 * cowork-engine.js
 *
 * Core engine for Cowork mode — LOCAL execution without GitHub Actions.
 * Supports:
 *   - Mode A: Cowork Solo (Claude-only, all local)
 *   - Mode B: Cowork+Codex Dual (Claude + Codex cross-review)
 *
 * Usage:
 *   node bin/cowork-engine.js local-review [--staged|--branch|--file <path>] [--target <branch>] [--dry-run] [--json]
 *   node bin/cowork-engine.js knowledge-capture [--session|--file <path>] [--project <tag>]
 *   node bin/cowork-engine.js dual-review [--staged|--branch] [--target <branch>] [--json]
 *   node bin/cowork-engine.js detect-mode
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");
const C = require("./constants");

const personalization = require("./personalization");
const extSignals = require("./external-signals");
const reviewParser = require("./review-parser");

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

// Lazy path getters — resolve $HOME at call time so tests can override.
// Tests can also set COWORK_SKILL_DIR_OVERRIDE env var or via _setSkillDirOverride().
let _skillDirOverride = null;
function _setSkillDirOverride(p) { _skillDirOverride = p; }
const _skillBase = () => _skillDirOverride
  || process.env.COWORK_SKILL_DIR_OVERRIDE
  || path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");

// User config file: ~/.solo-cto-agent/config.json
// Allows overriding models, API base URLs, review settings, etc.
// Schema: config.schema.json — validation is advisory (warns, never blocks).
function _validateConfigSchema(config, configPath) {
  try {
    const schemaPath = path.join(__dirname, "..", "config.schema.json");
    if (!fs.existsSync(schemaPath)) return; // schema not shipped (dev env)
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
  // Tier → model mapping. Haiku for light validation (maker),
  // Sonnet for balanced dev work (builder), Opus for orchestration
  // and deeper reasoning (cto). Env overrides documented in resolveModelForTier().
  tierModels: {
    claude: {
      maker:   C.MODELS.tier.maker,
      builder: C.MODELS.tier.builder,
      cto:     C.MODELS.tier.cto,
      ...(_userConfig.tierModels && _userConfig.tierModels.claude),
    },
  },
  // Provider endpoints — override to use Ollama, LM Studio, Together AI, Groq, etc.
  // Any OpenAI-compatible API works with openaiBase.
  providers: {
    anthropicBase: process.env.ANTHROPIC_API_BASE
      || (_userConfig.providers && _userConfig.providers.anthropicBase)
      || C.API_HOSTS.anthropic,
    openaiBase: process.env.OPENAI_API_BASE
      || (_userConfig.providers && _userConfig.providers.openaiBase)
      || C.API_HOSTS.openai,
  },
  // Diff chunking — split large diffs before sending to API.
  diff: {
    maxChunkBytes: (_userConfig.diff && _userConfig.diff.maxChunkBytes) || C.LIMITS.maxChunkBytes,
  },
  // Tier × Mode 자동화 한계 (Semi-auto mode)
  tierLimits: {
    maker:   { maxRetries: 2, selfCrossReview: false, autoMcpProbe: false, maxIssuesShown: 5,  managedAgents: false, routines: false },
    builder: { maxRetries: 3, selfCrossReview: true,  autoMcpProbe: true,  maxIssuesShown: 10, managedAgents: false, routines: false },
    cto:     { maxRetries: 3, selfCrossReview: true,  autoMcpProbe: true,  maxIssuesShown: 20, managedAgents: true,  routines: true  },
  },
  // Claude Code Routines — cloud-based scheduled/triggered review automation.
  // Requires Claude Code Pro/Max/Team/Enterprise with Routines enabled.
  // /fire endpoint: POST https://api.anthropic.com/v1/claude_code/routines/{trigger_id}/fire
  routines: {
    enabled: (_userConfig.routines && _userConfig.routines.enabled) || false,
    triggerId: (_userConfig.routines && _userConfig.routines.triggerId) || null,
    betaHeader: C.BETA_HEADERS.routines,
    // Daily run caps by plan: Pro=5, Max=15, Team/Enterprise=25
    schedules: (_userConfig.routines && _userConfig.routines.schedules) || [],
  },
  // Claude Managed Agents — fully managed agent harness for deep review.
  // CTO tier only. $0.08/session-hour + standard token rates.
  managedAgents: {
    enabled: (_userConfig.managedAgents && _userConfig.managedAgents.enabled) || false,
    model: (_userConfig.managedAgents && _userConfig.managedAgents.model) || C.MODELS.managedAgent,
    betaHeader: C.BETA_HEADERS.managedAgents,
    sessionTimeoutMs: (_userConfig.managedAgents && _userConfig.managedAgents.sessionTimeoutMs) || C.TIMEOUTS.managedAgent,
  },
};

// Initialize personalization layer with CONFIG and _skillDir getter
personalization.init(CONFIG, _skillBase);

// Initialize external signals layer with CONFIG (log utilities added later in LOGGING section)
extSignals.init(CONFIG, {});

// Initialize review parser layer
reviewParser.init(CONFIG, {});

// ============================================================================
// DELEGATION CONSTANTS (PR-G30/G32 refactor)
// ============================================================================
// These point to functions extracted into sub-modules. Inline definitions
// (lines ~318-1717) are removed to eliminate duplication.

// REVIEW PARSER (delegated to bin/review-parser.js, PR-G30/G32)
const normalizeVerdict = reviewParser.normalizeVerdict;
const verdictLabel = reviewParser.verdictLabel;
const normalizeSeverity = reviewParser.normalizeSeverity;
const parseReviewResponse = reviewParser.parseReviewResponse;
const formatCrossCheck = reviewParser.formatCrossCheck;
const formatTerminalOutput = reviewParser.formatTerminalOutput;
const COLORS = reviewParser.COLORS;

// EXTERNAL SIGNALS (delegated to bin/external-signals.js, PR-G30/G32)
const assessExternalSignals = extSignals.assessExternalSignals;
const formatSelfLoopWarning = extSignals.formatSelfLoopWarning;
const formatPartialSignalHint = extSignals.formatPartialSignalHint;
const resolveVercelProject = extSignals.resolveVercelProject;
const resolveSupabaseProject = extSignals.resolveSupabaseProject;
const fetchVercelGroundTruth = extSignals.fetchVercelGroundTruth;
const summarizeVercelDeployments = extSignals.summarizeVercelDeployments;
const fetchGroundTruth = extSignals.fetchGroundTruth;
const formatGroundTruthContext = extSignals.formatGroundTruthContext;
const scanPackageJson = extSignals.scanPackageJson;
const parsePinnedVersion = extSignals.parsePinnedVersion;
const compareVersions = extSignals.compareVersions;
const fetchNpmRegistry = extSignals.fetchNpmRegistry;
const fetchPackageCurrency = extSignals.fetchPackageCurrency;
const normalizeOsvSeverity = extSignals.normalizeOsvSeverity;
const severityRank = extSignals.severityRank;
const fetchOsvAdvisories = extSignals.fetchOsvAdvisories;
const fetchSecurityAdvisories = extSignals.fetchSecurityAdvisories;
const fetchExternalKnowledge = extSignals.fetchExternalKnowledge;
const formatExternalKnowledgeContext = extSignals.formatExternalKnowledgeContext;
const detectLiveSources = extSignals.detectLiveSources;
const liveSourceContext = extSignals.liveSourceContext;
const buildIdentity = extSignals.buildIdentity;

// Constants delegated from external-signals.js
const AGENT_IDENTITY_BY_TIER = extSignals.AGENT_IDENTITY_BY_TIER;
const AGENT_IDENTITY = extSignals.AGENT_IDENTITY;

/**
 * Resolve the Claude model to use for a given tier.
 *
 * Resolution order:
 *   1. CLAUDE_MODEL_<TIER> env (e.g. CLAUDE_MODEL_CTO) — tier-specific override
 *   2. CLAUDE_MODEL env — global override (applies to all tiers)
 *   3. CONFIG.tierModels.claude[tier] — tier default
 *   4. CONFIG.defaultModel.claude — backstop (preserves historical behavior)
 *
 * A user with a paid Opus subscription can set CLAUDE_MODEL_CTO=claude-opus-... and
 * keep Haiku for maker tier. A user who wants everything on one model can set CLAUDE_MODEL.
 */
/**
 * Split a unified diff into chunks that each fit within maxBytes.
 * Splits at "diff --git" file boundaries. If a single file exceeds maxBytes,
 * that file is truncated (unavoidable — better than dropping it entirely).
 * @param {string} diffText - full unified diff
 * @param {number} maxBytes - max bytes per chunk
 * @returns {string[]} array of diff chunks
 */
function _splitDiffIntoChunks(diffText, maxBytes) {
  // If entire diff fits, return as-is
  if (Buffer.byteLength(diffText, "utf8") <= maxBytes) {
    return [diffText];
  }
  // Split at file boundaries
  const fileParts = diffText.split(/(?=^diff --git )/m).filter(Boolean);

  if (fileParts.length <= 1) {
    // Single file exceeds limit — truncate it
    const truncated = Buffer.from(diffText, "utf8").subarray(0, maxBytes).toString("utf8");
    const lastNl = truncated.lastIndexOf("\n");
    return [(lastNl > 0 ? truncated.slice(0, lastNl) : truncated)
      + `\n\n[... single file truncated — ${(Buffer.byteLength(diffText, "utf8") / 1024).toFixed(0)}KB total]`];
  }

  const chunks = [];
  let current = "";

  for (const part of fileParts) {
    const partBytes = Buffer.byteLength(part, "utf8");
    const currentBytes = Buffer.byteLength(current, "utf8");

    if (currentBytes + partBytes <= maxBytes) {
      current += part;
    } else {
      if (current) chunks.push(current);
      // If this single file exceeds limit, truncate it
      if (partBytes > maxBytes) {
        const trunc = Buffer.from(part, "utf8").subarray(0, maxBytes).toString("utf8");
        const nl = trunc.lastIndexOf("\n");
        current = (nl > 0 ? trunc.slice(0, nl) : trunc)
          + `\n\n[... file truncated — ${(partBytes / 1024).toFixed(0)}KB]`;
      } else {
        current = part;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Merge multiple parsed review results into a single consolidated review.
 * Deduplicates issues by location, escalates verdict to worst-case.
 * @param {Array<{verdict: string, issues: Array, summary: string, nextAction: string}>} reviews
 * @returns {{verdict: string, issues: Array, summary: string, nextAction: string, chunkCount: number}}
 */
function _mergeChunkReviews(reviews) {
  const verdictRank = { APPROVE: 0, COMMENT: 1, REQUEST_CHANGES: 2 };
  let worstVerdict = "APPROVE";
  const allIssues = [];
  const seenLocations = new Set();
  const summaries = [];
  const nextActions = [];

  for (const r of reviews) {
    // Escalate verdict
    if ((verdictRank[r.verdict] || 0) > (verdictRank[worstVerdict] || 0)) {
      worstVerdict = r.verdict;
    }
    // Collect issues, dedup by location+issue
    for (const issue of (r.issues || [])) {
      const key = `${issue.location}::${issue.issue}`;
      if (!seenLocations.has(key)) {
        seenLocations.add(key);
        allIssues.push(issue);
      }
    }
    if (r.summary) summaries.push(r.summary);
    if (r.nextAction) nextActions.push(r.nextAction);
  }

  return {
    verdict: worstVerdict,
    verdictKo: verdictLabel(worstVerdict),
    issues: allIssues,
    summary: summaries.join(" "),
    nextAction: nextActions.join("\n"),
    chunkCount: reviews.length,
  };
}

function resolveModelForTier(tier, opts = {}) {
  const env = opts.env || process.env;
  const normalized = (tier || "").toLowerCase();

  // 1. tier-specific env override
  if (normalized) {
    const specific = env[`CLAUDE_MODEL_${normalized.toUpperCase()}`];
    if (specific && specific.trim()) return specific.trim();
  }

  // 2. global env override
  if (env.CLAUDE_MODEL && env.CLAUDE_MODEL.trim()) return env.CLAUDE_MODEL.trim();

  // 3. tier default from config
  const tierMap = CONFIG.tierModels && CONFIG.tierModels.claude;
  if (tierMap && tierMap[normalized]) return tierMap[normalized];

  // 4. backstop
  return CONFIG.defaultModel.claude;
}

// ============================================================================
// EMBEDDED SKILL CONTEXT
// 정확한 본문은 skills/_shared/skill-context.md 와 동기화 (build-time check)
// ============================================================================

// A. 운영 원칙 (스택 무관)
const OPERATING_PRINCIPLES = `
## 운영 원칙 (스택 무관)
- Live Source of Truth: 배포·DB·코드·로그는 항상 라이브 소스 직접 조회. 문서 기억 의존 금지.
  → 라이브 = [확정], 캐시 = [캐시], 추정 = [추정], 미확인 = [미검증]
- 최소 안전 수정: 요청 범위 밖 리팩토링 금지. diff 밖 파일 언급 금지.
- 에러 처리: 조용한 실패 금지. try-catch 는 실제 실패 지점에만. 구조화된 에러 반환.
- 팩트 기반: 모든 수치·주장에 [확정]/[추정]/[미검증]/[캐시]/[OFFLINE] 태그.
- PR 본문 필수: 요약 / 리스크(LOW·MEDIUM·HIGH) / 롤백 / Preview 링크.
- Circuit Breaker: 같은 에러 3회 재시도 실패 시 정지 후 보고.
`;

// B. Common Stack 패턴 (자주 등장하는 스택)
const COMMON_STACK_PATTERNS = `
## Common Stack 반복 에러 패턴 (사용자 stack 매칭 시 활성)
- Next.js: import @/ 절대경로, 14/15 params 동기/Promise 혼용 금지, Tailwind v3/v4 혼용 금지, 'use client' 정확성
- Prisma: Drizzle 와 동시 사용 금지, prisma generate 타이밍 (postinstall 또는 build pre-step), schema 변경 시 마이그레이션 필수
- NextAuth: session.user 확장 시 next-auth.d.ts types 필요, callback URL 환경별 분리
- Supabase: RLS 활성화 (비활성=BLOCKER), service_role 클라이언트 노출 금지, N+1 쿼리 점검
- Vercel: env 변수 누락 / prisma generate 타이밍 / build command 불일치 = 빌드 실패 상위 3
`;

// C. 리뷰 우선순위
const REVIEW_PRIORITY = `
## 리뷰 우선순위 (높음 → 낮음)
1. 보안 (secret 노출, auth bypass, SQL injection, RLS 비활성) → BLOCKER
2. 데이터 손실 위험 (마이그레이션 누락, 무차별 delete, 트랜잭션 누락) → BLOCKER
3. 타입 안전성 (any, strict 위반) → SUGGESTION (의도 명확하면 NIT)
4. 에러 처리 (조용한 실패, 구조화 안 됨) → SUGGESTION
5. 스택 일관성 (Common Stack 패턴 위반) → SUGGESTION 또는 BLOCKER
6. PR 본문 누락 → SUGGESTION
7. 성능 (N+1, 불필요 re-render, 큰 번들) → SUGGESTION
8. 스타일/일관성 → NIT
`;

// 통합 SKILL_CONTEXT (호환성 alias — 기존 코드와 외부 참조용)
const SKILL_CONTEXT = OPERATING_PRINCIPLES + "\n" + COMMON_STACK_PATTERNS;
const SKILL_REVIEW_CRITERIA = REVIEW_PRIORITY;

// D. AGENT_IDENTITY_BY_TIER delegated to external-signals.js (PR-G30/G32)
// AGENT_IDENTITY_BY_TIER is now imported from extSignals above
// COLORS is also delegated to external-signals.js

// ============================================================================
// ============================================================================
// PERSONALIZATION LAYER (extracted to bin/personalization.js, PR-G30)
// ============================================================================

// Delegation functions — forward to personalization module
const readTier = personalization.readTier;
const readMode = personalization.readMode;
const loadPersonalization = personalization.loadPersonalization;
const savePersonalization = personalization.savePersonalization;
const updatePersonalizationFromReview = personalization.updatePersonalizationFromReview;
const recordFeedback = personalization.recordFeedback;
const personalizationContext = personalization.personalizationContext;


// NOTE: detectLiveSources, liveSourceContext, buildIdentity have been moved to
// bin/external-signals.js and are delegated above via const assignments (PR-G30/G32).

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// When a caller wants stdout reserved for machine-readable output (--json),
// all ANSI banner / info / success / error lines must go to stderr instead.
// Set with setLogChannel("stderr") for the duration of a command.
let LOG_CHANNEL = "stdout"; // "stdout" | "stderr"
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

function logSection(title) {
  log(`\n${COLORS.bold}${title}${COLORS.reset}`);
  log("─".repeat(Math.min(title.length, 40)));
}

function logSuccess(msg) {
  log(`${COLORS.green}✓${COLORS.reset} ${msg}`);
}

function logError(msg) {
  log(`${COLORS.red}✗${COLORS.reset} ${msg}`);
}

function logWarn(msg) {
  log(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`);
}

function logInfo(msg) {
  log(`${COLORS.blue}ℹ${COLORS.reset} ${msg}`);
}

function logDim(msg) {
  log(`${COLORS.gray}${msg}${COLORS.reset}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Detect the repository's default branch dynamically. Order of preference:
//   1. `git symbolic-ref refs/remotes/origin/HEAD` (authoritative — what origin says is default)
//   2. Presence of `origin/main`, `origin/master`, `origin/develop`
//   3. Fallback: "main"
// Returns just the short name (e.g. "master"), never the `origin/` prefix.
function detectDefaultBranch(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd,
    }).trim();
    // Form: "refs/remotes/origin/<branch>"
    const m = ref.match(/refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  } catch {
    // symbolic-ref may not be set on shallow clones — fall through
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
  // Pricing from constants.js — single source of truth for all model rates.
  const rates = C.PRICING;

  // Prefix-based fallback so new minor model versions still get sane estimates
  // rather than silently defaulting to sonnet rates.
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

// ============================================================================
// API CALL FUNCTIONS
// ============================================================================

function _anthropicOnce(prompt, systemPrompt, model) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      reject(new Error("ANTHROPIC_API_KEY environment variable not set"));
      return;
    }

    const body = JSON.stringify({
      model,
      max_tokens: C.LIMITS.maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const options = {
      hostname: CONFIG.providers.anthropicBase,
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": C.ANTHROPIC_API_VERSION,
      },
    };

    const API_TIMEOUT_MS = C.TIMEOUTS.apiCall; // 2 minutes — LLM responses can be slow on large diffs

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          const err = new Error(
            `Anthropic API error ${res.statusCode}: ${data.slice(0, 300)}`
          );
          err.statusCode = res.statusCode;
          err.body = data;
          return reject(err);
        }
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.[0]?.text || "";
          resolve({
            text,
            usage: parsed.usage || { input_tokens: 0, output_tokens: 0 },
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    if (typeof req.setTimeout === "function") {
      req.setTimeout(API_TIMEOUT_MS, () => {
        req.destroy(new Error(`Anthropic API timeout after ${API_TIMEOUT_MS / 1000}s`));
      });
    }
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Tier-aware retry with rate-limit backoff (mirrors codex-main/claude-worker.js claude()).
// maxRetries is wired from CONFIG.tierLimits[tier].maxRetries by callers; defaults to 3.
async function callAnthropic(prompt, systemPrompt, model, opts = {}) {
  const maxRetries = Math.max(1, Math.min(6, opts.maxRetries || 3));
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await _anthropicOnce(prompt, systemPrompt, model);
    } catch (e) {
      lastErr = e;
      const body = (e.body || e.message || "").toLowerCase();
      const isRateLimit = body.includes("rate_limit") || body.includes("overloaded") || e.statusCode === 429 || e.statusCode === 529;
      if (attempt === maxRetries - 1) break;
      const waitMs = isRateLimit ? (attempt + 1) * C.RETRY_DELAYS.rateLimit : (attempt + 1) * C.RETRY_DELAYS.generic;
      logWarn(`Anthropic ${isRateLimit ? "rate limited" : "error"}, waiting ${waitMs / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

function _openaiOnce(prompt, systemPrompt, model) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      reject(new Error("OPENAI_API_KEY environment variable not set"));
      return;
    }

    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: C.LIMITS.maxTokens,
    });

    const options = {
      hostname: CONFIG.providers.openaiBase,
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };

    const API_TIMEOUT_MS = C.TIMEOUTS.apiCall;

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          const err = new Error(
            `OpenAI API error ${res.statusCode}: ${data.slice(0, 300)}`
          );
          err.statusCode = res.statusCode;
          err.body = data;
          return reject(err);
        }
        try {
          const parsed = JSON.parse(data);
          const text =
            parsed.choices?.[0]?.message?.content ||
            parsed.output_text ||
            "";
          resolve({
            text,
            usage: parsed.usage || { prompt_tokens: 0, completion_tokens: 0 },
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    if (typeof req.setTimeout === "function") {
      req.setTimeout(API_TIMEOUT_MS, () => {
        req.destroy(new Error(`OpenAI API timeout after ${API_TIMEOUT_MS / 1000}s`));
      });
    }
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function callOpenAI(prompt, systemPrompt, model) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await _openaiOnce(prompt, systemPrompt, model);
    } catch (e) {
      lastErr = e;
      const body = (e.body || e.message || "").toLowerCase();
      const isRateLimit = body.includes("rate_limit") || e.statusCode === 429;
      if (attempt === 2) break;
      const waitMs = isRateLimit ? (attempt + 1) * C.RETRY_DELAYS.rateLimit : (attempt + 1) * C.RETRY_DELAYS.generic;
      logWarn(`OpenAI ${isRateLimit ? "rate limited" : "error"}, waiting ${waitMs / 1000}s (attempt ${attempt + 1}/3)...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// NOTE: REVIEW LOGIC functions (normalizeVerdict, verdictLabel, normalizeSeverity,
// parseReviewResponse, formatCrossCheck, formatTerminalOutput) have been moved to
// bin/review-parser.js and are delegated above via const assignments (PR-G30/G32).


// NOTE: Duplicate function definitions for review parsing and external signals
// have been removed (PR-G32). They are now delegated to sub-modules:
// - bin/review-parser.js: normalizeVerdict, verdictLabel, normalizeSeverity,
//                         parseReviewResponse, formatCrossCheck, formatTerminalOutput
// - bin/external-signals.js: assessExternalSignals, formatSelfLoopWarning,
//                            formatPartialSignalHint, resolveVercelProject,
//                            and 20+ other functions

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

async function localReview(options = {}) {
  const callerSpecifiedModel = Object.prototype.hasOwnProperty.call(options, "model");
  const {
    diffSource = "staged",
    target = null,
    model: callerModel = CONFIG.defaultModel.claude,
    dryRun = false,
    outputFormat = "terminal",
    crossCheck = null, // null = tier 기본값 따름, true/false = 강제
  } = options;

  // Tier · agent · personalization · live-source 컨텍스트 결정
  const cwd = process.cwd();
  const tier = readTier();
  // Tier-aware model resolution (PR-G2). Caller-specified model wins;
  // otherwise pick the tier default (maker=Haiku / builder=Sonnet / cto=Opus)
  // with env overrides (CLAUDE_MODEL, CLAUDE_MODEL_<TIER>) applied.
  const model = callerSpecifiedModel ? callerModel : resolveModelForTier(tier);
  const mode = readMode();
  const agent = process.env.OPENAI_API_KEY ? "cowork+codex" : "cowork";
  const tierLimits = CONFIG.tierLimits[tier] || CONFIG.tierLimits.builder;
  const useCrossCheck = crossCheck !== null ? crossCheck : tierLimits.selfCrossReview;

  logSection("solo-cto-agent review");
  logInfo(`Mode: ${mode} | Agent: ${agent} | Tier: ${tier}`);
  logInfo(`Source: ${diffSource} changes`);
  logInfo(`Model: ${model}`);
  if (useCrossCheck) logInfo(`Self cross-review: ON (tier=${tier})`);

  // Resolve diff + base metadata
  let diffBase = null;
  let diffTarget = null;
  let diff;
  if (diffSource === "branch") {
    diffBase = target || detectDefaultBranch({ cwd });
    diff = getDiff("branch", diffBase, { cwd });
    logInfo(`Base: ${diffBase}`);
  } else if (diffSource === "file") {
    diffTarget = target;
    diff = getDiff("file", diffTarget, { cwd });
  } else {
    diff = getDiff("staged", null, { cwd });
  }
  if (!diff || diff.trim().length === 0) {
    logWarn("No changes found");
    return null;
  }

  logInfo(`Diff: ${diff.split("\n").length} lines`);

  // P0 Security: scan diff for secrets before sending to AI API
  const diffGuard = require("./diff-guard");
  const secretScan = diffGuard.scanDiff(diff);
  if (secretScan.hasSecrets) {
    const warning = diffGuard.formatWarning(secretScan.findings);
    logWarn(warning);
    if (options.redact) {
      diff = diffGuard.redactDiff(diff);
      logInfo("Secrets auto-redacted from diff");
    } else if (!options.force) {
      logError("Aborting: diff contains secrets. Use --redact to auto-redact or --force to send anyway.");
      return null;
    }
  } else if (secretScan.findings.length > 0) {
    logWarn(`${secretScan.findings.length} potential secret(s) detected (non-critical). Review with caution.`);
  }

  // Multi-chunk review — split large diffs by file boundary (diff --git),
  // group files into chunks that fit within maxChunkBytes, review each chunk
  // independently, then merge results. Falls back to truncation if a single
  // file exceeds the limit.
  const diffBytes = Buffer.byteLength(diff, "utf8");
  const maxBytes = CONFIG.diff.maxChunkBytes;
  let diffChunks = null; // null = single-pass (diff fits), array = multi-chunk
  if (diffBytes > maxBytes) {
    diffChunks = _splitDiffIntoChunks(diff, maxBytes);
    logWarn(`Diff is large (${(diffBytes / 1024).toFixed(0)}KB > ${(maxBytes / 1024).toFixed(0)}KB limit). Split into ${diffChunks.length} chunk${diffChunks.length === 1 ? "" : "s"} for review.`);
  }

  // Load context
  const skillContext = readSkillContext();
  const failureCatalog = readFailureCatalog();
  const personalCtx = personalizationContext();
  const liveCtx = liveSourceContext();
  const identity = buildIdentity(tier, agent);

  // T2 + T3 external signals — fetch in parallel, never block the review on
  // failure. Empty/error payloads just yield empty context sections.
  let groundTruth = null;
  let externalKnowledge = null;
  try {
    [groundTruth, externalKnowledge] = await Promise.all([
      fetchGroundTruth().catch((e) => { logWarn(`Ground truth fetch failed: ${e.message}`); return null; }),
      fetchExternalKnowledge().catch((e) => { logWarn(`External knowledge fetch failed: ${e.message}`); return null; }),
    ]);
    if (groundTruth && groundTruth.hasData) {
      const n = groundTruth.vercel && groundTruth.vercel.deployments ? groundTruth.vercel.deployments.length : 0;
      logInfo(`T3 ground truth: ${n} Vercel deployment${n === 1 ? "" : "s"} fetched`);
    }
    if (externalKnowledge && externalKnowledge.hasData) {
      const pc = externalKnowledge.packageCurrency;
      logInfo(`T2 external knowledge: scanned ${pc.scanned}/${pc.total} deps · major=${pc.summary.major} minor=${pc.summary.minor} deprecated=${pc.summary.deprecated}`);
    }
    // PR-F2 — honest diagnostics: env flag on but scan produced nothing.
    // This is the exact false-confidence case surfaced by sample projects
    // with external knowledge enabled (COWORK_EXTERNAL_KNOWLEDGE=1, no package.json
    // at repo root → silent no-op → "1/3 active" reading was a lie).
    if (process.env.COWORK_EXTERNAL_KNOWLEDGE === "1" && !(externalKnowledge && externalKnowledge.hasData)) {
      logWarn("T2 enabled (COWORK_EXTERNAL_KNOWLEDGE=1) but no package.json was scanned — signal not applied.");
    }
    if ((process.env.VERCEL_TOKEN || process.env.SUPABASE_ACCESS_TOKEN) && !(groundTruth && groundTruth.hasData)) {
      logWarn("T3 enabled (VERCEL_TOKEN/SUPABASE_ACCESS_TOKEN set) but no runtime data was fetched — signal not applied.");
    }
  } catch (e) {
    logWarn(`External-signal fetch failed: ${e.message} — review proceeds without T2/T3`);
  }
  const groundTruthCtx = formatGroundTruthContext(groundTruth);
  const externalKnowledgeCtx = formatExternalKnowledgeContext(externalKnowledge);

  const errorPatterns = failureCatalog.patterns
    ?.map((p) => `- ${p.pattern}: ${p.fix}`)
    .join("\n") || "No patterns loaded";

  // Build review prompt (Korean, codex-main parity + cowork enhancements)
  const systemPrompt = `${identity}

당신은 Claude, 팀의 시니어 코드 리뷰어다. 아래 diff를 리뷰한다.

${OPERATING_PRINCIPLES}
${COMMON_STACK_PATTERNS}
${REVIEW_PRIORITY}
${liveCtx}${groundTruthCtx}${externalKnowledgeCtx}${personalCtx}

## 심각도 분류
- ⛔ BLOCKER  — 머지/배포 차단. 치명 버그, 보안, 데이터 손실 위험.
- ⚠️ SUGGESTION — 강하게 권하는 개선. 에러 처리 누락, 성능, 구조.
- 💡 NIT — 취향 수준. 스타일, 일관성.

## 사용자 프로젝트의 기존 에러 패턴
${errorPatterns}

## 출력 형식 (이 포맷을 정확히 따른다)

[VERDICT] APPROVE | REQUEST_CHANGES | COMMENT

[ISSUES]
⛔ [path/to/file.ts:42]
  이슈 설명 한 줄.
  → 구체적 수정 방법.

⚠️ [path/to/file.ts:17]
  이슈 설명 한 줄.
  → 구체적 수정 방법.

💡 [path/to/file.ts:3]
  이슈 설명 한 줄.
  → 구체적 수정 방법.

[SUMMARY]
전체 평가 1~2문장. 수치는 [확정]/[추정]/[미검증] 태그 사용.

[NEXT ACTION]
- 수정할 항목 1
- 수정할 항목 2

## 규칙
- 한국어 존댓말 없이 간결하게. 기술 용어는 영어 그대로.
- "좋습니다", "훌륭합니다" 같은 칭찬 금지.
- BLOCKER가 0개면 REQUEST_CHANGES 쓰지 않는다. APPROVE 또는 COMMENT.
- BLOCKER가 1개라도 있으면 REQUEST_CHANGES.
- diff 범위 밖 파일은 언급하지 않는다.`;

  // Build user prompt — used for single-pass or as template for multi-chunk
  const _buildUserPrompt = (diffContent) => `## 프로젝트 컨텍스트 (SKILL.md)
${skillContext}

## 리뷰 대상 diff
\`\`\`diff
${diffContent}
\`\`\`

위 출력 형식 그대로 리뷰하라.`;

  const userPrompt = _buildUserPrompt(diff);

  if (dryRun) {
    log("\n[DRY RUN] Would call Anthropic API with:");
    log(`System prompt length: ${systemPrompt.length} chars`);
    log(`User prompt length: ${userPrompt.length} chars`);
    if (diffChunks) log(`Multi-chunk: ${diffChunks.length} chunks`);
    try {
      const signals = assessExternalSignals();
      const warning = formatSelfLoopWarning(signals);
      if (warning) log(warning);
      else {
        const hint = formatPartialSignalHint(signals);
        if (hint) log(hint);
      }
    } catch (_) { /* never block dry-run on signal inspection */ }
    return null;
  }

  let review, response, rawTexts;

  try {
    if (diffChunks && diffChunks.length > 1) {
      // Multi-chunk review: review each chunk independently, merge results
      logInfo(`Calling Anthropic API — ${diffChunks.length} chunks (maxRetries=${tierLimits.maxRetries})...`);
      const chunkResults = [];
      rawTexts = [];
      for (let i = 0; i < diffChunks.length; i++) {
        logInfo(`  Chunk ${i + 1}/${diffChunks.length} (${(Buffer.byteLength(diffChunks[i], "utf8") / 1024).toFixed(0)}KB)...`);
        const chunkPrompt = _buildUserPrompt(diffChunks[i]);
        const chunkResp = await callAnthropic(chunkPrompt, systemPrompt, model, { maxRetries: tierLimits.maxRetries });
        chunkResults.push(parseReviewResponse(chunkResp.text));
        rawTexts.push(chunkResp.text);
      }
      review = _mergeChunkReviews(chunkResults);
      response = { text: rawTexts.join("\n\n---\n\n"), usage: { input_tokens: 0, output_tokens: 0 } };
    } else {
      // Single-pass review (fits within limit or single-chunk fallback)
      logInfo(`Calling Anthropic API (maxRetries=${tierLimits.maxRetries})...`);
      response = await callAnthropic(userPrompt, systemPrompt, model, { maxRetries: tierLimits.maxRetries });
      review = parseReviewResponse(response.text);
    }

    // Estimate tokens
    const inputTokens = Math.ceil(
      (systemPrompt.length + userPrompt.length) / 4
    );
    const outputTokens = Math.ceil(response.text.length / 4);
    const totalCost = estimateCost(inputTokens, outputTokens, model);

    // Save review
    ensureDir(CONFIG.reviewsDir);
    const reviewFile = path.join(
      CONFIG.reviewsDir,
      `${timestamp()}.json`
    );

    const reviewData = {
      timestamp: new Date().toISOString(),
      mode,
      agent,
      tier,
      model,
      diffSource,
      diffBase,
      diffTarget,
      verdict: review.verdict,
      issueCount: review.issues.length,
      issues: review.issues,
      summary: review.summary,
      raw: response.text,
      tokens: {
        input: inputTokens,
        output: outputTokens,
      },
      cost: totalCost,
    };

    // Self cross-review (Cowork 단독 구성의 핵심 품질 게이트)
    if (useCrossCheck && agent === "cowork") {
      logInfo("Running self cross-review (devil's advocate pass)...");
      try {
        const cross = await selfCrossReview({
          diff,
          firstPass: review,
          firstPassRaw: response.text,
          systemPromptBase: identity,
          model,
          maxRetries: tierLimits.maxRetries,
        });
        reviewData.crossCheck = cross;
        // 합의 BLOCKER 가 있으면 verdict 강화
        if (cross.commonBlockers > 0 && reviewData.verdict !== "REQUEST_CHANGES") {
          reviewData.verdict = "REQUEST_CHANGES";
          reviewData.verdictUpgradedBy = "self-cross-review";
        }
        // 토큰/비용 합산
        reviewData.tokens.input += cross.tokens.input;
        reviewData.tokens.output += cross.tokens.output;
        reviewData.cost = (parseFloat(reviewData.cost) + parseFloat(cross.cost)).toFixed(4);
      } catch (err) {
        logWarn(`Self cross-review failed: ${err.message} — 1차 결과만 보고`);
        reviewData.crossCheckError = err.message;
      }
    }

    // Personalization 누적 (반복 핫스팟 추적)
    try {
      updatePersonalizationFromReview(review);
    } catch (_) { /* personalization 업데이트 실패는 리뷰 결과에 영향 없음 */ }

    // External-signal assessment — tells the user whether this review had any
    // non-self-loop backing (peer model / external knowledge / ground truth).
    // PR-F2: we pass the ACTUAL fetch outcome so "env set but scan empty" is
    // reported as signal NOT applied. Otherwise the activeCount becomes a
    // self-congratulation artifact.
    const externalSignals = assessExternalSignals({
      outcome: {
        t2Applied: !!(externalKnowledge && externalKnowledge.hasData),
        t3Applied: !!(groundTruth && groundTruth.hasData),
      },
    });
    reviewData.externalSignals = externalSignals;
    // T3 payload — raw fetched data for audit / downstream use.
    if (groundTruth) reviewData.groundTruth = groundTruth;
    // T2 payload — scanned package currency snapshot.
    if (externalKnowledge) reviewData.externalKnowledge = externalKnowledge;

    fs.writeFileSync(reviewFile, JSON.stringify(reviewData, null, 2));

    // Output based on format
    if (outputFormat === "json") {
      // B5: JSON body always goes to stdout verbatim regardless of LOG_CHANNEL
      // (banner / info / success lines went to stderr via the log channel switch
      // set by the caller). This keeps `review --json | jq` valid.
      process.stdout.write(JSON.stringify(reviewData, null, 2) + "\n");
    } else if (outputFormat === "markdown") {
      log(response.text);
      if (externalSignals.isSelfLoop) {
        log("\n> ⚠️ **SELF-LOOP NOTICE** — no external signals (peer model / external knowledge / ground truth) were active for this review. Run `dual-review` or set `VERCEL_TOKEN` / `SUPABASE_ACCESS_TOKEN` / `COWORK_EXTERNAL_KNOWLEDGE=1` to close the loop.\n");
      }
    } else {
      // terminal format
      const costInfo = {
        inputTokens: (inputTokens / 1000).toFixed(1),
        outputTokens: (outputTokens / 1000).toFixed(1),
        total: totalCost,
        savedPath: reviewFile,
      };
      const output = formatTerminalOutput(review, { diffSource }, costInfo);
      log(output);
      if (reviewData.crossCheck) {
        log(formatCrossCheck(reviewData.crossCheck));
      }
      // Self-loop warning (if applicable) — or hint about partial signals.
      const warning = formatSelfLoopWarning(externalSignals);
      if (warning) log(warning);
      else {
        const hint = formatPartialSignalHint(externalSignals);
        if (hint) log(hint);
      }
    }

    logSuccess(`Review saved to ${reviewFile}`);

    // PR-G8-review-emit — fire a notify envelope so telegram/slack/discord
    // channels receive the verdict. Non-blocking: a notify failure must
    // never abort the review itself.
    try {
      const notifyMod = require("./notify");
      await notifyMod.notifyReviewResult(reviewData).catch(() => {});
    } catch (_) {
      // notify module is optional at runtime
    }

    return reviewData;
  } catch (err) {
    logError(`API call failed: ${err.message}`);
    throw err;
  }
}

/**
 * Self Cross-Review (Cowork 단독의 핵심 품질 게이트)
 *
 * 1차 리뷰의 결과를 두 번째 패스 (devil's advocate 페르소나) 가 검증한다.
 * - 1차가 놓친 BLOCKER 가 있는가?
 * - 1차가 과대 평가한 항목이 있는가?
 * - 1차의 false positive / false negative 의심 지점은?
 *
 * 두 패스의 합의·불일치를 정리해 단일 시점 의견의 한계를 보완.
 * Cowork+Codex 가 없을 때 가장 큰 가치를 만든다.
 */
async function selfCrossReview({ diff, firstPass, firstPassRaw, systemPromptBase, model, maxRetries }) {
  const advocateSystem = `${systemPromptBase}

당신은 동일 diff 의 1차 리뷰 결과를 검증하는 **devil's advocate 리뷰어** 다.
1차 리뷰는 자기 자신의 한 차례 응답이다. 자기 검증의 한계를 인정하고,
의도적으로 다른 시각에서 본다. 동의를 위한 동의는 금지.

검증 항목:
1. 1차가 놓친 BLOCKER (보안, 데이터 손실, 명백한 버그) 가 있는가?
2. 1차가 BLOCKER 로 본 항목 중 사실 SUGGESTION 이거나 false positive 인 것이 있는가?
3. 1차가 SUGGESTION/NIT 로 묶었지만 실제로는 BLOCKER 인 항목은?
4. 1차 summary 의 [확정]/[추정] 태그가 적절한가? (라이브 소스 없이 [확정] 단정 짓진 않았는지)

## 출력 형식 (반드시 이대로)

[CROSS_VERDICT] AGREE | DISAGREE | PARTIAL

[ADD]                  ← 1차가 놓친 항목 (없으면 "없음")
⛔/⚠️/💡 [path:line]
  이슈.
  → 수정.

[REMOVE]               ← 1차의 false positive (없으면 "없음")
[path:line]
  사유.

[UPGRADE]              ← 심각도 상향 (없으면 "없음")
[path:line] SUGGESTION→BLOCKER
  사유.

[DOWNGRADE]            ← 심각도 하향 (없으면 "없음")
[path:line] BLOCKER→SUGGESTION
  사유.

[META_REVIEW]
1~2문장. 1차 리뷰 자체의 품질 평가.

## 규칙
- 한국어, 칭찬 금지, 간결.
- 1차와 동일 항목 반복 금지. 1차에 추가/수정할 게 없으면 그냥 "없음".
- 자기 검증의 한계 명시: 같은 모델·같은 컨텍스트의 한계가 있다.`;

  const advocateUser = `## 1차 리뷰 결과 (검증 대상)

VERDICT: ${firstPass.verdict}
ISSUES (${firstPass.issues.length}개):
${firstPass.issues.map((i) => `  ${i.severity === "BLOCKER" ? "⛔" : i.severity === "SUGGESTION" ? "⚠️" : "💡"} [${i.location}] ${i.issue}`).join("\n")}
SUMMARY: ${firstPass.summary}

## 1차 리뷰 원문
${firstPassRaw}

## 검증 대상 diff
\`\`\`diff
${diff}
\`\`\`

위 출력 형식 그대로, devil's advocate 시각에서 검증하라.`;

  const response = await callAnthropic(advocateUser, advocateSystem, model, { maxRetries: maxRetries || 3 });
  const text = response.text;

  // Parse cross-check response
  const crossVerdict = (text.match(/\[CROSS_VERDICT\][:\s]*([A-Z]+)/i) || [])[1] || "AGREE";

  // ADD section: extract issue patterns
  const addBlock = (text.match(/\[ADD\]([\s\S]*?)(?=\[REMOVE\]|\[UPGRADE\]|\[DOWNGRADE\]|\[META_REVIEW\]|$)/i) || [])[1] || "";
  const addedIssues = [];
  const addPattern = /(⛔|⚠️|💡)\s*\[([^\]]+)\]\s*\n\s*([^\n]+)\n\s*(?:→|->)\s*([^\n]+)/g;
  let m;
  while ((m = addPattern.exec(addBlock)) !== null) {
    addedIssues.push({
      severity: m[1] === "⛔" ? "BLOCKER" : m[1] === "⚠️" ? "SUGGESTION" : "NIT",
      location: m[2].trim(),
      issue: m[3].trim(),
      suggestion: m[4].trim(),
    });
  }

  // REMOVE section: false positives
  const removeBlock = (text.match(/\[REMOVE\]([\s\S]*?)(?=\[UPGRADE\]|\[DOWNGRADE\]|\[META_REVIEW\]|$)/i) || [])[1] || "";
  const removedItems = [];
  const removePattern = /\[([^\]]+)\]\s*\n\s*([^\n[]+)/g;
  while ((m = removePattern.exec(removeBlock)) !== null) {
    if (m[1].trim().toLowerCase() === "없음") continue;
    removedItems.push({ location: m[1].trim(), reason: m[2].trim() });
  }

  const upgradeBlock = (text.match(/\[UPGRADE\]([\s\S]*?)(?=\[DOWNGRADE\]|\[META_REVIEW\]|$)/i) || [])[1] || "";
  const downgradeBlock = (text.match(/\[DOWNGRADE\]([\s\S]*?)(?=\[META_REVIEW\]|$)/i) || [])[1] || "";
  const metaReview = ((text.match(/\[META_REVIEW\]([\s\S]*?)$/i) || [])[1] || "").trim();

  const commonBlockers = addedIssues.filter((i) => i.severity === "BLOCKER").length
    + firstPass.issues.filter((i) => i.severity === "BLOCKER" && !removedItems.find((r) => r.location === i.location)).length;

  // Token cost
  const inputTokens = Math.ceil((advocateSystem.length + advocateUser.length) / 4);
  const outputTokens = Math.ceil(text.length / 4);
  const cost = estimateCost(inputTokens, outputTokens, model);

  return {
    crossVerdict,
    addedIssues,
    removedItems,
    upgradeBlock: upgradeBlock.trim(),
    downgradeBlock: downgradeBlock.trim(),
    metaReview,
    commonBlockers,
    raw: text,
    tokens: { input: inputTokens, output: outputTokens },
    cost,
  };
}

async function knowledgeCapture(options = {}) {
  const { source = "session", input = null, projectTag = null } = options;

  logSection("solo-cto-agent knowledge-capture");
  logInfo(`Source: ${source}`);
  if (projectTag) logInfo(`Project: ${projectTag}`);

  let content = "";

  if (source === "session") {
    logInfo("Scanning recent commits (24h)...");
    content = getRecentCommits(24);
    if (!content) {
      logWarn("No recent commits found");
      return null;
    }
  } else if (source === "file") {
    if (!input) {
      logError("--file requires --input <path>");
      return null;
    }
    logInfo(`Reading from ${input}...`);
    try {
      content = fs.readFileSync(input, "utf8");
    } catch (err) {
      logError(`Failed to read file: ${err.message}`);
      return null;
    }
  } else if (source === "manual") {
    if (!input) {
      logError("manual source requires --input <text>");
      return null;
    }
    content = input;
  }

  const systemPrompt = `${AGENT_IDENTITY}

세션 데이터에서 재사용 가능한 지식을 추출한다.
나중에 같은 실수를 반복하지 않기 위한 자료다. 추측 금지, 실제 발생한 것만 적는다.

## 출력 형식

[TITLE]: 한 줄 주제

[DECISIONS]:
- {결정}: {근거}
- {결정}: {근거}

[ERROR_PATTERNS]:
- {에러 패턴}: {수정 방법}
- {에러 패턴}: {수정 방법}

[PREFERENCES]:
- {유저 선호 / 코딩 스타일 / 워크플로우 규칙}

[OPEN_THREADS]:
- {미해결 항목}

## 규칙
- 한국어. 간결하게. 일반론 금지, 이 세션에서 실제로 나온 것만.
- 수치는 [확정] / [추정] / [미검증] 태그.
- 동일한 항목 반복 금지.`;

  const userPrompt = `## 분석 대상

${content}`;

  logInfo("Calling Anthropic API...");

  try {
    const response = await callAnthropic(userPrompt, systemPrompt, CONFIG.defaultModel.claude);

    // Parse response
    const titleMatch = response.text.match(/\[TITLE\]:\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled";

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50);

    // Build markdown
    let markdown = `# ${title} — Knowledge Article\n`;
    markdown += `> Created: ${new Date().toISOString().split("T")[0]}\n`;
    if (projectTag) markdown += `> Project: ${projectTag}\n`;
    markdown += `> Source: ${source}\n\n`;

    const sections = {
      DECISIONS: response.text.match(/\[DECISIONS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
      ERROR_PATTERNS: response.text.match(/\[ERROR_PATTERNS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
      PREFERENCES: response.text.match(/\[PREFERENCES\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
      OPEN_THREADS: response.text.match(/\[OPEN_THREADS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
    };

    if (sections.DECISIONS.trim()) {
      markdown += `## Decisions\n${sections.DECISIONS.trim()}\n\n`;
    }
    if (sections.ERROR_PATTERNS.trim()) {
      markdown += `## Error Patterns\n${sections.ERROR_PATTERNS.trim()}\n\n`;
    }
    if (sections.PREFERENCES.trim()) {
      markdown += `## Preferences\n${sections.PREFERENCES.trim()}\n\n`;
    }
    if (sections.OPEN_THREADS.trim()) {
      markdown += `## Open Threads\n${sections.OPEN_THREADS.trim()}\n\n`;
    }

    // Save knowledge article
    ensureDir(CONFIG.knowledgeDir);
    const articleFile = path.join(
      CONFIG.knowledgeDir,
      `${new Date().toISOString().split("T")[0]}-${slug}.md`
    );

    fs.writeFileSync(articleFile, markdown);
    logSuccess(`Knowledge article saved to ${articleFile}`);

    // Update index
    const indexFile = path.join(CONFIG.knowledgeDir, "index.md");
    let indexContent = "";

    if (fs.existsSync(indexFile)) {
      indexContent = fs.readFileSync(indexFile, "utf8");
    } else {
      indexContent = "# Knowledge Index\n\n";
    }

    const indexEntry = `- [${title}](./${path.basename(articleFile)}) — ${projectTag || "general"}`;
    if (!indexContent.includes(indexEntry)) {
      indexContent += indexEntry + "\n";
      fs.writeFileSync(indexFile, indexContent);
      logSuccess(`Updated knowledge index`);
    }

    // Merge patterns into failure catalog
    const patterns = response.text
      .match(/\[ERROR_PATTERNS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "";
    if (patterns.trim()) {
      const catalogPath = path.join(CONFIG.skillDir, "failure-catalog.json");
      let catalog = { patterns: [] };

      if (fs.existsSync(catalogPath)) {
        try {
          catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
        } catch {
          catalog = { patterns: [] };
        }
      }

      const newPatterns = patterns
        .split("\n")
        .filter((p) => p.trim())
        .map((p) => {
          const match = p.match(/^\s*-\s*([^:]+):\s*(.+)$/);
          return match ? { pattern: match[1].trim(), fix: match[2].trim() } : null;
        })
        .filter((p) => p !== null);

      catalog.patterns = [...catalog.patterns, ...newPatterns];
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
      logSuccess(`Updated failure catalog with ${newPatterns.length} patterns`);
    }

    return { articleFile, indexFile };
  } catch (err) {
    logError(`API call failed: ${err.message}`);
    throw err;
  }
}

async function dualReview(options = {}) {
  const callerSpecifiedClaudeModel = Object.prototype.hasOwnProperty.call(options, "claudeModel");
  const {
    diffSource = "staged",
    target = null,
    claudeModel: callerClaudeModel = CONFIG.defaultModel.claude,
    codexModel = CONFIG.defaultModel.codex,
  } = options;

  logSection("solo-cto-agent dual-review");
  logInfo(`Mode: dual (Claude + OpenAI)`);
  logInfo(`Source: ${diffSource} changes`);

  const cwd = process.cwd();
  // Tier-aware Claude model resolution (PR-G2). Codex side unchanged.
  const _dualTier = (typeof readTier === "function") ? readTier() : "builder";
  const claudeModel = callerSpecifiedClaudeModel ? callerClaudeModel : resolveModelForTier(_dualTier);
  let diffBase = null;
  let diffTarget = null;
  let diff;
  if (diffSource === "branch") {
    diffBase = target || detectDefaultBranch({ cwd });
    diff = getDiff("branch", diffBase, { cwd });
    logInfo(`Base: ${diffBase}`);
  } else if (diffSource === "file") {
    diffTarget = target;
    diff = getDiff("file", diffTarget, { cwd });
  } else {
    diff = getDiff("staged", null, { cwd });
  }
  if (!diff || diff.trim().length === 0) {
    logWarn("No changes found");
    return null;
  }

  logInfo(`Diff: ${diff.split("\n").length} lines`);

  const skillContext = readSkillContext();
  const failureCatalog = readFailureCatalog();
  const errorPatterns = failureCatalog.patterns
    ?.map((p) => `- ${p.pattern}: ${p.fix}`)
    .join("\n") || "No patterns loaded";

  // T2 + T3 external signals — same parallel fetch as localReview. Both
  // review passes (Claude + OpenAI) get the same grounded context for a
  // consistent cross-check.
  let groundTruth = null;
  let externalKnowledge = null;
  try {
    [groundTruth, externalKnowledge] = await Promise.all([
      fetchGroundTruth().catch((e) => { logWarn(`Ground truth fetch failed: ${e.message}`); return null; }),
      fetchExternalKnowledge().catch((e) => { logWarn(`External knowledge fetch failed: ${e.message}`); return null; }),
    ]);
    if (groundTruth && groundTruth.hasData) {
      const n = groundTruth.vercel && groundTruth.vercel.deployments ? groundTruth.vercel.deployments.length : 0;
      logInfo(`T3 ground truth: ${n} Vercel deployment${n === 1 ? "" : "s"} fetched`);
    }
    if (externalKnowledge && externalKnowledge.hasData) {
      const pc = externalKnowledge.packageCurrency;
      logInfo(`T2 external knowledge: scanned ${pc.scanned}/${pc.total} deps · major=${pc.summary.major} minor=${pc.summary.minor} deprecated=${pc.summary.deprecated}`);
    }
    // PR-F2 — same honest-diagnostics check as localReview.
    if (process.env.COWORK_EXTERNAL_KNOWLEDGE === "1" && !(externalKnowledge && externalKnowledge.hasData)) {
      logWarn("T2 enabled (COWORK_EXTERNAL_KNOWLEDGE=1) but no package.json was scanned — signal not applied.");
    }
    if ((process.env.VERCEL_TOKEN || process.env.SUPABASE_ACCESS_TOKEN) && !(groundTruth && groundTruth.hasData)) {
      logWarn("T3 enabled (VERCEL_TOKEN/SUPABASE_ACCESS_TOKEN set) but no runtime data was fetched — signal not applied.");
    }
  } catch (e) {
    logWarn(`External-signal fetch failed: ${e.message} — dual-review proceeds without T2/T3`);
  }
  const groundTruthCtx = formatGroundTruthContext(groundTruth);
  const externalKnowledgeCtx = formatExternalKnowledgeContext(externalKnowledge);

  // Dual-review prompt (identical spec for Claude + OpenAI — codex-main parity)
  const systemPrompt = `${AGENT_IDENTITY}

팀의 시니어 코드 리뷰어다. 아래 diff를 리뷰한다.

${SKILL_CONTEXT}
${SKILL_REVIEW_CRITERIA}
${groundTruthCtx}${externalKnowledgeCtx}
## 심각도
- ⛔ BLOCKER  머지 차단 (치명 버그, 보안, 데이터 손실)
- ⚠️ SUGGESTION 강한 개선 권고
- 💡 NIT 취향 수준

## 기존 에러 패턴
${errorPatterns}

## 출력 형식
[VERDICT] APPROVE | REQUEST_CHANGES | COMMENT

[ISSUES]
⛔ [path:line]
  설명.
  → 수정.

⚠️ [path:line]
  설명.
  → 수정.

💡 [path:line]
  설명.
  → 수정.

[SUMMARY]
1~2문장. 수치는 [확정]/[추정]/[미검증].

[NEXT ACTION]
- 항목

## 규칙
- 한국어. 칭찬 금지. 간결하게.
- BLOCKER 1개 이상이면 REQUEST_CHANGES.
- diff 밖 파일 언급 금지.`;

  const userPrompt = `## 프로젝트 컨텍스트
${skillContext}

## diff
\`\`\`diff
${diff}
\`\`\``;

  logInfo("Calling Claude...");
  let claudeResponse, codexResponse;

  try {
    claudeResponse = await callAnthropic(userPrompt, systemPrompt, claudeModel);
    logSuccess("Claude review complete");
  } catch (err) {
    logError(`Claude API failed: ${err.message}`);
    claudeResponse = { text: "[FAILURE] Claude API error", usage: {} };
  }

  logInfo("Calling OpenAI...");
  try {
    codexResponse = await callOpenAI(userPrompt, systemPrompt, codexModel);
    logSuccess("OpenAI review complete");
  } catch (err) {
    logError(`OpenAI API failed: ${err.message}`);
    codexResponse = { text: "[FAILURE] OpenAI API error", usage: {} };
  }

  // Parse both
  const claudeReview = parseReviewResponse(claudeResponse.text);
  const codexReview = parseReviewResponse(codexResponse.text);

  // Cross-compare
  const comparison = {
    agreement: claudeReview.verdict === codexReview.verdict,
    verdictMatch: claudeReview.verdict === codexReview.verdict,
    claudeVerdict: claudeReview.verdict,
    codexVerdict: codexReview.verdict,
    claudeIssueCount: claudeReview.issues.length,
    codexIssueCount: codexReview.issues.length,
    commonIssues: [],
    claudeOnlyIssues: [],
    codexOnlyIssues: [],
  };

  // Simple string matching for common issues
  for (const claudeIssue of claudeReview.issues) {
    const found = codexReview.issues.find((c) =>
      c.location === claudeIssue.location
    );
    if (found) {
      comparison.commonIssues.push(claudeIssue);
    } else {
      comparison.claudeOnlyIssues.push(claudeIssue);
    }
  }

  for (const codexIssue of codexReview.issues) {
    if (!comparison.commonIssues.find((c) => c.location === codexIssue.location)) {
      comparison.codexOnlyIssues.push(codexIssue);
    }
  }

  // Final verdict
  const finalVerdict =
    claudeReview.verdict === "CHANGES_REQUESTED" ||
    codexReview.verdict === "CHANGES_REQUESTED"
      ? "CHANGES_REQUESTED"
      : claudeReview.verdict === "COMMENT" || codexReview.verdict === "COMMENT"
      ? "COMMENT"
      : "APPROVE";

  // Save dual review
  ensureDir(CONFIG.reviewsDir);
  const reviewFile = path.join(
    CONFIG.reviewsDir,
    `${timestamp()}-dual.json`
  );

  const dualReviewData = {
    timestamp: new Date().toISOString(),
    mode: "dual",
    models: { claude: claudeModel, openai: codexModel },
    diffSource,
    diffBase,
    diffTarget,
    finalVerdict,
    comparison,
    claudeReview,
    codexReview,
    raw: {
      claude: claudeResponse.text,
      openai: codexResponse.text,
    },
  };

  // External-signal assessment. dual-review always has T1 (peer model) active
  // (both API keys were required to get here), so T1 is forced-applied.
  // PR-F2 — pass outcome so T2/T3 reflect actual fetch success, not just env.
  const externalSignals = assessExternalSignals({
    outcome: {
      t1Applied: true,
      t2Applied: !!(externalKnowledge && externalKnowledge.hasData),
      t3Applied: !!(groundTruth && groundTruth.hasData),
    },
  });
  dualReviewData.externalSignals = externalSignals;
  if (groundTruth) dualReviewData.groundTruth = groundTruth;
  if (externalKnowledge) dualReviewData.externalKnowledge = externalKnowledge;

  fs.writeFileSync(reviewFile, JSON.stringify(dualReviewData, null, 2));
  logSuccess(`Dual review saved to ${reviewFile}`);

  // Terminal output
  log("\n");
  log(`${COLORS.bold}┌─ CROSS-REVIEW SUMMARY ─┐${COLORS.reset}`);
  log(
    `${COLORS.bold}│${COLORS.reset} Final Verdict: ${
      finalVerdict === "APPROVE"
        ? COLORS.green
        : finalVerdict === "CHANGES_REQUESTED"
        ? COLORS.red
        : COLORS.blue
    }${finalVerdict}${COLORS.reset}`
  );
  log(
    `${COLORS.bold}│${COLORS.reset} Agreement: ${
      comparison.verdictMatch
        ? (finalVerdict === "APPROVE"
            ? COLORS.green + "YES ✅"
            : COLORS.red + "YES ❌ (both negative)")
        : COLORS.red + "NO ⚠️"
    }${COLORS.reset}`
  );
  log(
    `${COLORS.bold}│${COLORS.reset} Claude Issues: ${claudeReview.issues.length}`
  );
  log(
    `${COLORS.bold}│${COLORS.reset} OpenAI Issues: ${codexReview.issues.length}`
  );
  log(`${COLORS.bold}│${COLORS.reset} Common Issues: ${comparison.commonIssues.length}`);
  log(`${COLORS.bold}└────────────────────────┘${COLORS.reset}`);

  // T1 is active here by definition (both keys present); hint about T2/T3 gaps.
  const hint = formatPartialSignalHint(externalSignals);
  if (hint) log(hint);

  // PR-G8-review-emit / PR-G11 — dualReview's schema differs from localReview
  // (finalVerdict / comparison / per-reviewer issues). Adapt to the shape
  // notifyReviewResult expects so the event taxonomy stays consistent.
  // Verdict mismatch between Claude and OpenAI → "review.dual-disagree";
  // otherwise use aggregated blockers → "review.blocker".
  //
  // PR-G11 hardening: the prior adapter used `!comparison.verdictMatch`,
  // which silently collapsed three distinct states (agree / disagree /
  // unknown) into a binary. If either verdict was undefined (parse failure)
  // the expression `undefined === undefined` returned true and pretended
  // the reviewers agreed; if verdictMatch itself was undefined it flipped
  // to true and pretended they disagreed. Now we route explicitly on the
  // tri-state so partial/malformed comparisons degrade to a conservative
  // DISAGREE sentinel AND log a warning instead of masquerading as signal.
  try {
    const notifyMod = require("./notify");
    const cv = claudeReview && claudeReview.verdict;
    const xv = codexReview && codexReview.verdict;
    let crossVerdict;
    if (!cv || !xv) {
      // One side failed to parse — treat as disagree (conservative: never
      // claim agreement when we don't know).
      crossVerdict = "DISAGREE";
      // eslint-disable-next-line no-console
      console.warn(
        `[notify] dual-review comparison has missing verdict (claude=${cv || "∅"} openai=${xv || "∅"}) — routing as DISAGREE`
      );
    } else if (comparison && comparison.verdictMatch === true) {
      crossVerdict = finalVerdict;
    } else if (comparison && comparison.verdictMatch === false) {
      crossVerdict = "DISAGREE";
    } else {
      // verdictMatch was undefined despite both verdicts present — compute
      // directly from the verdicts rather than trust a missing field.
      crossVerdict = cv === xv ? finalVerdict : "DISAGREE";
    }
    const mergedIssues = [
      ...((claudeReview && claudeReview.issues) || []),
      ...((codexReview && codexReview.issues) || []),
    ];
    const isNegativeAgreement = crossVerdict !== "DISAGREE" && finalVerdict !== "APPROVE";
    const agreementLabel = crossVerdict === "DISAGREE"
      ? "NO ⚠️"
      : (isNegativeAgreement ? "YES ❌" : "YES ✅");
    await notifyMod
      .notifyReviewResult({
        verdict: finalVerdict,
        issues: mergedIssues,
        summary: `dual-review • claude=${cv || "∅"} openai=${xv || "∅"} • agreement=${agreementLabel}`,
        crossCheck: {
          // notifyReviewResult treats any crossVerdict !== verdict as
          // "dual-disagree". The explicit DISAGREE sentinel above makes
          // the event routing unambiguous even when finalVerdict is null.
          crossVerdict,
        },
        tier: "dual",
        agent: "dual",
        diffSource,
        cost: null,
      })
      .catch(() => {});
  } catch (_) {
    // notify module is optional at runtime
  }

  return dualReviewData;
}

// ============================================================================
// AUTO-SYNC — fetch orchestrator data from GitHub at session start (Phase 3)
// ============================================================================

function _ghApiFetch(pathname, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: pathname,
      method: "GET",
      headers: {
        "User-Agent": "solo-cto-agent",
        "Accept": "application/vnd.github+json",
      },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON from ${pathname}`)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("GitHub API timeout")));
    req.end();
  });
}

async function _fetchRepoFile(ownerRepo, filePath, token) {
  const data = await _ghApiFetch(`/repos/${ownerRepo}/contents/${filePath}`, token);
  return Buffer.from(data.content || "", "base64").toString("utf8").replace(/^\uFEFF/, "");
}

async function autoSync(options = {}) {
  const {
    orchestratorRepo = null,
    verbose = false,
  } = options;

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.ORCHESTRATOR_PAT;
  if (!token) {
    logWarn("auto_sync: No GitHub token found (GITHUB_TOKEN / GH_TOKEN / ORCHESTRATOR_PAT). Skipping.");
    return null;
  }

  // Detect orchestrator repo from git remote or user config
  let orchRepo = orchestratorRepo;
  if (!orchRepo) {
    try {
      const url = execSync("git config --get remote.origin.url", { encoding: "utf8" }).trim();
      const owner = url.replace("git@github.com:", "").replace("https://github.com/", "").replace(".git", "").split("/")[0];
      if (owner) orchRepo = `${owner}/dual-agent-review-orchestrator`;
    } catch { /* ignore */ }
  }
  if (!orchRepo) {
    logWarn("auto_sync: Could not determine orchestrator repo. Use --repo owner/repo.");
    return null;
  }

  logSection("Auto-Sync from Orchestrator");
  logInfo(`Source: ${orchRepo}`);

  const syncDir = path.join(CONFIG.sessionsDir, "sync");
  ensureDir(syncDir);

  const filesToSync = [
    { remote: "ops/orchestrator/agent-scores.json", local: "agent-scores.json" },
    { remote: "ops/orchestrator/error-patterns.md", local: "error-patterns.md" },
    { remote: "ops/orchestrator/decision-log.json", local: "decision-log.json" },
  ];

  const results = { synced: [], failed: [], skipped: [] };

  for (const file of filesToSync) {
    try {
      const content = await _fetchRepoFile(orchRepo, file.remote, token);
      const localPath = path.join(syncDir, file.local);

      // Skip if content unchanged
      if (fs.existsSync(localPath)) {
        const existing = fs.readFileSync(localPath, "utf8");
        if (existing === content) {
          results.skipped.push(file.local);
          if (verbose) logInfo(`  ${file.local}: unchanged`);
          continue;
        }
      }

      fs.writeFileSync(localPath, content);
      results.synced.push(file.local);
      logSuccess(`  ${file.local}: synced`);
    } catch (err) {
      results.failed.push(file.local);
      if (verbose) logWarn(`  ${file.local}: ${err.message}`);
    }
  }

  // Write sync metadata
  const meta = {
    timestamp: new Date().toISOString(),
    orchestrator: orchRepo,
    synced: results.synced,
    failed: results.failed,
    skipped: results.skipped,
  };
  fs.writeFileSync(path.join(syncDir, "_sync-meta.json"), JSON.stringify(meta, null, 2));

  const summary = [
    results.synced.length ? `${results.synced.length} synced` : null,
    results.skipped.length ? `${results.skipped.length} unchanged` : null,
    results.failed.length ? `${results.failed.length} failed` : null,
  ].filter(Boolean).join(", ");
  logInfo(`Auto-sync complete: ${summary}`);

  return results;
}

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

  // Update latest.json symlink/copy
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

function detectMode() {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasAnthropic && hasOpenAI) return "dual";
  if (hasAnthropic) return "solo";
  return "none";
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  try {
    if (command === "local-review") {
      const diffSource = args.includes("--branch")
        ? "branch"
        : args.includes("--file")
        ? "file"
        : "staged";

      const fileIdx = args.indexOf("--file");
      const targetIdx = args.indexOf("--target");
      let target = null;
      if (diffSource === "branch") {
        target = targetIdx >= 0 ? args[targetIdx + 1] : null;
      } else if (diffSource === "file") {
        target = fileIdx >= 0 ? args[fileIdx + 1] : null;
      }

      const dryRun = args.includes("--dry-run");
      const outputFormat = args.includes("--json")
        ? "json"
        : args.includes("--markdown")
        ? "markdown"
        : "terminal";
      if (outputFormat === "json") setLogChannel("stderr");

      // Self cross-review override flags
      let crossCheck = null;
      if (args.includes("--cross-check")) crossCheck = true;
      if (args.includes("--no-cross-check")) crossCheck = false;

      await localReview({
        diffSource,
        target,
        dryRun,
        outputFormat,
        crossCheck,
      });
      if (outputFormat === "json") setLogChannel("stdout");
    } else if (command === "knowledge-capture") {
      const source = args.includes("--file")
        ? "file"
        : args.includes("--manual")
        ? "manual"
        : "session";

      const fileIdx = args.indexOf("--file");
      const inputIdx = args.indexOf("--input");
      const projectIdx = args.indexOf("--project");

      const input =
        fileIdx >= 0
          ? args[fileIdx + 1]
          : inputIdx >= 0
          ? args[inputIdx + 1]
          : null;
      const projectTag = projectIdx >= 0 ? args[projectIdx + 1] : null;

      await knowledgeCapture({ source, input, projectTag });
    } else if (command === "dual-review") {
      const diffSource = args.includes("--branch") ? "branch" : "staged";
      const targetIdx = args.indexOf("--target");
      const target = diffSource === "branch" && targetIdx >= 0 ? args[targetIdx + 1] : null;

      await dualReview({ diffSource, target });
    } else if (command === "detect-mode") {
      const mode = detectMode();
      const tier = readTier();
      const skillMode = readMode();
      const liveSources = detectLiveSources();
      logInfo(`Agent: ${mode} | Tier: ${tier} | Mode: ${skillMode}`);
      log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "set" : "missing"}`);
      log(`  OPENAI_API_KEY:   ${process.env.OPENAI_API_KEY ? "set" : "missing"}`);
      log(`  Live MCP sources: ${liveSources.length ? liveSources.join(", ") : "none"}`);
    } else if (command === "personalization") {
      const sub = args[1] || "show";
      if (sub === "show") {
        const p = loadPersonalization();
        log(JSON.stringify(p, null, 2));
      } else if (sub === "reset") {
        if (fs.existsSync(CONFIG.personalizationFile)) {
          fs.unlinkSync(CONFIG.personalizationFile);
        }
        logSuccess("Personalization reset");
      } else if (sub === "context") {
        log(personalizationContext() || "(empty — 첫 사용)");
      } else {
        logError(`Unknown personalization subcommand: ${sub}`);
        log(`Use: personalization show|reset|context`);
        process.exit(1);
      }
    } else if (command === "session") {
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
          log(JSON.stringify(data, null, 2));
        }
      } else if (subcommand === "list") {
        const limitIdx = args.indexOf("--limit");
        const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 10;
        sessionList({ limit });
      } else if (subcommand === "sync" || subcommand === "auto-sync") {
        const repoIdx = args.indexOf("--repo");
        const orchestratorRepo = repoIdx >= 0 ? args[repoIdx + 1] : null;
        const verbose = args.includes("--verbose") || args.includes("-v");
        await autoSync({ orchestratorRepo, verbose });
      } else {
        logError(`Unknown session subcommand: ${subcommand}`);
        log(`Use: session save|restore|list|sync`);
        process.exit(1);
      }
    } else if (command === "help" || command === "-h" || command === "--help") {
      log(`
${COLORS.bold}cowork-engine.js — Local Cowork Mode${COLORS.reset}

${COLORS.bold}Usage:${COLORS.reset}
  node bin/cowork-engine.js <command> [options]

${COLORS.bold}Commands:${COLORS.reset}
  local-review            Run Claude review (auto self cross-review for builder/cto)
  knowledge-capture       Extract session decisions into knowledge articles
  dual-review             Run Claude + OpenAI cross-review (Cowork+Codex)
  detect-mode             Show agent / tier / live MCP sources
  personalization show    Show accumulated user style/preference data
  personalization reset   Reset personalization data
  personalization context Show prompt-injection block built from accumulation
  session save            Save current session context
  session restore         Load most recent session context
  session list            List recent sessions
  session sync            Sync orchestrator data (agent-scores, error-patterns, decision-log)
  help                    Show this message

${COLORS.bold}Options:${COLORS.reset}
  local-review:
    --staged           Review staged changes (default)
    --branch           Review changes on current branch vs base (origin/HEAD or main)
    --target <branch>  Override base branch for --branch (e.g., master)
    --file <path>      Review changes in specific file
    --dry-run          Show prompt without calling API
    --json             Output as JSON
    --markdown         Output raw markdown
    --cross-check      Force self cross-review ON (regardless of tier)
    --no-cross-check   Force self cross-review OFF

  knowledge-capture:
    --session        Extract from recent commits (default)
    --file <path>    Extract from file
    --manual         Extract from manual input
    --input <text>   Input text or file path
    --project <tag>  Project tag (e.g., sample-store, project-b)

  session sync:
    --repo <owner/repo>  Override orchestrator repo (default: auto-detect)
    --verbose, -v        Show details for skipped/failed files

  dual-review:
    --staged         Review staged changes (default)
    --branch         Review current branch vs base (origin/HEAD or main)
    --target <branch> Override base branch for --branch (e.g., master)

${COLORS.bold}Examples:${COLORS.reset}
  # Review staged changes with Claude
  node bin/cowork-engine.js local-review

  # Dry run to see prompt
  node bin/cowork-engine.js local-review --dry-run

  # Extract knowledge from recent commits
  node bin/cowork-engine.js knowledge-capture

  # Run dual review if both APIs configured
  node bin/cowork-engine.js dual-review

${COLORS.bold}Configuration:${COLORS.reset}
  Set environment variables:
    export ANTHROPIC_API_KEY="sk-ant-..."
    export OPENAI_API_KEY="sk-..."

${COLORS.bold}Mode Detection:${COLORS.reset}
  solo  → Only ANTHROPIC_API_KEY set (Claude reviews)
  dual  → Both keys set (Claude + OpenAI cross-review)
  none  → No API keys configured
      `);
    } else {
      logError(`Unknown command: ${command}`);
      log(`Run: node bin/cowork-engine.js help`);
      process.exit(1);
    }
  } catch (err) {
    logError(`Fatal error: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err);
    }
    process.exit(1);
  }
}

// ============================================================================
// CLAUDE CODE ROUTINES — /fire endpoint adapter (PR-G26)
// ============================================================================

/**
 * Fire a Claude Code Routine via the /fire API endpoint.
 * Routines run on Anthropic's cloud infrastructure — laptop can be closed.
 * CTO tier only. Requires ANTHROPIC_API_KEY and a configured triggerId.
 *
 * Cost: standard Claude token rates. Daily caps: Pro=5, Max=15, Team/Enterprise=25.
 *
 * @param {object} options
 * @param {string} [options.triggerId] - routine trigger ID (trig_01...). Falls back to CONFIG.
 * @param {string} [options.text] - optional run-specific context (e.g. alert body, PR URL)
 * @param {boolean} [options.dryRun=false] - if true, prints the request without sending
 * @returns {Promise<{sessionId: string, status: string}|null>}
 */
async function fireRoutine(options = {}) {
  const tier = readTier();
  const tierLimits = CONFIG.tierLimits[tier] || CONFIG.tierLimits.builder;

  if (!tierLimits.routines) {
    logWarn(`Routines are CTO-tier only (current tier: ${tier}). Upgrade or set --force.`);
    if (!options.force) return null;
  }

  if (!CONFIG.routines.enabled) {
    logError("Routines not enabled. Set routines.enabled=true in config and provide a triggerId.");
    logInfo("Setup: https://code.claude.com/docs/en/routines");
    return null;
  }

  const triggerId = options.triggerId || CONFIG.routines.triggerId;
  if (!triggerId) {
    logError("No routine triggerId configured. Set routines.triggerId in ~/.solo-cto-agent/config.json");
    return null;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logError("ANTHROPIC_API_KEY required for Routines /fire endpoint.");
    return null;
  }

  const payload = {};
  if (options.text) payload.text = options.text;

  if (options.dryRun) {
    logSection("Routine /fire — DRY RUN");
    logInfo(`Trigger: ${triggerId}`);
    logInfo(`Text: ${options.text || "(none)"}`);
    logInfo(`Endpoint: POST /v1/claude_code/routines/${triggerId}/fire`);
    logInfo(`Beta header: ${CONFIG.routines.betaHeader}`);
    return null;
  }

  logSection("Firing Claude Code Routine");
  logInfo(`Trigger: ${triggerId}`);

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: C.API_HOSTS.anthropic,
      path: `/v1/claude_code/routines/${triggerId}/fire`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "anthropic-beta": CONFIG.routines.betaHeader,
        "anthropic-version": C.ANTHROPIC_API_VERSION,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          logError(`Routine /fire failed (${res.statusCode}): ${data.slice(0, 300)}`);
          return resolve(null);
        }
        try {
          const parsed = JSON.parse(data);
          logSuccess(`Routine fired — session: ${parsed.session_id || "pending"}`);
          resolve({ sessionId: parsed.session_id, status: parsed.status || "fired" });
        } catch (e) {
          logWarn(`Routine fired but response unparseable: ${data.slice(0, 200)}`);
          resolve({ sessionId: null, status: "fired" });
        }
      });
    });
    req.on("error", (e) => {
      logError(`Routine /fire network error: ${e.message}`);
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

/**
 * Build a routine schedule manifest for the scheduled-tasks MCP.
 * Merges user-configured schedules with a default nightly review schedule.
 * @returns {object[]} array of schedule entries
 */
function buildRoutineSchedules() {
  const schedules = [...(CONFIG.routines.schedules || [])];
  if (CONFIG.routines.enabled && CONFIG.routines.triggerId && schedules.length === 0) {
    // Default: nightly review at 02:00
    schedules.push({
      name: "nightly-review",
      cron: "0 2 * * *",
      triggerId: CONFIG.routines.triggerId,
      text: "Nightly scheduled review — check all staged/uncommitted changes.",
    });
  }
  return schedules;
}

// ============================================================================
// CLAUDE MANAGED AGENTS — deep review with sandboxed execution (PR-G26)
// ============================================================================

/**
 * Create a Managed Agent session for deep code review with sandboxed execution.
 * CTO tier only. The agent can actually run code, check types, execute tests
 * in addition to reviewing the diff — providing higher-confidence reviews.
 *
 * Cost: standard Claude token rates + $0.08/session-hour for active runtime.
 * Max session timeout: 5 minutes by default (configurable).
 *
 * @param {object} options
 * @param {string} options.diff - the diff to review
 * @param {string} [options.systemPrompt] - review system prompt
 * @param {string} [options.model] - model to use (default: config value)
 * @param {boolean} [options.dryRun=false] - print request without sending
 * @returns {Promise<{verdict: string, issues: object[], raw: string, sessionHours: number, estimatedCost: string}|null>}
 */
async function managedAgentReview(options = {}) {
  const tier = readTier();
  const tierLimits = CONFIG.tierLimits[tier] || CONFIG.tierLimits.builder;

  if (!tierLimits.managedAgents) {
    logWarn(`Managed Agents deep-review is CTO-tier only (current tier: ${tier}).`);
    if (!options.force) return null;
  }

  if (!CONFIG.managedAgents.enabled) {
    logError("Managed Agents not enabled. Set managedAgents.enabled=true in config.");
    logInfo("Docs: https://platform.claude.com/docs/en/managed-agents/overview");
    logInfo("Cost: standard token rates + $0.08/session-hour active runtime.");
    return null;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logError("ANTHROPIC_API_KEY required for Managed Agents.");
    return null;
  }

  const model = options.model || CONFIG.managedAgents.model;
  let diff = options.diff;
  if (!diff) {
    logError("No diff provided for managed agent review.");
    return null;
  }

  // P0 Security: scan diff for secrets
  const diffGuardMA = require("./diff-guard");
  const secretScanMA = diffGuardMA.scanDiff(diff);
  if (secretScanMA.hasSecrets) {
    logWarn(diffGuardMA.formatWarning(secretScanMA.findings));
    if (options.redact) {
      diff = diffGuardMA.redactDiff(diff);
      logInfo("Secrets auto-redacted from diff");
    } else if (!options.force) {
      logError("Aborting deep-review: diff contains secrets. Use --redact or --force.");
      return null;
    }
  }

  const skillContext = readSkillContext();
  const failureCatalog = readFailureCatalog();
  const errorPatterns = failureCatalog.patterns
    ?.map((p) => `- ${p.pattern}: ${p.fix}`)
    .join("\n") || "No patterns loaded";

  const systemPrompt = options.systemPrompt || `You are a senior code reviewer with access to a sandboxed environment.
Review the provided diff thoroughly. You can execute code to verify correctness.

## Project context
${skillContext}

## Known error patterns
${errorPatterns}

## Instructions
1. Review the diff for bugs, security issues, and architectural problems.
2. If possible, write and run a quick test to verify critical logic.
3. Output your review in the standard format:
   [VERDICT] APPROVE | REQUEST_CHANGES | COMMENT
   [ISSUES] ...
   [SUMMARY] ...
   [NEXT ACTION] ...`;

  if (options.dryRun) {
    logSection("Managed Agent Review — DRY RUN");
    logInfo(`Model: ${model}`);
    logInfo(`Diff size: ${(Buffer.byteLength(diff, "utf8") / 1024).toFixed(0)}KB`);
    logInfo(`Timeout: ${CONFIG.managedAgents.sessionTimeoutMs / 1000}s`);
    logInfo(`Beta header: ${CONFIG.managedAgents.betaHeader}`);
    logInfo(`Cost: standard token rates + $0.08/session-hour`);
    return null;
  }

  logSection("Managed Agent Deep Review");
  logInfo(`Model: ${model} | Timeout: ${CONFIG.managedAgents.sessionTimeoutMs / 1000}s`);
  logInfo("Cost: standard token rates + $0.08/session-hour active runtime");

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: `Review this diff:\n\`\`\`diff\n${diff}\n\`\`\`` }],
      max_tokens: C.LIMITS.maxTokensDeep,
      tools: [{ type: "computer_20250124", name: "computer" }],
    });

    const req = https.request({
      hostname: C.API_HOSTS.anthropic,
      path: "/v1/managed_agents/sessions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-beta": CONFIG.managedAgents.betaHeader,
        "anthropic-version": C.ANTHROPIC_API_VERSION,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const elapsed = (Date.now() - startTime) / 1000;
        const sessionHours = elapsed / 3600;
        const runtimeCost = (sessionHours * 0.08).toFixed(4);

        if (res.statusCode >= 400) {
          logError(`Managed Agent failed (${res.statusCode}): ${data.slice(0, 300)}`);
          return resolve(null);
        }
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.map(b => b.text).filter(Boolean).join("\n") || data;
          const review = parseReviewResponse(text);

          // Token cost estimate
          const inputTokens = parsed.usage?.input_tokens || Math.ceil(body.length / 4);
          const outputTokens = parsed.usage?.output_tokens || Math.ceil(text.length / 4);
          const tokenCost = estimateCost(inputTokens, outputTokens, model);
          const totalCost = (parseFloat(tokenCost) + parseFloat(runtimeCost)).toFixed(4);

          logSuccess(`Deep review complete (${elapsed.toFixed(1)}s)`);
          logInfo(`Runtime cost: $${runtimeCost} | Token cost: $${tokenCost} | Total: $${totalCost}`);

          resolve({
            ...review,
            raw: text,
            sessionHours,
            tokens: { input: inputTokens, output: outputTokens },
            cost: { token: tokenCost, runtime: runtimeCost, total: totalCost },
          });
        } catch (e) {
          logWarn(`Managed Agent response unparseable: ${e.message}`);
          resolve(null);
        }
      });
    });
    req.on("error", (e) => {
      logError(`Managed Agent network error: ${e.message}`);
      resolve(null);
    });
    req.setTimeout(CONFIG.managedAgents.sessionTimeoutMs, () => {
      req.destroy(new Error(`Managed Agent timeout after ${CONFIG.managedAgents.sessionTimeoutMs / 1000}s`));
    });
    req.write(body);
    req.end();
  });
}

// ============================================================================
// CONTEXT CHECKPOINT SYSTEM (2026 Compaction Defense)
// ============================================================================

/**
 * Create a context checkpoint before long operations.
 * Captures current branch, modified files, and type definitions snapshot.
 * Stores in .claude/context-checkpoint.json
 */
function contextCheckpoint(options = {}) {
  const {
    cwd = process.cwd(),
    label = "auto",
    includeTypeSnapshot = true,
  } = options;

  const checkpointDir = path.join(cwd, ".claude");
  const checkpointFile = path.join(checkpointDir, "context-checkpoint.json");

  try {
    // Ensure .claude directory exists
    if (!fs.existsSync(checkpointDir)) {
      fs.mkdirSync(checkpointDir, { recursive: true });
    }

    // Get current branch
    let currentBranch = "unknown";
    try {
      currentBranch = execSync("git branch --show-current", {
        cwd,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
    } catch (_) {}

    // Get modified files
    let modifiedFiles = [];
    try {
      const out = execSync("git diff --name-only HEAD", {
        cwd,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      modifiedFiles = out.split("\n").filter(l => l.length > 0);
    } catch (_) {}

    // Get type definitions snapshot (list of files only)
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

/**
 * Restore a context checkpoint and validate current state matches.
 * Used after context compaction to verify project integrity.
 */
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

    // Validate current state
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

/**
 * Hook for rework loop to refresh context before applying fixes.
 * Re-reads type definitions and schema to ensure fixes are type-safe.
 */
function reworkContextRefresh(options = {}) {
  const {
    cwd = process.cwd(),
    verbose = false,
  } = options;

  const refreshed = {
    timestamp: new Date().toISOString(),
    sources: {},
  };

  // Re-read type definitions
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

  // Re-read schema
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

  // Re-read package.json
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

// ============================================================================
// EXPORTS & EXECUTION
// ============================================================================

module.exports = {
  localReview,
  knowledgeCapture,
  dualReview,
  detectMode,
  sessionSave,
  sessionRestore,
  sessionList,
  autoSync,
  // Context checkpoint system (2026 compaction defense)
  contextCheckpoint,
  contextRestore,
  reworkContextRefresh,
  // Cowork-specific layer (substantive upgrade)
  selfCrossReview,
  readTier,
  readMode,
  loadPersonalization,
  savePersonalization,
  updatePersonalizationFromReview,
  personalizationContext,
  recordFeedback,
  // External-signal / self-loop assessment
  assessExternalSignals,
  formatSelfLoopWarning,
  formatPartialSignalHint,
  // T3 Ground Truth (PR-E1)
  resolveVercelProject,
  resolveSupabaseProject,
  fetchVercelGroundTruth,
  summarizeVercelDeployments,
  fetchGroundTruth,
  formatGroundTruthContext,
  // T2 External Knowledge (PR-E2)
  scanPackageJson,
  parsePinnedVersion,
  compareVersions,
  fetchNpmRegistry,
  fetchPackageCurrency,
  fetchExternalKnowledge,
  formatExternalKnowledgeContext,
  // T2 Security Advisories (PR-G4)
  normalizeOsvSeverity,
  severityRank,
  fetchOsvAdvisories,
  fetchSecurityAdvisories,
  detectLiveSources,
  liveSourceContext,
  buildIdentity,
  AGENT_IDENTITY_BY_TIER,
  // Utilities for testing
  parseReviewResponse,
  getDiff,
  detectDefaultBranch,
  setLogChannel,
  getLogChannel,
  readSkillContext,
  readFailureCatalog,
  _setSkillDirOverride,
  _splitDiffIntoChunks,
  _mergeChunkReviews,
  // Tier-aware model resolution (PR-G2)
  resolveModelForTier,
  estimateCost,
  // Claude Code Routines + Managed Agents (PR-G26)
  fireRoutine,
  buildRoutineSchedules,
  managedAgentReview,
  CONFIG,
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
