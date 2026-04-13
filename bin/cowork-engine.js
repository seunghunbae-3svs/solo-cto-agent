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

const CONFIG = {
  skillDir: path.join(os.homedir(), ".claude", "skills", "solo-cto-agent"),
  reviewsDir: path.join(os.homedir(), ".claude", "skills", "solo-cto-agent", "reviews"),
  knowledgeDir: path.join(os.homedir(), ".claude", "skills", "solo-cto-agent", "knowledge"),
  sessionsDir: path.join(os.homedir(), ".claude", "skills", "solo-cto-agent", "sessions"),
  defaultModel: {
    claude: "claude-sonnet-4-20250514",
    codex: "codex-mini-latest",
  },
};

// ============================================================================
// EMBEDDED SKILL CONTEXT (mirrors codex-main/claude-worker.js)
// Keep in sync with skills/_shared/skill-context.md
// ============================================================================

const SKILL_CONTEXT = `
## Ship-Zero Protocol (배포 전 체크리스트)
- Prisma: schema validate, generate 타이밍, postinstall 스크립트
- NextAuth: import 경로(@/lib/), 콜백 로직, 세션 설정
- Vercel 빌드: env 변수 존재 확인, build command, output directory
- TypeScript: strict 모드, any 타입 제거, 타입 누락
- Supabase: RLS 정책, service_role vs anon key 구분, N+1 쿼리

## Project Dev Guide 에러 패턴
- import 경로 에러: ./relative → @/absolute 변환 필수
- Prisma + Drizzle 동시 사용 금지: 하나만 선택
- NextAuth 콜백에서 session.user 확장 시 next-auth.d.ts types 파일 필요
- Vercel 배포 실패 상위 원인: env 누락, prisma generate 타이밍, build command 불일치
- Next.js 14/15 혼용 금지: params 동기/비동기 처리 규칙 다름
- Tailwind v3/v4 문법 혼용 금지: PostCSS 설정과 import 방식 다름

## 코딩 규칙
- 최소 안전 수정: 요청 범위 밖 리팩토링 금지
- 에러 처리: 조용한 실패 금지, 구조화된 에러 반환
- PR 본문 필수: 변경 요약, 리스크 레벨, 롤백 방법, Preview 링크
- 팩트 기반: 추정과 확정 구분 [확정] / [추정] / [미검증]
- Circuit Breaker: 같은 에러 3회 재시도 실패 시 정지 후 보고
`;

const SKILL_REVIEW_CRITERIA = `
## 리뷰 기준 (Ship-Zero Protocol + Project Dev Guide)
1. Import 경로: ./relative 대신 @/ 절대경로 사용했는지
2. Prisma/Drizzle: 혼재 사용 없는지, generate 타이밍 맞는지
3. NextAuth: 콜백 로직, 세션 확장 시 types 파일 있는지
4. Supabase: RLS 정책, service_role vs anon 구분, N+1 쿼리
5. TypeScript: any 타입, 타입 누락, strict 모드 위반
6. 에러 처리: try-catch 누락, 조용한 실패, 구조화 안 된 에러
7. 보안: SQL injection, auth bypass, secret 노출
8. 배포: env 변수 누락, build command, Vercel 설정
9. Next.js 버전: 14는 params 동기, 15는 params Promise — 혼용 금지
10. Tailwind 버전: v3/v4 문법 혼용 금지, PostCSS 설정 일치
`;

const AGENT_IDENTITY = `당신은 어시스턴트가 아니다. CTO급 co-founder다.
- 코드를 지키는 사람이지, 추가만 하는 사람이 아니다.
- 유저가 신난다고 해도 틀린 아이디어는 막아선다.
- 배포되는 것은 전부 본인 책임이라는 전제에서 움직인다.
- 깨질 것을 먼저 보고, 만들 것을 나중에 본다.`;

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
  } = options;

  logSection("solo-cto-agent local-review");
  logInfo(`Mode: solo (Claude)`);
  logInfo(`Source: ${diffSource} changes`);
  logInfo(`Model: ${model}`);

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

  const errorPatterns = failureCatalog.patterns
    ?.map((p) => `- ${p.pattern}: ${p.fix}`)
    .join("\n") || "No patterns loaded";

  // Build review prompt (Korean, codex-main parity)
  const systemPrompt = `${AGENT_IDENTITY}

당신은 Claude, 팀의 시니어 코드 리뷰어다. 아래 diff를 리뷰한다.

${SKILL_CONTEXT}
${SKILL_REVIEW_CRITERIA}

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
      mode: "solo",
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
    }

    logSuccess(`Review saved to ${reviewFile}`);
    return reviewData;
  } catch (err) {
    logError(`API call failed: ${err.message}`);
    throw err;
  }
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

      await localReview({
        diffSource,
        target,
        dryRun,
        outputFormat,
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
      logInfo(`Current mode: ${mode}`);
      log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "set" : "missing"}`);
      log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "set" : "missing"}`);
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
  local-review       Run Claude-only code review
  knowledge-capture  Extract session decisions into knowledge articles
  dual-review        Run Claude + OpenAI cross-review
  detect-mode        Check which API keys are configured
  session save       Save current session context
  session restore    Load most recent session context
  session list       List recent sessions
  help               Show this message

${COLORS.bold}Options:${COLORS.reset}
  local-review:
    --staged         Review staged changes (default)
    --branch         Review changes on current branch vs main
    --file <path>    Review changes in specific file
    --dry-run        Show prompt without calling API
    --json           Output as JSON
    --markdown       Output raw markdown

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
  // Utilities for testing
  parseReviewResponse,
  getDiff,
  readSkillContext,
  readFailureCatalog,
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}
