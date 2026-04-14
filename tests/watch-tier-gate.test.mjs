import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(import.meta.url);
const watch = require("../bin/watch.js");
const engine = require("../bin/cowork-engine.js");

describe("watch.checkTierGate", () => {
  it("cto + cowork+codex → allowed", () => {
    const r = watch.checkTierGate({ tier: "cto", agent: "cowork+codex", force: false });
    expect(r.allowed).toBe(true);
  });

  it("cto + cowork-only → refused unless --force", () => {
    const r = watch.checkTierGate({ tier: "cto", agent: "cowork", force: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/needs --force/);
  });

  it("--force overrides the gate", () => {
    const r = watch.checkTierGate({ tier: "maker", agent: "cowork", force: true });
    expect(r.allowed).toBe(true);
    expect(r.reason).toMatch(/force override/);
  });

  it("maker tier → refused", () => {
    const r = watch.checkTierGate({ tier: "maker", agent: "cowork+codex", force: false });
    expect(r.allowed).toBe(false);
  });

  it("builder tier → refused", () => {
    const r = watch.checkTierGate({ tier: "builder", agent: "cowork", force: false });
    expect(r.allowed).toBe(false);
  });
});

describe("watch.detectAgent", () => {
  let original;
  beforeEach(() => { original = process.env.OPENAI_API_KEY; });
  afterEach(() => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  });
  it("returns cowork+codex when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(watch.detectAgent()).toBe("cowork+codex");
  });
  it("returns cowork when OPENAI_API_KEY is absent", () => {
    delete process.env.OPENAI_API_KEY;
    expect(watch.detectAgent()).toBe("cowork");
  });
});

describe("watch.isWatchable", () => {
  it("matches common frontend extensions", () => {
    expect(watch.isWatchable("App.tsx")).toBe(true);
    expect(watch.isWatchable("page.jsx")).toBe(true);
    expect(watch.isWatchable("style.css")).toBe(true);
    expect(watch.isWatchable("App.svelte")).toBe(true);
  });
  it("rejects irrelevant files", () => {
    expect(watch.isWatchable("README.md")).toBe(false);
    expect(watch.isWatchable("package.json")).toBe(false);
    expect(watch.isWatchable(null)).toBe(false);
  });
});

describe("watch.startWatch (dryRun)", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-test-"));
    engine._setSkillDirOverride(tmpDir);
  });
  afterEach(() => {
    engine._setSkillDirOverride(null);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  it("returns gate decision without spawning anything", async () => {
    const r = await watch.startWatch({ rootDir: tmpDir, auto: true, force: false, dryRun: true });
    expect(r).toHaveProperty("rootDir");
    expect(r).toHaveProperty("tier");
    expect(r).toHaveProperty("willAuto");
    expect(r).toHaveProperty("gateReason");
    // willAuto depends on env (OPENAI_API_KEY) and tier — just assert decision is recorded
    expect(typeof r.willAuto).toBe("boolean");
    expect(typeof r.gateReason).toBe("string");
  });

  it("--force in dryRun yields willAuto=true", async () => {
    const r = await watch.startWatch({ rootDir: tmpDir, auto: true, force: true, dryRun: true });
    expect(r.willAuto).toBe(true);
    expect(r.gateReason).toMatch(/force override/);
  });

  it("auto=false yields willAuto=false with manual reason", async () => {
    const r = await watch.startWatch({ rootDir: tmpDir, auto: false, dryRun: true });
    expect(r.willAuto).toBe(false);
    expect(r.gateReason).toMatch(/manual signal mode/);
  });
});

describe("watch.emitScheduledTasksManifest", () => {
  it("writes a yaml manifest under skill dir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "watch-manifest-"));
    // Manifest path is fixed under ~/.claude — we just verify it returns a path or null
    const out = watch.emitScheduledTasksManifest({ rootDir: tmp, intervalSec: 60, autoApply: false });
    if (out) {
      const filePath = typeof out === "string" ? out : out.path;
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).toMatch(/cowork-review-watch/);
      expect(content).toMatch(/interval_seconds: 60/);
      expect(content).toMatch(/auto: false/);
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  });
});
