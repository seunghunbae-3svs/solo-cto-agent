// PR-G7-subcommands — tests for the new telegram subcommands
// (test / verify / status / disable / config). All network + filesystem
// state is isolated via SOLO_CTO_NOTIFY_CONFIG + tmp cwds.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  telegramTest,
  telegramVerify,
  telegramStatus,
  telegramDisable,
  telegramConfig,
  resolveCreds,
  upsertEnvBlock,
} from "../bin/telegram-wizard.js";
import * as notifyConfig from "../bin/notify-config.js";

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telegram-sub-test-"));
  return path.join(dir, "notify.json");
}

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "telegram-sub-cwd-"));
}

const VALID_TOKEN = "123456789:AAE" + "a".repeat(30);

let prevCfg;
let prevTok;
let prevChat;
let cfgFile;

beforeEach(() => {
  prevCfg = process.env.SOLO_CTO_NOTIFY_CONFIG;
  prevTok = process.env.TELEGRAM_BOT_TOKEN;
  prevChat = process.env.TELEGRAM_CHAT_ID;
  cfgFile = tmpFile();
  process.env.SOLO_CTO_NOTIFY_CONFIG = cfgFile;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

afterEach(() => {
  if (prevCfg === undefined) delete process.env.SOLO_CTO_NOTIFY_CONFIG;
  else process.env.SOLO_CTO_NOTIFY_CONFIG = prevCfg;
  if (prevTok === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = prevTok;
  if (prevChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = prevChat;
});

// ----------------------------------------------------------------------------
// resolveCreds
// ----------------------------------------------------------------------------
describe("resolveCreds", () => {
  it("prefers explicit args over env", () => {
    process.env.TELEGRAM_BOT_TOKEN = "envtok";
    process.env.TELEGRAM_CHAT_ID = "envchat";
    const r = resolveCreds({ token: "argtok", chat: "argchat" });
    expect(r.source).toBe("args");
    expect(r.token).toBe("argtok");
    expect(r.chatId).toBe("argchat");
  });

  it("falls back to env when no args", () => {
    process.env.TELEGRAM_BOT_TOKEN = "envtok";
    process.env.TELEGRAM_CHAT_ID = "envchat";
    const r = resolveCreds({});
    expect(r.source).toBe("env");
    expect(r.token).toBe("envtok");
  });
});

// ----------------------------------------------------------------------------
// telegramTest
// ----------------------------------------------------------------------------
describe("telegramTest", () => {
  it("fails fast when creds missing", async () => {
    const r = await telegramTest({}, { log: () => {}, errLog: () => {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("MISSING_CREDS");
  });

  it("rejects malformed token", async () => {
    const r = await telegramTest({ token: "nope", chat: "1" }, { log: () => {}, errLog: () => {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("BAD_TOKEN_SHAPE");
  });

  it("sends a message with a stubbed transport", async () => {
    let captured;
    const httpPostJson = async (url, body) => {
      captured = { url, body };
      return { status: 200, json: { ok: true, result: { message_id: 99 } } };
    };
    const r = await telegramTest(
      { token: VALID_TOKEN, chat: "42" },
      { httpPostJson, log: () => {}, errLog: () => {} },
    );
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe(99);
    expect(captured.body.chat_id).toBe("42");
  });
});

// ----------------------------------------------------------------------------
// telegramVerify
// ----------------------------------------------------------------------------
describe("telegramVerify", () => {
  it("requires a token", async () => {
    const r = await telegramVerify({}, { log: () => {}, errLog: () => {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("MISSING_TOKEN");
  });

  it("getMe-only when no chat id supplied", async () => {
    const httpGetJson = async () => ({ status: 200, json: { ok: true, result: { id: 1, username: "b" } } });
    const r = await telegramVerify(
      { token: VALID_TOKEN },
      { httpGetJson, log: () => {}, errLog: () => {} },
    );
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(false);
    expect(r.bot.username).toBe("b");
  });

  it("performs the round-trip when chat id provided", async () => {
    const httpGetJson = async () => ({ status: 200, json: { ok: true, result: { id: 1, username: "b" } } });
    const httpPostJson = async () => ({ status: 200, json: { ok: true, result: { message_id: 7 } } });
    const r = await telegramVerify(
      { token: VALID_TOKEN, chat: "9" },
      { httpGetJson, httpPostJson, log: () => {}, errLog: () => {} },
    );
    expect(r.ok).toBe(true);
    expect(r.sent).toBe(true);
    expect(r.messageId).toBe(7);
  });

  it("surfaces getMe failures", async () => {
    const httpGetJson = async () => ({ status: 401, json: { ok: false, description: "Unauthorized" } });
    const r = await telegramVerify(
      { token: VALID_TOKEN },
      { httpGetJson, log: () => {}, errLog: () => {} },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("GETME_FAILED");
  });
});

// ----------------------------------------------------------------------------
// telegramStatus
// ----------------------------------------------------------------------------
describe("telegramStatus", () => {
  it("reports defaults when nothing is configured", () => {
    const lines = [];
    const r = telegramStatus({ cwd: tmpCwd() }, { log: (l) => lines.push(l) });
    expect(r.ok).toBe(true);
    expect(r.creds.envToken).toBe(false);
    expect(r.notify.exists).toBe(false);
    expect(lines.some((l) => /Notify config:/.test(l))).toBe(true);
  });

  it("detects an .env block", () => {
    const cwd = tmpCwd();
    upsertEnvBlock(path.join(cwd, ".env"), {
      TELEGRAM_BOT_TOKEN: "x",
      TELEGRAM_CHAT_ID: "1",
    });
    const r = telegramStatus({ cwd }, { log: () => {} });
    expect(r.creds.envFile).toBeTruthy();
  });

  it("masks env tokens in the output", () => {
    process.env.TELEGRAM_BOT_TOKEN = "12345678abcdef";
    const lines = [];
    telegramStatus({ cwd: tmpCwd() }, { log: (l) => lines.push(l) });
    const tokenLine = lines.find((l) => /Token \(env\)/.test(l));
    expect(tokenLine).toBeTruthy();
    expect(tokenLine).not.toContain("12345678abcdef");
    expect(tokenLine).toMatch(/1234.*cdef/);
  });
});

// ----------------------------------------------------------------------------
// telegramDisable
// ----------------------------------------------------------------------------
describe("telegramDisable", () => {
  it("removes the .env block when present", async () => {
    const cwd = tmpCwd();
    const envFile = path.join(cwd, ".env");
    upsertEnvBlock(envFile, { TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "1" });
    expect(fs.readFileSync(envFile, "utf8")).toMatch(/TELEGRAM_BOT_TOKEN/);

    const exec = async () => ({ code: 1, stdout: "", stderr: "" }); // gh not signed in
    const r = await telegramDisable({ cwd, withGh: true }, { exec, log: () => {}, errLog: () => {} });
    expect(r.ok).toBe(true);
    expect(r.results.env.removed).toBe(true);
    expect(fs.readFileSync(envFile, "utf8")).not.toMatch(/TELEGRAM_BOT_TOKEN/);
  });

  it("drops 'telegram' from notify-config channels if file exists", async () => {
    notifyConfig.writeConfig(notifyConfig.defaultConfig());
    expect(notifyConfig.readConfig().channels).toContain("telegram");
    const exec = async () => ({ code: 1, stdout: "", stderr: "" });
    await telegramDisable({ cwd: tmpCwd(), withGh: true }, { exec, log: () => {}, errLog: () => {} });
    expect(notifyConfig.readConfig().channels).not.toContain("telegram");
  });

  it("skips gh when withGh=false", async () => {
    let called = false;
    const exec = async () => { called = true; return { code: 0 }; };
    const r = await telegramDisable({ cwd: tmpCwd(), withGh: false }, { exec, log: () => {}, errLog: () => {} });
    expect(called).toBe(false);
    expect(r.results.gh).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// telegramConfig
// ----------------------------------------------------------------------------
describe("telegramConfig", () => {
  it("--list dumps current config without prompting", async () => {
    const lines = [];
    const r = await telegramConfig(
      { list: true, nonInteractive: true },
      { log: (l) => lines.push(l), errLog: () => {} },
    );
    expect(r.ok).toBe(true);
    expect(lines.some((l) => /events:/.test(l))).toBe(true);
    expect(lines.some((l) => /review.blocker/.test(l))).toBe(true);
  });

  it("--event X --on enables an event", async () => {
    const r = await telegramConfig(
      { event: "ci.success", on: true },
      { log: () => {}, errLog: () => {} },
    );
    expect(r.ok).toBe(true);
    expect(notifyConfig.readConfig().events["ci.success"]).toBe(true);
  });

  it("--event X --off disables an event", async () => {
    const r = await telegramConfig(
      { event: "review.blocker", off: true },
      { log: () => {}, errLog: () => {} },
    );
    expect(r.ok).toBe(true);
    expect(notifyConfig.readConfig().events["review.blocker"]).toBe(false);
  });

  it("--event with no toggle errors out", async () => {
    const errs = [];
    const r = await telegramConfig(
      { event: "ci.failure" },
      { log: () => {}, errLog: (l) => errs.push(l) },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("MISSING_TOGGLE");
  });

  it("rejects unknown events", async () => {
    const errs = [];
    const r = await telegramConfig(
      { event: "made.up", on: true },
      { log: () => {}, errLog: (l) => errs.push(l) },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("UNKNOWN_EVENT");
  });

  it("--format compact|detailed updates the config", async () => {
    await telegramConfig({ format: "detailed" }, { log: () => {}, errLog: () => {} });
    expect(notifyConfig.readConfig().format).toBe("detailed");
  });

  it("rejects unknown format values", async () => {
    const r = await telegramConfig({ format: "novel" }, { log: () => {}, errLog: () => {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("BAD_FORMAT");
  });
});
