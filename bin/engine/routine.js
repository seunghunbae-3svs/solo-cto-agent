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
// CLAUDE MANAGED AGENTS (v2 — real API, April 2026)
// ============================================================================
//
// Flow: create agent → create environment → create session → send event → poll
// Docs: https://platform.claude.com/docs/en/managed-agents/overview
// Beta header: managed-agents-2026-04-01
// Endpoints: /v1/agents, /v1/environments, /v1/sessions, /v1/sessions/{id}/events
// ============================================================================

/**
 * Helper: make an HTTPS JSON request to the Anthropic API.
 * Returns { statusCode, body } where body is parsed JSON.
 */
function _apiRequest(method, urlPath, apiKey, payload) {
  return new Promise((resolve) => {
    const body = payload ? JSON.stringify(payload) : undefined;
    const req = https.request({
      hostname: C.API_HOSTS.anthropic,
      path: urlPath,
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": C.ANTHROPIC_API_VERSION,
        "anthropic-beta": C.BETA_HEADERS.managedAgents,
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ statusCode: res.statusCode, body: { raw: data } });
        }
      });
    });
    req.on("error", (e) => resolve({ statusCode: 0, body: { error: e.message } }));
    req.setTimeout(C.TIMEOUTS.managedAgent, () => {
      req.destroy(new Error("request timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Poll session until status is "idle" (agent finished) or timeout.
 * Returns the full session object on success, null on timeout/error.
 */
async function _pollSession(sessionId, apiKey, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const pollInterval = 3000; // 3s

  while (Date.now() < deadline) {
    const { statusCode, body } = await _apiRequest("GET", `/v1/sessions/${sessionId}`, apiKey);
    if (statusCode !== 200) {
      logWarn(`Poll failed (${statusCode}): ${JSON.stringify(body).slice(0, 200)}`);
      return null;
    }
    if (body.status === "idle") return body;
    if (body.status === "error" || body.status === "failed") {
      logError(`Session entered error state: ${body.status}`);
      return null;
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  logError(`Session poll timed out after ${timeoutMs / 1000}s`);
  return null;
}

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

  const timeoutMs = CONFIG.managedAgents.sessionTimeoutMs || C.TIMEOUTS.managedAgent;

  if (options.dryRun) {
    logSection("Managed Agent Review — DRY RUN");
    logInfo(`Model: ${model}`);
    logInfo(`Diff size: ${(Buffer.byteLength(diff, "utf8") / 1024).toFixed(0)}KB`);
    logInfo(`Timeout: ${timeoutMs / 1000}s`);
    logInfo(`Beta header: ${C.BETA_HEADERS.managedAgents}`);
    logInfo(`Cost: standard token rates + $0.08/session-hour`);
    logInfo("API flow: create agent → create env → create session → send event → poll");
    return null;
  }

  logSection("Managed Agent Deep Review");
  logInfo(`Model: ${model} | Timeout: ${timeoutMs / 1000}s`);
  logInfo("Cost: standard token rates + $0.08/session-hour active runtime");

  const startTime = Date.now();

  // ── Step 1: Create or reuse agent ──
  let agentId = options.agentId || CONFIG.managedAgents.agentId;
  if (!agentId) {
    logInfo("Creating agent...");
    const agentRes = await _apiRequest("POST", "/v1/agents", apiKey, {
      name: "solo-cto-deep-reviewer",
      description: "CTO-level deep code reviewer for solo-cto-agent CLI.",
      model: { id: model },
      system: systemPrompt,
      tools: [{ type: "agent_toolset_20260401" }],
    });
    if (agentRes.statusCode >= 400 || !agentRes.body.id) {
      logError(`Failed to create agent (${agentRes.statusCode}): ${JSON.stringify(agentRes.body).slice(0, 300)}`);
      return null;
    }
    agentId = agentRes.body.id;
    logInfo(`Agent created: ${agentId}`);
  }

  // ── Step 2: Create or reuse environment ──
  let envId = options.environmentId || CONFIG.managedAgents.environmentId;
  if (!envId) {
    logInfo("Creating environment...");
    const envRes = await _apiRequest("POST", "/v1/environments", apiKey, {
      name: "solo-cto-review-env",
      config: { type: "cloud", networking: { type: "unrestricted" } },
    });
    if (envRes.statusCode >= 400 || !envRes.body.id) {
      logError(`Failed to create environment (${envRes.statusCode}): ${JSON.stringify(envRes.body).slice(0, 300)}`);
      return null;
    }
    envId = envRes.body.id;
    logInfo(`Environment created: ${envId}`);
  }

  // ── Step 3: Create session ──
  logInfo("Creating session...");
  const sessionRes = await _apiRequest("POST", "/v1/sessions", apiKey, {
    agent: agentId,
    environment_id: envId,
    title: `deep-review-${new Date().toISOString().slice(0, 19)}`,
  });
  if (sessionRes.statusCode >= 400 || !sessionRes.body.id) {
    logError(`Failed to create session (${sessionRes.statusCode}): ${JSON.stringify(sessionRes.body).slice(0, 300)}`);
    return null;
  }
  const sessionId = sessionRes.body.id;
  logInfo(`Session created: ${sessionId}`);

  // ── Step 4: Send user message event ──
  logInfo("Sending diff for review...");
  const eventRes = await _apiRequest("POST", `/v1/sessions/${sessionId}/events`, apiKey, {
    events: [{
      type: "user.message",
      content: [{
        type: "text",
        text: `Review this diff:\n\`\`\`diff\n${diff}\n\`\`\`\n\nOutput your review in the standard format:\n[VERDICT] APPROVE | REQUEST_CHANGES | COMMENT\n[ISSUES] list each issue\n[SUMMARY] one-line summary\n[NEXT ACTION] suggested next steps`,
      }],
    }],
  });
  if (eventRes.statusCode >= 400) {
    logError(`Failed to send event (${eventRes.statusCode}): ${JSON.stringify(eventRes.body).slice(0, 300)}`);
    return null;
  }
  logInfo("Event sent — waiting for agent to complete...");

  // ── Step 5: Poll until idle ──
  const finalSession = await _pollSession(sessionId, apiKey, timeoutMs);
  if (!finalSession) return null;

  const elapsed = (Date.now() - startTime) / 1000;
  const activeSeconds = finalSession.stats?.active_seconds || 0;
  const sessionHours = activeSeconds / 3600;
  const runtimeCost = (sessionHours * (C.PRICING.managedAgentRuntime || 0.08)).toFixed(4);

  // ── Step 6: Fetch events to extract agent response ──
  const eventsRes = await _apiRequest("GET", `/v1/sessions/${sessionId}/events`, apiKey);
  if (eventsRes.statusCode >= 400) {
    logError(`Failed to fetch events: ${eventsRes.statusCode}`);
    return null;
  }

  const events = eventsRes.body.data || [];
  const agentMessages = events.filter((e) => e.type === "agent.message");
  const text = agentMessages
    .flatMap((e) => (e.content || []).filter((b) => b.type === "text").map((b) => b.text))
    .join("\n");

  if (!text) {
    logWarn("Agent session completed but no text response found.");
    return null;
  }

  const reviewParser = require("../review-parser");
  const review = reviewParser.parseReviewResponse(text);

  const inputTokens = finalSession.usage?.input_tokens || 0;
  const outputTokens = finalSession.usage?.output_tokens || 0;
  const cacheTokens = finalSession.usage?.cache_creation_input_tokens || 0;
  const tokenCost = estimateCost(inputTokens + cacheTokens, outputTokens, model);
  const totalCost = (parseFloat(tokenCost) + parseFloat(runtimeCost)).toFixed(4);

  logSuccess(`Deep review complete (${elapsed.toFixed(1)}s wall, ${activeSeconds.toFixed(1)}s active)`);
  logInfo(`Runtime cost: $${runtimeCost} | Token cost: $${tokenCost} | Total: $${totalCost}`);
  logInfo(`Session: ${sessionId} | Agent: ${agentId} | Env: ${envId}`);

  return {
    ...review,
    raw: text,
    sessionId,
    agentId,
    environmentId: envId,
    activeSeconds,
    sessionHours,
    tokens: { input: inputTokens, output: outputTokens, cache: cacheTokens },
    cost: { token: tokenCost, runtime: runtimeCost, total: totalCost },
  };
}

module.exports = {
  fireRoutine,
  buildRoutineSchedules,
  managedAgentReview,
};
