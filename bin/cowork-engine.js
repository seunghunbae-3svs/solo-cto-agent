#!/usr/bin/env node

/**
 * cowork-engine.js
 *
 * Facade that orchestrates the refactored sub-modules.
 * This file maintains the original module.exports signature for backward compatibility.
 *
 * Sub-modules:
 *   - bin/engine/core.js — CONFIG, logging, utilities
 *   - bin/engine/review.js — API calls, localReview, selfCrossReview, dualReview
 *   - bin/engine/session.js — session management, context checkpoints
 *   - bin/engine/routine.js — routines, managed agents
 */

const fs = require("fs");
const path = require("path");

// Import sub-modules
const core = require("./engine/core");
const review = require("./engine/review");
const session = require("./engine/session");
const routine = require("./engine/routine");

// Import external dependencies
const personalization = require("./personalization");
const extSignals = require("./external-signals");
const reviewParser = require("./review-parser");

// Initialize CONFIG-dependent modules
const {
  CONFIG,
  log,
  logSection,
  logSuccess,
  logError,
  logWarn,
  logInfo,
  logDim,
  setLogChannel,
  getLogChannel,
} = core;

personalization.init(CONFIG, core._skillBase);
extSignals.init(CONFIG, {});
reviewParser.init(CONFIG, {});

// ============================================================================
// EMBEDDED SKILL CONTEXT & CONSTANTS
// ============================================================================

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

const COMMON_STACK_PATTERNS = `
## Common Stack 반복 에러 패턴 (사용자 stack 매칭 시 활성)
- Next.js: import @/ 절대경로, 14/15 params 동기/Promise 혼용 금지, Tailwind v3/v4 혼용 금지, 'use client' 정확성
- Prisma: Drizzle 와 동시 사용 금지, prisma generate 타이밍 (postinstall 또는 build pre-step), schema 변경 시 마이그레이션 필수
- NextAuth: session.user 확장 시 next-auth.d.ts types 필요, callback URL 환경별 분리
- Supabase: RLS 활성화 (비활성=BLOCKER), service_role 클라이언트 노출 금지, N+1 쿼리 점검
- Vercel: env 변수 누락 / prisma generate 타이밍 / build command 불일치 = 빌드 실패 상위 3
`;

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

const SKILL_CONTEXT = OPERATING_PRINCIPLES + "\n" + COMMON_STACK_PATTERNS;
const SKILL_REVIEW_CRITERIA = REVIEW_PRIORITY;

// Delegated functions
const normalizeVerdict = reviewParser.normalizeVerdict;
const verdictLabel = reviewParser.verdictLabel;
const normalizeSeverity = reviewParser.normalizeSeverity;
const parseReviewResponse = reviewParser.parseReviewResponse;
const formatCrossCheck = reviewParser.formatCrossCheck;
const formatTerminalOutput = reviewParser.formatTerminalOutput;
const COLORS = reviewParser.COLORS;

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
const AGENT_IDENTITY_BY_TIER = extSignals.AGENT_IDENTITY_BY_TIER;
const AGENT_IDENTITY = extSignals.AGENT_IDENTITY;

const readTier = personalization.readTier;
const readMode = personalization.readMode;
const loadPersonalization = personalization.loadPersonalization;
const savePersonalization = personalization.savePersonalization;
const updatePersonalizationFromReview = personalization.updatePersonalizationFromReview;
const recordFeedback = personalization.recordFeedback;
const personalizationContext = personalization.personalizationContext;

// ============================================================================
// MAIN REVIEW FUNCTIONS (facade orchestration)
// ============================================================================

async function localReview(options = {}) {
  const callerSpecifiedModel = Object.prototype.hasOwnProperty.call(options, "model");
  const {
    diffSource = "staged",
    target = null,
    model: callerModel = CONFIG.defaultModel.claude,
    dryRun = false,
    outputFormat = "terminal",
    crossCheck = null,
  } = options;

  const cwd = process.cwd();
  const tier = readTier();
  const model = callerSpecifiedModel ? callerModel : core.resolveModelForTier(tier);
  const mode = readMode();
  const agent = process.env.OPENAI_API_KEY ? "cowork+codex" : "cowork";
  const tierLimits = CONFIG.tierLimits[tier] || CONFIG.tierLimits.builder;
  const useCrossCheck = crossCheck !== null ? crossCheck : tierLimits.selfCrossReview;

  logSection("solo-cto-agent review");
  logInfo(`Mode: ${mode} | Agent: ${agent} | Tier: ${tier}`);
  logInfo(`Source: ${diffSource} changes`);
  logInfo(`Model: ${model}`);
  if (useCrossCheck) logInfo(`Self cross-review: ON (tier=${tier})`);

  let diffBase = null;
  let diffTarget = null;
  let diff;
  if (diffSource === "branch") {
    diffBase = target || core.detectDefaultBranch({ cwd });
    diff = core.getDiff("branch", diffBase, { cwd });
    logInfo(`Base: ${diffBase}`);
  } else if (diffSource === "file") {
    diffTarget = target;
    diff = core.getDiff("file", diffTarget, { cwd });
  } else {
    diff = core.getDiff("staged", null, { cwd });
  }
  if (!diff || diff.trim().length === 0) {
    logWarn("No changes found");
    return null;
  }

  logInfo(`Diff: ${diff.split("\n").length} lines`);

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

  const diffBytes = Buffer.byteLength(diff, "utf8");
  const maxBytes = CONFIG.diff.maxChunkBytes;
  let diffChunks = null;
  if (diffBytes > maxBytes) {
    diffChunks = review._splitDiffIntoChunks(diff, maxBytes);
    logWarn(`Diff is large (${(diffBytes / 1024).toFixed(0)}KB > ${(maxBytes / 1024).toFixed(0)}KB limit). Split into ${diffChunks.length} chunk${diffChunks.length === 1 ? "" : "s"} for review.`);
  }

  const skillContext = core.readSkillContext();
  const failureCatalog = core.readFailureCatalog();
  const personalCtx = personalizationContext();
  const liveCtx = liveSourceContext();
  const identity = buildIdentity(tier, agent);

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
    } catch (_) { /* never block dry-run */ }
    return null;
  }

  let reviewResult, response, rawTexts;

  try {
    if (diffChunks && diffChunks.length > 1) {
      logInfo(`Calling Anthropic API — ${diffChunks.length} chunks (maxRetries=${tierLimits.maxRetries})...`);
      const chunkResults = [];
      rawTexts = [];
      for (let i = 0; i < diffChunks.length; i++) {
        logInfo(`  Chunk ${i + 1}/${diffChunks.length} (${(Buffer.byteLength(diffChunks[i], "utf8") / 1024).toFixed(0)}KB)...`);
        const chunkPrompt = _buildUserPrompt(diffChunks[i]);
        const chunkResp = await review.callAnthropic(chunkPrompt, systemPrompt, model, { maxRetries: tierLimits.maxRetries });
        chunkResults.push(parseReviewResponse(chunkResp.text));
        rawTexts.push(chunkResp.text);
      }
      reviewResult = review._mergeChunkReviews(chunkResults);
      response = { text: rawTexts.join("\n\n---\n\n"), usage: { input_tokens: 0, output_tokens: 0 } };
    } else {
      logInfo(`Calling Anthropic API (maxRetries=${tierLimits.maxRetries})...`);
      response = await review.callAnthropic(userPrompt, systemPrompt, model, { maxRetries: tierLimits.maxRetries });
      reviewResult = parseReviewResponse(response.text);
    }

    const inputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
    const outputTokens = Math.ceil(response.text.length / 4);
    const totalCost = core.estimateCost(inputTokens, outputTokens, model);

    core.ensureDir(CONFIG.reviewsDir);
    const reviewFile = path.join(CONFIG.reviewsDir, `${core.timestamp()}.json`);

    const reviewData = {
      timestamp: new Date().toISOString(),
      mode,
      agent,
      tier,
      model,
      diffSource,
      diffBase,
      diffTarget,
      verdict: reviewResult.verdict,
      issueCount: reviewResult.issues.length,
      issues: reviewResult.issues,
      summary: reviewResult.summary,
      raw: response.text,
      tokens: {
        input: inputTokens,
        output: outputTokens,
      },
      cost: totalCost,
    };

    if (useCrossCheck && agent === "cowork") {
      logInfo("Running self cross-review (devil's advocate pass)...");
      try {
        const cross = await review.selfCrossReview({
          diff,
          firstPass: reviewResult,
          firstPassRaw: response.text,
          systemPromptBase: identity,
          model,
          maxRetries: tierLimits.maxRetries,
        });
        reviewData.crossCheck = cross;
        if (cross.commonBlockers > 0 && reviewData.verdict !== "REQUEST_CHANGES") {
          reviewData.verdict = "REQUEST_CHANGES";
          reviewData.verdictUpgradedBy = "self-cross-review";
        }
        reviewData.tokens.input += cross.tokens.input;
        reviewData.tokens.output += cross.tokens.output;
        reviewData.cost = (parseFloat(reviewData.cost) + parseFloat(cross.cost)).toFixed(4);
      } catch (err) {
        logWarn(`Self cross-review failed: ${err.message} — 1차 결과만 보고`);
        reviewData.crossCheckError = err.message;
      }
    }

    try {
      updatePersonalizationFromReview(reviewResult);
    } catch (_) { /* personalization update failures don't affect review */ }

    const externalSignals = assessExternalSignals({
      outcome: {
        t2Applied: !!(externalKnowledge && externalKnowledge.hasData),
        t3Applied: !!(groundTruth && groundTruth.hasData),
      },
    });
    reviewData.externalSignals = externalSignals;
    if (groundTruth) reviewData.groundTruth = groundTruth;
    if (externalKnowledge) reviewData.externalKnowledge = externalKnowledge;

    fs.writeFileSync(reviewFile, JSON.stringify(reviewData, null, 2));

    if (outputFormat === "json") {
      process.stdout.write(JSON.stringify(reviewData, null, 2) + "\n");
    } else if (outputFormat === "markdown") {
      log(response.text);
      if (externalSignals.isSelfLoop) {
        log("\n> ⚠️ **SELF-LOOP NOTICE** — no external signals (peer model / external knowledge / ground truth) were active for this review. Run `dual-review` or set `VERCEL_TOKEN` / `SUPABASE_ACCESS_TOKEN` / `COWORK_EXTERNAL_KNOWLEDGE=1` to close the loop.\n");
      }
    } else {
      const costInfo = {
        inputTokens: (inputTokens / 1000).toFixed(1),
        outputTokens: (outputTokens / 1000).toFixed(1),
        total: totalCost,
        savedPath: reviewFile,
      };
      const output = formatTerminalOutput(reviewResult, { diffSource }, costInfo);
      log(output);
      if (reviewData.crossCheck) {
        log(formatCrossCheck(reviewData.crossCheck));
      }
      const warning = formatSelfLoopWarning(externalSignals);
      if (warning) log(warning);
      else {
        const hint = formatPartialSignalHint(externalSignals);
        if (hint) log(hint);
      }
    }

    logSuccess(`Review saved to ${reviewFile}`);

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

async function knowledgeCapture(options = {}) {
  const { source = "session", input = null, projectTag = null } = options;

  logSection("solo-cto-agent knowledge-capture");
  logInfo(`Source: ${source}`);
  if (projectTag) logInfo(`Project: ${projectTag}`);

  let content = "";

  if (source === "session") {
    logInfo("Scanning recent commits (24h)...");
    content = core.getRecentCommits(24);
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
    const response = await review.callAnthropic(userPrompt, systemPrompt, CONFIG.defaultModel.claude);

    const titleMatch = response.text.match(/\[TITLE\]:\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled";

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50);

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

    core.ensureDir(CONFIG.knowledgeDir);
    const articleFile = path.join(
      CONFIG.knowledgeDir,
      `${new Date().toISOString().split("T")[0]}-${slug}.md`
    );

    fs.writeFileSync(articleFile, markdown);
    logSuccess(`Knowledge article saved to ${articleFile}`);

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
  const _dualTier = (typeof readTier === "function") ? readTier() : "builder";
  const claudeModel = callerSpecifiedClaudeModel ? callerClaudeModel : core.resolveModelForTier(_dualTier);
  let diffBase = null;
  let diffTarget = null;
  let diff;
  if (diffSource === "branch") {
    diffBase = target || core.detectDefaultBranch({ cwd });
    diff = core.getDiff("branch", diffBase, { cwd });
    logInfo(`Base: ${diffBase}`);
  } else if (diffSource === "file") {
    diffTarget = target;
    diff = core.getDiff("file", diffTarget, { cwd });
  } else {
    diff = core.getDiff("staged", null, { cwd });
  }
  if (!diff || diff.trim().length === 0) {
    logWarn("No changes found");
    return null;
  }

  logInfo(`Diff: ${diff.split("\n").length} lines`);

  const skillContext = core.readSkillContext();
  const failureCatalog = core.readFailureCatalog();
  const errorPatterns = failureCatalog.patterns
    ?.map((p) => `- ${p.pattern}: ${p.fix}`)
    .join("\n") || "No patterns loaded";

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
    claudeResponse = await review.callAnthropic(userPrompt, systemPrompt, claudeModel);
    logSuccess("Claude review complete");
  } catch (err) {
    logError(`Claude API failed: ${err.message}`);
    claudeResponse = { text: "[FAILURE] Claude API error", usage: {} };
  }

  logInfo("Calling OpenAI...");
  try {
    codexResponse = await review.callOpenAI(userPrompt, systemPrompt, codexModel);
    logSuccess("OpenAI review complete");
  } catch (err) {
    logError(`OpenAI API failed: ${err.message}`);
    codexResponse = { text: "[FAILURE] OpenAI API error", usage: {} };
  }

  const claudeReview = parseReviewResponse(claudeResponse.text);
  const codexReview = parseReviewResponse(codexResponse.text);

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

  const finalVerdict =
    claudeReview.verdict === "REQUEST_CHANGES" ||
    codexReview.verdict === "REQUEST_CHANGES"
      ? "REQUEST_CHANGES"
      : claudeReview.verdict === "COMMENT" || codexReview.verdict === "COMMENT"
      ? "COMMENT"
      : "APPROVE";

  core.ensureDir(CONFIG.reviewsDir);
  const reviewFile = path.join(
    CONFIG.reviewsDir,
    `${core.timestamp()}-dual.json`
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

  log("\n");
  log(`${COLORS.bold}┌─ CROSS-REVIEW SUMMARY ─┐${COLORS.reset}`);
  log(
    `${COLORS.bold}│${COLORS.reset} Final Verdict: ${
      finalVerdict === "APPROVE"
        ? COLORS.green
        : finalVerdict === "REQUEST_CHANGES"
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

  const hint = formatPartialSignalHint(externalSignals);
  if (hint) log(hint);

  try {
    const notifyMod = require("./notify");
    const cv = claudeReview && claudeReview.verdict;
    const xv = codexReview && codexReview.verdict;
    let crossVerdict;
    if (!cv || !xv) {
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

function detectMode() {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasAnthropic && hasOpenAI) return "dual";
  if (hasAnthropic) return "solo";
  return "none";
}

// Helper for autoSync (GitHub API calls)
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

    const https = require("https");
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

  let orchRepo = orchestratorRepo;
  if (!orchRepo) {
    try {
      const { execSync: exec } = require("child_process");
      const url = exec("git config --get remote.origin.url", { encoding: "utf8" }).trim();
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
  core.ensureDir(syncDir);

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
        session.sessionSave({ projectTag });
      } else if (subcommand === "restore") {
        const sessionIdx = args.indexOf("--session");
        const sessionFile = sessionIdx >= 0 ? args[sessionIdx + 1] : null;
        const data = session.sessionRestore({ sessionFile });
        if (data) {
          log(JSON.stringify(data, null, 2));
        }
      } else if (subcommand === "list") {
        const limitIdx = args.indexOf("--limit");
        const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 10;
        session.sessionList({ limit });
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
// EXPORTS & EXECUTION
// ============================================================================

module.exports = {
  // Main public functions
  localReview,
  knowledgeCapture,
  dualReview,
  detectMode,
  // Session management
  sessionSave: session.sessionSave,
  sessionRestore: session.sessionRestore,
  sessionList: session.sessionList,
  autoSync,
  // Context checkpoints
  contextCheckpoint: session.contextCheckpoint,
  contextRestore: session.contextRestore,
  reworkContextRefresh: session.reworkContextRefresh,
  // Self cross-review
  selfCrossReview: review.selfCrossReview,
  // Personalization
  readTier,
  readMode,
  loadPersonalization,
  savePersonalization,
  updatePersonalizationFromReview,
  personalizationContext,
  recordFeedback,
  // External signals
  assessExternalSignals,
  formatSelfLoopWarning,
  formatPartialSignalHint,
  // Ground truth (T3)
  resolveVercelProject,
  resolveSupabaseProject,
  fetchVercelGroundTruth,
  summarizeVercelDeployments,
  fetchGroundTruth,
  formatGroundTruthContext,
  // External knowledge (T2)
  scanPackageJson,
  parsePinnedVersion,
  compareVersions,
  fetchNpmRegistry,
  fetchPackageCurrency,
  fetchExternalKnowledge,
  formatExternalKnowledgeContext,
  // Security (T2)
  normalizeOsvSeverity,
  severityRank,
  fetchOsvAdvisories,
  fetchSecurityAdvisories,
  // Live sources & identity
  detectLiveSources,
  liveSourceContext,
  buildIdentity,
  AGENT_IDENTITY_BY_TIER,
  // Review parsing
  parseReviewResponse,
  // Utilities
  getDiff: core.getDiff,
  detectDefaultBranch: core.detectDefaultBranch,
  setLogChannel,
  getLogChannel,
  readSkillContext: core.readSkillContext,
  readFailureCatalog: core.readFailureCatalog,
  _setSkillDirOverride: core._setSkillDirOverride,
  _splitDiffIntoChunks: review._splitDiffIntoChunks,
  _mergeChunkReviews: review._mergeChunkReviews,
  // Model resolution & cost
  resolveModelForTier: core.resolveModelForTier,
  estimateCost: core.estimateCost,
  // Routines & managed agents
  fireRoutine: routine.fireRoutine,
  buildRoutineSchedules: routine.buildRoutineSchedules,
  managedAgentReview: routine.managedAgentReview,
  // CONFIG
  CONFIG,
};

if (require.main === module) {
  main();
}
