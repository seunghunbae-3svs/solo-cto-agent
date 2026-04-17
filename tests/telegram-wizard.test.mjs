// PR-G7-impl — telegram-wizard tests. All network + shell calls are
// stubbed so the suite stays offline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  isTokenShapeValid,
  verifyToken,
  captureChatId,
  sendTestMessage,
  upsertEnvBlock,
  removeEnvBlock,
  ensureGitignoreEnv,
  shellProfilePath,
  applyStorage,
  runWizard,
} from "../bin/telegram-wizard.js";

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "telegram-wizard-test-"));
}

// ----------------------------------------------------------------------------
// Token shape validation
// ----------------------------------------------------------------------------
describe("isTokenShapeValid", () => {
  it("accepts well-formed tokens", () => {
    expect(isTokenShapeValid("123456789:AAE" + "a".repeat(30))).toBe(true);
  });
  it("rejects malformed inputs", () => {
    expect(isTokenShapeValid("")).toBe(false);
    expect(isTokenShapeValid("no-colon-here")).toBe(false);
    expect(isTokenShapeValid("abc:short")).toBe(false);
    expect(isTokenShapeValid("123:" + "a".repeat(10))).toBe(false);
    expect(isTokenShapeValid(null)).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// verifyToken (getMe)
// ----------------------------------------------------------------------------
describe("verifyToken", () => {
  it("returns the bot metadata on success", async () => {
    const fetchImpl = async () => ({ status: 200, json: { ok: true, result: { id: 1, username: "mybot" } } });
    const bot = await verifyToken("123:abc", { fetchImpl });
    expect(bot.username).toBe("mybot");
  });

  it("throws TELEGRAM_GETME_FAILED on 401", async () => {
    const fetchImpl = async () => ({ status: 401, json: { ok: false, description: "Unauthorized" } });
    await expect(verifyToken("123:bad", { fetchImpl })).rejects.toThrow(/Unauthorized/);
  });

  it("throws on network-level failure shape", async () => {
    const fetchImpl = async () => ({ status: 500, json: null });
    await expect(verifyToken("123:bad", { fetchImpl })).rejects.toThrow(/HTTP 500/);
  });
});

// ----------------------------------------------------------------------------
// captureChatId
// ----------------------------------------------------------------------------
describe("captureChatId", () => {
  it("returns the first inbound message", async () => {
    const fetchImpl = async () => ({
      status: 200,
      json: { ok: true, result: [{
        update_id: 42,
        message: { chat: { id: 987, type: "private", username: "testuser" }, text: "hi" },
      }] },
    });
    const out = await captureChatId("t", { fetchImpl, timeoutMs: 5000, pollMs: 1 });
    expect(out.chatId).toBe(987);
    expect(out.kind).toBe("private");
    expect(out.text).toBe("hi");
  });

  it("throws TIMEOUT when no updates arrive", async () => {
    const fetchImpl = async () => ({ status: 200, json: { ok: true, result: [] } });
    let t = 0;
    const now = () => (t += 100);
    await expect(captureChatId("t", { fetchImpl, timeoutMs: 50, pollMs: 1, now })).rejects.toMatchObject({
      code: "TIMEOUT_WAITING_FOR_MESSAGE",
    });
  });

  it("advances offset to drain handled updates", async () => {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      if (seen.length === 1) return { status: 200, json: { ok: true, result: [] } };
      return {
        status: 200,
        json: { ok: true, result: [{ update_id: 100, message: { chat: { id: 7, type: "private" } } }] },
      };
    };
    const out = await captureChatId("t", { fetchImpl, timeoutMs: 5000, pollMs: 1 });
    expect(out.chatId).toBe(7);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });
});

// ----------------------------------------------------------------------------
// sendTestMessage
// ----------------------------------------------------------------------------
describe("sendTestMessage", () => {
  it("resolves on 200 ok", async () => {
    const calls = [];
    const fetchImpl = async (url, payload) => { calls.push({ url, payload }); return { status: 200, json: { ok: true, result: { message_id: 5 } } }; };
    const r = await sendTestMessage("t", 99, "hello", { fetchImpl });
    expect(r.message_id).toBe(5);
    expect(calls[0].payload.chat_id).toBe(99);
    expect(calls[0].payload.text).toBe("hello");
  });

  it("throws on non-ok response", async () => {
    const fetchImpl = async () => ({ status: 400, json: { ok: false, description: "chat not found" } });
    await expect(sendTestMessage("t", 99, "x", { fetchImpl })).rejects.toThrow(/chat not found/);
  });
});

// ----------------------------------------------------------------------------
// Storage helpers
// ----------------------------------------------------------------------------
describe("upsertEnvBlock / removeEnvBlock", () => {
  it("writes a fresh block when the file is missing", () => {
    const cwd = tmpCwd();
    const envPath = path.join(cwd, ".env");
    upsertEnvBlock(envPath, { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" });
    const contents = fs.readFileSync(envPath, "utf8");
    expect(contents).toMatch(/TELEGRAM_BOT_TOKEN=t/);
    expect(contents).toMatch(/TELEGRAM_CHAT_ID=1/);
    expect(contents).toMatch(/# solo-cto-agent BEGIN/);
  });

  it("replaces an existing block in place", () => {
    const cwd = tmpCwd();
    const envPath = path.join(cwd, ".env");
    fs.writeFileSync(envPath, "FOO=bar\n");
    upsertEnvBlock(envPath, { TELEGRAM_BOT_TOKEN: "t1", TELEGRAM_CHAT_ID: "1" });
    upsertEnvBlock(envPath, { TELEGRAM_BOT_TOKEN: "t2", TELEGRAM_CHAT_ID: "2" });
    const contents = fs.readFileSync(envPath, "utf8");
    expect(contents).toMatch(/FOO=bar/);
    expect(contents).toMatch(/TELEGRAM_BOT_TOKEN=t2/);
    expect(contents).not.toMatch(/TELEGRAM_BOT_TOKEN=t1/);
    // only one marker pair
    const beginCount = (contents.match(/solo-cto-agent BEGIN/g) || []).length;
    expect(beginCount).toBe(1);
  });

  it("removeEnvBlock strips the block", () => {
    const cwd = tmpCwd();
    const envPath = path.join(cwd, ".env");
    fs.writeFileSync(envPath, "FOO=bar\n");
    upsertEnvBlock(envPath, { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" });
    const r = removeEnvBlock(envPath);
    expect(r.removed).toBe(true);
    const contents = fs.readFileSync(envPath, "utf8");
    expect(contents).toMatch(/FOO=bar/);
    expect(contents).not.toMatch(/TELEGRAM_BOT_TOKEN/);
  });

  it("removeEnvBlock is a no-op when marker absent", () => {
    const cwd = tmpCwd();
    const envPath = path.join(cwd, ".env");
    fs.writeFileSync(envPath, "FOO=bar\n");
    const r = removeEnvBlock(envPath);
    expect(r.removed).toBe(false);
  });
});

describe("ensureGitignoreEnv", () => {
  it("adds .env when missing", () => {
    const cwd = tmpCwd();
    const r = ensureGitignoreEnv(cwd);
    expect(r.alreadyIgnored).toBe(false);
    expect(fs.readFileSync(path.join(cwd, ".gitignore"), "utf8")).toMatch(/\.env/);
  });

  it("is idempotent when .env already present", () => {
    const cwd = tmpCwd();
    fs.writeFileSync(path.join(cwd, ".gitignore"), "node_modules\n.env\n");
    const r = ensureGitignoreEnv(cwd);
    expect(r.alreadyIgnored).toBe(true);
    // file should not grow
    expect(fs.readFileSync(path.join(cwd, ".gitignore"), "utf8")).toBe("node_modules\n.env\n");
  });
});

describe("shellProfilePath", () => {
  it("returns an absolute path ending with a known profile name", () => {
    const p = shellProfilePath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(/\.(zshrc|bashrc|profile)$/.test(p)).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// applyStorage (env-only path is the simplest to isolate)
// ----------------------------------------------------------------------------
describe("applyStorage", () => {
  it("writes .env and .gitignore when storage == 1", async () => {
    const cwd = tmpCwd();
    const logs = [];
    const r = await applyStorage(
      { storage: 1, token: "t", chatId: 99, cwd, exec: null },
      (line) => logs.push(line),
      () => {},
    );
    expect(r.env.ok).toBe(true);
    expect(fs.readFileSync(path.join(cwd, ".env"), "utf8")).toMatch(/TELEGRAM_BOT_TOKEN=t/);
  });

  it("reports gh failure without aborting env", async () => {
    const cwd = tmpCwd();
    const exec = async () => ({ code: 1, stdout: "", stderr: "not signed in" });
    const r = await applyStorage(
      { storage: 4, token: "t", chatId: 1, cwd, exec },
      () => {},
      () => {},
    );
    expect(r.env.ok).toBe(true);
    expect(r.gh.ok).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// runWizard — end-to-end with all network calls stubbed
// ----------------------------------------------------------------------------
describe("runWizard (non-interactive)", () => {
  const prev = process.env.SOLO_CTO_EXPERIMENTAL;
  let prevNotifyCfg;
  beforeEach(() => {
    process.env.SOLO_CTO_EXPERIMENTAL = "1";
    // Step 5 writes notify.json — isolate it so we don't pollute ~/.
    prevNotifyCfg = process.env.SOLO_CTO_NOTIFY_CONFIG;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-wiz-cfg-"));
    process.env.SOLO_CTO_NOTIFY_CONFIG = path.join(dir, "notify.json");
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.SOLO_CTO_EXPERIMENTAL;
    else process.env.SOLO_CTO_EXPERIMENTAL = prev;
    if (prevNotifyCfg === undefined) delete process.env.SOLO_CTO_NOTIFY_CONFIG;
    else process.env.SOLO_CTO_NOTIFY_CONFIG = prevNotifyCfg;
  });

  it("runs end-to-end with --token/--chat/--storage 1", async () => {
    const cwd = tmpCwd();
    const getJson = async (url) => {
      if (url.includes("getMe")) return { status: 200, json: { ok: true, result: { id: 1, username: "b" } } };
      return { status: 200, json: { ok: true, result: [] } };
    };
    const postJson = async () => ({ status: 200, json: { ok: true, result: { message_id: 7 } } });
    const logs = [];
    const res = await runWizard(
      {
        token: "123456789:AAE" + "a".repeat(30),
        chat: "42",
        storage: 1,
        nonInteractive: true,
        cwd,
      },
      { httpGetJson: getJson, httpPostJson: postJson, log: (l) => logs.push(l), errLog: () => {} },
    );
    expect(res.ok).toBe(true);
    expect(res.chat.chatId).toBe("42");
    expect(res.storage.env.ok).toBe(true);
    // Match either en ("All set") or ko ("완료") since the default locale
    // is ko but CI may have LANG=en_US set. PR-G10 wired the wizard
    // through i18n so the string depends on the active bundle.
    expect(logs.some((l) => /All set|완료/.test(l))).toBe(true);
  });

  it("requires a token (no experimental gate)", async () => {
    delete process.env.SOLO_CTO_EXPERIMENTAL;
    const r = await runWizard({}, { log: () => {}, errLog: () => {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("MISSING_TOKEN");
  });

  it("rejects bad token shape early", async () => {
    const r = await runWizard({ token: "nope", nonInteractive: true }, { log: () => {}, errLog: () => {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("BAD_TOKEN_SHAPE");
  });

  it("surfaces getMe failures", async () => {
    const getJson = async () => ({ status: 401, json: { ok: false, description: "Unauthorized" } });
    const r = await runWizard(
      { token: "123456789:AAE" + "a".repeat(30), chat: "1", storage: 1, nonInteractive: true, cwd: tmpCwd() },
      { httpGetJson: getJson, httpPostJson: async () => ({ status: 200, json: { ok: true } }), log: () => {}, errLog: () => {} },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("GETME_FAILED");
  });

  // PR-G10 — --lang ko emits the Korean bundle, --lang en emits English.
  // The wizard writes user-facing strings through i18n.t() so switching
  // locale at runtime flips the output for the same execution.
  it("honors opts.lang=ko and emits Korean prompts", async () => {
    const getJson = async () => ({ status: 200, json: { ok: true, result: { id: 1, username: "b" } } });
    const postJson = async () => ({ status: 200, json: { ok: true, result: { message_id: 1 } } });
    const logs = [];
    await runWizard(
      {
        token: "123456789:AAE" + "a".repeat(30),
        chat: "42",
        storage: 1,
        nonInteractive: true,
        cwd: tmpCwd(),
        lang: "ko",
      },
      { httpGetJson: getJson, httpPostJson: postJson, log: (l) => logs.push(l), errLog: () => {} },
    );
    const joined = logs.join("\n");
    expect(joined).toMatch(/테스트 알림 전송 중|chat 42 에 전달됨|기본 notify 설정 파일 작성|봇 토큰|완료/);
  });

  it("honors opts.lang=en and emits English prompts", async () => {
    const getJson = async () => ({ status: 200, json: { ok: true, result: { id: 1, username: "b" } } });
    const postJson = async () => ({ status: 200, json: { ok: true, result: { message_id: 1 } } });
    const logs = [];
    await runWizard(
      {
        token: "123456789:AAE" + "a".repeat(30),
        chat: "42",
        storage: 1,
        nonInteractive: true,
        cwd: tmpCwd(),
        lang: "en",
      },
      { httpGetJson: getJson, httpPostJson: postJson, log: (l) => logs.push(l), errLog: () => {} },
    );
    const joined = logs.join("\n");
    expect(joined).toMatch(/Sending test notification|Delivered to chat 42|Wrote default notify config|All set/);
  });
});
