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
const notifyConfig = require("./notify-config");
// PR-G10 — i18n. `t()` falls back to en / key, so the wizard still
// works if i18n.js is not present in the install (graceful degrade).
let _i18n = null;
try { _i18n = require("./i18n"); } catch (_) { _i18n = null; }
function t(key, params) {
  if (_i18n && typeof _i18n.t === "function") return _i18n.t(key, params);
  return key;
}

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

  // PR-G10 — allow callers (or the CLI top-level --lang) to override
  // the active locale for just this wizard run without mutating global
  // state. Default keeps whatever the cli.js dispatch already set.
  if (_i18n && opts.lang && _i18n.isSupported && _i18n.isSupported(opts.lang)) {
    _i18n.setLocale(opts.lang);
  }

  const nonInteractive = !!opts.nonInteractive || !isTTY();
  let rl = null;

  try {
    // ── Step 1: token ────────────────────────────────────────────────
    let token = opts.token;
    if (!token) {
      if (nonInteractive) {
        errLog(t("telegram.wizard.step1.missing_token"));
        return { ok: false, reason: "MISSING_TOKEN" };
      }
      rl = rl || (deps.rl || createRl());
      log(t("telegram.wizard.step1.header"));
      log(t("telegram.wizard.step1.hint"));
      while (true) {
        const answer = await ask(rl, "      token");
        if (!answer) { log(t("telegram.wizard.step1.empty")); continue; }
        if (!isTokenShapeValid(answer)) { log(t("telegram.wizard.step1.bad_shape")); continue; }
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
      log(t("telegram.wizard.step1.verified", { username: bot.username || bot.id }));
    } catch (e) {
      errLog(`      ✗ ${e.message}`);
      return { ok: false, reason: "GETME_FAILED", error: e.message };
    }

    // ── Step 2: chat_id ──────────────────────────────────────────────
    let chatInfo;
    if (opts.chat) {
      chatInfo = { chatId: opts.chat, kind: "unknown", name: null, text: "" };
      log(t("telegram.wizard.step2.using_provided", { chatId: opts.chat }));
    } else if (nonInteractive) {
      errLog(t("telegram.wizard.step2.missing_chat"));
      return { ok: false, reason: "MISSING_CHAT" };
    } else {
      rl = rl || (deps.rl || createRl());
      log(t("telegram.wizard.step2.send_message", { username: bot.username }));
      log(t("telegram.wizard.step2.waiting"));
      try {
        chatInfo = await captureChatId(token, {
          timeoutMs: (opts.timeout || 60) * 1000,
          pollMs: opts.pollMs || 2000,
          fetchImpl: getJson,
          now: deps.now,
        });
        const namePart = chatInfo.name ? ` from ${chatInfo.name}` : "";
        log(t("telegram.wizard.step2.captured", {
          namePart,
          chatId: chatInfo.chatId,
          kind: chatInfo.kind,
        }));
      } catch (e) {
        errLog(`      ✗ ${e.message}`);
        return { ok: false, reason: e.code || "CAPTURE_FAILED" };
      }
    }

    // ── Step 3: storage ──────────────────────────────────────────────
    let storage = opts.storage;
    if (!storage) {
      if (nonInteractive) { errLog(t("telegram.wizard.step3.missing_storage")); return { ok: false, reason: "MISSING_STORAGE" }; }
      rl = rl || (deps.rl || createRl());
      log(t("telegram.wizard.step3.header"));
      log(t("telegram.wizard.step3.opt1"));
      log(t("telegram.wizard.step3.opt2"));
      log(t("telegram.wizard.step3.opt3"));
      log(t("telegram.wizard.step3.opt4"));
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
    log(t("telegram.wizard.step4.sending"));
    try {
      const msg = await sendTestMessage(
        token,
        chatInfo.chatId,
        "✅ <b>solo-cto-agent</b> is now wired up.\nYou'll get alerts on review blockers, dual-review disagreement, and CI failures.",
        { fetchImpl: postJson },
      );
      log(t("telegram.wizard.step4.delivered", {
        chatId: chatInfo.chatId,
        messageId: msg.message_id,
      }));
    } catch (e) {
      errLog(`      ✗ ${e.message}`);
      return { ok: false, reason: "SEND_FAILED", error: e.message };
    }

    // ── Step 5: seed notify.json + done ─────────────────────────────
    let notifyResult = null;
    try {
      notifyResult = notifyConfig.ensureDefaultConfig();
      if (notifyResult.created) {
        log(t("telegram.wizard.step5.wrote_config", { path: notifyResult.path }));
        log(t("telegram.wizard.step5.customize_hint"));
      } else {
        log(t("telegram.wizard.step5.already_present", { path: notifyResult.path }));
      }
    } catch (e) {
      errLog(t("telegram.wizard.step5.write_failed", { detail: e.message }));
      notifyResult = { created: false, error: e.message };
    }

    log(t("telegram.wizard.done"));
    return {
      ok: true,
      bot: { username: bot.username, id: bot.id },
      chat: chatInfo,
      storage: storageResults,
      notifyConfig: notifyResult,
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
// Subcommands — test / config / status / disable / verify.
// Each one is a thin, pure-ish helper so bin/cli.js can stay slim and
// tests/telegram-wizard.test.mjs can hit the surface directly.
// --------------------------------------------------------------------------

/**
 * Resolve the active token / chat. Priority: explicit opts → process.env.
 * Returns { token, chatId, source } where `source` is 'args' | 'env'.
 */
function resolveCreds(opts = {}) {
  const token = opts.token || process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = opts.chat || process.env.TELEGRAM_CHAT_ID || "";
  const source = opts.token || opts.chat ? "args" : "env";
  return { token, chatId, source };
}

/**
 * `telegram test` — send a one-shot test message with current creds.
 * Does NOT consult notify-config (the whole point is to confirm the pipe
 * works even if all events are disabled).
 */
async function telegramTest(opts = {}, deps = {}) {
  const log = deps.log || ((l) => process.stdout.write(l + "\n"));
  const errLog = deps.errLog || ((l) => process.stderr.write(l + "\n"));
  const postJson = deps.httpPostJson || httpPostJson;

  const { token, chatId, source } = resolveCreds(opts);
  if (!token || !chatId) {
    errLog("✗ Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (not in env and no --token/--chat).");
    errLog("  Run `solo-cto-agent telegram wizard` first, or pass --token/--chat.");
    return { ok: false, reason: "MISSING_CREDS" };
  }
  if (!isTokenShapeValid(token)) {
    errLog("✗ token format looks off (expected '123:ABC...')");
    return { ok: false, reason: "BAD_TOKEN_SHAPE" };
  }

  const text = opts.text
    || "🔔 <b>solo-cto-agent</b> — test notification.\nIf you see this, the wire is live.";

  try {
    const msg = await sendTestMessage(token, chatId, text, { fetchImpl: postJson });
    log(`✓ Delivered to chat ${chatId} (message_id=${msg.message_id}, source=${source})`);
    return { ok: true, messageId: msg.message_id, source };
  } catch (e) {
    errLog(`✗ ${e.message}`);
    return { ok: false, reason: "SEND_FAILED", error: e.message };
  }
}

/**
 * `telegram verify` — non-interactive round-trip (getMe + sendMessage).
 * Returns a structured result for CI-style scripts. No stdout chrome
 * unless `deps.log` is wired up.
 */
async function telegramVerify(opts = {}, deps = {}) {
  const log = deps.log || ((l) => process.stdout.write(l + "\n"));
  const errLog = deps.errLog || ((l) => process.stderr.write(l + "\n"));
  const getJson = deps.httpGetJson || httpGetJson;
  const postJson = deps.httpPostJson || httpPostJson;

  const { token, chatId } = resolveCreds(opts);
  if (!token) {
    errLog("✗ TELEGRAM_BOT_TOKEN not set (and no --token)");
    return { ok: false, reason: "MISSING_TOKEN" };
  }
  if (!isTokenShapeValid(token)) {
    errLog("✗ token format looks off");
    return { ok: false, reason: "BAD_TOKEN_SHAPE" };
  }

  let bot;
  try {
    bot = await verifyToken(token, { fetchImpl: getJson });
    log(`✓ getMe: @${bot.username || bot.id}`);
  } catch (e) {
    errLog(`✗ getMe failed: ${e.message}`);
    return { ok: false, reason: "GETME_FAILED", error: e.message };
  }

  if (!chatId) {
    log("(no chat id provided → skipping sendMessage round-trip)");
    return { ok: true, bot: { username: bot.username, id: bot.id }, sent: false };
  }

  try {
    const msg = await sendTestMessage(
      token,
      chatId,
      opts.text || "✔ solo-cto-agent verify",
      { fetchImpl: postJson },
    );
    log(`✓ sendMessage → chat ${chatId} (message_id=${msg.message_id})`);
    return {
      ok: true,
      bot: { username: bot.username, id: bot.id },
      sent: true,
      messageId: msg.message_id,
    };
  } catch (e) {
    errLog(`✗ sendMessage failed: ${e.message}`);
    return { ok: false, reason: "SEND_FAILED", error: e.message };
  }
}

/**
 * `telegram status` — show where creds are coming from + notify config
 * summary. Pure read, no network.
 */
function telegramStatus(opts = {}, deps = {}) {
  const log = deps.log || ((l) => process.stdout.write(l + "\n"));
  const cwd = opts.cwd || process.cwd();

  const envToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const envChat = process.env.TELEGRAM_CHAT_ID || "";

  // Detect per-backend presence
  const envFile = path.join(cwd, ".env");
  const shellFile = shellProfilePath();
  const envFileHas = fs.existsSync(envFile)
    && fs.readFileSync(envFile, "utf8").includes(ENV_BLOCK_BEGIN);
  const shellFileHas = fs.existsSync(shellFile)
    && fs.readFileSync(shellFile, "utf8").includes(ENV_BLOCK_BEGIN);

  const cfg = notifyConfig.readConfig();
  const cfgPath = notifyConfig.configPath();
  const cfgExists = fs.existsSync(cfgPath);

  const masked = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : "(unset)");

  log("solo-cto-agent telegram status");
  log("────────────────────────────────");
  log(`  Token (env):          ${masked(envToken)}`);
  log(`  Chat  (env):          ${envChat || "(unset)"}`);
  log(`  .env block:           ${envFileHas ? envFile : "(not present)"}`);
  log(`  Shell profile block:  ${shellFileHas ? shellFile : "(not present)"}`);
  log(`  Notify config:        ${cfgPath} ${cfgExists ? "" : "(defaults — file not written)"}`);
  log(`  Format:               ${cfg.format}`);
  log(`  Channels:             ${(cfg.channels || []).join(", ") || "(none)"}`);
  log("  Events:");
  for (const ev of notifyConfig.KNOWN_EVENTS) {
    const on = cfg.events[ev] === true;
    log(`    ${on ? "✓" : "·"} ${ev}${on ? "" : "  (off)"}`);
  }

  return {
    ok: true,
    creds: {
      envToken: !!envToken,
      envChat: !!envChat,
      envFile: envFileHas ? envFile : null,
      shellFile: shellFileHas ? shellFile : null,
    },
    notify: { path: cfgPath, exists: cfgExists, config: cfg },
  };
}

/**
 * `telegram disable` — strip credentials from every storage backend we
 * wrote to and drop 'telegram' from notify-config.channels. Each backend
 * is best-effort; we report per-backend outcome.
 */
async function telegramDisable(opts = {}, deps = {}) {
  const log = deps.log || ((l) => process.stdout.write(l + "\n"));
  const errLog = deps.errLog || ((l) => process.stderr.write(l + "\n"));
  const cwd = opts.cwd || process.cwd();
  const runExec = deps.exec || defaultExec;

  const results = {};

  // .env
  try {
    const envFile = path.join(cwd, ".env");
    const r = removeEnvBlock(envFile);
    log(r.removed ? `✓ Removed block from ${envFile}` : `· No block in ${envFile}`);
    results.env = r;
  } catch (e) {
    errLog(`✗ .env: ${e.message}`);
    results.env = { ok: false, error: e.message };
  }

  // shell profile
  try {
    const profile = shellProfilePath();
    const r = removeEnvBlock(profile);
    log(r.removed ? `✓ Removed block from ${profile}` : `· No block in ${profile}`);
    results.shell = r;
  } catch (e) {
    errLog(`✗ shell profile: ${e.message}`);
    results.shell = { ok: false, error: e.message };
  }

  // GitHub secrets (only if gh auth works; best effort)
  if (opts.withGh !== false) {
    try {
      const auth = await runExec(["gh", "auth", "status"]);
      if (auth.code !== 0) {
        log("· gh not signed in — skipping GitHub secret removal");
        results.gh = { ok: false, skipped: true };
      } else {
        await runExec(["gh", "secret", "remove", "TELEGRAM_BOT_TOKEN"]);
        await runExec(["gh", "secret", "remove", "TELEGRAM_CHAT_ID"]);
        log("✓ Removed GitHub secrets (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)");
        results.gh = { ok: true };
      }
    } catch (e) {
      errLog(`· gh: ${e.message}`);
      results.gh = { ok: false, error: e.message };
    }
  }

  // Drop 'telegram' from notify-config channels (if config exists)
  try {
    if (fs.existsSync(notifyConfig.configPath())) {
      const updated = notifyConfig.setChannelEnabled("telegram", false);
      log("✓ Dropped 'telegram' from notify-config channels");
      results.notifyConfig = { ok: true, channels: updated.channels };
    } else {
      results.notifyConfig = { ok: true, skipped: true };
    }
  } catch (e) {
    errLog(`✗ notify-config: ${e.message}`);
    results.notifyConfig = { ok: false, error: e.message };
  }

  log("Disabled. Re-run `solo-cto-agent telegram wizard` to re-enable.");
  return { ok: true, results };
}

/**
 * `telegram config` — view or toggle a single event in notify.json.
 *
 * Non-interactive shapes:
 *   --list              → dump current config to stdout
 *   --event X --on      → enable event X
 *   --event X --off     → disable event X
 *   --format compact|detailed
 *
 * Interactive fall-back: prints a numbered menu of known events with
 * their current state, user picks a number to toggle, blank = exit.
 */
async function telegramConfig(opts = {}, deps = {}) {
  const log = deps.log || ((l) => process.stdout.write(l + "\n"));
  const errLog = deps.errLog || ((l) => process.stderr.write(l + "\n"));

  // Set explicit format
  if (opts.format) {
    if (!notifyConfig.KNOWN_FORMATS.includes(opts.format)) {
      errLog(`✗ format must be one of: ${notifyConfig.KNOWN_FORMATS.join(", ")}`);
      return { ok: false, reason: "BAD_FORMAT" };
    }
    const cfg = notifyConfig.readConfig();
    cfg.format = opts.format;
    const written = notifyConfig.writeConfig(cfg);
    log(`✓ format = ${written.format}`);
    return { ok: true, config: written };
  }

  // Toggle explicit event
  if (opts.event) {
    if (!notifyConfig.KNOWN_EVENTS.includes(opts.event)) {
      errLog(`✗ unknown event '${opts.event}'. Known: ${notifyConfig.KNOWN_EVENTS.join(", ")}`);
      return { ok: false, reason: "UNKNOWN_EVENT" };
    }
    if (opts.on === undefined && opts.off === undefined) {
      errLog("✗ pass --on or --off with --event");
      return { ok: false, reason: "MISSING_TOGGLE" };
    }
    const enabled = opts.on === true && opts.off !== true;
    const written = notifyConfig.setEventEnabled(opts.event, enabled);
    log(`✓ ${opts.event} = ${enabled ? "on" : "off"}`);
    return { ok: true, config: written };
  }

  // List mode (default when no action flag)
  if (opts.list || (!opts.event && !opts.format && (opts.nonInteractive || !isTTY()))) {
    const cfg = notifyConfig.readConfig();
    log(`config: ${notifyConfig.configPath()}`);
    log(`format: ${cfg.format}`);
    log(`channels: ${(cfg.channels || []).join(", ") || "(none)"}`);
    log("events:");
    for (const ev of notifyConfig.KNOWN_EVENTS) {
      log(`  ${cfg.events[ev] ? "✓" : "·"} ${ev}`);
    }
    return { ok: true, config: cfg };
  }

  // Interactive toggle menu
  const rl = deps.rl || createRl();
  try {
    while (true) {
      const cfg = notifyConfig.readConfig();
      log("");
      log(`notify config — ${notifyConfig.configPath()}`);
      notifyConfig.KNOWN_EVENTS.forEach((ev, i) => {
        log(`  [${i + 1}] ${cfg.events[ev] ? "✓" : "·"} ${ev}`);
      });
      log(`  [f] format: ${cfg.format}`);
      log("  [enter] save + exit");
      const answer = await ask(rl, "  toggle which?");
      if (!answer) break;
      if (answer === "f") {
        const next = cfg.format === "compact" ? "detailed" : "compact";
        cfg.format = next;
        notifyConfig.writeConfig(cfg);
        log(`  → format = ${next}`);
        continue;
      }
      const idx = parseInt(answer, 10);
      if (!Number.isInteger(idx) || idx < 1 || idx > notifyConfig.KNOWN_EVENTS.length) {
        log("  (invalid choice)");
        continue;
      }
      const ev = notifyConfig.KNOWN_EVENTS[idx - 1];
      notifyConfig.setEventEnabled(ev, !cfg.events[ev]);
    }
    return { ok: true, config: notifyConfig.readConfig() };
  } finally {
    if (!deps.rl) rl.close();
  }
}

// --------------------------------------------------------------------------
// Exports
// --------------------------------------------------------------------------

module.exports = {
  // public
  runWizard,

  // subcommands (PR-G7-subcommands)
  telegramTest,
  telegramVerify,
  telegramStatus,
  telegramDisable,
  telegramConfig,

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
  resolveCreds,
};
