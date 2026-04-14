// PR-G7-subcommands — tests for bin/notify-config.js
//
// Every test runs against a tmp file via SOLO_CTO_NOTIFY_CONFIG so the
// real ~/.solo-cto-agent/notify.json is never touched.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import * as notifyConfig from "../bin/notify-config.js";

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notify-config-test-"));
  return path.join(dir, "notify.json");
}

let prevEnv;
let configFile;

beforeEach(() => {
  prevEnv = process.env.SOLO_CTO_NOTIFY_CONFIG;
  configFile = tmpFile();
  process.env.SOLO_CTO_NOTIFY_CONFIG = configFile;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.SOLO_CTO_NOTIFY_CONFIG;
  else process.env.SOLO_CTO_NOTIFY_CONFIG = prevEnv;
});

describe("defaultConfig", () => {
  it("matches docs/telegram-wizard-spec.md §5", () => {
    const c = notifyConfig.defaultConfig();
    expect(c.channels).toEqual(["telegram"]);
    expect(c.format).toBe("compact");
    expect(c.events["review.blocker"]).toBe(true);
    expect(c.events["review.dual-disagree"]).toBe(true);
    expect(c.events["ci.failure"]).toBe(true);
    expect(c.events["ci.success"]).toBe(false);
    expect(c.events["deploy.ready"]).toBe(false);
    expect(c.events["deploy.error"]).toBe(true);
  });
});

describe("configPath", () => {
  it("honors SOLO_CTO_NOTIFY_CONFIG override", () => {
    expect(notifyConfig.configPath()).toBe(configFile);
  });

  it("falls back to ~/.solo-cto-agent/notify.json without override", () => {
    delete process.env.SOLO_CTO_NOTIFY_CONFIG;
    const p = notifyConfig.configPath();
    expect(p).toMatch(/\.solo-cto-agent[\/\\]notify\.json$/);
    expect(p.startsWith(os.homedir())).toBe(true);
    process.env.SOLO_CTO_NOTIFY_CONFIG = configFile;
  });
});

describe("readConfig", () => {
  it("returns defaults when the file is missing", () => {
    const c = notifyConfig.readConfig();
    expect(c.events["review.blocker"]).toBe(true);
    expect(c.channels).toEqual(["telegram"]);
  });

  it("merges partial files with defaults (fail-open)", () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ events: { "ci.success": true } }));
    const c = notifyConfig.readConfig();
    expect(c.events["ci.success"]).toBe(true);
    // Other defaults preserved
    expect(c.events["review.blocker"]).toBe(true);
    expect(c.format).toBe("compact");
  });

  it("recovers from corrupt JSON (returns defaults + _error)", () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, "{ this is not json");
    const c = notifyConfig.readConfig();
    expect(c._error).toBe("parse");
    expect(c.events["review.blocker"]).toBe(true);
  });

  it("ignores non-boolean event values", () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(
      configFile,
      JSON.stringify({ events: { "review.blocker": "yes", "ci.failure": false } }),
    );
    const c = notifyConfig.readConfig();
    expect(c.events["review.blocker"]).toBe(true); // default kept
    expect(c.events["ci.failure"]).toBe(false);
  });

  it("falls back format to default when invalid", () => {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ format: "novel" }));
    expect(notifyConfig.readConfig().format).toBe("compact");
  });
});

describe("writeConfig", () => {
  it("creates the parent directory and persists JSON", () => {
    const written = notifyConfig.writeConfig({ format: "detailed", channels: ["telegram", "slack"], events: {} });
    expect(fs.existsSync(configFile)).toBe(true);
    expect(written.format).toBe("detailed");
    const onDisk = JSON.parse(fs.readFileSync(configFile, "utf8"));
    expect(onDisk.format).toBe("detailed");
    expect(onDisk.channels).toContain("slack");
  });

  it("normalizes invalid format input back to compact", () => {
    const written = notifyConfig.writeConfig({ format: "garbage" });
    expect(written.format).toBe("compact");
  });
});

describe("ensureDefaultConfig", () => {
  it("writes the default file when missing", () => {
    const r = notifyConfig.ensureDefaultConfig();
    expect(r.created).toBe(true);
    expect(fs.existsSync(configFile)).toBe(true);
  });

  it("is a no-op when the file exists", () => {
    notifyConfig.ensureDefaultConfig();
    const second = notifyConfig.ensureDefaultConfig();
    expect(second.created).toBe(false);
  });
});

describe("isEventEnabled", () => {
  it("returns true for known-enabled events", () => {
    expect(notifyConfig.isEventEnabled("review.blocker")).toBe(true);
  });

  it("returns false for explicitly disabled events", () => {
    notifyConfig.writeConfig({ events: { "ci.failure": false } });
    expect(notifyConfig.isEventEnabled("ci.failure")).toBe(false);
  });

  it("returns true for unknown events (fail-open)", () => {
    expect(notifyConfig.isEventEnabled("brand.new.event")).toBe(true);
  });

  it("accepts a pre-loaded config to avoid double reads", () => {
    const cfg = { events: { "review.blocker": false } };
    expect(notifyConfig.isEventEnabled("review.blocker", cfg)).toBe(false);
  });
});

describe("isChannelEnabled", () => {
  it("returns true when channel is in the list", () => {
    expect(notifyConfig.isChannelEnabled("telegram")).toBe(true);
  });

  it("returns false when channel is removed", () => {
    notifyConfig.writeConfig({ channels: ["slack"] });
    expect(notifyConfig.isChannelEnabled("telegram")).toBe(false);
  });
});

describe("setEventEnabled / setChannelEnabled", () => {
  it("toggles a single event idempotently", () => {
    notifyConfig.setEventEnabled("ci.success", true);
    expect(notifyConfig.readConfig().events["ci.success"]).toBe(true);
    notifyConfig.setEventEnabled("ci.success", false);
    expect(notifyConfig.readConfig().events["ci.success"]).toBe(false);
  });

  it("adds and removes channels without dupes", () => {
    notifyConfig.setChannelEnabled("slack", true);
    notifyConfig.setChannelEnabled("slack", true);
    const c = notifyConfig.readConfig();
    expect(c.channels.filter((x) => x === "slack").length).toBe(1);
    notifyConfig.setChannelEnabled("slack", false);
    expect(notifyConfig.readConfig().channels).not.toContain("slack");
  });
});
