// PR-G6-runtime — plugin-loader + ctx capability enforcement tests.

import { describe, it, expect } from "vitest";
import {
  makeEnvAccessor,
  makeFetch,
  makeFsAccessor,
  makeLogger,
  makeOutput,
  buildCtx,
  pathMatches,
  resolveEntry,
  loadPlugin,
  collectReviewHooks,
  runPreReviewHooks,
  runPostReviewHooks,
} from "../bin/plugin-loader.js";

function plugin(overrides = {}) {
  return {
    name: "demo",
    version: "1.0.0",
    apiVersion: 2,
    agents: ["claude"],
    capabilities: [],
    contributes: {},
    source: "path:/fake/demo",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// env capability
// ---------------------------------------------------------------------------
describe("makeEnvAccessor", () => {
  it("returns declared env vars", () => {
    process.env.SCA_TEST_DECLARED = "hi";
    const env = makeEnvAccessor(plugin({ capabilities: ["env:SCA_TEST_DECLARED"] }));
    expect(env("SCA_TEST_DECLARED")).toBe("hi");
    delete process.env.SCA_TEST_DECLARED;
  });

  it("throws for undeclared env vars", () => {
    const env = makeEnvAccessor(plugin({ capabilities: [] }));
    expect(() => env("SECRET")).toThrow(/env access denied/);
  });

  it("returns null when declared but unset", () => {
    delete process.env.SCA_UNSET;
    const env = makeEnvAccessor(plugin({ capabilities: ["env:SCA_UNSET"] }));
    expect(env("SCA_UNSET")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetch capability
// ---------------------------------------------------------------------------
describe("makeFetch", () => {
  it("throws for undeclared hosts", async () => {
    const fetch = makeFetch(plugin({ capabilities: ["net:other.example"] }));
    await expect(fetch("https://api.github.com/x")).rejects.toThrow(/network access denied for host "api.github.com"/);
  });

  it("throws on malformed URLs", async () => {
    const fetch = makeFetch(plugin({ capabilities: ["net:any"] }));
    await expect(fetch("not-a-url")).rejects.toThrow(/invalid URL/);
  });
});

// ---------------------------------------------------------------------------
// pathMatches
// ---------------------------------------------------------------------------
describe("pathMatches", () => {
  it("matches exact paths", () => {
    expect(pathMatches("a/b.txt", "a/b.txt")).toBe(true);
    expect(pathMatches("a/b.txt", "a/c.txt")).toBe(false);
  });

  it("matches directory prefix", () => {
    expect(pathMatches("logs/2026.log", "logs/")).toBe(true);
    expect(pathMatches("other/2026.log", "logs/")).toBe(false);
  });

  it("matches /* for direct children only", () => {
    expect(pathMatches("logs/a.txt", "logs/*")).toBe(true);
    expect(pathMatches("logs/sub/a.txt", "logs/*")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fs capability + escape prevention
// ---------------------------------------------------------------------------
describe("makeFsAccessor", () => {
  it("denies fs.read outside declared globs", () => {
    const fsA = makeFsAccessor(plugin({ capabilities: ["fs:read:logs/"] }), process.cwd());
    expect(() => fsA.read("README.md")).toThrow(/fs\.read denied/);
  });

  it("prevents path escape via ..", () => {
    const fsA = makeFsAccessor(plugin({ capabilities: ["fs:read:../"] }), process.cwd());
    expect(() => fsA.read("../../etc/passwd")).toThrow(/path escape/);
  });
});

// ---------------------------------------------------------------------------
// logger + output
// ---------------------------------------------------------------------------
describe("makeLogger", () => {
  it("prefixes lines and routes by severity", () => {
    const lines = [];
    const logger = makeLogger(plugin(), (l) => lines.push(l));
    logger.info("hi");
    logger.warn("warn");
    logger.error("oh no");
    expect(lines[0]).toMatch(/\[plugin:demo\] hi/);
    expect(lines[1]).toMatch(/WARN warn/);
    expect(lines[2]).toMatch(/ERROR oh no/);
  });
});

describe("makeOutput", () => {
  it("writes JSON + text", () => {
    const chunks = [];
    const stdout = { write: (s) => chunks.push(s) };
    const out = makeOutput(stdout);
    out.text("raw");
    out.json({ a: 1 });
    expect(chunks[0]).toBe("raw");
    expect(chunks[1]).toMatch(/"a": 1/);
  });
});

// ---------------------------------------------------------------------------
// buildCtx
// ---------------------------------------------------------------------------
describe("buildCtx", () => {
  it("returns all ctx members", () => {
    const ctx = buildCtx(plugin({ capabilities: ["env:X"] }));
    expect(ctx.manifest.name).toBe("demo");
    expect(typeof ctx.env).toBe("function");
    expect(typeof ctx.fetch).toBe("function");
    expect(typeof ctx.fs.read).toBe("function");
    expect(typeof ctx.log.info).toBe("function");
    expect(typeof ctx.output.json).toBe("function");
    expect(typeof ctx.review.addNote).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// resolveEntry
// ---------------------------------------------------------------------------
describe("resolveEntry", () => {
  it("resolves path: sources", () => {
    expect(resolveEntry(plugin({ source: "path:/abs/dir" }))).toBe("/abs/dir");
    expect(resolveEntry(plugin({ source: "path:/abs/dir#entry.js" }))).toBe("/abs/dir/entry.js");
  });

  it("throws for unsupported source", () => {
    expect(() => resolveEntry(plugin({ source: "git:foo" }))).toThrow(/unsupported source/);
  });
});

// ---------------------------------------------------------------------------
// loadPlugin
// ---------------------------------------------------------------------------
describe("loadPlugin", () => {
  it("require()s the resolved entry", () => {
    const fakeMod = { apiVersion: 2, handle: () => ({ diff: "x" }) };
    const requireFn = () => fakeMod;
    expect(loadPlugin(plugin(), { requireFn })).toBe(fakeMod);
  });

  it("rejects mismatched apiVersion", () => {
    const requireFn = () => ({ apiVersion: 99 });
    expect(() => loadPlugin(plugin(), { requireFn })).toThrow(/apiVersion=99/);
  });
});

// ---------------------------------------------------------------------------
// collectReviewHooks
// ---------------------------------------------------------------------------
describe("collectReviewHooks", () => {
  it("orders by priority ascending", () => {
    const plugins = [
      plugin({ name: "b", contributes: { reviewHooks: [{ event: "pre-review", priority: 20 }] }, source: "path:/b" }),
      plugin({ name: "a", contributes: { reviewHooks: [{ event: "pre-review", priority: 10 }] }, source: "path:/a" }),
    ];
    const manifest = { plugins };
    const fakeModA = { handle: () => ({}) };
    const fakeModB = { handle: () => ({}) };
    const requireFn = (p) => (p === "/a" ? fakeModA : fakeModB);
    const hooks = collectReviewHooks(manifest, "pre-review", { requireFn });
    expect(hooks.map((h) => h.plugin.name)).toEqual(["a", "b"]);
  });

  it("skips plugins whose module fails to load", () => {
    const plugins = [plugin({ contributes: { reviewHooks: [{ event: "pre-review" }] } })];
    const requireFn = () => { throw new Error("ENOENT"); };
    expect(collectReviewHooks({ plugins }, "pre-review", { requireFn })).toEqual([]);
  });

  it("filters by event type", () => {
    const plugins = [plugin({ contributes: { reviewHooks: [{ event: "post-review" }] } })];
    const requireFn = () => ({ handle: () => ({}) });
    expect(collectReviewHooks({ plugins }, "pre-review", { requireFn })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runPreReviewHooks
// ---------------------------------------------------------------------------
describe("runPreReviewHooks", () => {
  it("shallow-merges patches in priority order", async () => {
    const plugins = [
      plugin({
        name: "redact",
        contributes: { reviewHooks: [{ event: "pre-review", priority: 10 }] },
        source: "path:/redact",
      }),
      plugin({
        name: "prefix",
        contributes: { reviewHooks: [{ event: "pre-review", priority: 20 }] },
        source: "path:/prefix",
      }),
    ];
    const requireFn = (p) => {
      if (p === "/redact") return { apiVersion: 2, handle: ({ diff }) => ({ diff: diff.replace("sk_live_x", "sk_live_***") }) };
      if (p === "/prefix") return { apiVersion: 2, handle: ({ diff }) => ({ diff: `// touched\n${diff}` }) };
      throw new Error("unexpected " + p);
    };
    const out = await runPreReviewHooks({ diff: "before sk_live_x after" }, { manifest: { plugins }, requireFn });
    expect(out.diff).toBe("// touched\nbefore sk_live_*** after");
  });

  it("keeps running after a failing hook", async () => {
    const plugins = [
      plugin({ name: "boom", contributes: { reviewHooks: [{ event: "pre-review", priority: 5 }] }, source: "path:/boom" }),
      plugin({ name: "ok", contributes: { reviewHooks: [{ event: "pre-review", priority: 10 }] }, source: "path:/ok" }),
    ];
    const requireFn = (p) => {
      if (p === "/boom") return { handle: () => { throw new Error("fail"); } };
      if (p === "/ok") return { handle: () => ({ diff: "survived" }) };
    };
    const logs = [];
    const out = await runPreReviewHooks({ diff: "x" }, { manifest: { plugins }, requireFn, log: (l) => logs.push(l) });
    expect(out.diff).toBe("survived");
    expect(logs.some((l) => /pre-review failed: fail/.test(l))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runPostReviewHooks
// ---------------------------------------------------------------------------
describe("runPostReviewHooks", () => {
  it("runs in parallel, returns ok array", async () => {
    const calls = [];
    const plugins = [
      plugin({ name: "a", contributes: { reviewHooks: [{ event: "post-review" }] }, source: "path:/a" }),
      plugin({ name: "b", contributes: { reviewHooks: [{ event: "post-review" }] }, source: "path:/b" }),
    ];
    const requireFn = () => ({ handle: async (payload) => { calls.push(payload.marker); } });
    const results = await runPostReviewHooks({ marker: 1 }, { manifest: { plugins }, requireFn });
    expect(results).toEqual([{ ok: true, plugin: "a" }, { ok: true, plugin: "b" }]);
    expect(calls).toEqual([1, 1]);
  });

  it("captures individual failures", async () => {
    const plugins = [plugin({ contributes: { reviewHooks: [{ event: "post-review" }] } })];
    const requireFn = () => ({ handle: async () => { throw new Error("boom"); } });
    const logs = [];
    const results = await runPostReviewHooks({}, { manifest: { plugins }, requireFn, log: (l) => logs.push(l) });
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/boom/);
    expect(logs.some((l) => /post-review failed: boom/.test(l))).toBe(true);
  });
});
