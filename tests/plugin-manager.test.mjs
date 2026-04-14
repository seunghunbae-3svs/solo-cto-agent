// PR-G6-impl — Plugin API v2 filesystem scaffolding tests.
// Covers manifest I/O, capability parsing, package validation, and CRUD.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  SUPPORTED_API_VERSION,
  VALID_CAPABILITY_PREFIXES,
  pluginsManifestPath,
  defaultManifest,
  readManifest,
  writeManifest,
  parseCapability,
  isCapabilityAllowed,
  validatePluginPackage,
  listPlugins,
  findPlugin,
  addPlugin,
  removePlugin,
  readPackageJsonFromPath,
  formatPluginListText,
} from "../bin/plugin-manager.js";

function tmpManifest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sca-plugin-test-"));
  return path.join(dir, "plugins.json");
}

function validPkg(overrides = {}) {
  return {
    name: "sca-plugin-demo",
    version: "1.0.0",
    description: "a demo plugin",
    main: "index.js",
    soloCtoAgent: {
      apiVersion: 2,
      displayName: "Demo",
      agents: ["claude", "cowork"],
      capabilities: ["env:DEMO_TOKEN", "net:example.com", "hook:pre-review"],
      contributes: {
        reviewHooks: [{ event: "pre-review", handler: "./hooks/pre.js" }],
      },
      ...overrides,
    },
  };
}

// --------------------------------------------------------------------------
// Paths & manifest I/O
// --------------------------------------------------------------------------
describe("pluginsManifestPath", () => {
  it("respects SOLO_CTO_PLUGINS_PATH override", () => {
    const prev = process.env.SOLO_CTO_PLUGINS_PATH;
    process.env.SOLO_CTO_PLUGINS_PATH = "/tmp/test-override.json";
    expect(pluginsManifestPath()).toBe("/tmp/test-override.json");
    if (prev === undefined) delete process.env.SOLO_CTO_PLUGINS_PATH;
    else process.env.SOLO_CTO_PLUGINS_PATH = prev;
  });

  it("defaults to ~/.solo-cto-agent/plugins.json", () => {
    const prev = process.env.SOLO_CTO_PLUGINS_PATH;
    delete process.env.SOLO_CTO_PLUGINS_PATH;
    const p = pluginsManifestPath();
    expect(p).toMatch(/\.solo-cto-agent[\\/]plugins\.json$/);
    if (prev !== undefined) process.env.SOLO_CTO_PLUGINS_PATH = prev;
  });
});

describe("readManifest / writeManifest", () => {
  it("returns defaults when file is missing", () => {
    const p = tmpManifest();
    expect(readManifest({ path: p })).toEqual(defaultManifest());
  });

  it("round-trips manifest data", () => {
    const p = tmpManifest();
    const m = { version: 1, plugins: [{ name: "a", version: "1", agents: [] }] };
    writeManifest(m, { path: p });
    const back = readManifest({ path: p });
    expect(back.plugins).toHaveLength(1);
    expect(back.plugins[0].name).toBe("a");
  });

  it("recovers gracefully from corrupt JSON", () => {
    const p = tmpManifest();
    fs.writeFileSync(p, "{ not json");
    expect(readManifest({ path: p })).toEqual(defaultManifest());
  });

  it("normalizes missing fields", () => {
    const p = tmpManifest();
    fs.writeFileSync(p, JSON.stringify({ foo: "bar" }));
    const m = readManifest({ path: p });
    expect(m.version).toBe(1);
    expect(m.plugins).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Capability helpers
// --------------------------------------------------------------------------
describe("parseCapability", () => {
  it("parses env/net/cli/hook/schedule capabilities", () => {
    expect(parseCapability("env:FOO")).toEqual({ kind: "env", value: "FOO" });
    expect(parseCapability("net:api.github.com")).toEqual({ kind: "net", value: "api.github.com" });
    expect(parseCapability("cli:plugin-run")).toEqual({ kind: "cli", value: "plugin-run" });
    expect(parseCapability("hook:pre-review")).toEqual({ kind: "hook", value: "pre-review" });
    expect(parseCapability("schedule:daily")).toEqual({ kind: "schedule", value: "daily" });
  });

  it("parses fs:read: and fs:write: prefixes", () => {
    expect(parseCapability("fs:read:~/.config")).toEqual({ kind: "fs:read", value: "~/.config" });
    expect(parseCapability("fs:write:./logs")).toEqual({ kind: "fs:write", value: "./logs" });
  });

  it("rejects invalid shapes", () => {
    expect(parseCapability("")).toBeNull();
    expect(parseCapability(null)).toBeNull();
    expect(parseCapability("unknown:thing")).toBeNull();
    expect(parseCapability("env:")).toBeNull();
    expect(parseCapability(42)).toBeNull();
  });

  it("has all documented prefixes", () => {
    expect(VALID_CAPABILITY_PREFIXES).toContain("env:");
    expect(VALID_CAPABILITY_PREFIXES).toContain("fs:read:");
    expect(VALID_CAPABILITY_PREFIXES).toContain("fs:write:");
  });
});

describe("isCapabilityAllowed", () => {
  it("returns true for exact declared match", () => {
    expect(isCapabilityAllowed("env:TOKEN", ["env:TOKEN", "net:x"])).toBe(true);
  });
  it("returns false when not declared", () => {
    expect(isCapabilityAllowed("env:OTHER", ["env:TOKEN"])).toBe(false);
  });
  it("returns false for non-array declared", () => {
    expect(isCapabilityAllowed("env:X", null)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Package validation
// --------------------------------------------------------------------------
describe("validatePluginPackage", () => {
  it("accepts a minimal valid package", () => {
    const r = validatePluginPackage(validPkg());
    expect(r.ok).toBe(true);
    expect(r.normalized.name).toBe("sca-plugin-demo");
    expect(r.normalized.apiVersion).toBe(SUPPORTED_API_VERSION);
    expect(r.normalized.agents).toEqual(["claude", "cowork"]);
  });

  it("rejects non-object input", () => {
    expect(validatePluginPackage(null).ok).toBe(false);
    expect(validatePluginPackage("hi").ok).toBe(false);
  });

  it("requires name and version", () => {
    const r = validatePluginPackage({ soloCtoAgent: { apiVersion: 2, agents: ["claude"] } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /name/.test(e))).toBe(true);
    expect(r.errors.some((e) => /version/.test(e))).toBe(true);
  });

  it("requires soloCtoAgent section", () => {
    const r = validatePluginPackage({ name: "x", version: "1.0.0" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/soloCtoAgent/);
  });

  it("rejects unsupported apiVersion", () => {
    const pkg = validPkg();
    pkg.soloCtoAgent.apiVersion = 1;
    const r = validatePluginPackage(pkg);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/apiVersion/);
  });

  it("requires a non-empty agents array", () => {
    const pkg = validPkg();
    pkg.soloCtoAgent.agents = [];
    expect(validatePluginPackage(pkg).ok).toBe(false);
  });

  it("rejects unknown agents", () => {
    const pkg = validPkg();
    pkg.soloCtoAgent.agents = ["claude", "bogus"];
    const r = validatePluginPackage(pkg);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/bogus/);
  });

  it("rejects malformed capabilities", () => {
    const pkg = validPkg();
    pkg.soloCtoAgent.capabilities = ["env:OK", "nope:bad"];
    const r = validatePluginPackage(pkg);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/nope:bad/);
  });

  it("rejects unknown contribution keys", () => {
    const pkg = validPkg();
    pkg.soloCtoAgent.contributes = { surpriseKey: {} };
    const r = validatePluginPackage(pkg);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/surpriseKey/);
  });

  it("validates reviewHooks.event", () => {
    const pkg = validPkg();
    pkg.soloCtoAgent.contributes.reviewHooks = [{ event: "mid-review", handler: "x" }];
    const r = validatePluginPackage(pkg);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/pre-review|post-review/);
  });

  it("falls back to pkg.description when spec.description is missing", () => {
    const pkg = validPkg();
    delete pkg.soloCtoAgent.description;
    const r = validatePluginPackage(pkg);
    expect(r.ok).toBe(true);
    expect(r.normalized.description).toBe("a demo plugin");
  });
});

// --------------------------------------------------------------------------
// Manifest CRUD
// --------------------------------------------------------------------------
describe("addPlugin / removePlugin / listPlugins", () => {
  let manifestPath;
  beforeEach(() => { manifestPath = tmpManifest(); });

  it("adds a valid plugin", () => {
    const res = addPlugin({ pkg: validPkg(), source: "path:/tmp/demo" }, { path: manifestPath });
    expect(res.ok).toBe(true);
    expect(res.replaced).toBe(false);
    const list = listPlugins({ path: manifestPath });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("sca-plugin-demo");
    expect(list[0].source).toBe("path:/tmp/demo");
    expect(list[0].installedAt).toMatch(/T.*Z$/);
  });

  it("requires a source string", () => {
    const res = addPlugin({ pkg: validPkg() }, { path: manifestPath });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/source/);
  });

  it("propagates validation errors", () => {
    const bad = validPkg();
    bad.soloCtoAgent.apiVersion = 99;
    const res = addPlugin({ pkg: bad, source: "path:/x" }, { path: manifestPath });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/apiVersion/);
  });

  it("replaces existing plugin in place", () => {
    addPlugin({ pkg: validPkg(), source: "path:/v1" }, { path: manifestPath });
    const bumped = validPkg();
    bumped.version = "2.0.0";
    const res = addPlugin({ pkg: bumped, source: "path:/v2" }, { path: manifestPath });
    expect(res.ok).toBe(true);
    expect(res.replaced).toBe(true);
    const list = listPlugins({ path: manifestPath });
    expect(list).toHaveLength(1);
    expect(list[0].version).toBe("2.0.0");
    expect(list[0].source).toBe("path:/v2");
  });

  it("removes a registered plugin", () => {
    addPlugin({ pkg: validPkg(), source: "path:/x" }, { path: manifestPath });
    const res = removePlugin("sca-plugin-demo", { path: manifestPath });
    expect(res.removed).toBe(true);
    expect(listPlugins({ path: manifestPath })).toHaveLength(0);
  });

  it("removePlugin reports misses", () => {
    const res = removePlugin("never-installed", { path: manifestPath });
    expect(res.removed).toBe(false);
  });

  it("findPlugin returns null when absent", () => {
    const m = readManifest({ path: manifestPath });
    expect(findPlugin(m, "nope")).toBeNull();
  });
});

// --------------------------------------------------------------------------
// readPackageJsonFromPath
// --------------------------------------------------------------------------
describe("readPackageJsonFromPath", () => {
  it("reads a valid package.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sca-pkg-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(validPkg()));
    const r = readPackageJsonFromPath(dir);
    expect(r.ok).toBe(true);
    expect(r.pkg.name).toBe("sca-plugin-demo");
  });

  it("reports missing package.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sca-pkg-"));
    const r = readPackageJsonFromPath(dir);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no package\.json/);
  });

  it("reports malformed JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sca-pkg-"));
    fs.writeFileSync(path.join(dir, "package.json"), "{ not json");
    const r = readPackageJsonFromPath(dir);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/failed to parse/);
  });
});

// --------------------------------------------------------------------------
// formatPluginListText
// --------------------------------------------------------------------------
describe("formatPluginListText", () => {
  it("handles the empty case", () => {
    expect(formatPluginListText([])).toMatch(/No plugins registered/);
  });

  it("renders plugin metadata", () => {
    const out = formatPluginListText([
      {
        name: "demo",
        version: "1.0.0",
        displayName: "Demo",
        description: "d",
        agents: ["claude"],
        capabilities: ["env:FOO"],
        source: "path:/x",
        installedAt: "2026-04-14T00:00:00Z",
      },
    ]);
    expect(out).toMatch(/demo@1\.0\.0/);
    expect(out).toMatch(/agents: claude/);
    expect(out).toMatch(/capabilities: env:FOO/);
    expect(out).toMatch(/source: path:\/x/);
  });
});
