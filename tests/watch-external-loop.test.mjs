// PR-E5 — watch periodic external loop tests.
// Covers buildScheduledTasks, serializeYamlTasks, detectExternalSignals,
// externalLoopPing, formatExternalLoopPing. All fetches are stubbed via fetchImpl.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const watch = require("../bin/watch.js");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wel-test-"));
}

describe("detectExternalSignals", () => {
  it("returns all false for empty env", () => {
    const s = watch.detectExternalSignals({});
    expect(s.t1PeerModel).toBe(false);
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.t3GroundTruth).toBe(false);
  });

  it("detects T1 via OPENAI_API_KEY", () => {
    const s = watch.detectExternalSignals({ OPENAI_API_KEY: "sk" });
    expect(s.t1PeerModel).toBe(true);
  });

  it("detects T2 via COWORK_EXTERNAL_KNOWLEDGE=1", () => {
    const s = watch.detectExternalSignals({ COWORK_EXTERNAL_KNOWLEDGE: "1" });
    expect(s.t2ExternalKnowledge).toBe(true);
  });

  it("detects T2 via COWORK_PACKAGE_REGISTRY", () => {
    const s = watch.detectExternalSignals({ COWORK_PACKAGE_REGISTRY: "1" });
    expect(s.t2ExternalKnowledge).toBe(true);
  });

  it("detects T3 via VERCEL_TOKEN", () => {
    const s = watch.detectExternalSignals({ VERCEL_TOKEN: "t" });
    expect(s.t3GroundTruth).toBe(true);
  });

  it("detects T3 via SUPABASE_ACCESS_TOKEN", () => {
    const s = watch.detectExternalSignals({ SUPABASE_ACCESS_TOKEN: "t" });
    expect(s.t3GroundTruth).toBe(true);
  });
});

describe("buildScheduledTasks", () => {
  it("emits only cowork-review-watch when no external signals", () => {
    const tasks = watch.buildScheduledTasks({
      rootDir: "/tmp/app",
      intervalSec: 60,
      autoApply: false,
      signals: { t1PeerModel: false, t2ExternalKnowledge: false, t3GroundTruth: false },
      tier: "builder",
      agent: "cowork",
      force: false,
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("cowork-review-watch");
  });

  it("adds external-loop-daily when T2 active", () => {
    const tasks = watch.buildScheduledTasks({
      rootDir: "/tmp/app",
      intervalSec: 60,
      autoApply: false,
      signals: { t1PeerModel: false, t2ExternalKnowledge: true, t3GroundTruth: false },
      tier: "builder",
      agent: "cowork",
      force: false,
    });
    expect(tasks.map((t) => t.id)).toContain("cowork-external-loop-daily");
    const daily = tasks.find((t) => t.id === "cowork-external-loop-daily");
    expect(daily.interval_seconds).toBe(86400);
    expect(daily.auto).toBe(true);
  });

  it("adds external-loop-daily when T3 active", () => {
    const tasks = watch.buildScheduledTasks({
      rootDir: "/tmp/app",
      intervalSec: 60,
      autoApply: false,
      signals: { t1PeerModel: false, t2ExternalKnowledge: false, t3GroundTruth: true },
      tier: "builder",
      agent: "cowork",
      force: false,
    });
    expect(tasks.map((t) => t.id)).toContain("cowork-external-loop-daily");
  });

  it("adds dual-review-weekly when T1 active, auto-enabled for cto+cowork+codex", () => {
    const tasks = watch.buildScheduledTasks({
      rootDir: "/tmp/app",
      intervalSec: 60,
      autoApply: false,
      signals: { t1PeerModel: true, t2ExternalKnowledge: false, t3GroundTruth: false },
      tier: "cto",
      agent: "cowork+codex",
      force: false,
    });
    const weekly = tasks.find((t) => t.id === "cowork-dual-review-weekly");
    expect(weekly).toBeTruthy();
    expect(weekly.interval_seconds).toBe(604800);
    expect(weekly.auto).toBe(true);
  });

  it("emits dual-review-weekly with auto=false when tier blocks", () => {
    const tasks = watch.buildScheduledTasks({
      rootDir: "/tmp/app",
      intervalSec: 60,
      autoApply: false,
      signals: { t1PeerModel: true, t2ExternalKnowledge: false, t3GroundTruth: false },
      tier: "builder",
      agent: "cowork+codex",
      force: false,
    });
    const weekly = tasks.find((t) => t.id === "cowork-dual-review-weekly");
    expect(weekly.auto).toBe(false);
    expect(weekly.note).toMatch(/manually|tier gate/i);
  });

  it("--force enables dual-review-weekly regardless of tier", () => {
    const tasks = watch.buildScheduledTasks({
      rootDir: "/tmp/app",
      intervalSec: 60,
      autoApply: false,
      signals: { t1PeerModel: true, t2ExternalKnowledge: false, t3GroundTruth: false },
      tier: "maker",
      agent: "cowork",
      force: true,
    });
    const weekly = tasks.find((t) => t.id === "cowork-dual-review-weekly");
    expect(weekly.auto).toBe(true);
  });

  it("emits all three tasks when all signals on", () => {
    const tasks = watch.buildScheduledTasks({
      rootDir: "/tmp/app",
      intervalSec: 60,
      autoApply: true,
      signals: { t1PeerModel: true, t2ExternalKnowledge: true, t3GroundTruth: true },
      tier: "cto",
      agent: "cowork+codex",
      force: false,
    });
    expect(tasks.map((t) => t.id).sort()).toEqual([
      "cowork-dual-review-weekly",
      "cowork-external-loop-daily",
      "cowork-review-watch",
    ]);
  });
});

describe("serializeYamlTasks", () => {
  it("produces YAML with id, description, interval, command, auto, cwd", () => {
    const yaml = watch.serializeYamlTasks([
      { id: "a", description: "d", interval_seconds: 60, command: "cmd", auto: true, cwd: "/tmp" },
    ]);
    expect(yaml).toMatch(/id: a/);
    expect(yaml).toMatch(/description: "d"/);
    expect(yaml).toMatch(/interval_seconds: 60/);
    expect(yaml).toMatch(/command: "cmd"/);
    expect(yaml).toMatch(/auto: true/);
    expect(yaml).toMatch(/cwd: \/tmp/);
  });

  it("escapes double-quotes in description", () => {
    const yaml = watch.serializeYamlTasks([
      { id: "a", description: 'has "quotes"', interval_seconds: 60, command: "c", auto: false, cwd: "/x" },
    ]);
    expect(yaml).toMatch(/description: "has \\"quotes\\""/);
  });

  it("emits optional note line when present", () => {
    const yaml = watch.serializeYamlTasks([
      { id: "a", description: "d", interval_seconds: 60, command: "c", auto: false, cwd: "/x", note: "foo" },
    ]);
    expect(yaml).toMatch(/note: "foo"/);
  });
});

describe("emitScheduledTasksManifest", () => {
  let dir;
  beforeEach(() => { dir = tmpdir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("writes manifest file and returns path + tasks", () => {
    const out = path.join(dir, "manifest.yaml");
    const r = watch.emitScheduledTasksManifest({
      rootDir: dir,
      intervalSec: 60,
      autoApply: false,
      env: {},
      tier: "builder",
      agent: "cowork",
      force: false,
      outPath: out,
    });
    expect(r).toBeTruthy();
    expect(r.path).toBe(out);
    expect(r.tasks).toHaveLength(1);
    expect(fs.existsSync(out)).toBe(true);
    const yaml = fs.readFileSync(out, "utf8");
    expect(yaml).toMatch(/cowork-review-watch/);
  });

  it("respects env signals for task selection", () => {
    const out = path.join(dir, "manifest.yaml");
    const r = watch.emitScheduledTasksManifest({
      rootDir: dir,
      intervalSec: 60,
      autoApply: false,
      env: { VERCEL_TOKEN: "t", OPENAI_API_KEY: "k" },
      tier: "cto",
      agent: "cowork+codex",
      force: false,
      outPath: out,
    });
    expect(r.tasks.map((t) => t.id).sort()).toEqual([
      "cowork-dual-review-weekly",
      "cowork-external-loop-daily",
      "cowork-review-watch",
    ]);
  });
});

describe("externalLoopPing", () => {
  let dir;
  beforeEach(() => { dir = tmpdir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("returns ok:false when no signals active", async () => {
    const r = await watch.externalLoopPing({ env: {}, cwd: dir });
    expect(r.ok).toBe(false);
    expect(r.activeCount).toBe(0);
    expect(r.reason).toMatch(/no external signals/);
  });

  it("returns ok:true with T3 alerts when Vercel has ERROR deployments", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        deployments: [
          { uid: "d1", state: "ERROR", target: "production", created: 2000 },
          { uid: "d2", state: "READY", target: "production", created: 1000 },
        ],
      }),
    });
    const r = await watch.externalLoopPing({
      env: { VERCEL_TOKEN: "t", VERCEL_PROJECT_ID: "p" },
      cwd: dir,
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(r.activeCount).toBe(1);
    expect(r.alerts.find((a) => a.kind === "vercel-error")).toBeTruthy();
  });

  it("returns ok:true with no alerts when all clear", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        deployments: [{ uid: "d1", state: "READY", target: "production", created: 1000 }],
      }),
    });
    const r = await watch.externalLoopPing({
      env: { VERCEL_TOKEN: "t", VERCEL_PROJECT_ID: "p" },
      cwd: dir,
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(r.alerts).toEqual([]);
  });

  it("combines T2 + T3 signals", async () => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      name: "app",
      dependencies: { react: "17.0.0" },
    }));
    const fetchImpl = async (url) => {
      if (url.includes("api.vercel.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ deployments: [] }),
        };
      }
      // npm registry
      return {
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "18.3.1" }, versions: { "18.3.1": {} } }),
      };
    };
    const r = await watch.externalLoopPing({
      env: { VERCEL_TOKEN: "t", VERCEL_PROJECT_ID: "p", COWORK_EXTERNAL_KNOWLEDGE: "1" },
      cwd: dir,
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(r.activeCount).toBe(2);
    expect(r.alerts.find((a) => a.tier === "T2" && a.kind === "major-drift")).toBeTruthy();
  });
});

describe("formatExternalLoopPing", () => {
  it("formats inactive state", () => {
    const s = watch.formatExternalLoopPing({
      ok: false,
      reason: "no external signals active",
      signals: { t1PeerModel: false, t2ExternalKnowledge: false, t3GroundTruth: false },
      activeCount: 0,
      timestamp: "",
    });
    expect(s).toMatch(/inactive/);
    expect(s).toMatch(/no external signals/);
  });

  it("formats all-clear when no alerts", () => {
    const s = watch.formatExternalLoopPing({
      ok: true,
      signals: { t1PeerModel: false, t2ExternalKnowledge: true, t3GroundTruth: true },
      activeCount: 2,
      alerts: [],
      timestamp: "",
    });
    expect(s).toMatch(/active=2\/3/);
    expect(s).toMatch(/all clear/);
  });

  it("lists each alert", () => {
    const s = watch.formatExternalLoopPing({
      ok: true,
      signals: { t1PeerModel: false, t2ExternalKnowledge: true, t3GroundTruth: true },
      activeCount: 2,
      alerts: [
        { tier: "T3", kind: "vercel-error", detail: "1 ERROR; uid=d1" },
        { tier: "T2", kind: "deprecated", detail: "2 deprecated" },
      ],
      timestamp: "",
    });
    expect(s).toMatch(/\[T3\] vercel-error/);
    expect(s).toMatch(/\[T2\] deprecated/);
  });

  it("returns empty string for null", () => {
    expect(watch.formatExternalLoopPing(null)).toBe("");
  });
});
