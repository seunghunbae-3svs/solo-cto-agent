import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import os from "os";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const notify = require("../bin/notify.js");

const ENV_KEYS = ["SLACK_WEBHOOK_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "DISCORD_WEBHOOK_URL", "NOTIFY_LOG_FILE"];

describe("notify: channel detection", () => {
  beforeEach(() => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
  });

  it("returns ['console'] when no env vars set", () => {
    expect(notify.detectChannels()).toEqual(["console"]);
  });

  it("includes slack when SLACK_WEBHOOK_URL set", () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/x";
    expect(notify.detectChannels()).toContain("slack");
  });

  it("includes telegram only when both BOT_TOKEN + CHAT_ID set", () => {
    process.env.TELEGRAM_BOT_TOKEN = "tok";
    expect(notify.detectChannels()).not.toContain("telegram");
    process.env.TELEGRAM_CHAT_ID = "123";
    expect(notify.detectChannels()).toContain("telegram");
  });

  it("includes discord and file when their env vars set", () => {
    process.env.DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/x";
    process.env.NOTIFY_LOG_FILE = "/tmp/notify.log";
    const ch = notify.detectChannels();
    expect(ch).toContain("discord");
    expect(ch).toContain("file");
  });
});

describe("notify: severity icon + format", () => {
  it("maps severity to icon", () => {
    expect(notify._severityIcon("blocker")).toBe("⛔");
    expect(notify._severityIcon("error")).toBe("❌");
    expect(notify._severityIcon("warn")).toBe("⚠️");
    expect(notify._severityIcon("info")).toBe("ℹ️");
    expect(notify._severityIcon("unknown")).toBe("ℹ️");
  });

  it("formatPlain includes title, severity, body, meta", () => {
    const env = {
      ts: "2026-04-14T00:00:00Z",
      severity: "warn",
      title: "Build failed",
      body: "TypeScript error in src/x.ts",
      meta: { project: "tribo", commit: "abc123" },
    };
    const out = notify._formatPlain(env);
    expect(out).toContain("⚠️");
    expect(out).toContain("WARN");
    expect(out).toContain("Build failed");
    expect(out).toContain("TypeScript error");
    expect(out).toContain("project: tribo");
    expect(out).toContain("commit: abc123");
  });
});

describe("notify: console + file delivery (no network)", () => {
  let tmpFile;
  beforeEach(() => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    tmpFile = path.join(os.tmpdir(), `notify-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
  });
  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it("delivers to console by default", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const r = await notify.notify({ severity: "info", title: "hello" });
      expect(r.results.find((x) => x.channel === "console").ok).toBe(true);
      expect(stderrSpy).toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("appends JSONL to file when NOTIFY_LOG_FILE set", async () => {
    process.env.NOTIFY_LOG_FILE = tmpFile;
    await notify.notify({ severity: "error", title: "boom", body: "details", meta: { x: 1 } });
    const lines = fs.readFileSync(tmpFile, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    const env = JSON.parse(lines[0]);
    expect(env.severity).toBe("error");
    expect(env.title).toBe("boom");
    expect(env.body).toBe("details");
    expect(env.meta.x).toBe(1);
  });

  it("requires title", async () => {
    await expect(notify.notify({ severity: "info" })).rejects.toThrow("title is required");
  });

  it("normalizes invalid severity to 'info'", async () => {
    process.env.NOTIFY_LOG_FILE = tmpFile;
    await notify.notify({ severity: "ULTRA_CRITICAL", title: "x" });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.severity).toBe("info");
  });
});

describe("notify: helper convenience wrappers", () => {
  let tmpFile;
  beforeEach(() => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    tmpFile = path.join(os.tmpdir(), `notify-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
    process.env.NOTIFY_LOG_FILE = tmpFile;
  });
  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it("notifyReviewResult escalates severity when blockers present", async () => {
    await notify.notifyReviewResult({
      verdict: "REQUEST_CHANGES",
      issues: [
        { severity: "BLOCKER", location: "x", issue: "y", suggestion: "z" },
        { severity: "SUGGESTION", location: "a", issue: "b", suggestion: "c" },
      ],
      summary: "1 blocker found",
      tier: "builder",
      agent: "cowork",
      diffSource: "staged",
      cost: "0.0021",
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.severity).toBe("blocker");
    expect(env.title).toContain("REQUEST_CHANGES");
    expect(env.title).toContain("1 blocker");
  });

  it("notifyReviewResult uses 'info' when verdict APPROVE", async () => {
    await notify.notifyReviewResult({
      verdict: "APPROVE",
      issues: [],
      summary: "looks good",
      tier: "maker",
      agent: "cowork",
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.severity).toBe("info");
  });

  // PR-G8-review-emit — event-tag routing. The event field drives the
  // notify-config filter in sendTelegram(), so we assert it's set on
  // the envelope for the three interesting cases.
  it("tags event=review.blocker when blockers but no cross disagreement", async () => {
    await notify.notifyReviewResult({
      verdict: "REQUEST_CHANGES",
      issues: [{ severity: "BLOCKER", location: "x", issue: "y", suggestion: "z" }],
      summary: "blocker found",
      tier: "builder",
      agent: "cowork",
      crossCheck: { crossVerdict: "REQUEST_CHANGES" }, // agrees — not a disagree
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.meta.event).toBe("review.blocker");
  });

  it("tags event=review.dual-disagree when crossVerdict differs", async () => {
    await notify.notifyReviewResult({
      verdict: "APPROVE",
      issues: [],
      summary: "primary approves",
      tier: "builder",
      agent: "cowork",
      crossCheck: { crossVerdict: "REQUEST_CHANGES" },
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.meta.event).toBe("review.dual-disagree");
  });

  it("tags event=null when verdict clean and no disagreement (filter skips quietly)", async () => {
    await notify.notifyReviewResult({
      verdict: "APPROVE",
      issues: [{ severity: "SUGGESTION", location: "a", issue: "b", suggestion: "c" }],
      summary: "fine",
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.meta.event).toBeNull();
  });

  // PR-G9-ship-emit — notifyDeployResult event-tag routing.
  it("notifyDeployResult success → event=deploy.ready, severity=info", async () => {
    await notify.notifyDeployResult({
      target: "production",
      status: "success",
      url: "https://myapp.com",
      commit: "abc1234",
      summary: "v1.2.3 live",
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.meta.event).toBe("deploy.ready");
    expect(env.severity).toBe("info");
    expect(env.title).toContain("production");
    expect(env.title).toContain("SUCCESS");
    expect(env.body).toContain("https://myapp.com");
    expect(env.meta.target).toBe("production");
  });

  it("notifyDeployResult failed → event=deploy.error, severity=error", async () => {
    await notify.notifyDeployResult({
      target: "preview",
      status: "failed",
      summary: "build log tail",
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.meta.event).toBe("deploy.error");
    expect(env.severity).toBe("error");
    expect(env.title).toContain("preview");
    expect(env.title).toContain("FAILED");
  });

  it("notifyDeployResult partial → event=deploy.error, severity=warn", async () => {
    await notify.notifyDeployResult({
      target: "staging",
      status: "partial",
      summary: "deployed but health-check flaky",
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.meta.event).toBe("deploy.error");
    expect(env.severity).toBe("warn");
  });

  it("notifyDeployResult with unknown status falls back to deploy.error/error", async () => {
    await notify.notifyDeployResult({ target: "preview", status: "weird" });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.meta.event).toBe("deploy.error");
    expect(env.severity).toBe("error");
  });

  // The dualReview adapter in bin/cowork-engine.js maps verdictMatch=false
  // to crossVerdict="DISAGREE" so the event bucket is deterministic.
  it("dualReview adapter shape → review.dual-disagree", async () => {
    await notify.notifyReviewResult({
      verdict: "REQUEST_CHANGES",
      issues: [
        { severity: "BLOCKER", location: "x", issue: "claude saw", suggestion: "s" },
      ],
      summary: "dual-review • claude=REQUEST_CHANGES openai=APPROVE • agreement=NO",
      crossCheck: { crossVerdict: "DISAGREE" },
      tier: "dual",
      agent: "dual",
      diffSource: "staged",
      cost: null,
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.meta.event).toBe("review.dual-disagree");
    expect(env.meta.tier).toBe("dual");
  });
});
