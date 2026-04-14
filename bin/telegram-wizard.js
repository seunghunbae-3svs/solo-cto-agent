#!/usr/bin/env node

/**
 * telegram-wizard.js — interactive Telegram setup wizard (PR-G7-impl).
 *
 * Implements the happy path of docs/telegram-wizard-spec.md §2 behind
 * the SOLO_CTO_EXPERIMENTAL=1 flag. Non-interactive mode
 * (--token/--chat/--storage, or --non-interactive) runs end-to-end
 * without stdin.
 *
 * Scope for this cut:
 *   - getMe verification                             ✓
 *   - chat_id capture via getUpdates long-poll       ✓
 *   - .env storage backend                           ✓
 *   - shell profile + gh secret backends             ✓
 *   - live sendMessage test                          ✓
 *   - i18n hook (english default, bundle passthrough)
 *
 * Deferred to follow-up:
 *   - telegram config (event filter file)
 *   - telegram disable/status subcommands
 *   - group / channel first-class UX polish
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const { isTTY, ask, askChoice, askYesNo, createRl } = require("./prompt-utils");

// --------------------------------------------------------------------------
// Small deps: minimal https wrapper. We avoid pulling `fetch` polyfills so
// the wizard works on Node 16 too (matches notify.js style).
// --------------------------------------------------------------------------

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
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
    req.setTimeout(15000, () => {
      req.destroy(new Error("telegram-wizard: request timeout"));
    });
  });
}

function httpPostJson(url, payload) {
  const data = Buffer.from(JSON.stringify(payload), "utf8");
  const u = new URL(url);
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
    req.setTimeout(15000, () => { req.destroy(new Error("telegram-wizard: request timeout")); });
    req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// --------------------------------------------------------------------------
// Token / chat validation helpers.
// --------------------------------------------------------------------------

/**
 * Rough shape check for a BotFather token. Accepts `<bot_id>:<secret>`
 * with a numeric ID and a 30+ character secret. Network call still
 * required to confirm the token actually works.
 */
function isTokenShapeValid(token) {
  if (typeof token !== "string") return false;
  const m = /^(\d+):([A-Za-z0-9_-]{30,})$/.exec(token.trim());
  return !!m;
}

/**
 * Call Telegram getMe to confirm the token works. Returns the bot
 * metadata on success or throws on failure. Injectable fetcher keeps
 * the function testable offline.
 */
async function verifyToken(token, { fetchImpl = httpGetJson } = {}) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`);
  if (res.status !== 200 || !res.json || !res.json.ok) {
    const detail = res.json && res.json.description ? res.json.description : `HTTP ${res.status}`;
    const err = new Error(`getMe failed: ${detail}`);
    err.code = "TELEGRAM_GETME_FAILED";
    throw err;
  }
  return res.json.result; // { id, is_bot, username, first_name, ... }
}

/**
 * Poll getUpdates until a message arrives or the deadline passes. Used
 * to capture chat_id in step 2 of the happy path.
 */
async function captureChatId(token, { timeoutMs = 60000, pollMs = 2000, fetchImpl = httpGetJson, now = () => Date.now() } = {}) {
  const deadline = now() + timeoutMs;
  let offset = 0;
  while (now() < deadline) {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=1`;
    const res = await fetchImpl(url);
    const updates = (res.json && res.json.result) || [];
    for (const upd of updates) {
      if (typeof upd.update_id === "number") offset = upd.update_id + 1;
      const chat = upd.message && upd.message.chat;
      if (chat && chat.id) {
        return {
          chatId: chat.id,
          kind: chat.type || "private",
          name: chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || null,
          text: (upd.message && upd.message.text) || "",
        };
      }
    }
    await sleep(pollMs);
  }
  const err = new Error("TIMEOUT_WAITING_FOR_MESSAGE");
  err.code = "TIMEOUT_WAITING_FOR_MESSAGE";
  throw err;
}

/**
 * Send a test message so the user can confirm delivery end-to-end.
 */
async function sendTestMessage(token, chatId, text, { fetchImpl = httpPostJson } = {}) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (res.status !== 200 || !res.json || !res.json.ok) {
    const detail = res.json && res.json.description ? res.json.description : `HTTP ${res.status}`;
    const err = new Error(`sendMessage failed: ${detail}`);
    err.code = "TELEGRAM_SEND_FAILED";
    throw err;
  }
  return res.json.result;
}

// --------------------------------------------------------------------------
// Storage backends (spec §4.4).
// --------------------------------------------------------------------------

const ENV_BLOCK_BEGIN = "# solo-cto-agent BEGIN (telegram)";
const ENV_BLOCK_END = "# solo-cto-agent END (telegram)";

/**
 * Upsert TELEGRAM_* into an .env-style file, fenced with begin/end
 * markers so `telegram disable` can strip it cleanly.
 */
function upsertEnvBlock(filePath, entries) {
  let existing = "";
  if (fs.existsSync(filePath)) existing = fs.readFileSync(filePath, "utf8");

  const block = [
    ENV_BLOCK_BEGIN,
    ...Object.entries(entries).map(([k, v]) => `${k}=${v}`),
    ENV_BLOCK_END,
    "",
  ].join("\n");

  const beginIdx = existing.indexOf(ENV_BLOCK_BEGIN);
  const endIdx = existing.indexOf(ENV_BLOCK_END);
  let next;
  if (beginIdx >= 0 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + ENV_BLOCK_END.length).replace(/^\n/, "");
    next = before + block + after;
  } else {
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    next = existing + sep + (existing ? "\n" : "") + block;
  }

  fs.writeFileSync(filePath, next);
  return { path: filePath, replaced: beginIdx >= 0 && endIdx > beginIdx };
}

function removeEnvBlock(filePath) {
  if (!fs.existsSync(filePath)) return { path: filePath, removed: false };
  const existing = fs.readFileSync(filePath, "utf8");
  const beginIdx = existing.indexOf(ENV_BLOCK_BEGIN);
  const endIdx = existing.indexOf(ENV_BLOCK_END);
  if (beginIdx < 0 || endIdx <= beginIdx) return { path: filePath, removed: false };
  const before = existing.slice(0, beginIdx).replace(/\n+$/, "\n");
  const after = existing.slice(endIdx + ENV_BLOCK_END.length).replace(/^\n+/, "");
  fs.writeFileSync(filePath, before + after);
  return { path: filePath, removed: true };
}

/**
 * Ensure `.env` is listed in `.gitignore` (one line). Idempotent.
 */
function ensureGitignoreEnv(cwd) {
  const giPath = path.join(cwd, ".gitignore");
  let gi = "";
  if (fs.existsSync(giPath)) gi = fs.readFileSync(giPath, "utf8");
  const lines = gi.split(/\r?\n/);
  if (lines.some((l) => l.trim() === ".env")) return { path: giPath, alreadyIgnored: true };
  const sep = gi && !gi.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(giPath, gi + sep + ".env\n");
  return { path: giPath, alreadyIgnored: false };
}

function shellProfilePath() {
  const shell = process.env.SHELL || "";
  const home = os.homedir();
  if (/zsh$/.test(shell)) return path.join(home, ".zshrc");
  if (/bash$/.test(shell)) return path.join(home, ".bashrc");
  return path.join(home, ".profile");
}

// --------------------------------------------------------------------------
// Wizard entry points.
// --------------------------------------------------------------------------

/**
 * Run the whole wizard. Pure-ish — all side effects go through the
 * injected `deps` so tests can stub stdin / fetch / filesystem.
 *
 * @param {object} opts
 * @param {string}   [opts.token]
 * @param {string}   [opts.chat]
 * @param {number}   [opts.storage] 1=env 2=shell 3=gh 4=all
 * @param {boolean}  [opts.nonInteractive]
 * @param {number}   [opts.timeout] seconds for step 2 polling
 * @param {string}   [opts.cwd] directory for .env + .gitignore
 * @param {object}   [deps]   injected httpGetJson / httpPostJson / rl / log
 */
async function runWizard(opts = {}, deps = {}) {
  const log = deps.log || ((line) => process.stdout.write(line + "\n"));
  const errLog = deps.errLog || ((line) => process.stderr.write(line + "\n"));
  const getJson = deps.httpGetJson || httpGetJson;
  const postJson = deps.httpPostJson || httpPostJson;
  const cwd = opts.cwd || process.cwd();

  const experimental = process.env.SOLO_CTO_EXPERIMENTAL === "1";
  if (!experimental && !opts.force) {
    errLog("telegram-wizard is experimental. Re-run with SOLO_CTO_EXPERIMENTAL=1 to continue.");
    return { ok: false, reason: "NOT_EXPERIMENTAL" };
  }

  const nonInteractive = !!opts.nonInteractive || !isTTY();
  let rl = null;

  try {
    // ── Step 1: token ────────────────────────────────────────────────
    let token = opts.token;
    if (!token) {
      if (nonInteractive) {
        errLog("--token required in non-interactive mode");
        return { ok: false, reason: "MISSING_TOKEN" };
      }
      rl = rl || (deps.rl || createRl());
      log("[1/5] Bot token");
      log("      Open https://t.me/BotFather, run /newbot (or /mybots), then paste the token.");
      while (true) {
        const answer = await ask(rl, "      token");
        if (!answer) { log("      (empty — try again)"); continue; }
        if (!isTokenShapeValid(answer)) { log("      token format looks off (expected 123:ABC...). Try again."); continue; }
        token = answer;
        break;
      }
    } else if (!isTokenShapeValid(token)) {
      errLog("token format looks off (expected '123:ABC...')");
      return { ok: false, reason: "BAD_TOKEN_SHAPE" };
    }

    let bot;
    try {
      bot = await verifyToken(token, { fetchImpl: getJson });
      log(`      ✓ Verified with Telegram (getMe): @${bot.username || bot.id}`);
    } catch (e) {
      errLog(`      ✗ ${e.message}`);
      return { ok: false, reason: "GETME_FAILED", error: e.message };
    }

    // ── Step 2: chat_id ──────────────────────────────────────────────
    let chatInfo;
    if (opts.chat) {
      chatInfo = { chatId: opts.chat, kind: "unknown", name: null, text: "" };
      log(`[2/5] Using provided chat id ${opts.chat}`);
    } else if (nonInteractive) {
      errLog("--chat required in non-interactive mode");
      return { ok: false, reason: "MISSING_CHAT" };
    } else {
      rl = rl || (deps.rl || createRl());
      log(`[2/5] Send ANY message to @${bot.username} now.`);
      log("      (waiting up to 60 s — Ctrl-C cancels)");
      try {
        chatInfo = await captureChatId(token, {
          timeoutMs: (opts.timeout || 60) * 1000,
          pollMs: opts.pollMs || 2000,
          fetchImpl: getJson,
          now: deps.now,
        });
        const namePart = chatInfo.name ? ` from ${chatInfo.name}` : "";
        log(`      ✓ Got message${namePart} in chat ${chatInfo.chatId} (${chatInfo.kind})`);
      } catch (e) {
        errLog(`      ✗ ${e.message}`);
        return { ok: false, reason: e.code || "CAPTURE_FAILED" };
      }
    }

    // ── Step 3: storage ──────────────────────────────────────────────
    let storage = opts.storage;
    if (!storage) {
      if (nonInteractive) { errLog("--storage required in non-interactive mode"); return { ok: false, reason: "MISSING_STORAGE" }; }
      rl = rl || (deps.rl || createRl());
      log("[3/5] Where to save credentials?");
      log("      (1) .env (repo-local)");
      log("      (2) shell profile (~/.zshrc or ~/.bashrc)");
      log("      (3) GitHub repo secrets (gh)");
      log("      (4) all of the above");
      storage = await askChoice(rl, "      choice", 4, 1);
    }

    const storageResults = await applyStorage({
      storage,
      token,
      chatId: chatInfo.chatId,
      cwd,
      exec: deps.exec || null,
      fsImpl: deps.fs || null,
    }, log, errLog);

    // ── Step 4: live test ────────────────────────────────────────────
    log("[4/5] Sending test notification…");
    try {
      const msg = await sendTestMessage(
        token,
        chatInfo.chatId,
        "✅ <b>solo-cto-agent</b> is now wired up.\nYou'll get alerts on review blockers, dual-review disagreement, and CI failures.",
        { fetchImpl: postJson },
      );
      log(`      ✓ Delivered to chat ${chatInfo.chatId} (message_id=${msg.message_id})`);
    } catch (e) {
      errLog(`      ✗ ${e.message}`);
      return { ok: false, reason: "SEND_FAILED", error: e.message };
    }

    // ── Step 5: done ─────────────────────────────────────────────────
    log("[5/5] All set.");
    return {
      ok: true,
      bot: { username: bot.username, id: bot.id },
      chat: chatInfo,
      storage: storageResults,
    };
  } finally {
    if (rl && !deps.rl) rl.close();
  }
}

/**
 * Apply the chosen storage backend(s). Backends are independent — a
 * failure in one is logged but does not abort the others.
 */
async function applyStorage({ storage, token, chatId, cwd, exec }, log, errLog) {
  const doEnv = storage === 1 || storage === 4;
  const doShell = storage === 2 || storage === 4;
  const doGh = storage === 3 || storage === 4;
  const results = {};

  if (doEnv) {
    try {
      const envPath = path.join(cwd, ".env");
      const r = upsertEnvBlock(envPath, {
        TELEGRAM_BOT_TOKEN: token,
        TELEGRAM_CHAT_ID: chatId,
      });
      const gi = ensureGitignoreEnv(cwd);
      log(`      ✓ .env ${r.replaced ? "updated" : "written"}`);
      if (!gi.alreadyIgnored) log("      ✓ added .env to .gitignore");
      results.env = { ok: true, path: envPath, replaced: r.replaced, gitignore: gi };
    } catch (e) {
      errLog(`      ✗ .env: ${e.message}`);
      results.env = { ok: false, error: e.message };
    }
  }

  if (doShell) {
    try {
      const profile = shellProfilePath();
      const r = upsertEnvBlock(profile, {
        "export TELEGRAM_BOT_TOKEN": token,
        "export TELEGRAM_CHAT_ID": chatId,
      });
      log(`      ✓ shell profile ${r.replaced ? "updated" : "written"}: ${profile}`);
      results.shell = { ok: true, path: profile, replaced: r.replaced };
    } catch (e) {
      errLog(`      ✗ shell profile: ${e.message}`);
      results.shell = { ok: false, error: e.message };
    }
  }

  if (doGh) {
    const runExec = exec || defaultExec;
    try {
      const auth = await runExec(["gh", "auth", "status"]);
      if (auth.code !== 0) throw new Error("gh is not signed in — run `gh auth login`");
      await runExec(["gh", "secret", "set", "TELEGRAM_BOT_TOKEN", "--body", token]);
      await runExec(["gh", "secret", "set", "TELEGRAM_CHAT_ID", "--body", String(chatId)]);
      log("      ✓ GitHub secrets set (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)");
      results.gh = { ok: true };
    } catch (e) {
      errLog(`      ✗ gh: ${e.message}`);
      results.gh = { ok: false, error: e.message };
    }
  }

  return results;
}

function defaultExec(argv) {
  return new Promise((resolve) => {
    const { spawn } = require("child_process");
    const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    child.on("close", (code) =>
      resolve({ code: code == null ? 1 : code, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }),
    );
    child.on("error", (e) => resolve({ code: 1, stdout: "", stderr: e.message }));
  });
}

// --------------------------------------------------------------------------
// Exports
// --------------------------------------------------------------------------

module.exports = {
  // public
  runWizard,

  // helpers (exported for tests / future subcommands)
  isTokenShapeValid,
  verifyToken,
  captureChatId,
  sendTestMessage,
  upsertEnvBlock,
  removeEnvBlock,
  ensureGitignoreEnv,
  shellProfilePath,
  applyStorage,
};
