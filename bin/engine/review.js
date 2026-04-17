/**
 * bin/engine/review.js
 * Review logic: API calls, localReview, selfCrossReview, dualReview
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const C = require("../constants");
const core = require("./core");

// Re-export core utilities for convenience
const {
  CONFIG,
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
  estimateCost,
  resolveModelForTier,
} = core;

// ============================================================================
// DIFF CHUNKING
// ============================================================================

function _splitDiffIntoChunks(diffText, maxBytes) {
  if (Buffer.byteLength(diffText, "utf8") <= maxBytes) {
    return [diffText];
  }
  const fileParts = diffText.split(/(?=^diff --git )/m).filter(Boolean);

  if (fileParts.length <= 1) {
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

function _mergeChunkReviews(reviews) {
  const reviewParser = require("../review-parser");
  const verdictLabel = reviewParser.verdictLabel;

  const verdictRank = { APPROVE: 0, COMMENT: 1, REQUEST_CHANGES: 2 };
  let worstVerdict = "APPROVE";
  const allIssues = [];
  const seenLocations = new Set();
  const summaries = [];
  const nextActions = [];

  for (const r of reviews) {
    if ((verdictRank[r.verdict] || 0) > (verdictRank[worstVerdict] || 0)) {
      worstVerdict = r.verdict;
    }
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

    const API_TIMEOUT_MS = C.TIMEOUTS.apiCall;

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

// ============================================================================
// SELF CROSS-REVIEW
// ============================================================================

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

  const crossVerdict = (text.match(/\[CROSS_VERDICT\][:\s]*([A-Z]+)/i) || [])[1] || "AGREE";

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

// Export public functions
module.exports = {
  _splitDiffIntoChunks,
  _mergeChunkReviews,
  callAnthropic,
  callOpenAI,
  selfCrossReview,
};
