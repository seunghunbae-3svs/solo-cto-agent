/**
 * bin/engine/routine.js
 * Claude Code Routines and Managed Agents functions
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const C = require("../constants");
const core = require("./core");

const {
  CONFIG,
  logSection,
  logSuccess,
  logError,
  logWarn,
  logInfo,
  readSkillContext,
  readFailureCatalog,
  estimateCost,
} = core;

const personalization = require("../personalization");
const { readTier } = personalization;

// ============================================================================
// CLAUDE CODE ROUTINES
// ============================================================================

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

function buildRoutineSchedules() {
  const schedules = [...(CONFIG.routines.schedules || [])];
  if (CONFIG.routines.enabled && CONFIG.routines.triggerId && schedules.length === 0) {
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
// CLAUDE MANAGED AGENTS
// ============================================================================

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
  const diffGuardMA = require("../diff-guard");
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
          const reviewParser = require("../review-parser");
          const parseReviewResponse = reviewParser.parseReviewResponse;

          const parsed = JSON.parse(data);
          const text = parsed.content?.map(b => b.text).filter(Boolean).join("\n") || data;
          const review = parseReviewResponse(text);

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

module.exports = {
  fireRoutine,
  buildRoutineSchedules,
  managedAgentReview,
};
