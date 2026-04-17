#!/usr/bin/env node

/**
 * telegram-bot.js — Long-polling bot for PR decision callbacks (Tier 1).
 *
 * Handles callback_query events from inline keyboard buttons in Telegram
 * messages sent by GitHub Actions workflows (telegram-notify.yml).
 *
 * Callback format: "DECISION|<repo>|<pr_number>|<action>"
 *   - APPROVE: approve PR + merge
 *   - HOLD: add "hold" label
 *   - FEEDBACK: ask for text, add as PR comment
 *
 * Also handles basic text commands:
 *   - /status: report bot status
 *   - /help: show available commands
 *
 * No npm dependencies beyond Node.js built-ins (https, fs, etc.).
 * All network calls stubbed for testing.
 */

"use strict";

const https = require("https");
const fs = require("fs");
const url = require("url");

// Polling state
let botState = {
  running: false,
  token: null,
  chatId: null,
  offset: 0,
  lastUpdate: null,
};

let pollInterval = null;

// --------------------------------------------------------------------------
// HTTP helpers (match notify.js + telegram-wizard.js pattern)
// --------------------------------------------------------------------------

function httpGetJson(rawUrl, timeoutMs) {
  const timeout = timeoutMs || 15000;
  return new Promise((resolve, reject) => {
    const req = https.get(rawUrl, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({ status: res.statusCode || 0, body, json: body ? JSON.parse(body) : null });
        } catch (e) {
          resolve({ status: res.statusCode || 0, body, json: null, parseError: e.message });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => {
      req.destroy(new Error("telegram-bot: request timeout"));
    });
  });
}

function httpPostJson(rawUrl, payload) {
  const data = Buffer.from(JSON.stringify(payload), "utf8");
  const u = new URL(rawUrl);
  const opts = {
    method: "POST",
    hostname: u.hostname,
    path: u.pathname + u.search,
    port: u.port || 443,
    headers: { "content-type": "application/json", "content-length": data.length },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        try {
          resolve({ status: res.statusCode || 0, body, json: body ? JSON.parse(body) : null });
        } catch (e) {
          resolve({ status: res.statusCode || 0, body, json: null, parseError: e.message });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(new Error("telegram-bot: request timeout")); });
    req.write(data);
    req.end();
  });
}

// --------------------------------------------------------------------------
// Callback parsing
// --------------------------------------------------------------------------

/**
 * Parse callback data in format: "DECISION|<repo>|<pr_number>|<action>"
 * Returns { ok, type, repo, prNumber, action, error } object.
 */
function _parseCallbackData(data) {
  if (!data || typeof data !== "string") {
    return { ok: false, error: "Invalid callback data" };
  }
  const parts = data.split("|");
  if (parts.length !== 4 || parts[0] !== "DECISION") {
    return { ok: false, error: `Invalid callback format: expected DECISION|repo|pr_number|action, got "${data}"` };
  }
  const [, repo, prStr, action] = parts;
  const prNumber = parseInt(prStr, 10);
  if (!repo || !prNumber || !action) {
    return { ok: false, error: "Missing required fields in callback data" };
  }
  if (!["APPROVE", "HOLD", "FEEDBACK"].includes(action)) {
    return { ok: false, error: `Unknown action: ${action}` };
  }
  return {
    ok: true,
    type: "DECISION",
    repo,
    prNumber,
    action,
  };
}

// --------------------------------------------------------------------------
// GitHub API calls (testable with injectable _githubApi)
// --------------------------------------------------------------------------

/**
 * Make a GitHub API call. Wrapper for testing.
 * Signature: _githubApi({ method, endpoint, body, token })
 */
async function _githubApi({ method = "POST", endpoint, body = null, token }) {
  if (!token) throw new Error("GITHUB_TOKEN not set");
  const opts = {
    method,
    hostname: "api.github.com",
    path: endpoint,
    headers: {
      "Authorization": `token ${token}`,
      "User-Agent": "solo-cto-agent-telegram-bot",
      "Accept": "application/vnd.github.v3+json",
    },
  };
  if (body) {
    const data = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
    opts.headers["Content-Length"] = Buffer.byteLength(data);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        try {
          const json = body ? JSON.parse(body) : null;
          if (res.statusCode >= 400) {
            const err = new Error(`GitHub API error: ${res.statusCode} ${json?.message || "unknown"}`);
            err.statusCode = res.statusCode;
            reject(err);
          } else {
            resolve({ status: res.statusCode, json });
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(new Error("github-api: request timeout")); });
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// --------------------------------------------------------------------------
// Handle callback_query events
// --------------------------------------------------------------------------

/**
 * Process a single callback_query event.
 * Parses the data, routes to appropriate GitHub action, answers callback.
 */
async function handleCallback(callbackQuery, botToken, deps = {}) {
  const { callback_query_id, from, data, message } = callbackQuery;
  if (!callback_query_id || !data || !message) {
    console.log("[telegram-bot] Invalid callback_query structure");
    return { ok: false, error: "Invalid callback_query" };
  }

  const parsed = _parseCallbackData(data);
  if (!parsed.ok) {
    console.log(`[telegram-bot] Parse error: ${parsed.error}`);
    // Answer the callback so the spinner stops, even on parse error
    try {
      await (deps.httpPostJson || httpPostJson)(
        `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
        { callback_query_id, text: `❌ ${parsed.error}`, show_alert: true }
      );
    } catch (e) {
      console.error(`[telegram-bot] Failed to answer callback: ${e.message}`);
    }
    return parsed;
  }

  const { repo, prNumber, action } = parsed;
  const token = process.env.GITHUB_TOKEN;
  const githubApi = deps._githubApi || _githubApi;

  try {
    // Determine the owner/repo format. Support both "owner/repo" and "repo".
    let ownerRepo = repo;
    if (!repo.includes("/")) {
      // If only repo name, prepend default owner
      ownerRepo = `seunghunbae-3svs/${repo}`;
    }

    if (action === "APPROVE") {
      // POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews
      await githubApi({
        method: "POST",
        endpoint: `/repos/${ownerRepo}/pulls/${prNumber}/reviews`,
        body: { event: "APPROVE" },
        token,
      });
      // PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge
      const mergeRes = await githubApi({
        method: "PUT",
        endpoint: `/repos/${ownerRepo}/pulls/${prNumber}/merge`,
        body: { commit_title: `Merge PR #${prNumber}` },
        token,
      });
      console.log(`[telegram-bot] ✓ PR #${prNumber} approved & merged`);
      // Answer the callback
      await (deps.httpPostJson || httpPostJson)(
        `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
        { callback_query_id, text: "✅ PR approved & merged", show_alert: false }
      );
    } else if (action === "HOLD") {
      // POST /repos/{owner}/{repo}/issues/{issue_number}/labels
      await githubApi({
        method: "POST",
        endpoint: `/repos/${ownerRepo}/issues/${prNumber}/labels`,
        body: { labels: ["hold"] },
        token,
      });
      console.log(`[telegram-bot] ✓ Added 'hold' label to PR #${prNumber}`);
      await (deps.httpPostJson || httpPostJson)(
        `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
        { callback_query_id, text: "⏸️ Marked as hold", show_alert: false }
      );
    } else if (action === "FEEDBACK") {
      // For now, just acknowledge. In a real system, you'd send a follow-up
      // message asking for feedback text, then add it as a comment when received.
      console.log(`[telegram-bot] → Feedback requested for PR #${prNumber}`);
      await (deps.httpPostJson || httpPostJson)(
        `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
        { callback_query_id, text: "📝 Reply with feedback (not yet implemented)", show_alert: false }
      );
    }

    return { ok: true, action, repo, prNumber };
  } catch (e) {
    console.error(`[telegram-bot] ${action} failed for PR #${prNumber}: ${e.message}`);
    try {
      await (deps.httpPostJson || httpPostJson)(
        `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
        { callback_query_id, text: `❌ ${action} failed: ${e.message}`, show_alert: true }
      );
    } catch (answerErr) {
      console.error(`[telegram-bot] Failed to answer callback: ${answerErr.message}`);
    }
    return { ok: false, error: e.message, action, repo, prNumber };
  }
}

// --------------------------------------------------------------------------
// Dashboard: cross-repo PR status via GitHub API
// --------------------------------------------------------------------------

const DASHBOARD_REPOS = [
  "seunghunbae-3svs/eventbadge",
  "seunghunbae-3svs/golf-now",
  "seunghunbae-3svs/tribo-store",
];

async function _handleDashboard(chat, botToken, deps, detailed) {
  const post = deps.httpPostJson || httpPostJson;
  const get = deps.httpGetJson || httpGetJson;
  const githubToken = process.env.GITHUB_TOKEN || process.env.ORCHESTRATOR_PAT;

  if (!githubToken) {
    await post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chat.id,
      text: "GITHUB_TOKEN not set -- cannot fetch PR data.",
    });
    return { ok: false, error: "no github token" };
  }

  const lines = ["<b>Cross-Repo Dashboard</b>", ""];
  let totalOpen = 0;

  for (const repo of DASHBOARD_REPOS) {
    const short = repo.split("/")[1];
    try {
      const res = await _githubApi({
        method: "GET",
        endpoint: `/repos/${repo}/pulls?state=open&per_page=20`,
        token: githubToken,
      });
      const prs = (res && res.json) ? (Array.isArray(res.json) ? res.json : []) : [];
      totalOpen += prs.length;

      if (prs.length === 0) {
        lines.push(`<b>${short}</b>: no open PRs`);
      } else {
        lines.push(`<b>${short}</b> (${prs.length} open)`);
        for (const pr of prs.slice(0, detailed ? 10 : 3)) {
          const branch = pr.head ? pr.head.ref : "";
          let icon = "";
          if (branch.includes("codex")) icon = "G ";
          if (branch.includes("claude")) icon = "C ";
          lines.push(`  ${icon}#${pr.number} ${(pr.title || "").slice(0, 40)}`);
        }
        if (!detailed && prs.length > 3) {
          lines.push(`  ... +${prs.length - 3} more`);
        }
      }
      lines.push("");
    } catch (e) {
      lines.push(`<b>${short}</b>: error (${e.message.slice(0, 50)})`);
      lines.push("");
    }
  }

  lines.push(`Total open PRs: ${totalOpen}`);

  await post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chat.id,
    text: lines.join("\n"),
    parse_mode: "HTML",
  });

  return { ok: true, command: detailed ? "dashboard" : "prs" };
}

// --------------------------------------------------------------------------
// Handle text messages
// --------------------------------------------------------------------------

/**
 * Process a single text message.
 * Routes basic commands like /status, /help, /prs, /dashboard.
 */
async function handleMessage(message, botToken, deps = {}) {
  const { chat, text } = message;
  if (!chat || !text) {
    console.log("[telegram-bot] Invalid message structure");
    return { ok: false, error: "Invalid message" };
  }

  const trimmed = text.trim().toLowerCase();

  if (trimmed === "/status") {
    const statusMsg = `ℹ️ <b>Bot Status</b>\nRunning: ${botState.running}\nToken: ${botState.token ? "✓ set" : "✗ not set"}\nChat ID: ${botState.chatId || "unknown"}`;
    try {
      await (deps.httpPostJson || httpPostJson)(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        { chat_id: chat.id, text: statusMsg, parse_mode: "HTML" }
      );
      return { ok: true, command: "status" };
    } catch (e) {
      console.error(`[telegram-bot] Failed to send status: ${e.message}`);
      return { ok: false, error: e.message };
    }
  } else if (trimmed === "/help") {
    const helpMsg = [
      "<b>solo-cto-agent Telegram Bot</b>",
      "",
      "Commands:",
      "/status - Bot status",
      "/prs - Open PRs across all repos",
      "/dashboard - Full cross-repo dashboard",
      "/help - Show this message",
      "",
      "Use inline buttons to approve, hold, or feedback on PRs.",
    ].join("\n");
    try {
      await (deps.httpPostJson || httpPostJson)(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        { chat_id: chat.id, text: helpMsg, parse_mode: "HTML" }
      );
      return { ok: true, command: "help" };
    } catch (e) {
      console.error(`[telegram-bot] Failed to send help: ${e.message}`);
      return { ok: false, error: e.message };
    }
  } else if (trimmed === "/prs" || trimmed === "/dashboard") {
    // Cross-repo PR dashboard via GitHub API
    return _handleDashboard(chat, botToken, deps, trimmed === "/dashboard");
  } else {
    // Natural language routing: check for PR-related keywords
    const prMatch = text.match(/(?:approve|merge|hold|close)\s+(?:#?)(\d+)/i);
    if (prMatch) {
      console.log(`[telegram-bot] Natural language PR command: ${text.slice(0, 80)}`);
      // Try to extract repo context from recent messages or default
      await (deps.httpPostJson || httpPostJson)(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          chat_id: chat.id,
          text: `Use inline buttons on PR notifications, or specify repo:\n<code>approve eventbadge #${prMatch[1]}</code>`,
          parse_mode: "HTML",
        }
      );
      return { ok: true, command: "natural-hint" };
    }
    // Unknown command or plain text -- acknowledge
    console.log(`[telegram-bot] Received message: ${text.slice(0, 50)}`);
    return { ok: true, command: "text" };
  }
}

// --------------------------------------------------------------------------
// Long-polling loop
// --------------------------------------------------------------------------

/**
 * Start the bot's long-polling loop. Reads TELEGRAM_BOT_TOKEN and
 * TELEGRAM_CHAT_ID from environment, then polls for updates indefinitely.
 * Dies on SIGINT/SIGTERM.
 */
async function startBot(opts = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error("❌ TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set");
    console.error("   Run: solo-cto-agent telegram wizard");
    process.exit(1);
  }

  botState.token = token;
  botState.chatId = chatId;
  botState.running = true;
  botState.offset = 0;

  console.log("ℹ️ Telegram bot starting...");
  console.log(`   Token: ${token.slice(0, 10)}...`);
  console.log(`   Chat ID: ${chatId}`);

  // Delete any existing webhook (long-polling and webhooks are mutually exclusive)
  try {
    const delRes = await httpPostJson(
      `https://api.telegram.org/bot${token}/deleteWebhook`,
      { drop_pending_updates: false }
    );
    if (delRes.json && delRes.json.ok) {
      console.log("   Webhook cleared (switching to long-poll mode)");
    } else {
      console.log(`   deleteWebhook response: ${delRes.body}`);
    }
  } catch (e) {
    console.error(`   Warning: deleteWebhook failed: ${e.message}`);
    // Continue anyway -- might still work if no webhook was set
  }

  // Graceful shutdown on SIGINT/SIGTERM
  process.on("SIGINT", () => {
    console.log("\n⏹️ Shutting down...");
    stopBot();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    console.log("\n⏹️ Shutting down...");
    stopBot();
    process.exit(0);
  });

  // Start polling loop
  await _pollLoop(token, opts);
}

/**
 * Stop the polling loop.
 */
function stopBot() {
  botState.running = false;
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Main polling loop. Fetches updates, dispatches to handlers, acks updates.
 */
async function _pollLoop(token, opts = {}) {
  const pollDelay = opts.pollMs || 1000;
  const httpGetJsonImpl = opts.httpGetJson || httpGetJson;
  const httpPostJsonImpl = opts.httpPostJson || httpPostJson;

  while (botState.running) {
    try {
      // Telegram long-poll: server holds connection for `timeout` seconds.
      // HTTP client timeout must be longer than server timeout.
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${botState.offset}&allowed_updates=["callback_query","message"]&timeout=10`;
      const res = await httpGetJsonImpl(url, 20000);

      if (!res.json || !res.json.ok) {
        console.error(`[telegram-bot] getUpdates failed: ${res.json?.description || "unknown error"}`);
        // Wait before retrying
        await new Promise((r) => setTimeout(r, pollDelay));
        continue;
      }

      const updates = res.json.result || [];
      for (const upd of updates) {
        if (typeof upd.update_id === "number") {
          botState.offset = upd.update_id + 1;
        }

        if (upd.callback_query) {
          await handleCallback(upd.callback_query, token, {
            httpPostJson: httpPostJsonImpl,
            _githubApi: opts._githubApi || _githubApi,
          });
        } else if (upd.message && upd.message.text) {
          await handleMessage(upd.message, token, { httpPostJson: httpPostJsonImpl });
        }
      }

      botState.lastUpdate = new Date().toISOString();

      // Small delay between polls
      await new Promise((r) => setTimeout(r, pollDelay));
    } catch (e) {
      console.error(`[telegram-bot] Polling error: ${e.message}`);
      await new Promise((r) => setTimeout(r, pollDelay));
    }
  }
}

// --------------------------------------------------------------------------
// Exports for testing + CLI
// --------------------------------------------------------------------------

module.exports = {
  startBot,
  stopBot,
  handleCallback,
  handleMessage,
  _parseCallbackData,
  _githubApi,
};
