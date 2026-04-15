/**
 * PR-G27 — notify.js helper coverage.
 * Tests notifyApplyResult, channel override, edge cases.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(import.meta.url);
const notify = require("../bin/notify.js");

const ENV_KEYS = ["SLACK_WEBHOOK_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "DISCORD_WEBHOOK_URL", "NOTIFY_LOG_FILE"];

describe("notifyApplyResult", () => {
  let tmpFile;
  beforeEach(() => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    tmpFile = path.join(os.tmpdir(), `notify-apply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`);
    process.env.NOTIFY_LOG_FILE = tmpFile;
  });
  afterEach(() => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  });

  it("reports info severity when all fixes applied", async () => {
    await notify.notifyApplyResult({
      applied: [{ file: "a.js" }, { file: "b.js" }],
      failed: [],
      summary: "2 fixes applied",
      reviewFile: "review.json",
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.severity).toBe("info");
    expect(env.title).toContain("2 applied");
    expect(env.title).toContain("0 failed");
    expect(env.meta.event).toBe("ci.success");
    expect(env.meta.reviewFile).toBe("review.json");
  });

  it("reports warn severity when some fixes failed", async () => {
    await notify.notifyApplyResult({
      applied: [{ file: "a.js" }],
      failed: [{ file: "b.js", error: "parse error" }],
      summary: "1/2 applied",
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.severity).toBe("warn");
    expect(env.title).toContain("1 applied");
    expect(env.title).toContain("1 failed");
    expect(env.meta.event).toBe("ci.failure");
  });

  it("handles empty applied/failed arrays gracefully", async () => {
    await notify.notifyApplyResult({
      applied: [],
      failed: [],
      summary: "nothing to apply",
    });
    const env = JSON.parse(fs.readFileSync(tmpFile, "utf8").trim());
    expect(env.severity).toBe("info");
    expect(env.title).toContain("0 applied");
  });
});

describe("notify channel override", () => {
  beforeEach(() => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
  });

  it("uses only specified channels when channels param provided", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const r = await notify.notify({
        severity: "info",
        title: "test",
        channels: ["console"],
      });
      expect(r.results).toHaveLength(1);
      expect(r.results[0].channel).toBe("console");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("reports unknown channel as error", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const r = await notify.notify({
        severity: "info",
        title: "test",
        channels: ["nonexistent"],
      });
      const ch = r.results.find((x) => x.channel === "nonexistent");
      expect(ch.ok).toBe(false);
      expect(ch.error).toMatch(/unknown channel/);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("notify envelope structure", () => {
  beforeEach(() => {
    ENV_KEYS.forEach((k) => delete process.env[k]);
  });

  it("truncates title to 200 chars", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const longTitle = "A".repeat(300);
      const r = await notify.notify({ severity: "info", title: longTitle });
      expect(r.envelope.title.length).toBe(200);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("envelope has ts, severity, title, body, meta", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const r = await notify.notify({
        severity: "warn",
        title: "test",
        body: "details",
        meta: { key: "val" },
      });
      expect(r.envelope).toHaveProperty("ts");
      expect(r.envelope.severity).toBe("warn");
      expect(r.envelope.title).toBe("test");
      expect(r.envelope.body).toBe("details");
      expect(r.envelope.meta.key).toBe("val");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("coerces null body and meta to safe values", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const r = await notify.notify({
        severity: "info",
        title: "test",
        body: null,
        meta: null,
      });
      expect(r.envelope.body).toBe("");
      expect(r.envelope.meta).toEqual({});
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("formatPlain edge cases", () => {
  it("handles empty meta object", () => {
    const out = notify._formatPlain({
      ts: "2026-04-15T00:00:00Z",
      severity: "info",
      title: "test",
      body: "",
      meta: {},
    });
    expect(out).toContain("test");
    expect(out).not.toContain("메타:");
  });

  it("handles meta with object value (stringified)", () => {
    const out = notify._formatPlain({
      ts: "2026-04-15T00:00:00Z",
      severity: "error",
      title: "crash",
      body: "oops",
      meta: { nested: { a: 1 } },
    });
    expect(out).toContain("메타:");
    expect(out).toContain('"a":1');
  });
});
