#!/usr/bin/env node

/**
 * uiux-engine.js — Cowork-mode UI/UX 검토 엔진
 *
 * codex-main 의 uiux-* 4종 (code-review / visual-review / cross-verify / suggest-fixes)
 * 에 대응하는 cowork-main 단일 파일 구현.
 *
 * 차이점:
 * - GitHub PR 대신 로컬 diff / 사용자 제공 screenshot 파일을 입력으로 사용
 * - Playwright 캡처 가능 시 자동, 없으면 사용자가 Cowork 의 Chrome MCP 로 캡처한
 *   파일 경로를 --screenshot 로 전달
 * - 동일한 4축 평가 (layout / typography / spacing / color / a11y / polish)
 * - 동일한 AI Slop 감지 기준
 * - 결과 포맷은 cowork-engine 의 review 포맷과 통일 (BLOCKER/SUGGESTION/NIT)
 *
 * Usage:
 *   node bin/uiux-engine.js code-review [--diff <source>]
 *   node bin/uiux-engine.js vision-review --screenshot <path> [--viewport mobile|tablet|desktop] [--project <slug>]
 *   node bin/uiux-engine.js cross-verify --screenshot <path> [--diff <source>]
 *   node bin/uiux-engine.js suggest-fixes --review <review-file>
 *   node bin/uiux-engine.js baseline save|diff --screenshot <path> --project <slug>
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// 재사용: cowork-engine 의 공통 helper 와 personalization layer
const cowork = require("./cowork-engine.js");

// ============================================================================
// CONFIG
// ============================================================================

let _skillDirOverride = null;
function _setSkillDirOverride(p) { _skillDirOverride = p; }
const skillDir = () => _skillDirOverride
  || process.env.COWORK_SKILL_DIR_OVERRIDE
  || path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");

const CONFIG = {
  get baselineDir() { return path.join(skillDir(), "visual-baselines"); },
  get reviewsDir() { return path.join(skillDir(), "reviews"); },
  defaultModel: "claude-sonnet-4-20250514",
  visionModel: "claude-sonnet-4-20250514",
  defaultViewports: ["mobile", "tablet", "desktop"],
};

const COLORS = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", blue: "\x1b[34m", gray: "\x1b[90m",
};

function log(...a) { console.log(...a); }
function logSection(t) { log(`\n${COLORS.bold}${t}${COLORS.reset}\n${"─".repeat(Math.min(t.length, 40))}`); }
function logSuccess(m) { log(`${COLORS.green}✓${COLORS.reset} ${m}`); }
function logError(m) { log(`${COLORS.red}✗${COLORS.reset} ${m}`); }
function logWarn(m) { log(`${COLORS.yellow}⚠${COLORS.reset} ${m}`); }
function logInfo(m) { log(`${COLORS.blue}ℹ${COLORS.reset} ${m}`); }

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16); }

// ============================================================================
// DESIGN TOKEN EXTRACTION (코드 사이드)
// ============================================================================

/**
 * 프로젝트 디렉토리에서 디자인 토큰 추출.
 * - tailwind.config.{js,ts,mjs} 의 theme.extend
 * - app/globals.css / styles/globals.css 의 :root CSS 변수
 * - design-tokens.json 또는 tokens.json (있으면)
 */
function extractDesignTokens(projectDir = process.cwd()) {
  const tokens = {
    tailwind: null,
    cssVars: [],
    tokenFiles: [],
    configFile: null,
    fontFamilies: [],
    spacing: [],
    borderRadius: [],
    colors: [],
  };

  // 1. tailwind.config 찾기
  for (const ext of ["js", "ts", "mjs", "cjs"]) {
    const f = path.join(projectDir, `tailwind.config.${ext}`);
    if (fs.existsSync(f)) {
      tokens.configFile = f;
      try {
        const text = fs.readFileSync(f, "utf8");
        // 간이 파싱: theme.extend 블록 내용을 키로 추출
        const themeMatch = text.match(/extend\s*:\s*\{([\s\S]*?)\n\s*\}/);
        if (themeMatch) tokens.tailwind = themeMatch[1].slice(0, 1500);
        // 색상/spacing/font 키 추출
        const colorMatches = [...text.matchAll(/['"]([a-z-]+)['"]\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/g)];
        tokens.colors = colorMatches.slice(0, 30).map((m) => m[1]);
        const fontMatches = [...text.matchAll(/fontFamily\s*:\s*\{([^}]+)\}/g)];
        if (fontMatches.length) tokens.fontFamilies = fontMatches[0][1].split(",").map((s) => s.trim()).slice(0, 10);
      } catch (_) {}
      break;
    }
  }

  // 2. CSS variables 찾기
  for (const candidate of ["app/globals.css", "styles/globals.css", "src/index.css", "src/app/globals.css"]) {
    const f = path.join(projectDir, candidate);
    if (fs.existsSync(f)) {
      try {
        const text = fs.readFileSync(f, "utf8");
        const varMatches = [...text.matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)];
        tokens.cssVars = varMatches.slice(0, 50).map((m) => ({ name: m[1], value: m[2].trim() }));
      } catch (_) {}
      break;
    }
  }

  // 3. design-tokens.json
  for (const candidate of ["design-tokens.json", "tokens.json", "src/tokens.json"]) {
    const f = path.join(projectDir, candidate);
    if (fs.existsSync(f)) {
      tokens.tokenFiles.push(candidate);
    }
  }

  return tokens;
}

function summarizeTokens(tokens) {
  const lines = [];
  if (tokens.configFile) lines.push(`tailwind config: ${path.basename(tokens.configFile)}`);
  if (tokens.colors.length) lines.push(`colors (${tokens.colors.length}): ${tokens.colors.slice(0, 10).join(", ")}`);
  if (tokens.fontFamilies.length) lines.push(`fonts: ${tokens.fontFamilies.slice(0, 5).join(", ")}`);
  if (tokens.cssVars.length) lines.push(`css vars (${tokens.cssVars.length}): ${tokens.cssVars.slice(0, 8).map((v) => `--${v.name}`).join(", ")}`);
  if (tokens.tokenFiles.length) lines.push(`token files: ${tokens.tokenFiles.join(", ")}`);
  return lines.length ? lines.join("\n") : "(no tokens detected)";
}

// ============================================================================
// API CALLS (Vision 지원)
// ============================================================================

function _callAnthropic({ system, messages, model, maxTokens = 4096 }) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return reject(new Error("ANTHROPIC_API_KEY not set"));

    const body = JSON.stringify({ model, max_tokens: maxTokens, system, messages });
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          const e = new Error(`Anthropic API ${res.statusCode}: ${data.slice(0, 300)}`);
          e.statusCode = res.statusCode; e.body = data;
          return reject(e);
        }
        try {
          const parsed = JSON.parse(data);
          resolve({ text: parsed.content?.[0]?.text || "", usage: parsed.usage || {} });
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body); req.end();
  });
}

async function callAnthropicWithRetry(opts) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { return await _callAnthropic(opts); }
    catch (e) {
      lastErr = e;
      const isRate = e.statusCode === 429 || e.statusCode === 529 || (e.body || "").includes("rate_limit");
      if (i === 2) break;
      const waitMs = isRate ? (i + 1) * 30000 : (i + 1) * 15000;
      logWarn(`API ${isRate ? "rate-limited" : "error"}, retry in ${waitMs / 1000}s (${i + 1}/3)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ============================================================================
// CODE REVIEW (Stage 1 — 코드 사이드)
// ============================================================================

const UIUX_CODE_PROMPT = `당신은 시니어 UI/UX 리뷰어다. 아래 frontend diff 를 6개 차원에서 검토한다.

## 검토 차원
1. **Component Structure** — god component, prop drilling, 잘못된 분리
2. **Styling Consistency** — Tailwind utility 일관성, inline style 혼재, !important 남용
3. **Responsive Design** — mobile-first 위반, breakpoint 누락, fixed width
4. **Accessibility** — aria-* 누락, semantic HTML 위반, button vs div, contrast 문제
5. **Design System Adherence** — design token 무시 (hex 직접 사용), spacing scale 이탈, font size 임의값
6. **AI Slop Detection** — 의미 없는 placeholder 텍스트, gratuitous gradient, 무의미한 emoji, 반복적 lorem ipsum, 과한 shadow/blur 이펙트

## 심각도
- ⛔ BLOCKER  — 사용성/접근성 차단 (a11y 위반, 깨진 레이아웃, 색대비 < 3:1)
- ⚠️ SUGGESTION — 강한 권고 (design system 이탈, AI slop 명백)
- 💡 NIT — 취향 수준 (네이밍, 일관성)

## 출력 형식 (정확히 이대로)

[VERDICT] APPROVE | REQUEST_CHANGES | COMMENT

[ISSUES]
⛔ [path/file.tsx:42 — category:accessibility]
  이슈 한 줄.
  → 구체적 수정.

⚠️ [path/file.tsx:17 — category:ai-slop]
  이슈 한 줄.
  → 구체적 수정.

[SUMMARY]
1~2문장. 수치는 [확정]/[추정] 태그.

[NEXT ACTION]
- 항목

규칙: 한국어, 칭찬 금지, 간결. category 는 structure|styling|responsive|accessibility|design-system|ai-slop 중 하나.`;

async function uiuxCodeReview({ diffSource = "staged", target = null, projectDir = process.cwd(), model = CONFIG.defaultModel, dryRun = false } = {}) {
  logSection("uiux code-review");
  const diff = cowork.getDiff ? cowork.getDiff(diffSource, target) : "";
  if (!diff || !diff.trim()) { logWarn("No diff"); return null; }

  // UI 관련 파일만 필터링 (간이 — diff 헤더 보고 결정)
  const uiPattern = /\.(tsx?|jsx?|css|scss|sass|tailwind|html|svelte|vue)$/m;
  const uiRelevant = diff.split(/^diff --git/m).filter((chunk) => uiPattern.test(chunk));
  if (!uiRelevant.length) { logWarn("No UI-related files in diff"); return null; }
  const uiDiff = uiRelevant.join("\ndiff --git").slice(0, 18000); // token cap

  const tokens = extractDesignTokens(projectDir);
  const tokenSummary = summarizeTokens(tokens);
  logInfo(`Tokens: ${tokens.colors.length} colors, ${tokens.cssVars.length} css vars`);

  const userPrompt = `## 프로젝트 디자인 토큰 (system of record)
${tokenSummary}

## 검토 대상 diff
\`\`\`diff
${uiDiff}
\`\`\`

위 출력 형식 그대로 6차원 리뷰하라.`;

  if (dryRun) {
    log(`[DRY RUN] system ${UIUX_CODE_PROMPT.length}자, user ${userPrompt.length}자`);
    return null;
  }

  logInfo("Calling Anthropic (code review)...");
  const resp = await callAnthropicWithRetry({ system: UIUX_CODE_PROMPT, messages: [{ role: "user", content: userPrompt }], model });
  const review = cowork.parseReviewResponse(resp.text);

  // 저장
  ensureDir(CONFIG.reviewsDir);
  const outFile = path.join(CONFIG.reviewsDir, `${timestamp()}-uiux-code.json`);
  const data = {
    timestamp: new Date().toISOString(),
    type: "uiux-code",
    model,
    diffSource,
    tokens: { count: tokens.colors.length + tokens.cssVars.length, configFile: tokens.configFile },
    verdict: review.verdict,
    issues: review.issues,
    summary: review.summary,
    raw: resp.text,
  };
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  logSuccess(`Saved ${outFile}`);

  printReview(data);
  return data;
}

// ============================================================================
// VISION REVIEW (Stage 2 — 시각 사이드)
// ============================================================================

const UIUX_VISION_PROMPT = `당신은 시니어 UI/UX 리뷰어다. 첨부된 스크린샷을 6개 차원으로 분석한다.

## 평가 차원 (각 0~10)
1. **Layout** — 시각적 위계, 정렬, balance
2. **Typography** — 크기, 굵기, 가독성, 행간
3. **Spacing** — padding/margin/whitespace 일관성
4. **Color** — 대비, 조화, accessibility (WCAG AA 4.5:1 / AAA 7:1)
5. **Accessibility** — touch target ≥ 44px, contrast, 시각적 cue
6. **Polish** — professional finish, AI slop 부재, authentic 디자인

## AI Slop 체크리스트 (발견 시 polish 점수 -3)
- 의미 없는 emoji 또는 stock illustration
- 과도한 gradient (3색 이상 또는 무관한 색 조합)
- 반복적 placeholder ("Lorem ipsum", "Card title", "Description here")
- 무관한 그림자/blur effect
- 의미 없는 큰 숫자/통계 ("10,000+ users" 같은 가짜 social proof)

## 출력 형식 (정확히 이대로)

[VERDICT] APPROVE | REQUEST_CHANGES | COMMENT

[SCORES]
layout: N/10
typography: N/10
spacing: N/10
color: N/10
accessibility: N/10
polish: N/10
overall: N/10

[ISSUES]
⛔ [area: header — category:accessibility]
  이슈 한 줄.
  → 수정.

⚠️ [area: hero — category:polish]
  이슈 한 줄.
  → 수정.

[STRENGTHS]
- 강점 1
- 강점 2

[SUMMARY]
1~2문장.

규칙: 한국어, 칭찬 금지 (단, [STRENGTHS] 섹션은 예외 — 사실 기반으로만), 간결. area 는 화면 영역명 (header/hero/card/footer/...). category 는 layout|typography|spacing|color|accessibility|polish.`;

async function uiuxVisionReview({ screenshotPath, viewport = "desktop", projectSlug = null, model = CONFIG.visionModel, dryRun = false } = {}) {
  logSection(`uiux vision-review (${viewport})`);
  if (!screenshotPath || !fs.existsSync(screenshotPath)) {
    logError(`Screenshot not found: ${screenshotPath}`);
    return null;
  }
  const buf = fs.readFileSync(screenshotPath);
  const base64 = buf.toString("base64");
  const mime = screenshotPath.toLowerCase().endsWith(".png") ? "image/png"
    : screenshotPath.toLowerCase().endsWith(".webp") ? "image/webp"
    : "image/jpeg";

  logInfo(`Screenshot: ${screenshotPath} (${(buf.length / 1024).toFixed(1)} KB)`);

  if (dryRun) {
    log(`[DRY RUN] Would call Vision API with screenshot ${(buf.length / 1024).toFixed(1)} KB at ${viewport}`);
    return null;
  }

  const messages = [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
      { type: "text", text: `viewport: ${viewport}\nproject: ${projectSlug || "(unspecified)"}\n\n위 형식 그대로 분석하라.` },
    ],
  }];

  logInfo("Calling Vision API...");
  const resp = await callAnthropicWithRetry({ system: UIUX_VISION_PROMPT, messages, model, maxTokens: 3000 });
  const text = resp.text;

  const review = cowork.parseReviewResponse(text);
  const scores = parseScores(text);
  const strengths = parseStrengths(text);

  ensureDir(CONFIG.reviewsDir);
  const outFile = path.join(CONFIG.reviewsDir, `${timestamp()}-uiux-vision-${viewport}.json`);
  const data = {
    timestamp: new Date().toISOString(),
    type: "uiux-vision",
    viewport,
    projectSlug,
    model,
    screenshotPath,
    screenshotSize: buf.length,
    verdict: review.verdict,
    scores,
    strengths,
    issues: review.issues,
    summary: review.summary,
    raw: text,
  };
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  logSuccess(`Saved ${outFile}`);

  printVisionReview(data);
  return data;
}

function parseScores(text) {
  const block = (text.match(/\[SCORES\]([\s\S]*?)(?=\[ISSUES\]|\[STRENGTHS\]|\[SUMMARY\]|$)/i) || [])[1] || "";
  const scores = {};
  // Matches "axis: 8", "axis: 8.5", "axis: 8/10", "axis: 8.5/10". The /10 suffix is optional.
  for (const m of block.matchAll(/(\w+)\s*:\s*(\d+(?:\.\d+)?)(?:\s*\/\s*10)?\b/g)) {
    scores[m[1].toLowerCase()] = parseFloat(m[2]);
  }
  return scores;
}

function parseStrengths(text) {
  const block = (text.match(/\[STRENGTHS\]([\s\S]*?)(?=\[SUMMARY\]|\[ISSUES\]|$)/i) || [])[1] || "";
  return block.split("\n").map((s) => s.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
}

// ============================================================================
// CROSS-VERIFY (Stage 3 — 코드 ↔ 시각 일치성)
// ============================================================================

async function uiuxCrossVerify({ diffSource = "staged", target = null, screenshotPath, viewport = "desktop", projectDir = process.cwd(), projectSlug = null } = {}) {
  logSection("uiux cross-verify");
  const codeReview = await uiuxCodeReview({ diffSource, target, projectDir });
  if (!codeReview) { logWarn("Code review skipped"); }
  const visionReview = await uiuxVisionReview({ screenshotPath, viewport, projectSlug });
  if (!visionReview) { logWarn("Vision review skipped"); }

  if (!codeReview || !visionReview) return { codeReview, visionReview, alignment: null };

  // 합의/불일치 분석
  const codeBlockers = (codeReview.issues || []).filter((i) => i.severity === "BLOCKER");
  const visionBlockers = (visionReview.issues || []).filter((i) => i.severity === "BLOCKER");

  // category 단위 합의 (코드와 시각이 같은 영역을 BLOCKER 로 짚었는가)
  const codeCats = new Set(codeBlockers.map((i) => extractCategory(i.location)));
  const visionCats = new Set(visionBlockers.map((i) => extractCategory(i.location)));
  const agreedCats = [...codeCats].filter((c) => visionCats.has(c));

  const alignment = {
    codeBlockerCount: codeBlockers.length,
    visionBlockerCount: visionBlockers.length,
    agreedCategories: agreedCats,
    codeOnlyCategories: [...codeCats].filter((c) => !visionCats.has(c)),
    visionOnlyCategories: [...visionCats].filter((c) => !codeCats.has(c)),
    finalVerdict: (codeBlockers.length || visionBlockers.length) ? "REQUEST_CHANGES" : "APPROVE",
  };

  log(`\n${COLORS.bold}┌─ UIUX CROSS-VERIFY ─┐${COLORS.reset}`);
  log(`Final: ${alignment.finalVerdict}`);
  log(`Code BLOCKER:   ${codeBlockers.length}`);
  log(`Vision BLOCKER: ${visionBlockers.length}`);
  log(`Agreed cats:    ${agreedCats.join(", ") || "none"}`);
  if (alignment.codeOnlyCategories.length) log(`Code-only:      ${alignment.codeOnlyCategories.join(", ")}`);
  if (alignment.visionOnlyCategories.length) log(`Vision-only:    ${alignment.visionOnlyCategories.join(", ")}`);

  // 저장
  ensureDir(CONFIG.reviewsDir);
  const outFile = path.join(CONFIG.reviewsDir, `${timestamp()}-uiux-cross.json`);
  fs.writeFileSync(outFile, JSON.stringify({ codeReview, visionReview, alignment }, null, 2));
  logSuccess(`Saved ${outFile}`);

  return { codeReview, visionReview, alignment };
}

function extractCategory(location) {
  // Allow alphanumerics + hyphens so categories like "a11y", "i18n", "design-system" parse correctly.
  const m = (location || "").match(/category:\s*([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : "unknown";
}

// ============================================================================
// SUGGEST FIXES (Stage 4 — 자동 패치 제안)
// ============================================================================

const FIX_PROMPT = `당신은 시니어 frontend 엔지니어다. 아래 UI/UX 리뷰 결과를 받아 BLOCKER 와 SUGGESTION 항목에 대해 *적용 가능한 코드 패치* 를 제안한다.

## 출력 형식

각 이슈마다:

[FIX #N — severity] [path:line]
설명: 무엇을 왜 바꾸는지 1줄.
patch:
\`\`\`diff
- 기존 코드
+ 새 코드
\`\`\`

## 규칙
- 실제 적용 가능한 코드만. placeholder 금지.
- diff 형식 정확히. 컨텍스트 줄 (앞뒤 1-2줄) 포함.
- 한 이슈에 여러 줄 변경 가능, 단 최소 변경 원칙.
- a11y / design token / Tailwind 컨벤션 준수.
- 자신 없는 이슈는 [SKIP #N — reason] 으로 표기 후 건너뛴다.`;

async function uiuxSuggestFixes({ reviewFile, applyMode = "dry-run", model = CONFIG.defaultModel } = {}) {
  logSection("uiux suggest-fixes");
  if (!reviewFile || !fs.existsSync(reviewFile)) {
    logError(`Review file not found: ${reviewFile}`);
    return null;
  }
  const review = JSON.parse(fs.readFileSync(reviewFile, "utf8"));
  const issues = (review.issues || review.codeReview?.issues || []).filter((i) => i.severity !== "NIT");
  if (!issues.length) { logInfo("No actionable issues (BLOCKER/SUGGESTION) found"); return null; }

  const issueText = issues.map((i, n) =>
    `[#${n + 1}] ${i.severity} [${i.location}]\n  이슈: ${i.issue}\n  제안: ${i.suggestion}`
  ).join("\n\n");

  const userPrompt = `## 적용 대상 이슈 (${issues.length}개)\n\n${issueText}\n\n위 형식 그대로 patch 를 출력하라. apply 가능 여부를 명확히 표시.`;

  logInfo(`Generating fixes for ${issues.length} issues...`);
  const resp = await callAnthropicWithRetry({ system: FIX_PROMPT, messages: [{ role: "user", content: userPrompt }], model });
  const text = resp.text;

  // 파싱: [FIX #N] 블록 추출
  const fixes = [];
  const fixPattern = /\[FIX\s*#(\d+)\s*—\s*([A-Z]+)\]\s*\[([^\]]+)\][\s\S]*?\`\`\`diff\n([\s\S]*?)\n\`\`\`/g;
  let m;
  while ((m = fixPattern.exec(text)) !== null) {
    fixes.push({ index: parseInt(m[1], 10), severity: m[2], location: m[3].trim(), patch: m[4] });
  }

  // 출력
  log(`\n${fixes.length} fixes generated:`);
  for (const f of fixes) {
    const icon = f.severity === "BLOCKER" ? `${COLORS.red}⛔${COLORS.reset}` : f.severity === "SUGGESTION" ? `${COLORS.yellow}⚠️${COLORS.reset}` : `${COLORS.blue}💡${COLORS.reset}`;
    log(`\n${icon} #${f.index} [${f.location}]`);
    log(`${COLORS.gray}${f.patch.split("\n").map((l) => "  " + l).join("\n")}${COLORS.reset}`);
  }

  // 저장
  ensureDir(CONFIG.reviewsDir);
  const outFile = reviewFile.replace(/\.json$/, "-fixes.json");
  fs.writeFileSync(outFile, JSON.stringify({ fixes, applyMode, raw: text }, null, 2));
  logSuccess(`Saved ${outFile}`);

  if (applyMode === "apply") {
    logWarn("--apply mode: 실제 파일 수정은 cowork-engine apply-fixes 에 위임됩니다");
  }

  return { fixes, raw: text, outFile };
}

// ============================================================================
// BASELINE (Stage 5 — 시각 회귀)
// ============================================================================

function baselineSave({ screenshotPath, projectSlug, viewport = "desktop" } = {}) {
  if (!screenshotPath || !fs.existsSync(screenshotPath)) { logError("--screenshot required"); return null; }
  if (!projectSlug) { logError("--project required"); return null; }
  ensureDir(CONFIG.baselineDir);
  const dst = path.join(CONFIG.baselineDir, `${projectSlug}-${viewport}.png`);
  fs.copyFileSync(screenshotPath, dst);
  // metadata
  const meta = path.join(CONFIG.baselineDir, `${projectSlug}-${viewport}.json`);
  fs.writeFileSync(meta, JSON.stringify({
    projectSlug, viewport,
    savedAt: new Date().toISOString(),
    sourceFile: screenshotPath,
    size: fs.statSync(dst).size,
  }, null, 2));
  logSuccess(`Baseline saved: ${dst}`);
  return dst;
}

function baselineDiff({ screenshotPath, projectSlug, viewport = "desktop", threshold = 0.05 } = {}) {
  if (!screenshotPath || !fs.existsSync(screenshotPath)) { logError("--screenshot required"); return null; }
  const baseline = path.join(CONFIG.baselineDir, `${projectSlug}-${viewport}.png`);
  if (!fs.existsSync(baseline)) {
    logWarn(`No baseline for ${projectSlug}-${viewport}. Run 'baseline save' first.`);
    return { hasBaseline: false };
  }

  // 간이 diff: 파일 크기 변화율 (실제 픽셀 비교는 외부 라이브러리 필요 — 여기서는 신호만)
  const currentSize = fs.statSync(screenshotPath).size;
  const baselineSize = fs.statSync(baseline).size;
  const sizeDelta = Math.abs(currentSize - baselineSize) / baselineSize;
  const drift = sizeDelta > threshold;

  const result = {
    hasBaseline: true,
    baseline,
    current: screenshotPath,
    sizeDelta: sizeDelta.toFixed(4),
    threshold,
    drift,
    note: drift
      ? `시각 회귀 의심 (size delta ${(sizeDelta * 100).toFixed(2)}% > ${(threshold * 100)}%). 픽셀 단위 비교는 'pixelmatch' 등 외부 도구 권장.`
      : `안정 (size delta ${(sizeDelta * 100).toFixed(2)}% <= ${(threshold * 100)}%).`,
  };

  log(`\n${result.drift ? COLORS.red + "⚠️ DRIFT" : COLORS.green + "✓ STABLE"}${COLORS.reset}`);
  log(`baseline: ${baselineSize} bytes`);
  log(`current:  ${currentSize} bytes`);
  log(`delta:    ${(sizeDelta * 100).toFixed(2)}%`);
  log(result.note);
  return result;
}

// ============================================================================
// PRINT HELPERS
// ============================================================================

function printReview(data) {
  const { verdict, issues, summary } = data;
  const verdictColor = verdict === "APPROVE" ? COLORS.green : verdict === "REQUEST_CHANGES" ? COLORS.red : COLORS.blue;
  log(`\n${COLORS.bold}${verdictColor}${verdict}${COLORS.reset}`);
  const counts = { BLOCKER: 0, SUGGESTION: 0, NIT: 0 };
  for (const i of issues || []) counts[i.severity] = (counts[i.severity] || 0) + 1;
  log(`Issues: ${(issues || []).length}  ⛔${counts.BLOCKER}  ⚠️${counts.SUGGESTION}  💡${counts.NIT}\n`);
  for (const i of issues || []) {
    const icon = i.severity === "BLOCKER" ? `${COLORS.red}⛔${COLORS.reset}` : i.severity === "SUGGESTION" ? `${COLORS.yellow}⚠️${COLORS.reset}` : `${COLORS.blue}💡${COLORS.reset}`;
    log(`${icon} [${i.location}]`);
    log(`  ${i.issue}`);
    log(`  → ${i.suggestion}`);
  }
  if (summary) log(`\n${COLORS.bold}[SUMMARY]${COLORS.reset} ${summary}`);
}

function printVisionReview(data) {
  printReview(data);
  if (data.scores && Object.keys(data.scores).length) {
    log(`\n${COLORS.bold}[SCORES]${COLORS.reset}`);
    for (const [k, v] of Object.entries(data.scores)) {
      const color = v >= 8 ? COLORS.green : v >= 6 ? COLORS.yellow : COLORS.red;
      log(`  ${k}: ${color}${v}/10${COLORS.reset}`);
    }
  }
  if (data.strengths && data.strengths.length) {
    log(`\n${COLORS.bold}[STRENGTHS]${COLORS.reset}`);
    for (const s of data.strengths) log(`  + ${s}`);
  }
}

// ============================================================================
// CLI
// ============================================================================

function parseFlag(args, name, def = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "help";

  try {
    if (cmd === "code-review") {
      const diffSource = args.includes("--branch") ? "branch" : "staged";
      await uiuxCodeReview({
        diffSource,
        projectDir: parseFlag(args, "project-dir") || process.cwd(),
        dryRun: args.includes("--dry-run"),
      });
    } else if (cmd === "vision-review") {
      const screenshotPath = parseFlag(args, "screenshot");
      const viewport = parseFlag(args, "viewport", "desktop");
      const projectSlug = parseFlag(args, "project");
      await uiuxVisionReview({ screenshotPath, viewport, projectSlug, dryRun: args.includes("--dry-run") });
    } else if (cmd === "cross-verify") {
      const screenshotPath = parseFlag(args, "screenshot");
      const viewport = parseFlag(args, "viewport", "desktop");
      const projectSlug = parseFlag(args, "project");
      const diffSource = args.includes("--branch") ? "branch" : "staged";
      await uiuxCrossVerify({ diffSource, screenshotPath, viewport, projectSlug });
    } else if (cmd === "suggest-fixes") {
      const reviewFile = parseFlag(args, "review");
      const applyMode = args.includes("--apply") ? "apply" : "dry-run";
      await uiuxSuggestFixes({ reviewFile, applyMode });
    } else if (cmd === "baseline") {
      const sub = args[1] || "diff";
      const screenshotPath = parseFlag(args, "screenshot");
      const projectSlug = parseFlag(args, "project");
      const viewport = parseFlag(args, "viewport", "desktop");
      if (sub === "save") baselineSave({ screenshotPath, projectSlug, viewport });
      else if (sub === "diff") baselineDiff({ screenshotPath, projectSlug, viewport });
      else { logError(`Unknown baseline sub: ${sub}`); process.exit(1); }
    } else if (cmd === "extract-tokens") {
      const tokens = extractDesignTokens(parseFlag(args, "project-dir") || process.cwd());
      log(JSON.stringify(tokens, null, 2));
    } else if (cmd === "help" || cmd === "-h" || cmd === "--help") {
      log(`
${COLORS.bold}uiux-engine.js — Cowork UI/UX 검토${COLORS.reset}

${COLORS.bold}Commands:${COLORS.reset}
  code-review                                Diff 기반 코드 사이드 6차원 리뷰
  vision-review --screenshot <path>          Vision API 로 스크린샷 6축 평가
  cross-verify --screenshot <path>           코드 리뷰 + Vision 리뷰 합의/불일치 분석
  suggest-fixes --review <review-file>       리뷰 결과 → diff patch 생성
  baseline save --screenshot <p> --project <slug>   시각 baseline 저장
  baseline diff --screenshot <p> --project <slug>   현재 vs baseline 차이 점검
  extract-tokens                             디자인 토큰 추출 (디버그)

${COLORS.bold}Options:${COLORS.reset}
  --diff <staged|branch>     diff 소스 (code-review/cross-verify)
  --screenshot <path>        스크린샷 파일 경로
  --viewport <m|t|d>         mobile / tablet / desktop (기본 desktop)
  --project <slug>           프로젝트 slug (baseline 키)
  --review <file>            리뷰 결과 JSON 경로 (suggest-fixes)
  --dry-run                  API 호출 전 prompt 길이만 표시
  --apply                    suggest-fixes: cowork-engine apply-fixes 에 위임 표시

${COLORS.bold}Cowork 통합:${COLORS.reset}
  스크린샷 캡처는 Claude in Chrome MCP 또는 Playwright 로 진행 후 경로 전달.
  Cowork 세션 안에서: navigate → screenshot 저장 → 본 엔진 호출 → 결과를 review/craft skill 이 사용.
      `);
    } else {
      logError(`Unknown command: ${cmd}`);
      log(`Run: node bin/uiux-engine.js help`);
      process.exit(1);
    }
  } catch (e) {
    logError(`Fatal: ${e.message}`);
    if (process.env.DEBUG) console.error(e);
    process.exit(1);
  }
}

module.exports = {
  uiuxCodeReview,
  uiuxVisionReview,
  uiuxCrossVerify,
  uiuxSuggestFixes,
  baselineSave,
  baselineDiff,
  extractDesignTokens,
  summarizeTokens,
  parseScores,
  parseStrengths,
  extractCategory,
  _setSkillDirOverride,
};

if (require.main === module) main();
