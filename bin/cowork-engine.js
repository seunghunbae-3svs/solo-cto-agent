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
 *   node bin/cowork-engine.js local-review [--staged|--branch|--file <path>] [--dry-run] [--json]
 *   node bin/cowork-engine.js knowledge-capture [--session|--file <path>] [--project <tag>]
 *   node bin/cowork-engine.js dual-review [--staged|--branch] [--json]
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
 * 개인화 누적 데이터를 프롬프트 주입용 텍스트 블록으로 변환.
 * 빈 상태 (첫 사용) 면 빈 문자열 반환.
 */
function personalizationContext() {
  const p = loadPersonalization();
  if (!p.reviewCount) return "";

  const top = (p.repeatErrors || [])
    .filter((e) => (e.count || 0) >= 2)
    .slice(0, 8)
    .map((e) => `- ${e.location} (${e.severity}, ${e.count}회)`)
    .join("\n");

  const styleLines = Object.entries(p.stylePrefs || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  let out = `\n## 누적 개인화 컨텍스트 (사용자 히스토리 ${p.reviewCount}회 리뷰 기준)\n`;
  if (top) out += `\n반복 발생 핫스팟 (우선 점검):\n${top}\n`;
  if (styleLines) out += `\n사용자 스타일 선호:\n${styleLines}\n`;
  if (!top && !styleLines) return "";
  return out;
}

/**
 * 라이브 소스 (MCP 커넥터) 가용 여부 감지.
 * Semi-auto mode 에서는 desktop runtime 의 환경 또는 사용자 SKILL.md 의 mcp 필드를 본다.
 * 환경변수 힌트: MCP_VERCEL=1, MCP_SUPABASE=1, MCP_GITHUB=1 등.
 */
function detectLiveSources() {
  const sources = [];
  if (process.env.MCP_GITHUB || process.env.GITHUB_TOKEN) sources.push("github");
  if (process.env.MCP_VERCEL || process.env.VERCEL_TOKEN) sources.push("vercel");
  if (process.env.MCP_SUPABASE || process.env.SUPABASE_ACCESS_TOKEN) sources.push("supabase");
  if (process.env.MCP_FIGMA || process.env.FIGMA_TOKEN) sources.push("figma");

  // SKILL.md 에 mcp: 항목이 명시되어 있으면 그것도 포함
  try {
    const text = fs.readFileSync(path.join(CONFIG.skillDir, "SKILL.md"), "utf8");
    const m = text.match(/^mcp:\s*\[([^\]]+)\]/im);
    if (m) {
      m[1].split(",").map((s) => s.trim().replace(/['"]/g, "")).forEach((s) => {
        if (s && !sources.includes(s)) sources.push(s);
      });
    }
  } catch (_) {}

  return sources;
}

function liveSourceContext() {
  const sources = detectLiveSources();
  if (!sources.length) {
    return `\n## 라이브 소스\n현재 연결된 MCP 라이브 소스 없음. 모든 외부 상태는 [추정] 또는 [미검증] 으로 표기.\n오프라인 폴백: 캐시된 failure-catalog 와 personalization 만 사용.\n`;
  }
  return `\n## 라이브 소스 (우선 인용 — [확정] 자료)\n연결된 MCP: ${sources.join(", ")}\n- 배포 상태: ${sources.includes("vercel") ? "Vercel API 직접 조회" : "라이브 소스 없음 → [추정]"}\n- DB 상태: ${sources.includes("supabase") ? "Supabase 직접 조회" : "라이브 소스 없음 → [추정]"}\n- 코드 상태: ${sources.includes("github") ? "GitHub API 직접 조회" : "로컬 git 만 → [캐시]"}\n문서/이전 기억보다 위 라이브 소스를 우선한다.\n`;
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

function log(...args) {
  console.log(...args);
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

function getDiff(source, target) {
  try {
    let cmd;
    switch (source) {
      case "staged":
        cmd = "git diff --staged";
        break;
      case "branch":
        cmd = `git diff ${target || "main"}...HEAD`;
        break;
      case "file":
        if (!target) throw new Error("--file requires target path");
        cmd = `git diff -- ${target}`;
        break;
      default:
        cmd = "git diff --staged";
    }
    return execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 5 });
  } catch (e) {
    if (e.status === 128) {
      logError("Not a git repository");
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

// 3-retry with rate-limit backoff (mirrors codex-main/claude-worker.js claude())
async function callAnthropic(prompt, systemPrompt, model) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await _anthropicOnce(prompt, systemPrompt, model);
    } catch (e) {
      lastErr = e;
      const body = (e.body || e.message || "").toLowerCase();
      const isRateLimit = body.includes("rate_limit") || body.includes("overloaded") || e.statusCode === 429 || e.statusCode === 529;
      if (attempt === 2) break;
      const waitMs = isRateLimit ? (attempt + 1) * 30000 : (attempt + 1) * 15000;
      logWarn(`Anthropic ${isRateLimit ? "rate limited" : "error"}, waiting ${waitMs / 1000}s (attempt ${attempt + 1}/3)...`);
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

  // Get diff
  const diff = getDiff(diffSource, target);
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

  const errorPatterns = failureCatalog.patterns
    ?.map((p) => `- ${p.pattern}: ${p.fix}`)
    .join("\n") || "No patterns loaded";

  // Build review prompt (Korean, codex-main parity + cowork enhancements)
  const systemPrompt = `${identity}

당신은 Claude, 팀의 시니어 코드 리뷰어다. 아래 diff를 리뷰한다.

${OPERATING_PRINCIPLES}
${COMMON_STACK_PATTERNS}
${REVIEW_PRIORITY}
${liveCtx}${personalCtx}

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
    return null;
  }

  logInfo("Calling Anthropic API...");

  try {
    const response = await callAnthropic(userPrompt, systemPrompt, model);
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

    fs.writeFileSync(reviewFile, JSON.stringify(reviewData, null, 2));

    // Output based on format
    if (outputFormat === "json") {
      log(JSON.stringify(reviewData, null, 2));
    } else if (outputFormat === "markdown") {
      log(response.text);
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
async function selfCrossReview({ diff, firstPass, firstPassRaw, systemPromptBase, model }) {
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

  const response = await callAnthropic(advocateUser, advocateSystem, model);
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

  const diff = getDiff(diffSource, target);
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

  // Dual-review prompt (identical spec for Claude + OpenAI — codex-main parity)
  const systemPrompt = `${AGENT_IDENTITY}

팀의 시니어 코드 리뷰어다. 아래 diff를 리뷰한다.

${SKILL_CONTEXT}
${SKILL_REVIEW_CRITERIA}

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
    finalVerdict,
    comparison,
    claudeReview,
    codexReview,
    raw: {
      claude: claudeResponse.text,
      openai: codexResponse.text,
    },
  };

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
      const target = fileIdx >= 0 ? args[fileIdx + 1] : null;

      const dryRun = args.includes("--dry-run");
      const outputFormat = args.includes("--json")
        ? "json"
        : args.includes("--markdown")
        ? "markdown"
        : "terminal";

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
      const target = null;

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
    --branch           Review changes on current branch vs main
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
    --branch         Review current branch

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
  detectLiveSources,
  liveSourceContext,
  buildIdentity,
  AGENT_IDENTITY_BY_TIER,
  // Utilities for testing
  parseReviewResponse,
  getDiff,
  readSkillContext,
  readFailureCatalog,
  _setSkillDirOverride,
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
