// PR-G11 — ship → notify E2E integration test.
//
// Why this exists: skills/ship/SKILL.md documents `solo-cto-agent notify
// deploy-ready / deploy-error` as the hook point, but PR-G9 only covered
// the notifyDeployResult unit-level behavior. This test spawns the real
// CLI binary, routes notifications through the NOTIFY_LOG_FILE sink
// (append-only JSONL), and asserts the envelope the ship skill actually
// emits at the end of a deploy.
//
// The contract we lock in:
//   deploy-ready  → meta.event === "deploy.ready",  severity "info"
//   deploy-error  → meta.event === "deploy.error",  severity "error"
// Plus: --target, --url, --commit, --body all land in the envelope so
// downstream filters (§5 event taxonomy) can route/mute correctly.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "bin", "cli.js");

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("ship → notify E2E (PR-G11)", () => {
  let logFile;
  let prevLogEnv;
  let prevSlack;
  let prevTg;
  let prevTgChat;
  let prevDiscord;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-notify-e2e-"));
    logFile = path.join(dir, "notify.jsonl");
    prevLogEnv = process.env.NOTIFY_LOG_FILE;
    prevSlack = process.env.SLACK_WEBHOOK_URL;
    prevTg = process.env.TELEGRAM_BOT_TOKEN;
    prevTgChat = process.env.TELEGRAM_CHAT_ID;
    prevDiscord = process.env.DISCORD_WEBHOOK_URL;
    // Ensure file is the ONLY active sink so the test is offline and
    // deterministic.
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.DISCORD_WEBHOOK_URL;
    process.env.NOTIFY_LOG_FILE = logFile;
  });

  afterEach(() => {
    // Restore env.
    if (prevLogEnv === undefined) delete process.env.NOTIFY_LOG_FILE;
    else process.env.NOTIFY_LOG_FILE = prevLogEnv;
    if (prevSlack !== undefined) process.env.SLACK_WEBHOOK_URL = prevSlack;
    if (prevTg !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevTg;
    if (prevTgChat !== undefined) process.env.TELEGRAM_CHAT_ID = prevTgChat;
    if (prevDiscord !== undefined) process.env.DISCORD_WEBHOOK_URL = prevDiscord;
  });

  function runCli(args) {
    // execFileSync throws on non-zero exit; we want the captured stdout
    // either way so wrap it.
    try {
      return {
        code: 0,
        stdout: execFileSync(process.execPath, [CLI, ...args], {
          env: { ...process.env },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      };
    } catch (err) {
      return {
        code: err.status || 1,
        stdout: (err.stdout && err.stdout.toString()) || "",
        stderr: (err.stderr && err.stderr.toString()) || "",
      };
    }
  }

  it("deploy-ready writes an event=deploy.ready envelope to the audit log", () => {
    const r = runCli([
      "notify",
      "deploy-ready",
      "--target", "production",
      "--url", "https://myapp.example.com",
      "--commit", "abc1234",
      "--body", "v1.2.3 released",
    ]);
    expect(r.code).toBe(0);

    const entries = readJsonl(logFile);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1];

    // Event tag (§5 taxonomy) is the key routing field.
    expect(last.meta && last.meta.event).toBe("deploy.ready");
    expect(last.severity).toBe("info");

    // Deploy context must survive the envelope.
    const blob = JSON.stringify(last);
    expect(blob).toContain("production");
    expect(blob).toContain("https://myapp.example.com");
    expect(blob).toContain("abc1234");
  });

  it("deploy-error writes an event=deploy.error envelope with error severity", () => {
    const r = runCli([
      "notify",
      "deploy-error",
      "--target", "preview",
      "--commit", "def5678",
      "--body", "TypeError: cannot read properties of undefined",
    ]);
    expect(r.code).toBe(0);

    const entries = readJsonl(logFile);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1];

    expect(last.meta && last.meta.event).toBe("deploy.error");
    expect(last.severity).toBe("error");

    const blob = JSON.stringify(last);
    expect(blob).toContain("preview");
    expect(blob).toContain("def5678");
    expect(blob).toContain("TypeError");
  });

  it("deploy-ready and deploy-error produce distinct event tags in the same log", () => {
    runCli([
      "notify", "deploy-ready",
      "--target", "preview",
      "--url", "https://preview.example.com",
      "--commit", "aaa1111",
      "--body", "ok",
    ]);
    runCli([
      "notify", "deploy-error",
      "--target", "production",
      "--commit", "bbb2222",
      "--body", "build failed",
    ]);

    const entries = readJsonl(logFile);
    expect(entries.length).toBe(2);
    const events = entries.map((e) => e.meta && e.meta.event);
    expect(events).toContain("deploy.ready");
    expect(events).toContain("deploy.error");
  });
});

// Parallel guard — the ship skill's SKILL.md has the CLI contract
// documented. If someone renames the subcommand we want the docs/runtime
// drift to surface loudly in tests, not silently at 3am during an outage.
describe("ship skill → CLI contract doc (PR-G11)", () => {
  it("skills/ship/SKILL.md references the notify deploy-ready / deploy-error shortcuts", () => {
    const shipMd = fs.readFileSync(
      path.join(__dirname, "..", "skills", "ship", "SKILL.md"),
      "utf8",
    );
    expect(shipMd).toMatch(/solo-cto-agent notify deploy-ready/);
    expect(shipMd).toMatch(/solo-cto-agent notify deploy-error/);
    // Event taxonomy tags must remain visible in the doc so agents
    // reading the skill know which routing bucket they land in.
    expect(shipMd).toMatch(/deploy\.ready/);
    expect(shipMd).toMatch(/deploy\.error/);
  });
});
