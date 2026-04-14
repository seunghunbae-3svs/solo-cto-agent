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
const CONFIG = {
  get skillDir() { return _skillBase(); },
  get reviewsDir() { return path.join(_skillBase(), "reviews"); },
  get knowledgeDir() { return path.join(_skillBase(), "knowledge"); },
  get sessionsDir() { return path.join(_skillBase(), "sessions"); },
  get personalizationFile() { return path.join(_skillBase(), "personalization.json"); },
  defaultModel: {
    claude: "claude-sonnet-4-20250514",
    codex: "codex-mini-latest",
  },
  // Tier × Mode 자동화 한계 (Semi-auto mode)
  tierLimits: {
    maker:   { maxRetries: 2, selfCrossReview: false, autoMcpProbe: false, maxIssuesShown: 5  },
    builder: { maxRetries: 3, selfCrossReview: true,  autoMcpProbe: true,  maxIssuesShown: 10 },
    cto:     { maxRetries: 3, selfCrossReview: true,  autoMcpProbe: true,  maxIssuesShown: 20 },
  },
};

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

// D. Tier 별 에이전트 아이덴티티
// CLAUDE.md 의 "Maker Tier 에 강한 톤 적용 금지" 규칙 반영
const AGENT_IDENTITY_BY_TIER = {
  maker: `당신은 사용자의 desktop 에서 동작하는 페어 CTO 다. (Maker Tier — 학습/검증 단계)
- 사용자가 명시적으로 호출한 작업만 수행한다.
- 약점·리스크를 친절하게 짚되, 단정짓지 않는다. 검증 액션을 함께 제시한다.
- "이건 틀렸다" 보다 "이 가정이 깨지면 ~" 식 조건부 표현 우선.
- desktop runtime + 클라우드 amplifier (MCP, web search, scheduled task) 를 엮어 한 호출에서 가치를 최대로 뽑는다.`,
  builder: `당신은 사용자의 desktop 에서 동작하는 페어 CTO 다. (Builder Tier — 실행/배포 단계)
- 코드를 지키는 사람이지, 추가만 하는 사람이 아니다.
- 깨질 것을 먼저 보고, 만들 것을 나중에 본다.
- 자동 적용 가능한 LOW 리스크 변경은 제안과 함께 가드(typecheck/test) 결과를 첨부한다.
- desktop runtime + 클라우드 amplifier 의 라이브 소스 ([확정]) 를 우선 인용한다.`,
  cto: `당신은 CTO급 co-founder 다. (CTO Tier — 멀티 에이전트 오케스트레이션)
- 배포되는 것은 전부 본인 책임이라는 전제에서 움직인다.
- 유저가 신난다고 해도 틀린 아이디어는 막아선다.
- Cowork+Codex 또는 self cross-review 결과의 합의/불일치를 명시하고 우선순위를 정한다.
- 정책상 CTO Tier 의 완전 자율 실행은 Full-auto + Dual 에서만. Semi-auto 에서는 사용자 명시 호출에 따라 동작.`,
};

// 호환용 (구 코드/테스트가 AGENT_IDENTITY 직접 참조하는 경우)
const AGENT_IDENTITY = AGENT_IDENTITY_BY_TIER.builder;

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

// ============================================================================
// TIER · PERSONALIZATION · LIVE SOURCE LAYER (Cowork-specific)
// ============================================================================

/**
 * SKILL.md 에서 tier 추출. 없으면 builder (안전한 기본).
 * tier: 또는 mode 필드를 frontmatter 또는 본문에서 스캔.
 */
function readTier() {
  const skillPath = path.join(CONFIG.skillDir, "SKILL.md");
  try {
    const text = fs.readFileSync(skillPath, "utf8");
    const m = text.match(/^tier:\s*(maker|builder|cto)/im);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return "builder";
}

/**
 * SKILL.md 의 mode 필드 (cowork-main / codex-main). 없으면 cowork-main.
 */
function readMode() {
  const skillPath = path.join(CONFIG.skillDir, "SKILL.md");
  try {
    const text = fs.readFileSync(skillPath, "utf8");
    const m = text.match(/^mode:\s*(cowork-main|codex-main)/im);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return "cowork-main";
}

/**
 * 개인화 누적 데이터 로드. 누적 항목:
 * - acceptedPatterns: 사용자가 수락한 제안 패턴 (location 또는 keyword)
 * - rejectedPatterns: 사용자가 거부/무시한 제안 패턴
 * - repeatErrors: 반복 발생 에러 (failure-catalog 보강용)
 * - stylePrefs: { verbosity, commentDensity, naming } — 누적 휴리스틱
 * - lastUpdated: ISO timestamp
 */
function loadPersonalization() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG.personalizationFile, "utf8"));
  } catch (_) {
    return {
      acceptedPatterns: [],
      rejectedPatterns: [],
      repeatErrors: [],
      stylePrefs: {},
      reviewCount: 0,
      lastUpdated: null,
    };
  }
}

function savePersonalization(p) {
  ensureDir(CONFIG.skillDir);
  p.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONFIG.personalizationFile, JSON.stringify(p, null, 2));
}

/**
 * 리뷰 결과를 personalization 에 반영.
 * - 새 reviewCount + 1
 * - 새 BLOCKER/SUGGESTION 타입의 location keyword → 후속 추적용
 * - 동일 location 이 N회 이상 반복 → repeatErrors 등록
 */
function updatePersonalizationFromReview(review) {
  const p = loadPersonalization();
  p.reviewCount = (p.reviewCount || 0) + 1;

  // 각 issue 의 location 을 키워드 형태로 누적
  for (const issue of review.issues || []) {
    const key = (issue.location || "").split(":")[0]; // path 부분만
    if (!key) continue;
    const idx = p.repeatErrors.findIndex((e) => e.location === key && e.severity === issue.severity);
    if (idx >= 0) {
      p.repeatErrors[idx].count = (p.repeatErrors[idx].count || 1) + 1;
      p.repeatErrors[idx].lastSeen = new Date().toISOString();
    } else {
      p.repeatErrors.push({
        location: key,
        severity: issue.severity,
        count: 1,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  // 상위 50개만 유지
  p.repeatErrors.sort((a, b) => (b.count || 0) - (a.count || 0));
  p.repeatErrors = p.repeatErrors.slice(0, 50);

  savePersonalization(p);
  return p;
}

/**
 * Record explicit accept/reject feedback on a review issue.
 * Used by `solo-cto-agent feedback accept|reject ...` CLI.
 *
 * Anti-bias contract: accepted patterns inform future "trust this verdict",
 * rejected patterns inform "user disputes this severity" so we down-weight
 * similar future findings. personalizationContext() consumes both.
 */
function recordFeedback({ verdict, location, severity, note = "" }) {
  if (!verdict || !["accept", "reject"].includes(verdict)) {
    throw new Error(`recordFeedback: verdict must be 'accept' or 'reject' (got: ${verdict})`);
  }
  if (!location) throw new Error("recordFeedback: location is required");

  const p = loadPersonalization();
  const bucket = verdict === "accept" ? "acceptedPatterns" : "rejectedPatterns";
  if (!Array.isArray(p[bucket])) p[bucket] = [];

  const pathOnly = location.split(":")[0];
  const existing = p[bucket].find((x) => x.location === pathOnly && x.severity === severity);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.lastSeen = new Date().toISOString();
    if (note) existing.note = note;
  } else {
    p[bucket].push({
      location: pathOnly,
      severity: severity || "UNKNOWN",
      count: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      note,
    });
  }

  // Keep buckets bounded
  p[bucket].sort((a, b) => (b.count || 0) - (a.count || 0));
  p[bucket] = p[bucket].slice(0, 100);

  savePersonalization(p);
  return { verdict, location: pathOnly, severity, totalInBucket: p[bucket].length };
}

/**
 * 개인화 누적 데이터를 프롬프트 주입용 텍스트 블록으로 변환.
 * 빈 상태 (첫 사용) 면 빈 문자열 반환.
 *
 * Anti-bias rotation:
 *   - 80% of calls: full personalization context (exploit accumulated knowledge)
 *   - 20% of calls: minimal context with explicit "fresh look" hint (explore)
 *   This prevents over-fitting to past patterns and false-positive lock-in.
 *   Override deterministically via opts.exploration = true | false.
 */
function personalizationContext(opts = {}) {
  const p = loadPersonalization();
  if (!p.reviewCount) return "";

  // Decide rotation slot
  const explore = opts.exploration === true
    || (opts.exploration !== false && Math.random() < 0.20);

  if (explore) {
    return `\n## 개인화 컨텍스트 (탐색 모드 — 과거 패턴 의존도 낮춤)
사용자 히스토리 ${p.reviewCount}회 누적되어 있으나 이번 리뷰는 새 시각으로 본다.
과거 핫스팟/거부 패턴은 참조만, 단정 근거로는 사용 금지.
`;
  }

  const top = (p.repeatErrors || [])
    .filter((e) => (e.count || 0) >= 2)
    .slice(0, 8)
    .map((e) => `- ${e.location} (${e.severity}, ${e.count}회)`)
    .join("\n");

  const accepted = (p.acceptedPatterns || [])
    .slice(0, 5)
    .map((x) => `- ${x.location} (${x.severity}, accept ×${x.count})`)
    .join("\n");

  const rejected = (p.rejectedPatterns || [])
    .slice(0, 5)
    .map((x) => `- ${x.location} (${x.severity}, reject ×${x.count})${x.note ? ` — ${x.note}` : ""}`)
    .join("\n");

  const styleLines = Object.entries(p.stylePrefs || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  let out = `\n## 누적 개인화 컨텍스트 (사용자 히스토리 ${p.reviewCount}회 리뷰 기준)\n`;
  if (top) out += `\n반복 발생 핫스팟 (우선 점검):\n${top}\n`;
  if (accepted) out += `\n사용자가 이전에 동의한 패턴 (가중치 ↑):\n${accepted}\n`;
  if (rejected) out += `\n사용자가 이전에 거부한 패턴 (false positive 가능 — 가중치 ↓):\n${rejected}\n`;
  if (styleLines) out += `\n사용자 스타일 선호:\n${styleLines}\n`;
  if (!top && !accepted && !rejected && !styleLines) return "";
  return out;
}

/**
 * 라이브 소스 (MCP 커넥터) 가용 여부 감지.
 * Semi-auto mode 에서는 desktop runtime 의 환경 또는 사용자 SKILL.md 의 mcp 필드를 본다.
 * 환경변수 힌트: MCP_VERCEL=1, MCP_SUPABASE=1, MCP_GITHUB=1 등.
 */
/**
 * Detect MCP live sources with provenance.
 *
 * Returns: { confirmed: [...], inferred: [...], all: [...] }
 *   - confirmed: probed from ~/.claude/mcp.json or claude_desktop_config.json (Claude Desktop)
 *                or solo-cto-agent SKILL.md `mcp:` field
 *   - inferred:  env vars only (token presence ≠ MCP installed; only suggests credentials exist)
 *
 * Heuristic note: env-var detection used to claim "connected" — that's wrong because
 * a token can exist without the MCP server being registered. Now downgraded to [추정].
 */
function detectLiveSources() {
  const confirmed = new Set();
  const inferred = new Set();

  // Probe 1: Claude Desktop MCP config (most authoritative on Cowork)
  const desktopConfigPaths = [
    process.env.CLAUDE_DESKTOP_CONFIG,
    path.join(os.homedir(), ".claude", "mcp.json"),
    path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    path.join(os.homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
    path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json"),
  ].filter(Boolean);
  for (const p of desktopConfigPaths) {
    try {
      if (!fs.existsSync(p)) continue;
      const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
      const servers = cfg.mcpServers || cfg.mcp_servers || cfg.mcp || {};
      Object.keys(servers).forEach((name) => {
        const norm = name.toLowerCase();
        if (norm.includes("github")) confirmed.add("github");
        else if (norm.includes("vercel")) confirmed.add("vercel");
        else if (norm.includes("supabase")) confirmed.add("supabase");
        else if (norm.includes("figma")) confirmed.add("figma");
        else if (norm.includes("gdrive") || norm.includes("google-drive") || norm.includes("google_drive")) confirmed.add("gdrive");
        else if (norm.includes("gcal") || norm.includes("calendar")) confirmed.add("gcal");
        else if (norm.includes("slack")) confirmed.add("slack");
        else if (norm.includes("notion")) confirmed.add("notion");
        else confirmed.add(norm);
      });
      break; // first found wins
    } catch (_) { /* ignore parse error, try next */ }
  }

  // Probe 2: solo-cto-agent SKILL.md `mcp:` field (user-declared)
  try {
    const text = fs.readFileSync(path.join(CONFIG.skillDir, "SKILL.md"), "utf8");
    const m = text.match(/^mcp:\s*\[([^\]]+)\]/im);
    if (m) {
      m[1].split(",").map((s) => s.trim().replace(/['"]/g, "")).forEach((s) => {
        if (s) confirmed.add(s.toLowerCase());
      });
    }
  } catch (_) {}

  // Inferred: env-var hints (credentials exist, not the same as MCP being wired)
  if (process.env.MCP_GITHUB || process.env.GITHUB_TOKEN) inferred.add("github");
  if (process.env.MCP_VERCEL || process.env.VERCEL_TOKEN) inferred.add("vercel");
  if (process.env.MCP_SUPABASE || process.env.SUPABASE_ACCESS_TOKEN) inferred.add("supabase");
  if (process.env.MCP_FIGMA || process.env.FIGMA_TOKEN) inferred.add("figma");

  // Drop inferred entries that are already confirmed
  confirmed.forEach((c) => inferred.delete(c));

  // Backward compat: flat array contains both (test suites + existing callers).
  // Provenance attached as non-enumerable .confirmed / .inferred for context-aware printers.
  const result = [...confirmed, ...inferred];
  Object.defineProperty(result, "confirmed", { value: Array.from(confirmed), enumerable: false });
  Object.defineProperty(result, "inferred", { value: Array.from(inferred), enumerable: false });
  return result;
}

function liveSourceContext() {
  const sources = detectLiveSources();
  const confirmed = sources.confirmed || sources;
  const inferred = sources.inferred || [];

  if (!confirmed.length && !inferred.length) {
    return `\n## 라이브 소스\nMCP 라이브 소스 없음 (Claude Desktop mcp.json 미발견 + env 힌트 없음).\n모든 외부 상태는 [추정] 또는 [미검증] 으로 표기.\n오프라인 폴백: 캐시된 failure-catalog 와 personalization 만 사용.\n`;
  }

  const lines = [`\n## 라이브 소스`];
  if (confirmed.length) {
    lines.push(`확정 MCP (Claude Desktop config 또는 SKILL.md mcp: 명시) — [확정] 자료로 인용 가능:`);
    lines.push(`  ${confirmed.join(", ")}`);
  }
  if (inferred.length) {
    lines.push(`추정 MCP (env 토큰만 존재 — MCP 서버 등록 여부 미확인) — [추정] 으로만 인용:`);
    lines.push(`  ${inferred.join(", ")}`);
  }
  const has = (n) => confirmed.includes(n);
  lines.push(``);
  lines.push(`- 배포 상태: ${has("vercel") ? "Vercel MCP 직접 조회 가능 [확정]" : "라이브 MCP 없음 → [추정]"}`);
  lines.push(`- DB 상태:   ${has("supabase") ? "Supabase MCP 직접 조회 가능 [확정]" : "라이브 MCP 없음 → [추정]"}`);
  lines.push(`- 코드 상태: ${has("github") ? "GitHub MCP 직접 조회 가능 [확정]" : "로컬 git 만 → [캐시]"}`);
  lines.push(`문서/이전 기억보다 위 라이브 소스를 우선한다. 추정 항목은 단정 표현 금지.`);
  return lines.join("\n") + "\n";
}

/**
 * Tier 에 맞는 에이전트 아이덴티티 + agent 구성 표시.
 * agent: "cowork" | "cowork+codex"
 */
function buildIdentity(tier, agent) {
  const id = AGENT_IDENTITY_BY_TIER[tier] || AGENT_IDENTITY_BY_TIER.builder;
  const agentLine = agent === "cowork+codex"
    ? "\n에이전트 구성: Cowork + Codex (dual). 합의/불일치를 명시한다."
    : "\n에이전트 구성: Cowork 단독. 자기 검증 (self cross-review) 으로 단일 시점 의견의 한계를 보완한다.";
  return id + agentLine;
}

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
    return execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 5, cwd });
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
      maxBuffer: 1024 * 1024,
    });
    return log;
  } catch {
    return "";
  }
}

function estimateCost(inputTokens, outputTokens, model) {
  // Rough estimates (as of 2026-04)
  const rates = {
    "claude-sonnet-4-20250514": { input: 0.003, output: 0.015 }, // per 1K tokens
    "claude-opus-4-20250514": { input: 0.015, output: 0.075 },
    "codex-mini-latest": { input: 0.0005, output: 0.0015 },
  };

  const rate = rates[model] || { input: 0.003, output: 0.015 };
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
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    };

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
      const waitMs = isRateLimit ? (attempt + 1) * 30000 : (attempt + 1) * 15000;
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
      max_tokens: 4096,
    });

    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };

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
      const waitMs = isRateLimit ? (attempt + 1) * 30000 : (attempt + 1) * 15000;
      logWarn(`OpenAI ${isRateLimit ? "rate limited" : "error"}, waiting ${waitMs / 1000}s (attempt ${attempt + 1}/3)...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ============================================================================
// REVIEW LOGIC & PARSING
// ============================================================================

// Normalize verdict to canonical taxonomy: APPROVE | REQUEST_CHANGES | COMMENT
function normalizeVerdict(raw) {
  if (!raw) return "COMMENT";
  const up = raw.toUpperCase();
  if (up.includes("REQUEST_CHANGES") || up.includes("CHANGES_REQUESTED") || up.includes("REQUEST CHANGES") || up.includes("CHANGES REQUESTED")) {
    return "REQUEST_CHANGES";
  }
  if (raw.includes("수정요청") || raw.includes("변경요청")) return "REQUEST_CHANGES";
  if (up.includes("APPROVE")) return "APPROVE";
  if (raw.includes("승인")) return "APPROVE";
  if (up.includes("COMMENT")) return "COMMENT";
  if (raw.includes("보류")) return "COMMENT";
  return "COMMENT";
}

// Korean label for verdict
function verdictLabel(v) {
  return v === "APPROVE" ? "승인" : v === "REQUEST_CHANGES" ? "수정요청" : "보류";
}

// Severity: BLOCKER | SUGGESTION | NIT (with backwards-compat aliases)
function normalizeSeverity(raw) {
  if (!raw) return "NIT";
  const up = raw.toUpperCase();
  if (up.includes("BLOCKER") || up === "CRITICAL") return "BLOCKER";
  if (up.includes("SUGGEST") || up === "WARNING" || up === "WARN") return "SUGGESTION";
  return "NIT";
}

function parseReviewResponse(text) {
  // Verdict: prefer [VERDICT] header, fall back to scanning entire text
  const verdictHeader = text.match(/\[VERDICT\][:\s]*([A-Za-z_\s가-힣]+)/i);
  const verdict = normalizeVerdict(verdictHeader ? verdictHeader[1] : text);

  // Parse issues: look for ⛔/⚠️/💡 markers followed by [location] then description+arrow+fix
  const issues = [];
  const issuePattern =
    /(⛔|⚠️|💡)\s*\[([^\]]+)\]\s*\n\s*([^\n]+)\n\s*(?:→|->|=>)\s*([^\n]+)/g;

  let match;
  while ((match = issuePattern.exec(text)) !== null) {
    const icon = match[1];
    const location = match[2].trim();
    const issue = match[3].trim();
    const suggestion = match[4].trim();
    const severity = icon === "⛔" ? "BLOCKER" : icon === "⚠️" ? "SUGGESTION" : "NIT";
    issues.push({ location, issue, suggestion, severity });
  }

  // Summary + optional next action
  const summary = (text.match(/\[SUMMARY\][:\s]*([^\n]+(?:\n(?!\[)[^\n]+)*)/i) || ["", ""])[1].trim();
  const nextAction = (text.match(/\[NEXT[_\s]ACTION\][:\s]*([\s\S]*?)(?=\n\[|$)/i) || ["", ""])[1].trim();

  return { verdict, verdictKo: verdictLabel(verdict), issues, summary, nextAction };
}

/**
 * Assess which external-signal tiers are active for this review.
 *
 * The three tiers of external evaluation (see docs/external-loop-policy.md):
 *   T1 Peer Model     — another AI family reviewing (Claude + OpenAI dual)
 *   T2 External Knowledge — web search / package registry / trend data
 *   T3 Ground Truth    — real runtime logs / deploy status / production errors
 *
 * Without at least one tier active the review is a pure self-loop — the
 * same model's opinion reinforcing itself. This function detects the
 * environment so `formatSelfLoopWarning` can label the output honestly.
 */
function assessExternalSignals(opts = {}) {
  const env = opts.env || process.env;
  // outcome (optional) — the ACTUAL result of the T2/T3 fetches. When supplied,
  // a tier is only counted as active if (a) its env flag is set AND (b) the
  // fetch produced data. Without outcome we fall back to env-only so callers
  // that don't have fetch results (e.g. dry-run BEFORE fetches run) still get
  // a best-effort answer.
  //
  // Dogfood discovery (PR-F2): the drive-run on palate-pilot + 3stripe-event
  // showed that COWORK_EXTERNAL_KNOWLEDGE=1 in a repo with no (or nested)
  // package.json silently produced no T2 context, yet `activeCount` still
  // read "1/3". That's a false-confidence bug — the user thinks they closed
  // the self-loop when they haven't. Outcome-aware assessment fixes it.
  const outcome = opts.outcome || {};
  const t1Env = !!env.OPENAI_API_KEY;
  const t2Env =
    env.COWORK_EXTERNAL_KNOWLEDGE === "1"
    || !!env.COWORK_WEB_SEARCH
    || !!env.COWORK_PACKAGE_REGISTRY;
  const t3Env =
    !!env.VERCEL_TOKEN
    || !!env.SUPABASE_ACCESS_TOKEN
    || env.COWORK_GROUND_TRUTH === "1";

  // When outcome supplied, require successful application. When not supplied,
  // defer to env flag (backward compatible for callers without fetch data).
  const t2Applied = outcome.t2Applied !== undefined ? !!outcome.t2Applied : t2Env;
  const t3Applied = outcome.t3Applied !== undefined ? !!outcome.t3Applied : t3Env;
  // T1 is "applied" whenever the key exists — the dual-review caller decides
  // whether to actually invoke it; the peer model's mere availability is the
  // signal here.
  const t1Applied = outcome.t1Applied !== undefined ? !!outcome.t1Applied : t1Env;

  const flags = {
    t1PeerModel: t1Applied,
    t2ExternalKnowledge: t2Applied,
    t3GroundTruth: t3Applied,
    // Env-only view (useful for diagnostics: "env set but no data").
    t1EnvSet: t1Env,
    t2EnvSet: t2Env,
    t3EnvSet: t3Env,
  };
  const activeCount = [t1Applied, t2Applied, t3Applied].filter(Boolean).length;
  flags.activeCount = activeCount;
  flags.isSelfLoop = activeCount === 0;
  return flags;
}

/**
 * Render a visible warning when the review has no external-signal backing.
 *
 * The review itself is still produced — we don't gate on this — but the
 * warning makes the self-loop limitation legible to the user so they can
 * decide whether to run `dual-review`, wire up MCP sources, or accept
 * the narrower coverage.
 */
function formatSelfLoopWarning(signals) {
  if (!signals || !signals.isSelfLoop) return "";
  const box = `\n${COLORS.yellow}⚠️  [SELF-LOOP NOTICE]${COLORS.reset}\n`
    + `${COLORS.gray}This review was produced by a single model family with no external signals.${COLORS.reset}\n`
    + `${COLORS.gray}Missing: T1 peer model · T2 external knowledge · T3 ground truth.${COLORS.reset}\n`
    + `${COLORS.gray}Why it matters: opinions reinforce themselves — blind spots persist.${COLORS.reset}\n`
    + `${COLORS.gray}To close the loop, enable any of:${COLORS.reset}\n`
    + `${COLORS.gray}  • T1 — set OPENAI_API_KEY and use 'solo-cto-agent dual-review'${COLORS.reset}\n`
    + `${COLORS.gray}  • T2 — set COWORK_EXTERNAL_KNOWLEDGE=1 (trend + package checks)${COLORS.reset}\n`
    + `${COLORS.gray}  • T3 — set VERCEL_TOKEN or SUPABASE_ACCESS_TOKEN (runtime signals)${COLORS.reset}\n`;
  return box;
}

function formatPartialSignalHint(signals) {
  if (!signals || signals.isSelfLoop || signals.activeCount >= 3) return "";
  const missing = [];
  if (!signals.t1PeerModel) missing.push("T1 peer model");
  if (!signals.t2ExternalKnowledge) missing.push("T2 external knowledge");
  if (!signals.t3GroundTruth) missing.push("T3 ground truth");
  if (missing.length === 0) return "";
  // PR-F2 — surface false-confidence cases: env flag set but tier didn't
  // actually contribute. This is the palate-pilot / 3stripe-event bug.
  const stale = [];
  if (signals.t2EnvSet && !signals.t2ExternalKnowledge) stale.push("T2 (env set, no data)");
  if (signals.t3EnvSet && !signals.t3GroundTruth) stale.push("T3 (env set, no data)");
  const staleSuffix = stale.length
    ? ` · ${COLORS.yellow}enabled-but-silent: ${stale.join(", ")}${COLORS.reset}${COLORS.gray}`
    : "";
  return `\n${COLORS.gray}ℹ️  Active external signals: ${signals.activeCount}/3. Missing: ${missing.join(", ")}.${staleSuffix}${COLORS.reset}\n`;
}

// ============================================================================
// T3 Ground Truth — real runtime signals (PR-E1)
// ============================================================================
// Fetches actual deployment/runtime state from external services so the review
// prompt can be grounded in what's actually shipped, not what the model
// thinks is probably shipped. Currently: Vercel deployments. Supabase wiring
// is stubbed (project-ref resolution only — full log API is follow-up).

/**
 * Resolve Vercel project identifier for the current working dir.
 * Order:
 *   1. .vercel/project.json (created by `vercel link` — most reliable)
 *   2. VERCEL_PROJECT_ID env var
 *   3. VERCEL_PROJECT env var (name, requires list lookup — we return as-is)
 * Returns { projectId, orgId, source } or null.
 */
function resolveVercelProject(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  try {
    const p = path.join(cwd, ".vercel", "project.json");
    if (fs.existsSync(p)) {
      const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
      if (cfg.projectId) {
        return {
          projectId: cfg.projectId,
          orgId: cfg.orgId || null,
          source: ".vercel/project.json",
        };
      }
    }
  } catch (_) { /* ignore */ }
  if (env.VERCEL_PROJECT_ID) {
    return {
      projectId: env.VERCEL_PROJECT_ID,
      orgId: env.VERCEL_TEAM_ID || env.VERCEL_ORG_ID || null,
      source: "VERCEL_PROJECT_ID env",
    };
  }
  if (env.VERCEL_PROJECT) {
    return {
      projectId: env.VERCEL_PROJECT,
      orgId: env.VERCEL_TEAM_ID || env.VERCEL_ORG_ID || null,
      source: "VERCEL_PROJECT env (name)",
    };
  }
  return null;
}

function resolveSupabaseProject(opts = {}) {
  const env = opts.env || process.env;
  if (env.SUPABASE_PROJECT_REF) {
    return { projectRef: env.SUPABASE_PROJECT_REF, source: "SUPABASE_PROJECT_REF env" };
  }
  return null;
}

/**
 * Fetch last N deployments from Vercel REST API.
 * Returns { ok: true, deployments: [...], summary: {...} } or { ok: false, error }.
 * Network failures, timeouts, and auth errors are all soft — they return
 * ok:false with a reason string so the review can proceed without GT.
 */
async function fetchVercelGroundTruth(opts) {
  const { token, projectId, orgId = null, limit = 10, timeoutMs = 8000, fetchImpl } = opts;
  if (!token || !projectId) return { ok: false, error: "missing token or projectId" };
  const qs = new URLSearchParams({ projectId, limit: String(limit) });
  if (orgId) qs.set("teamId", orgId);
  const url = `https://api.vercel.com/v6/deployments?${qs.toString()}`;
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, error: "fetch not available" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: `vercel http ${res.status}` };
    }
    const data = await res.json();
    const deployments = (data.deployments || []).map((d) => ({
      uid: d.uid,
      state: d.state || d.readyState || "UNKNOWN",
      url: d.url,
      target: d.target || null,
      createdAt: d.created || d.createdAt,
      ready: d.ready,
      aliasError: d.aliasError || null,
    }));
    return { ok: true, deployments, summary: summarizeVercelDeployments(deployments) };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e.name === "AbortError" ? "timeout" : String(e.message || e) };
  }
}

function summarizeVercelDeployments(deployments) {
  const total = deployments.length;
  const byState = {};
  for (const d of deployments) {
    byState[d.state] = (byState[d.state] || 0) + 1;
  }
  const production = deployments.filter((d) => d.target === "production");
  const latestProduction = production[0] || null;
  const latestError = deployments.find((d) => d.state === "ERROR") || null;
  return {
    total,
    byState,
    latestProduction,
    latestError,
    errorCount: byState.ERROR || 0,
  };
}

/**
 * Top-level orchestrator. Runs all available GT fetchers in parallel with a
 * shared deadline. Returns a normalized payload that the review prompt
 * formatter can consume. Never throws — failures are captured per-source.
 */
async function fetchGroundTruth(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const timeoutMs = opts.timeoutMs || 8000;
  const fetchImpl = opts.fetchImpl;
  const result = {
    fetchedAt: new Date().toISOString(),
    vercel: null,
    supabase: null,
    hasData: false,
  };
  const jobs = [];

  if (env.VERCEL_TOKEN) {
    const proj = resolveVercelProject({ cwd, env });
    if (proj) {
      jobs.push(
        fetchVercelGroundTruth({
          token: env.VERCEL_TOKEN,
          projectId: proj.projectId,
          orgId: proj.orgId,
          timeoutMs,
          fetchImpl,
        }).then((r) => {
          result.vercel = { ...r, resolved: proj };
        }),
      );
    } else {
      result.vercel = { ok: false, error: "project not identified (no .vercel/project.json, no VERCEL_PROJECT_ID)" };
    }
  }

  if (env.SUPABASE_ACCESS_TOKEN) {
    const proj = resolveSupabaseProject({ env });
    if (proj) {
      result.supabase = { ok: false, error: "supabase log fetch not implemented yet (PR-E1.5)", resolved: proj };
    } else {
      result.supabase = { ok: false, error: "project not identified (set SUPABASE_PROJECT_REF)" };
    }
  }

  if (jobs.length) await Promise.allSettled(jobs);
  result.hasData = !!(result.vercel && result.vercel.ok && result.vercel.deployments && result.vercel.deployments.length);
  return result;
}

/**
 * Render ground-truth payload as a Korean markdown section for injection
 * into the review system prompt. Empty string if no data — the review still
 * runs, it just lacks the grounding section.
 */
function formatGroundTruthContext(gt) {
  if (!gt) return "";
  const lines = [];
  const vercel = gt.vercel;
  const supabase = gt.supabase;

  const hasAnything = (vercel && (vercel.ok || vercel.error)) || (supabase && (supabase.ok || supabase.error));
  if (!hasAnything) return "";

  lines.push(`\n## 최근 프로덕션 신호 (T3 Ground Truth)`);
  lines.push(`> 실제 배포/런타임 상태. [확정] 자료로 인용 가능. 아래 내용과 diff 가 충돌하면 diff 쪽을 의심한다.`);

  if (vercel) {
    lines.push(`\n### Vercel`);
    if (!vercel.ok) {
      lines.push(`- 조회 실패: ${vercel.error}. 배포 상태는 [미검증].`);
    } else {
      const s = vercel.summary || {};
      const stateStr = Object.entries(s.byState || {})
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "(없음)";
      lines.push(`- 최근 ${s.total} 개 배포 상태: ${stateStr}`);
      if (s.latestProduction) {
        const lp = s.latestProduction;
        lines.push(`- 최신 production: \`${lp.state}\` · ${lp.url || "(no url)"} · ${lp.createdAt ? new Date(lp.createdAt).toISOString() : "n/a"}`);
      } else {
        lines.push(`- 최신 production 배포 없음 (preview 만 존재).`);
      }
      if (s.errorCount > 0 && s.latestError) {
        lines.push(`- 최근 ERROR 배포 있음: \`${s.latestError.uid}\` @ ${s.latestError.createdAt ? new Date(s.latestError.createdAt).toISOString() : "n/a"}. 이 diff 가 그 에러와 관련될 가능성 의심.`);
      } else if (s.errorCount === 0) {
        lines.push(`- 최근 ${s.total} 개 중 ERROR 없음.`);
      }
    }
  }

  if (supabase) {
    lines.push(`\n### Supabase`);
    if (!supabase.ok) {
      lines.push(`- ${supabase.error}`);
    }
  }

  lines.push(``);
  lines.push(`위 Ground Truth 를 review 의 근거로 삼아라. diff 가 production 에러 근처를 건드리면 반드시 언급한다.`);
  return lines.join("\n") + "\n";
}

// ============================================================================
// T2 External Knowledge — package currency / stack freshness (PR-E2)
// ============================================================================
// Pulls real npm registry data for the project's direct dependencies so the
// review model knows the actual latest versions + deprecation status instead
// of relying on (potentially stale) training-data knowledge. Opt-in via
// COWORK_EXTERNAL_KNOWLEDGE=1 — registry traffic is public so no auth needed
// but we still gate it behind the flag to keep offline/air-gapped runs clean.

/**
 * Scan `package.json` in the working dir. Returns normalized dep lists.
 * Returns null if no package.json found or parse fails.
 */
function scanPackageJson(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const pkgPath = path.join(cwd, "package.json");
  try {
    if (!fs.existsSync(pkgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const dependencies = raw.dependencies || {};
    const devDependencies = raw.devDependencies || {};
    return {
      name: raw.name || null,
      version: raw.version || null,
      engines: raw.engines || {},
      dependencies,
      devDependencies,
      totalDeps: Object.keys(dependencies).length,
      totalDevDeps: Object.keys(devDependencies).length,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Strip semver prefixes (^, ~, >=, etc) and return major.minor.patch as
 * a plain string. Returns null for non-standard specifiers (git:, file:,
 * workspace:, npm:alias@, link:, etc) since we can't meaningfully compare.
 */
function parsePinnedVersion(spec) {
  if (!spec || typeof spec !== "string") return null;
  if (/^(workspace|file|link|git|github|npm|https?|\.)/.test(spec)) return null;
  const m = spec.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * Compare semver-ish versions. Returns { diff: "ahead"|"same"|"patch"|
 * "minor"|"major"|"unknown" } where "patch/minor/major" means installed
 * is BEHIND latest by that level.
 */
function compareVersions(installed, latest) {
  const pi = parsePinnedVersion(installed);
  const pl = parsePinnedVersion(latest);
  if (!pi || !pl) return { diff: "unknown", installed, latest };
  const [i1, i2, i3] = pi.split(".").map(Number);
  const [l1, l2, l3] = pl.split(".").map(Number);
  if (i1 > l1 || (i1 === l1 && i2 > l2) || (i1 === l1 && i2 === l2 && i3 > l3)) {
    return { diff: "ahead", installed: pi, latest: pl };
  }
  if (i1 === l1 && i2 === l2 && i3 === l3) return { diff: "same", installed: pi, latest: pl };
  if (i1 < l1) return { diff: "major", installed: pi, latest: pl };
  if (i2 < l2) return { diff: "minor", installed: pi, latest: pl };
  return { diff: "patch", installed: pi, latest: pl };
}

/**
 * Fetch a single package's registry metadata. Public API — no auth.
 * 5 s timeout. Returns { name, latest, deprecated } or { ok:false, error }.
 */
async function fetchNpmRegistry(name, opts = {}) {
  const { fetchImpl, timeoutMs = 5000 } = opts;
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, name, error: "fetch not available" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, name, error: `registry http ${res.status}` };
    const data = await res.json();
    const latest = (data["dist-tags"] && data["dist-tags"].latest) || null;
    // The abbreviated metadata includes per-version info in `versions`.
    const versionInfo = latest && data.versions && data.versions[latest];
    const deprecated = versionInfo && versionInfo.deprecated ? String(versionInfo.deprecated) : null;
    return { ok: true, name, latest, deprecated };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, name, error: e.name === "AbortError" ? "timeout" : String(e.message || e) };
  }
}

/**
 * Fetch currency info for a bag of deps. Returns report with entries sorted
 * by staleness (major > minor > patch). Concurrency-limited to be polite
 * to the public registry.
 */
async function fetchPackageCurrency(opts) {
  const {
    deps = {},
    fetchImpl,
    timeoutMs = 5000,
    concurrency = 6,
    limit = 20,
  } = opts;
  const names = Object.keys(deps).slice(0, limit);
  const results = [];
  // Simple concurrency pool.
  let idx = 0;
  async function worker() {
    while (idx < names.length) {
      const i = idx++;
      const name = names[i];
      const installedSpec = deps[name];
      const reg = await fetchNpmRegistry(name, { fetchImpl, timeoutMs });
      if (!reg.ok) {
        results.push({ name, installedSpec, ok: false, error: reg.error });
        continue;
      }
      const cmp = compareVersions(installedSpec, reg.latest);
      results.push({
        name,
        installedSpec,
        installed: cmp.installed,
        latest: reg.latest,
        diff: cmp.diff,
        deprecated: reg.deprecated,
        ok: true,
      });
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, names.length) }, worker);
  await Promise.all(workers);
  // Sort: major > minor > patch > deprecated > same/ahead/unknown
  const rank = { major: 0, minor: 1, patch: 2, same: 4, ahead: 5, unknown: 6 };
  results.sort((a, b) => {
    if (a.deprecated && !b.deprecated) return -1;
    if (!a.deprecated && b.deprecated) return 1;
    return (rank[a.diff] ?? 7) - (rank[b.diff] ?? 7);
  });
  return {
    scanned: names.length,
    total: Object.keys(deps).length,
    entries: results,
    summary: {
      major: results.filter((r) => r.diff === "major").length,
      minor: results.filter((r) => r.diff === "minor").length,
      patch: results.filter((r) => r.diff === "patch").length,
      deprecated: results.filter((r) => r.deprecated).length,
      errored: results.filter((r) => !r.ok).length,
    },
  };
}

// ----------------------------------------------------------------------------
// T2 Security Advisories — OSV.dev (PR-G4)
// ----------------------------------------------------------------------------
// Queries the public OSV.dev API for known vulnerabilities affecting each
// direct dependency at the pinned version. OSV aggregates GitHub Security
// Advisory Database (GHSA), CVE, npm advisories, and others — no auth
// required, public rate limits, 5 s timeout per request.
//
// Gate: COWORK_EXTERNAL_KNOWLEDGE_SECURITY. Defaults to ON when
// COWORK_EXTERNAL_KNOWLEDGE=1 is set (same trust boundary as registry
// traffic). Set to "0" to disable explicitly.

/**
 * Normalize a raw OSV severity block to a simple tag.
 * OSV returns severity as an array of {type, score} entries (CVSS_V3 /
 * CVSS_V4), and also an optional `database_specific.severity` string
 * ("LOW"|"MODERATE"|"HIGH"|"CRITICAL"). We prefer database_specific when
 * present, otherwise derive from CVSS score.
 */
function normalizeOsvSeverity(vuln) {
  const db = vuln && vuln.database_specific;
  if (db && typeof db.severity === "string") {
    const s = db.severity.toUpperCase();
    if (s === "CRITICAL" || s === "HIGH" || s === "MODERATE" || s === "LOW") return s;
  }
  const sev = Array.isArray(vuln && vuln.severity) ? vuln.severity : [];
  for (const entry of sev) {
    if (!entry || typeof entry.score !== "string") continue;
    // CVSS vector string — pull the base score if it looks like a pure number,
    // otherwise fall through to keyword heuristics below.
    const asNum = Number(entry.score);
    if (!Number.isNaN(asNum)) {
      if (asNum >= 9.0) return "CRITICAL";
      if (asNum >= 7.0) return "HIGH";
      if (asNum >= 4.0) return "MODERATE";
      if (asNum > 0) return "LOW";
    }
  }
  return "UNKNOWN";
}

/**
 * Severity rank for sorting. Higher number = more urgent.
 */
function severityRank(sev) {
  switch ((sev || "").toUpperCase()) {
    case "CRITICAL": return 4;
    case "HIGH": return 3;
    case "MODERATE": return 2;
    case "LOW": return 1;
    default: return 0;
  }
}

/**
 * Query OSV.dev for a single package@version. Returns
 * { ok, name, version, vulns:[{id, summary, severity, references}] } or
 * { ok:false, error }.
 */
async function fetchOsvAdvisories(name, version, opts = {}) {
  const { fetchImpl, timeoutMs = 5000 } = opts;
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, name, version, error: "fetch not available" };
  if (!name || !version) return { ok: false, name, version, error: "missing name or version" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        package: { name, ecosystem: "npm" },
        version,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, name, version, error: `osv http ${res.status}` };
    const data = await res.json();
    const rawVulns = Array.isArray(data && data.vulns) ? data.vulns : [];
    const vulns = rawVulns.map((v) => {
      const refs = Array.isArray(v.references) ? v.references.map((r) => r && r.url).filter(Boolean).slice(0, 3) : [];
      const aliases = Array.isArray(v.aliases) ? v.aliases : [];
      const cve = aliases.find((a) => /^CVE-/i.test(a)) || null;
      const ghsa = aliases.find((a) => /^GHSA-/i.test(a)) || (/^GHSA-/i.test(v.id || "") ? v.id : null);
      return {
        id: v.id || null,
        cve,
        ghsa,
        summary: typeof v.summary === "string" ? v.summary : null,
        severity: normalizeOsvSeverity(v),
        published: v.published || null,
        modified: v.modified || null,
        references: refs,
      };
    });
    // Sort by severity desc, then id.
    vulns.sort((a, b) => {
      const d = severityRank(b.severity) - severityRank(a.severity);
      if (d) return d;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
    return { ok: true, name, version, vulns };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, name, version, error: e.name === "AbortError" ? "timeout" : String(e.message || e) };
  }
}

/**
 * Batched OSV lookup across a list of { name, version } entries. Uses the
 * same concurrency pool as package-currency to be polite. Skips entries
 * with unresolvable versions (git:, workspace:, etc).
 */
async function fetchSecurityAdvisories(opts) {
  const {
    deps = {},
    fetchImpl,
    timeoutMs = 5000,
    concurrency = 6,
    limit = 20,
  } = opts;
  const names = Object.keys(deps).slice(0, limit);
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < names.length) {
      const i = idx++;
      const name = names[i];
      const spec = deps[name];
      const version = parsePinnedVersion(spec);
      if (!version) {
        results.push({ name, installedSpec: spec, ok: false, skipped: true, error: "unresolvable version" });
        continue;
      }
      const r = await fetchOsvAdvisories(name, version, { fetchImpl, timeoutMs });
      if (!r.ok) {
        results.push({ name, installedSpec: spec, version, ok: false, error: r.error });
        continue;
      }
      results.push({ name, installedSpec: spec, version, ok: true, vulns: r.vulns });
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, names.length) }, worker);
  await Promise.all(workers);
  // Sort entries: vulnerable packages first (by highest severity), then clean.
  results.sort((a, b) => {
    const av = a.ok && a.vulns && a.vulns.length ? severityRank(a.vulns[0].severity) : -1;
    const bv = b.ok && b.vulns && b.vulns.length ? severityRank(b.vulns[0].severity) : -1;
    if (bv !== av) return bv - av;
    return String(a.name).localeCompare(String(b.name));
  });
  const vulnerable = results.filter((r) => r.ok && r.vulns && r.vulns.length);
  const summary = {
    critical: 0, high: 0, moderate: 0, low: 0, unknown: 0,
    packagesAffected: vulnerable.length,
    totalVulns: 0,
    errored: results.filter((r) => !r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
  };
  for (const r of vulnerable) {
    for (const v of r.vulns) {
      summary.totalVulns++;
      const key = (v.severity || "UNKNOWN").toLowerCase();
      if (summary[key] !== undefined) summary[key]++;
    }
  }
  return {
    scanned: names.length,
    total: Object.keys(deps).length,
    entries: results,
    summary,
  };
}

/**
 * Top-level T2 orchestrator. Runs only when COWORK_EXTERNAL_KNOWLEDGE=1 is
 * set (or one of the granular flags). Always resolves.
 */
async function fetchExternalKnowledge(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const fetchImpl = opts.fetchImpl;
  const timeoutMs = opts.timeoutMs || 5000;
  const includeDev = env.COWORK_EXTERNAL_KNOWLEDGE_INCLUDE_DEV === "1";

  const enabled =
    env.COWORK_EXTERNAL_KNOWLEDGE === "1"
    || !!env.COWORK_PACKAGE_REGISTRY;
  if (!enabled) {
    return {
      enabled: false,
      fetchedAt: null,
      packageCurrency: null,
      securityAdvisories: null,
      hasData: false,
    };
  }

  const pkg = scanPackageJson({ cwd });
  if (!pkg) {
    return {
      enabled: true,
      fetchedAt: new Date().toISOString(),
      packageCurrency: null,
      securityAdvisories: null,
      hasData: false,
      error: "no package.json found",
    };
  }

  const deps = includeDev
    ? { ...pkg.dependencies, ...pkg.devDependencies }
    : pkg.dependencies;

  // Security advisories default to ON when T2 is enabled. Opt-out with "0".
  const securityEnabled = env.COWORK_EXTERNAL_KNOWLEDGE_SECURITY !== "0";

  // Fetch currency + advisories in parallel — both hit independent public APIs.
  const [packageCurrency, securityAdvisories] = await Promise.all([
    fetchPackageCurrency({ deps, fetchImpl, timeoutMs }),
    securityEnabled
      ? fetchSecurityAdvisories({ deps, fetchImpl, timeoutMs }).catch((e) => ({
          scanned: 0, total: Object.keys(deps).length, entries: [],
          summary: { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0, packagesAffected: 0, totalVulns: 0, errored: 0, skipped: 0, fatal: String(e.message || e) },
        }))
      : Promise.resolve(null),
  ]);

  const hasCurrency = !!(packageCurrency && packageCurrency.entries.length);
  const hasAdvisories = !!(securityAdvisories && securityAdvisories.summary && securityAdvisories.summary.totalVulns > 0);

  return {
    enabled: true,
    fetchedAt: new Date().toISOString(),
    projectName: pkg.name,
    projectVersion: pkg.version,
    engines: pkg.engines,
    packageCurrency,
    securityAdvisories,
    hasData: hasCurrency || hasAdvisories,
  };
}

/**
 * Render T2 payload as markdown for prompt injection. Empty string if
 * nothing useful to report.
 */
function formatExternalKnowledgeContext(ek) {
  if (!ek || !ek.enabled) return "";
  const pc = ek.packageCurrency;
  const sa = ek.securityAdvisories;
  const hasCurrency = !!(pc && pc.entries && pc.entries.length);
  const hasAdvisories = !!(sa && sa.summary && sa.summary.totalVulns > 0);
  if (!hasCurrency && !hasAdvisories) return "";

  const lines = [];

  if (hasCurrency) {
    lines.push(`\n## 스택 최신성 (T2 External Knowledge)`);
    lines.push(`> npm registry 실시간 조회 결과 (상위 ${pc.scanned}/${pc.total} 개 direct dep). [확정] 자료.`);

    const s = pc.summary;
    const tags = [];
    if (s.major) tags.push(`major behind: ${s.major}`);
    if (s.minor) tags.push(`minor behind: ${s.minor}`);
    if (s.patch) tags.push(`patch behind: ${s.patch}`);
    if (s.deprecated) tags.push(`deprecated: ${s.deprecated}`);
    if (s.errored) tags.push(`lookup 실패: ${s.errored}`);
    lines.push(`- 요약: ${tags.length ? tags.join(", ") : "모든 패키지 최신 또는 ahead"}`);

    // Surface the most interesting items — deprecated + major/minor behind.
    const flagged = pc.entries.filter(
      (e) => e.deprecated || e.diff === "major" || e.diff === "minor",
    );
    if (flagged.length) {
      lines.push(``);
      lines.push(`### 주의 대상 패키지`);
      for (const e of flagged.slice(0, 10)) {
        if (!e.ok) continue;
        if (e.deprecated) {
          lines.push(`- ⚠️ \`${e.name}@${e.installed || e.installedSpec}\` — **deprecated**: ${e.deprecated.slice(0, 120)}`);
        } else if (e.diff === "major") {
          lines.push(`- ⛔ \`${e.name}\` installed=${e.installed}, latest=${e.latest} — **major** 뒤처짐. breaking change 가능성.`);
        } else if (e.diff === "minor") {
          lines.push(`- ⚠️ \`${e.name}\` installed=${e.installed}, latest=${e.latest} — minor 뒤처짐.`);
        }
      }
    }
  }

  if (hasAdvisories) {
    const ss = sa.summary;
    lines.push(`\n## 보안 취약점 (T2 Security Advisories — OSV.dev / GHSA / CVE)`);
    lines.push(`> OSV.dev 실시간 조회. ${ss.packagesAffected}개 패키지에 ${ss.totalVulns}개 알려진 취약점. [확정] 자료.`);
    const sevTags = [];
    if (ss.critical) sevTags.push(`CRITICAL: ${ss.critical}`);
    if (ss.high) sevTags.push(`HIGH: ${ss.high}`);
    if (ss.moderate) sevTags.push(`MODERATE: ${ss.moderate}`);
    if (ss.low) sevTags.push(`LOW: ${ss.low}`);
    if (ss.unknown) sevTags.push(`UNKNOWN: ${ss.unknown}`);
    if (sevTags.length) lines.push(`- 심각도: ${sevTags.join(", ")}`);

    // Show top vulnerable packages with their highest-severity advisory first.
    const vulnerable = sa.entries.filter((e) => e.ok && e.vulns && e.vulns.length).slice(0, 8);
    if (vulnerable.length) {
      lines.push(``);
      lines.push(`### 영향받는 패키지`);
      for (const e of vulnerable) {
        const top = e.vulns[0];
        const icon = top.severity === "CRITICAL" || top.severity === "HIGH" ? "⛔" : "⚠️";
        const idStr = top.cve || top.ghsa || top.id || "advisory";
        const extra = e.vulns.length > 1 ? ` (+${e.vulns.length - 1} more)` : "";
        const summary = top.summary ? ` — ${top.summary.slice(0, 140)}` : "";
        lines.push(`- ${icon} \`${e.name}@${e.version}\` · **${top.severity}** · [${idStr}]${extra}${summary}`);
      }
    }
    lines.push(``);
    lines.push(`diff 가 위 패키지를 건드리면 취약점 수정 여부를 함께 검토한다. 취약점이 BLOCKER 수준이면 리뷰 verdict에 반영.`);
  } else if (hasCurrency) {
    // Only add the currency trailer when there are no advisories.
    lines.push(``);
    lines.push(`diff 가 위 패키지를 사용하는 파일을 건드리면 버전 차이를 감안해 리뷰한다. 학습 데이터 기반 기억보다 위 수치를 우선한다.`);
  }

  return lines.join("\n") + "\n";
}

function formatCrossCheck(cc) {
  if (!cc) return "";
  let out = `\n${COLORS.bold}[CROSS-CHECK]${COLORS.reset} ${cc.crossVerdict}\n`;
  if (cc.addedIssues.length) {
    out += `${COLORS.gray}+ 추가 발견 (${cc.addedIssues.length}):${COLORS.reset}\n`;
    for (const i of cc.addedIssues) {
      const icon = i.severity === "BLOCKER" ? `${COLORS.red}⛔${COLORS.reset}` : i.severity === "SUGGESTION" ? `${COLORS.yellow}⚠️${COLORS.reset}` : `${COLORS.blue}💡${COLORS.reset}`;
      out += `  ${icon} [${i.location}] ${i.issue} → ${i.suggestion}\n`;
    }
  }
  if (cc.removedItems.length) {
    out += `${COLORS.gray}- 1차 false positive 의심 (${cc.removedItems.length}):${COLORS.reset}\n`;
    for (const r of cc.removedItems) {
      out += `  · [${r.location}] ${r.reason}\n`;
    }
  }
  if (cc.upgradeBlock) out += `${COLORS.gray}↑ 심각도 상향:${COLORS.reset}\n  ${cc.upgradeBlock.replace(/\n/g, "\n  ")}\n`;
  if (cc.downgradeBlock) out += `${COLORS.gray}↓ 심각도 하향:${COLORS.reset}\n  ${cc.downgradeBlock.replace(/\n/g, "\n  ")}\n`;
  if (cc.metaReview) out += `${COLORS.gray}meta:${COLORS.reset} ${cc.metaReview}\n`;
  return out;
}

function formatTerminalOutput(review, sourceInfo, costInfo) {
  const issueCounts = {
    BLOCKER: review.issues.filter((i) => i.severity === "BLOCKER").length,
    SUGGESTION: review.issues.filter((i) => i.severity === "SUGGESTION").length,
    NIT: review.issues.filter((i) => i.severity === "NIT").length,
  };

  const totalIssues = review.issues.length;

  const verdictColor =
    review.verdict === "APPROVE"
      ? COLORS.green
      : review.verdict === "REQUEST_CHANGES"
      ? COLORS.red
      : COLORS.blue;

  const header = `VERDICT: ${review.verdict} (${review.verdictKo})`;
  let output = "\n";
  output += `${COLORS.bold}${verdictColor}${header}${COLORS.reset}\n`;
  output += `${COLORS.gray}${"─".repeat(header.length)}${COLORS.reset}\n`;
  output += `Issues: ${totalIssues}`;
  if (issueCounts.BLOCKER) output += `  ${COLORS.red}⛔ ${issueCounts.BLOCKER} BLOCKER${COLORS.reset}`;
  if (issueCounts.SUGGESTION) output += `  ${COLORS.yellow}⚠️  ${issueCounts.SUGGESTION} SUGGESTION${COLORS.reset}`;
  if (issueCounts.NIT) output += `  ${COLORS.blue}💡 ${issueCounts.NIT} NIT${COLORS.reset}`;
  output += `\n\n`;

  for (const issue of review.issues) {
    const icon =
      issue.severity === "BLOCKER"
        ? `${COLORS.red}⛔${COLORS.reset}`
        : issue.severity === "SUGGESTION"
        ? `${COLORS.yellow}⚠️${COLORS.reset}`
        : `${COLORS.blue}💡${COLORS.reset}`;
    output += `${icon} [${issue.location}]\n`;
    output += `   ${issue.issue}\n`;
    output += `   → ${issue.suggestion}\n\n`;
  }

  if (review.summary) {
    output += `${COLORS.bold}[SUMMARY]${COLORS.reset}\n${review.summary}\n`;
  }
  if (review.nextAction) {
    output += `\n${COLORS.bold}[NEXT ACTION]${COLORS.reset}\n${review.nextAction}\n`;
  }

  output += `\n${COLORS.gray}Cost: $${costInfo.total} (${costInfo.inputTokens}K input, ${costInfo.outputTokens}K output)${COLORS.reset}\n`;
  output += `${COLORS.gray}Saved: ${costInfo.savedPath}${COLORS.reset}\n`;

  return output;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

async function localReview(options = {}) {
  const {
    diffSource = "staged",
    target = null,
    model = CONFIG.defaultModel.claude,
    dryRun = false,
    outputFormat = "terminal",
    crossCheck = null, // null = tier 기본값 따름, true/false = 강제
  } = options;

  // Tier · agent · personalization · live-source 컨텍스트 결정
  const cwd = process.cwd();
  const tier = readTier();
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
    // This is the exact false-confidence case surfaced by the palate-pilot /
    // 3stripe-event drive-runs (COWORK_EXTERNAL_KNOWLEDGE=1, no package.json
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

  const userPrompt = `## 프로젝트 컨텍스트 (SKILL.md)
${skillContext}

## 리뷰 대상 diff
\`\`\`diff
${diff}
\`\`\`

위 출력 형식 그대로 리뷰하라.`;

  if (dryRun) {
    log("\n[DRY RUN] Would call Anthropic API with:");
    log(`System prompt length: ${systemPrompt.length} chars`);
    log(`User prompt length: ${userPrompt.length} chars`);
    // B3: Self-loop warning is free to compute — surface it on --dry-run too so
    // operators can audit their external-signal config without paying for an API call.
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

  logInfo(`Calling Anthropic API (maxRetries=${tierLimits.maxRetries})...`);

  try {
    const response = await callAnthropic(userPrompt, systemPrompt, model, { maxRetries: tierLimits.maxRetries });
    const review = parseReviewResponse(response.text);

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
  const {
    diffSource = "staged",
    target = null,
    claudeModel = CONFIG.defaultModel.claude,
    codexModel = CONFIG.defaultModel.codex,
  } = options;

  logSection("solo-cto-agent dual-review");
  logInfo(`Mode: dual (Claude + OpenAI)`);
  logInfo(`Source: ${diffSource} changes`);

  const cwd = process.cwd();
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
      comparison.verdictMatch ? COLORS.green + "YES" : COLORS.red + "NO"
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

  return dualReviewData;
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
      } else {
        logError(`Unknown session subcommand: ${subcommand}`);
        log(`Use: session save|restore|list`);
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
    --project <tag>  Project tag (e.g., tribo, pista)

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
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
