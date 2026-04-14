// PR-E2 — T2 External Knowledge (package currency) tests.
// Network calls are stubbed via fetchImpl injection so CI stays offline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  scanPackageJson,
  parsePinnedVersion,
  compareVersions,
  fetchNpmRegistry,
  fetchPackageCurrency,
  fetchExternalKnowledge,
  formatExternalKnowledgeContext,
} from "../bin/cowork-engine.js";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ek-test-"));
}

function writePkg(dir, pkg) {
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
}

describe("scanPackageJson", () => {
  let dir;
  beforeEach(() => { dir = tmpdir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("returns null when no package.json", () => {
    expect(scanPackageJson({ cwd: dir })).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    fs.writeFileSync(path.join(dir, "package.json"), "{not json");
    expect(scanPackageJson({ cwd: dir })).toBeNull();
  });

  it("extracts name, version, deps, devDeps, engines", () => {
    writePkg(dir, {
      name: "my-app",
      version: "1.2.3",
      engines: { node: ">=18" },
      dependencies: { react: "^18.2.0", next: "14.0.0" },
      devDependencies: { vitest: "^1.0.0" },
    });
    const p = scanPackageJson({ cwd: dir });
    expect(p.name).toBe("my-app");
    expect(p.version).toBe("1.2.3");
    expect(p.engines.node).toBe(">=18");
    expect(p.totalDeps).toBe(2);
    expect(p.totalDevDeps).toBe(1);
    expect(p.dependencies.react).toBe("^18.2.0");
  });

  it("handles missing dependencies/devDependencies fields", () => {
    writePkg(dir, { name: "empty" });
    const p = scanPackageJson({ cwd: dir });
    expect(p.totalDeps).toBe(0);
    expect(p.totalDevDeps).toBe(0);
  });
});

describe("parsePinnedVersion", () => {
  it("strips ^ and ~ prefixes", () => {
    expect(parsePinnedVersion("^18.2.0")).toBe("18.2.0");
    expect(parsePinnedVersion("~1.0.3")).toBe("1.0.3");
    expect(parsePinnedVersion(">=2.0.0")).toBe("2.0.0");
  });

  it("returns null for non-standard specifiers", () => {
    expect(parsePinnedVersion("workspace:*")).toBeNull();
    expect(parsePinnedVersion("file:../local")).toBeNull();
    expect(parsePinnedVersion("link:../other")).toBeNull();
    expect(parsePinnedVersion("git+https://github.com/foo/bar")).toBeNull();
    expect(parsePinnedVersion("github:foo/bar")).toBeNull();
    expect(parsePinnedVersion("npm:alias@1.0.0")).toBeNull();
  });

  it("returns null for missing/invalid input", () => {
    expect(parsePinnedVersion(null)).toBeNull();
    expect(parsePinnedVersion("")).toBeNull();
    expect(parsePinnedVersion("not-a-version")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("same version", () => {
    expect(compareVersions("1.0.0", "1.0.0").diff).toBe("same");
  });
  it("installed ahead of latest", () => {
    expect(compareVersions("2.0.0", "1.9.9").diff).toBe("ahead");
  });
  it("major behind", () => {
    expect(compareVersions("17.0.0", "18.0.0").diff).toBe("major");
  });
  it("minor behind", () => {
    expect(compareVersions("1.2.0", "1.3.0").diff).toBe("minor");
  });
  it("patch behind", () => {
    expect(compareVersions("1.2.3", "1.2.5").diff).toBe("patch");
  });
  it("unknown when one side unparseable", () => {
    expect(compareVersions("workspace:*", "1.0.0").diff).toBe("unknown");
  });
  it("handles caret prefix", () => {
    expect(compareVersions("^1.2.0", "1.3.0").diff).toBe("minor");
  });
});

describe("fetchNpmRegistry (mocked fetch)", () => {
  it("returns ok:true with latest + deprecated from registry", async () => {
    const fetchImpl = async (url) => {
      expect(url).toBe("https://registry.npmjs.org/react");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          "dist-tags": { latest: "18.3.1" },
          versions: { "18.3.1": {} },
        }),
      };
    };
    const r = await fetchNpmRegistry("react", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.latest).toBe("18.3.1");
    expect(r.deprecated).toBeNull();
  });

  it("surfaces deprecation string when present", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        "dist-tags": { latest: "2.88.2" },
        versions: { "2.88.2": { deprecated: "request has been deprecated" } },
      }),
    });
    const r = await fetchNpmRegistry("request", { fetchImpl });
    expect(r.deprecated).toMatch(/deprecated/i);
  });

  it("returns ok:false on 404", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await fetchNpmRegistry("not-a-real-pkg-xyz", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/404/);
  });

  it("returns timeout on AbortError", async () => {
    const fetchImpl = async (_url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const r = await fetchNpmRegistry("react", { fetchImpl, timeoutMs: 10 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("timeout");
  });

  it("url-encodes scoped package names", async () => {
    let seenUrl = null;
    const fetchImpl = async (url) => {
      seenUrl = url;
      return { ok: true, status: 200, json: async () => ({ "dist-tags": { latest: "1.0.0" }, versions: {} }) };
    };
    await fetchNpmRegistry("@scope/pkg", { fetchImpl });
    expect(seenUrl).toBe("https://registry.npmjs.org/%40scope%2Fpkg");
  });
});

describe("fetchPackageCurrency", () => {
  it("returns empty entries when deps is empty", async () => {
    const fetchImpl = async () => { throw new Error("should not be called"); };
    const r = await fetchPackageCurrency({ deps: {}, fetchImpl });
    expect(r.entries).toHaveLength(0);
    expect(r.scanned).toBe(0);
  });

  it("fetches all deps and classifies diffs", async () => {
    const fetchImpl = async (url) => {
      const name = decodeURIComponent(url.split("/").pop());
      const map = {
        react: "18.3.1",
        next: "14.2.0",
        typescript: "5.4.10",
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          "dist-tags": { latest: map[name] },
          versions: { [map[name]]: {} },
        }),
      };
    };
    const r = await fetchPackageCurrency({
      deps: { react: "17.0.0", next: "14.2.0", typescript: "5.4.9" },
      fetchImpl,
      concurrency: 2,
    });
    expect(r.scanned).toBe(3);
    expect(r.entries.find((e) => e.name === "react").diff).toBe("major");
    expect(r.entries.find((e) => e.name === "next").diff).toBe("same");
    expect(r.entries.find((e) => e.name === "typescript").diff).toBe("patch");
    expect(r.summary.major).toBe(1);
    expect(r.summary.patch).toBe(1);
  });

  it("respects limit cap", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } }),
    });
    const deps = {};
    for (let i = 0; i < 30; i++) deps[`pkg${i}`] = "1.0.0";
    const r = await fetchPackageCurrency({ deps, fetchImpl, limit: 5 });
    expect(r.scanned).toBe(5);
    expect(r.total).toBe(30);
    expect(r.entries).toHaveLength(5);
  });

  it("captures registry errors per-entry without failing whole batch", async () => {
    const fetchImpl = async (url) => {
      const name = decodeURIComponent(url.split("/").pop());
      if (name === "broken") return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } }) };
    };
    const r = await fetchPackageCurrency({
      deps: { good: "1.0.0", broken: "1.0.0" },
      fetchImpl,
    });
    expect(r.entries).toHaveLength(2);
    expect(r.summary.errored).toBe(1);
    expect(r.entries.find((e) => e.name === "broken").ok).toBe(false);
  });

  it("sorts deprecated + major before same/ahead", async () => {
    const fetchImpl = async (url) => {
      const name = decodeURIComponent(url.split("/").pop());
      if (name === "request") return { ok: true, status: 200, json: async () => ({ "dist-tags": { latest: "2.88.2" }, versions: { "2.88.2": { deprecated: "yes" } } }) };
      if (name === "old-dep") return { ok: true, status: 200, json: async () => ({ "dist-tags": { latest: "5.0.0" }, versions: { "5.0.0": {} } }) };
      return { ok: true, status: 200, json: async () => ({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } }) };
    };
    const r = await fetchPackageCurrency({
      deps: { fresh: "1.0.0", "old-dep": "2.0.0", request: "2.88.2" },
      fetchImpl,
    });
    // Deprecated first, then major-behind, then same.
    expect(r.entries[0].name).toBe("request");
    expect(r.entries[1].name).toBe("old-dep");
    expect(r.entries[2].name).toBe("fresh");
  });
});

describe("fetchExternalKnowledge", () => {
  let dir;
  beforeEach(() => { dir = tmpdir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("disabled when env flag missing", async () => {
    writePkg(dir, { name: "x", dependencies: { react: "18.0.0" } });
    const r = await fetchExternalKnowledge({ env: {}, cwd: dir });
    expect(r.enabled).toBe(false);
    expect(r.hasData).toBe(false);
  });

  it("enabled with COWORK_EXTERNAL_KNOWLEDGE=1 + no package.json surfaces error", async () => {
    const r = await fetchExternalKnowledge({
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1" },
      cwd: dir,
    });
    expect(r.enabled).toBe(true);
    expect(r.error).toMatch(/no package\.json/);
    expect(r.hasData).toBe(false);
  });

  it("scans deps when enabled + package.json present", async () => {
    writePkg(dir, { name: "x", dependencies: { react: "17.0.0" } });
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "18.3.1" }, versions: { "18.3.1": {} } }),
    });
    const r = await fetchExternalKnowledge({
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1" },
      cwd: dir,
      fetchImpl,
    });
    expect(r.enabled).toBe(true);
    expect(r.hasData).toBe(true);
    expect(r.packageCurrency.summary.major).toBe(1);
  });

  it("skips devDeps by default, includes when flag set", async () => {
    writePkg(dir, {
      name: "x",
      dependencies: { react: "17.0.0" },
      devDependencies: { vitest: "1.0.0" },
    });
    const called = new Set();
    const fetchImpl = async (url) => {
      called.add(decodeURIComponent(url.split("/").pop()));
      return {
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } }),
      };
    };
    const r1 = await fetchExternalKnowledge({
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1" },
      cwd: dir,
      fetchImpl,
    });
    expect(called.has("react")).toBe(true);
    expect(called.has("vitest")).toBe(false);

    called.clear();
    await fetchExternalKnowledge({
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1", COWORK_EXTERNAL_KNOWLEDGE_INCLUDE_DEV: "1" },
      cwd: dir,
      fetchImpl,
    });
    expect(called.has("vitest")).toBe(true);
  });

  it("COWORK_PACKAGE_REGISTRY alone also enables T2", async () => {
    writePkg(dir, { name: "x", dependencies: { react: "18.3.1" } });
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ "dist-tags": { latest: "18.3.1" }, versions: { "18.3.1": {} } }),
    });
    const r = await fetchExternalKnowledge({
      env: { COWORK_PACKAGE_REGISTRY: "https://registry.npmjs.org" },
      cwd: dir,
      fetchImpl,
    });
    expect(r.enabled).toBe(true);
  });
});

describe("formatExternalKnowledgeContext", () => {
  it("empty when disabled", () => {
    expect(formatExternalKnowledgeContext({ enabled: false })).toBe("");
  });
  it("empty when no package currency", () => {
    expect(formatExternalKnowledgeContext({ enabled: true, packageCurrency: null })).toBe("");
  });
  it("empty when no entries", () => {
    expect(formatExternalKnowledgeContext({
      enabled: true,
      packageCurrency: { entries: [], summary: {}, scanned: 0, total: 0 },
    })).toBe("");
  });

  it("includes header and summary line when deps present", () => {
    const out = formatExternalKnowledgeContext({
      enabled: true,
      packageCurrency: {
        scanned: 3,
        total: 3,
        entries: [
          { ok: true, name: "react", installed: "17.0.0", latest: "18.3.1", diff: "major" },
          { ok: true, name: "next", installed: "14.0.0", latest: "14.2.0", diff: "minor" },
          { ok: true, name: "fresh", installed: "1.0.0", latest: "1.0.0", diff: "same" },
        ],
        summary: { major: 1, minor: 1, patch: 0, deprecated: 0, errored: 0 },
      },
    });
    expect(out).toMatch(/스택 최신성/);
    expect(out).toMatch(/T2 External Knowledge/);
    expect(out).toMatch(/major behind: 1/);
    expect(out).toMatch(/⛔.*react/);
    expect(out).toMatch(/18\.3\.1/);
  });

  it("highlights deprecated packages", () => {
    const out = formatExternalKnowledgeContext({
      enabled: true,
      packageCurrency: {
        scanned: 1,
        total: 1,
        entries: [{ ok: true, name: "request", installed: "2.88.2", latest: "2.88.2", diff: "same", deprecated: "request has been deprecated" }],
        summary: { major: 0, minor: 0, patch: 0, deprecated: 1, errored: 0 },
      },
    });
    expect(out).toMatch(/deprecated/i);
    expect(out).toMatch(/request/);
  });

  it("shows 'all current' summary when nothing behind", () => {
    const out = formatExternalKnowledgeContext({
      enabled: true,
      packageCurrency: {
        scanned: 1,
        total: 1,
        entries: [{ ok: true, name: "react", installed: "18.3.1", latest: "18.3.1", diff: "same" }],
        summary: { major: 0, minor: 0, patch: 0, deprecated: 0, errored: 0 },
      },
    });
    expect(out).toMatch(/모든 패키지 최신/);
  });
});
