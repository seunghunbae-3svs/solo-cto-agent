"use strict";

/**
 * telegram-commands.js — Shared CTO-level command handlers for the
 * Telegram surfaces (long-poll bot in bin/telegram-bot.js and serverless
 * webhook in templates/orchestrator/api/telegram-webhook.js).
 *
 * Single source of truth for:
 *   - Command parsing (/status, /list, /rework, /approve, /do, /digest)
 *   - Inline-button callback parsing (DECISION|…, APPROVE|…, REJECT|…,
 *     REWORK|…, MERGE|…)
 *   - Authorization (admin-only gate for /merge and MERGE callback)
 *   - Inline-keyboard rendering (PR action row used across all PR-referencing
 *     messages)
 *
 * Design:
 *   - No npm deps. Callers inject `{ ghApi, telegram }` functions that already
 *     speak GitHub + Telegram.
 *   - All handlers return `{ ok, text?, extra?, error? }` so the caller can
 *     drive either `sendMessage` (long-poll bot) or `res.status(200).json(...)`
 *     (serverless).
 *   - Authorization is a pure function of `adminChatIds` + caller chat id.
 *   - Tracked repos resolved once per request: TRACKED_REPOS > PRODUCT_REPOS >
 *     explicit list passed by caller.
 */

// --------------------------------------------------------------------------
// Env helpers
// --------------------------------------------------------------------------

function splitCsv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the list of owner/repo slugs this bot should query.
 * Preference order: explicit arg > TRACKED_REPOS env > PRODUCT_REPOS env.
 */
function resolveTrackedRepos(env = process.env, explicit = null) {
  if (Array.isArray(explicit) && explicit.length) return explicit.slice();
  const tracked = splitCsv(env.TRACKED_REPOS);
  if (tracked.length) return tracked;
  const products = splitCsv(env.PRODUCT_REPOS);
  if (products.length) return products;
  return [];
}

/**
 * Resolve the admin chat-id allowlist.
 */
function resolveAdminChatIds(env = process.env) {
  return splitCsv(env.TELEGRAM_ADMIN_CHAT_IDS);
}

/**
 * Is the caller allowed to invoke an admin-only action?
 * Empty admin list → everyone is denied admin (fail-closed on /merge).
 */
function isAdmin(chatId, adminChatIds) {
  if (!chatId) return false;
  const list = Array.isArray(adminChatIds) ? adminChatIds : splitCsv(adminChatIds);
  if (!list.length) return false;
  return list.map(String).includes(String(chatId));
}

// --------------------------------------------------------------------------
// Command parsing
// --------------------------------------------------------------------------

/**
 * Parse a slash command line into { cmd, args }.
 * Supports: "/status", "/status repo-name", "/rework 42",
 * `/do "natural language goes here"`, `/do natural language`.
 *
 * Returns null if the input isn't a recognized top-level command.
 */
function parseCommand(rawText) {
  if (!rawText || typeof rawText !== "string") return null;
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("/")) return null;

  // Split off command; support /cmd@botname syntax used in groups.
  const firstSpace = trimmed.indexOf(" ");
  const head = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const tail = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();
  const cmd = head.split("@")[0].toLowerCase();

  // /do preserves its payload verbatim (supports "...", '...', or bare text)
  if (cmd === "/do") {
    const quoted = tail.match(/^["“”'](.*)["“”']$/);
    const payload = quoted ? quoted[1] : tail;
    return { cmd: "/do", args: [payload], raw: tail };
  }

  const args = tail ? tail.split(/\s+/) : [];
  return { cmd, args, raw: tail };
}

// --------------------------------------------------------------------------
// Callback-data parsing
// --------------------------------------------------------------------------

const ACTION_CALLBACK_PREFIXES = ["APPROVE", "REJECT", "REWORK", "MERGE"];

/**
 * Parse inline-button callback data.
 *
 * Supports three on-the-wire shapes (backward compatible):
 *   1. "APPROVE|<repo>|<pr>"     (new — single-action prefixes)
 *   2. "DECISION|<repo>|<pr>|<action>" (legacy — wrapped)
 *   3. any REJECT|REWORK|MERGE|…
 *
 * Returns { ok, type, action, repo, prNumber } or { ok:false, error }.
 */
function parseCallback(data) {
  if (!data || typeof data !== "string") {
    return { ok: false, error: "Invalid callback data" };
  }
  const parts = data.split("|");
  if (parts.length < 3) {
    return { ok: false, error: `Invalid callback format: "${data}"` };
  }

  let action;
  let repo;
  let prStr;

  if (parts[0] === "DECISION") {
    // Legacy: DECISION|repo|pr|action
    if (parts.length !== 4) {
      return { ok: false, error: `Invalid DECISION format: "${data}"` };
    }
    [, repo, prStr, action] = parts;
    action = action ? action.toUpperCase() : "";
  } else {
    // New: ACTION|repo|pr
    [action, repo, prStr] = parts;
    action = action ? action.toUpperCase() : "";
  }

  const prNumber = parseInt(prStr, 10);
  if (!repo || !action || Number.isNaN(prNumber) || prNumber <= 0) {
    return { ok: false, error: "Missing required fields in callback data" };
  }

  const ALL_ACTIONS = ["APPROVE", "HOLD", "FEEDBACK", "REVISE", "REJECT", "REWORK", "MERGE"];
  if (!ALL_ACTIONS.includes(action)) {
    return { ok: false, error: `Unknown action: ${action}` };
  }

  return { ok: true, type: parts[0] === "DECISION" ? "DECISION" : "ACTION", action, repo, prNumber };
}

// --------------------------------------------------------------------------
// Inline-keyboard rendering
// --------------------------------------------------------------------------

/**
 * Build the 4-button inline keyboard used on every PR-referencing message.
 *   ✅ Approve | ❌ Reject | 🔧 Rework | 🔀 Merge
 *
 * Callers pass { repo, prNumber } plus optional { prUrl, previewUrl } to
 * attach "Open PR" / "Preview" link buttons above the action row.
 */
function buildPrActionKeyboard({ repo, prNumber, prUrl = null, previewUrl = null }) {
  if (!repo || !prNumber) return { inline_keyboard: [] };
  const rows = [];
  if (prUrl) rows.push([{ text: "Open PR", url: prUrl }]);
  if (previewUrl) rows.push([{ text: "Preview", url: previewUrl }]);
  rows.push([
    { text: "✅ Approve", callback_data: `APPROVE|${repo}|${prNumber}` },
    { text: "❌ Reject", callback_data: `REJECT|${repo}|${prNumber}` },
  ]);
  rows.push([
    { text: "🔧 Rework", callback_data: `REWORK|${repo}|${prNumber}` },
    { text: "🔀 Merge", callback_data: `MERGE|${repo}|${prNumber}` },
  ]);
  return { inline_keyboard: rows };
}

/**
 * Build a numbered list of PRs each with its own action row. Used by
 * /status and /list.
 */
function buildPrListKeyboard(prs) {
  const rows = [];
  for (const pr of prs) {
    rows.push([
      {
        text: `#${pr.prNumber} ${pr.repo}`,
        url: pr.prUrl || `https://github.com/${pr.repo}/pull/${pr.prNumber}`,
      },
    ]);
    rows.push([
      { text: "✅", callback_data: `APPROVE|${pr.repo}|${pr.prNumber}` },
      { text: "❌", callback_data: `REJECT|${pr.repo}|${pr.prNumber}` },
      { text: "🔧", callback_data: `REWORK|${pr.repo}|${pr.prNumber}` },
      { text: "🔀", callback_data: `MERGE|${pr.repo}|${pr.prNumber}` },
    ]);
  }
  return { inline_keyboard: rows };
}

// --------------------------------------------------------------------------
// PR state helpers
// --------------------------------------------------------------------------

/**
 * Reduce a reviews[] array from the GitHub API to a human-readable state.
 * changes_requested wins over approved wins over anything else.
 */
function summarizeReviewState(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) return "awaiting";
  const hasChanges = reviews.some((r) => (r.state || "").toUpperCase() === "CHANGES_REQUESTED");
  if (hasChanges) return "changes-requested";
  const hasApproved = reviews.some((r) => (r.state || "").toUpperCase() === "APPROVED");
  if (hasApproved) return "approved";
  return "awaiting";
}

function formatReviewStateIcon(state) {
  if (state === "approved") return "✅";
  if (state === "changes-requested") return "❌";
  if (state === "merged") return "🔀";
  return "🕒";
}

// --------------------------------------------------------------------------
// Command handlers
//
// Signature: async (ctx) → { text, extra?, error? }
// ctx = { args, chatId, env, ghApi, trackedRepos, adminChatIds }
// --------------------------------------------------------------------------

async function cmdStatus(ctx) {
  const repos = filterRepos(ctx.trackedRepos, ctx.args[0]);
  if (!repos.length) return noTrackedReposResponse();

  const lines = ["<b>Active PRs</b>", ""];
  const allPrs = [];

  for (const slug of repos) {
    try {
      const prs = await ctx.ghApi(`/repos/${slug}/pulls?state=open&per_page=20`);
      const openPrs = (Array.isArray(prs) ? prs : []).filter((pr) => !pr.draft);
      for (const pr of openPrs) {
        let reviews = [];
        try {
          reviews = await ctx.ghApi(`/repos/${slug}/pulls/${pr.number}/reviews?per_page=20`);
        } catch (_) {
          reviews = [];
        }
        const state = summarizeReviewState(reviews);
        allPrs.push({
          repo: slug,
          prNumber: pr.number,
          title: (pr.title || "").slice(0, 60),
          state,
          prUrl: pr.html_url,
        });
      }
    } catch (e) {
      lines.push(`  <i>${slug}: fetch failed (${String(e.message || e).slice(0, 60)})</i>`);
    }
  }

  if (!allPrs.length) {
    return { text: "No active PRs across tracked repos." };
  }

  allPrs.forEach((pr, i) => {
    lines.push(
      `${i + 1}. ${formatReviewStateIcon(pr.state)} <b>${escapeHtml(pr.repo)}</b> #${pr.prNumber} — ${escapeHtml(pr.title)} <i>(${pr.state})</i>`,
    );
  });

  return {
    text: lines.join("\n"),
    extra: { reply_markup: buildPrListKeyboard(allPrs), parse_mode: "HTML" },
  };
}

async function cmdList(ctx) {
  const repos = filterRepos(ctx.trackedRepos, ctx.args[0]);
  if (!repos.length) return noTrackedReposResponse();

  const lines = ["<b>Last 10 PRs</b>", ""];
  const collected = [];

  for (const slug of repos) {
    try {
      const prs = await ctx.ghApi(`/repos/${slug}/pulls?state=all&per_page=10&sort=updated&direction=desc`);
      for (const pr of Array.isArray(prs) ? prs : []) {
        collected.push({
          repo: slug,
          prNumber: pr.number,
          title: (pr.title || "").slice(0, 60),
          state: pr.merged_at ? "merged" : (pr.state || "open"),
          updated: pr.updated_at,
          prUrl: pr.html_url,
        });
      }
    } catch (e) {
      lines.push(`  <i>${slug}: fetch failed (${String(e.message || e).slice(0, 60)})</i>`);
    }
  }

  collected.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  const top = collected.slice(0, 10);

  if (!top.length) return { text: "No PRs found." };

  top.forEach((pr, i) => {
    const icon = pr.state === "merged" ? "🔀" : pr.state === "closed" ? "⚪" : "🟢";
    lines.push(
      `${i + 1}. ${icon} <b>${escapeHtml(pr.repo)}</b> #${pr.prNumber} — ${escapeHtml(pr.title)}`,
    );
  });

  return {
    text: lines.join("\n"),
    extra: { reply_markup: buildPrListKeyboard(top), parse_mode: "HTML" },
  };
}

async function cmdRework(ctx) {
  const prNumber = parseInt(ctx.args[0], 10);
  if (!prNumber || Number.isNaN(prNumber)) {
    return { text: "Usage: <code>/rework &lt;pr_number&gt;</code>", extra: { parse_mode: "HTML" } };
  }

  const repos = ctx.trackedRepos;
  if (!repos.length) return noTrackedReposResponse();

  const resolved = await resolveRepoForPr(ctx.ghApi, repos, prNumber);
  if (!resolved) {
    return { text: `PR #${prNumber} not found across tracked repos.` };
  }

  const dispatchTarget = _resolveOrchSlug(ctx.env);
  if (!dispatchTarget) {
    return {
      text: "Cannot dispatch rework: ORCH_REPO_SLUG (or GITHUB_OWNER + ORCH_REPO) not configured.",
    };
  }

  try {
    await ctx.ghApi(`/repos/${dispatchTarget}/dispatches`, {
      method: "POST",
      body: {
        event_type: "rework-request",
        client_payload: {
          repo: resolved.repo,
          pr: prNumber,
          branch: resolved.branch,
          source: "telegram-command",
        },
      },
    });
  } catch (e) {
    return { text: `Rework dispatch failed: ${e.message}` };
  }

  return {
    text: `🔧 Rework dispatched for <b>${escapeHtml(resolved.repo)}</b> PR #${prNumber}`,
    extra: {
      parse_mode: "HTML",
      reply_markup: buildPrActionKeyboard({
        repo: resolved.repo,
        prNumber,
        prUrl: resolved.prUrl,
      }),
    },
  };
}

async function cmdApprove(ctx) {
  const prNumber = parseInt(ctx.args[0], 10);
  if (!prNumber || Number.isNaN(prNumber)) {
    return { text: "Usage: <code>/approve &lt;pr_number&gt;</code>", extra: { parse_mode: "HTML" } };
  }
  const repos = ctx.trackedRepos;
  if (!repos.length) return noTrackedReposResponse();

  const resolved = await resolveRepoForPr(ctx.ghApi, repos, prNumber);
  if (!resolved) return { text: `PR #${prNumber} not found across tracked repos.` };

  try {
    await ctx.ghApi(`/repos/${resolved.repo}/pulls/${prNumber}/reviews`, {
      method: "POST",
      body: { event: "APPROVE" },
    });
  } catch (e) {
    return { text: `Approve failed: ${e.message}` };
  }

  return {
    text: `✅ Approved <b>${escapeHtml(resolved.repo)}</b> PR #${prNumber}`,
    extra: {
      parse_mode: "HTML",
      reply_markup: buildPrActionKeyboard({
        repo: resolved.repo,
        prNumber,
        prUrl: resolved.prUrl,
      }),
    },
  };
}

/**
 * /do — STUB. Creates an issue in `solo-cto-agent-inbox` under GITHUB_OWNER
 * with label `nl-order`. The NL orchestrator (phase 3) picks these up.
 */
async function cmdDo(ctx) {
  const payload = (ctx.args[0] || "").trim();
  if (!payload) {
    return {
      text: "Usage: <code>/do \"what you want me to do\"</code>",
      extra: { parse_mode: "HTML" },
    };
  }

  const owner = ctx.env.GITHUB_OWNER;
  if (!owner) {
    return { text: "GITHUB_OWNER not configured — cannot queue NL order." };
  }
  const inboxRepo = `${owner}/solo-cto-agent-inbox`;

  // Ensure label exists (ignore 422/already-exists)
  try {
    await ctx.ghApi(`/repos/${inboxRepo}/labels`, {
      method: "POST",
      body: { name: "nl-order", color: "ededed", description: "Natural language order from Telegram /do" },
    });
  } catch (_) {
    // repo or label already exists, or repo missing — we'll check on issue create
  }

  let issue;
  try {
    issue = await ctx.ghApi(`/repos/${inboxRepo}/issues`, {
      method: "POST",
      body: {
        title: payload.slice(0, 80),
        body: `## Natural-language order\n\n${payload}\n\n---\n<sub>Queued via Telegram /do at ${new Date().toISOString()}. Will be processed once the NL orchestrator is wired.</sub>`,
        labels: ["nl-order"],
      },
    });
  } catch (e) {
    // Repo might not exist yet — try to create it gracefully
    if (/404/.test(String(e.message))) {
      try {
        await ctx.ghApi(`/user/repos`, {
          method: "POST",
          body: {
            name: "solo-cto-agent-inbox",
            description: "Natural-language order inbox for solo-cto-agent",
            private: true,
            has_issues: true,
          },
        });
        issue = await ctx.ghApi(`/repos/${inboxRepo}/issues`, {
          method: "POST",
          body: {
            title: payload.slice(0, 80),
            body: `## Natural-language order\n\n${payload}\n\n---\n<sub>Queued via Telegram /do at ${new Date().toISOString()}. Will be processed once the NL orchestrator is wired.</sub>`,
            labels: [],
          },
        });
      } catch (e2) {
        return { text: `Failed to queue NL order: ${e2.message}` };
      }
    } else {
      return { text: `Failed to queue NL order: ${e.message}` };
    }
  }

  return {
    text: `✅ Queued as inbox issue #${issue.number} — will be processed once NL orchestrator is wired.`,
    extra: { parse_mode: "HTML" },
  };
}

async function cmdDigest(ctx) {
  const repos = ctx.trackedRepos;
  if (!repos.length) return noTrackedReposResponse();

  const today = new Date().toISOString().slice(0, 10);
  const sinceISO = `${today}T00:00:00Z`;
  const openedToday = [];
  const mergedToday = [];
  const reworkedToday = [];

  for (const slug of repos) {
    try {
      // Opened: recently created PRs in tracked repo
      const recent = await ctx.ghApi(`/repos/${slug}/pulls?state=all&per_page=30&sort=updated&direction=desc`);
      for (const pr of Array.isArray(recent) ? recent : []) {
        if (pr.created_at && pr.created_at >= sinceISO) {
          openedToday.push({ repo: slug, prNumber: pr.number, title: pr.title });
        }
        if (pr.merged_at && pr.merged_at >= sinceISO) {
          mergedToday.push({ repo: slug, prNumber: pr.number, title: pr.title });
        }
        if (pr.updated_at && pr.updated_at >= sinceISO) {
          // Treat presence of [rework-round] comment today as a rework marker
          try {
            const comments = await ctx.ghApi(
              `/repos/${slug}/issues/${pr.number}/comments?per_page=20&since=${sinceISO}`,
            );
            if (
              Array.isArray(comments) &&
              comments.some((c) => /\[rework-round\]|rework-request/i.test(c.body || ""))
            ) {
              reworkedToday.push({ repo: slug, prNumber: pr.number, title: pr.title });
            }
          } catch (_) {
            /* skip */
          }
        }
      }
    } catch (_) {
      /* skip repo on failure */
    }
  }

  const lines = [`<b>Digest for ${today}</b>`, ""];
  lines.push(`• Opened: ${openedToday.length}`);
  openedToday.slice(0, 10).forEach((pr) => lines.push(`    - ${pr.repo} #${pr.prNumber} ${escapeHtml(pr.title || "").slice(0, 60)}`));
  lines.push(`• Merged: ${mergedToday.length}`);
  mergedToday.slice(0, 10).forEach((pr) => lines.push(`    - ${pr.repo} #${pr.prNumber} ${escapeHtml(pr.title || "").slice(0, 60)}`));
  lines.push(`• Reworked: ${reworkedToday.length}`);
  reworkedToday.slice(0, 10).forEach((pr) => lines.push(`    - ${pr.repo} #${pr.prNumber} ${escapeHtml(pr.title || "").slice(0, 60)}`));

  return { text: lines.join("\n"), extra: { parse_mode: "HTML" } };
}

// --------------------------------------------------------------------------
// Callback-button handlers (APPROVE / REJECT / REWORK / MERGE)
//
// These share ctx with the command handlers and return the same
// { text, extra? } shape. Callers then edit the original message to
// reflect the action.
// --------------------------------------------------------------------------

async function handleApproveCallback(ctx, { repo, prNumber }) {
  try {
    await ctx.ghApi(`/repos/${repo}/pulls/${prNumber}/reviews`, {
      method: "POST",
      body: { event: "APPROVE" },
    });
    return { ok: true, text: `✅ Approved by ${ctx.fromLabel || "user"}` };
  } catch (e) {
    return { ok: false, text: `❌ Approve failed: ${e.message}` };
  }
}

async function handleRejectCallback(ctx, { repo, prNumber }) {
  try {
    await ctx.ghApi(`/repos/${repo}/issues/${prNumber}/labels`, {
      method: "POST",
      body: { labels: ["needs-work"] },
    });
    await ctx.ghApi(`/repos/${repo}/issues/${prNumber}/comments`, {
      method: "POST",
      body: {
        body: `[REJECT via Telegram] Changes needed — please clarify the next steps before this PR can move forward.`,
      },
    });
    return { ok: true, text: `❌ Rejected by ${ctx.fromLabel || "user"}` };
  } catch (e) {
    return { ok: false, text: `❌ Reject failed: ${e.message}` };
  }
}

async function handleReworkCallback(ctx, { repo, prNumber }) {
  const orchRepo = _resolveOrchSlug(ctx.env);
  if (!orchRepo) return { ok: false, text: "ORCH_REPO_SLUG not configured" };

  try {
    let branch = null;
    try {
      const pr = await ctx.ghApi(`/repos/${repo}/pulls/${prNumber}`);
      branch = pr.head?.ref || null;
    } catch (_) { /* best-effort */ }

    await ctx.ghApi(`/repos/${orchRepo}/dispatches`, {
      method: "POST",
      body: {
        event_type: "rework-request",
        client_payload: { repo, pr: prNumber, branch, source: "telegram-button" },
      },
    });
    return { ok: true, text: `🔧 Rework dispatched by ${ctx.fromLabel || "user"}` };
  } catch (e) {
    return { ok: false, text: `❌ Rework failed: ${e.message}` };
  }
}

async function handleMergeCallback(ctx, { repo, prNumber }) {
  if (!isAdmin(ctx.chatId, ctx.adminChatIds)) {
    return { ok: false, text: "Not authorized" };
  }
  try {
    await ctx.ghApi(`/repos/${repo}/pulls/${prNumber}/merge`, {
      method: "PUT",
      body: { merge_method: "squash", commit_title: `Merge PR #${prNumber}` },
    });
    return { ok: true, text: `🔀 Merged by ${ctx.fromLabel || "user"}` };
  } catch (e) {
    return { ok: false, text: `❌ Merge failed: ${e.message}` };
  }
}

// --------------------------------------------------------------------------
// Dispatcher
// --------------------------------------------------------------------------

const COMMAND_DEFS = [
  { name: "/status", admin: false, handler: cmdStatus },
  { name: "/list", admin: false, handler: cmdList },
  { name: "/rework", admin: false, handler: cmdRework },
  { name: "/approve", admin: false, handler: cmdApprove },
  { name: "/do", admin: false, handler: cmdDo },
  { name: "/digest", admin: false, handler: cmdDigest },
  // /merge as a direct command is admin-only; handled through cmdMerge.
  { name: "/merge", admin: true, handler: cmdMerge },
];

async function cmdMerge(ctx) {
  const prNumber = parseInt(ctx.args[0], 10);
  if (!prNumber || Number.isNaN(prNumber)) {
    return { text: "Usage: <code>/merge &lt;pr_number&gt;</code>", extra: { parse_mode: "HTML" } };
  }
  const resolved = await resolveRepoForPr(ctx.ghApi, ctx.trackedRepos, prNumber);
  if (!resolved) return { text: `PR #${prNumber} not found across tracked repos.` };
  return handleMergeCallback(ctx, { repo: resolved.repo, prNumber });
}

/**
 * Run a parsed command. Returns { handled, response } where response is
 * { text, extra } shape. Returns { handled: false } if the command isn't
 * one of ours — caller falls through to legacy handling.
 */
async function dispatchCommand(parsed, ctx) {
  if (!parsed) return { handled: false };
  const def = COMMAND_DEFS.find((d) => d.name === parsed.cmd);
  if (!def) return { handled: false };

  if (def.admin && !isAdmin(ctx.chatId, ctx.adminChatIds)) {
    return { handled: true, response: { text: "Not authorized" } };
  }

  const handlerCtx = { ...ctx, args: parsed.args };
  const response = await def.handler(handlerCtx);
  return { handled: true, response };
}

/**
 * Route a callback button to its handler. Returns { handled, response, action }.
 */
async function dispatchCallback(callback, ctx) {
  const parsed = parseCallback(callback);
  if (!parsed.ok) return { handled: false, error: parsed.error };

  const { action, repo, prNumber } = parsed;

  // The ACTION buttons share a common shape (except MERGE which is gated).
  if (action === "APPROVE") {
    const r = await handleApproveCallback(ctx, { repo, prNumber });
    return { handled: true, response: r, action, repo, prNumber };
  }
  if (action === "REJECT") {
    const r = await handleRejectCallback(ctx, { repo, prNumber });
    return { handled: true, response: r, action, repo, prNumber };
  }
  if (action === "REWORK") {
    const r = await handleReworkCallback(ctx, { repo, prNumber });
    return { handled: true, response: r, action, repo, prNumber };
  }
  if (action === "MERGE") {
    const r = await handleMergeCallback(ctx, { repo, prNumber });
    return { handled: true, response: r, action, repo, prNumber };
  }

  // Legacy DECISION|…|HOLD, REVISE, FEEDBACK — surface to caller so the
  // existing webhook handlers keep running.
  return { handled: false, action, repo, prNumber, legacy: true };
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function _resolveOrchSlug(env) {
  if (!env) return null;
  if (env.ORCH_REPO_SLUG) return env.ORCH_REPO_SLUG;
  if (env.GITHUB_OWNER && env.ORCH_REPO) return `${env.GITHUB_OWNER}/${env.ORCH_REPO}`;
  return null;
}

function filterRepos(tracked, scopeArg) {
  if (!scopeArg) return tracked || [];
  const needle = String(scopeArg).toLowerCase();
  const match = (tracked || []).filter((s) => s.toLowerCase().includes(needle));
  return match.length ? match : (tracked || []);
}

function noTrackedReposResponse() {
  return {
    text:
      "No tracked repos configured. Set <code>TRACKED_REPOS</code> (comma-separated owner/repo) or <code>PRODUCT_REPOS</code>.",
    extra: { parse_mode: "HTML" },
  };
}

async function resolveRepoForPr(ghApi, repos, prNumber) {
  for (const slug of repos || []) {
    try {
      const pr = await ghApi(`/repos/${slug}/pulls/${prNumber}`);
      if (pr && pr.number === prNumber) {
        return {
          repo: slug,
          branch: pr.head?.ref || null,
          prUrl: pr.html_url || `https://github.com/${slug}/pull/${prNumber}`,
        };
      }
    } catch (_) {
      /* keep trying */
    }
  }
  return null;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --------------------------------------------------------------------------
// Exports
// --------------------------------------------------------------------------

module.exports = {
  // Env
  resolveTrackedRepos,
  resolveAdminChatIds,
  isAdmin,
  // Parsing
  parseCommand,
  parseCallback,
  // Keyboards
  buildPrActionKeyboard,
  buildPrListKeyboard,
  // PR state
  summarizeReviewState,
  formatReviewStateIcon,
  // Dispatchers
  dispatchCommand,
  dispatchCallback,
  // Individual handlers (exposed for tests + granular reuse)
  cmdStatus,
  cmdList,
  cmdRework,
  cmdApprove,
  cmdDo,
  cmdDigest,
  cmdMerge,
  handleApproveCallback,
  handleRejectCallback,
  handleReworkCallback,
  handleMergeCallback,
  // Utilities
  escapeHtml,
  splitCsv,
  resolveRepoForPr,
  ACTION_CALLBACK_PREFIXES,
};
