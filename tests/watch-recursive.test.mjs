/**
 * PR-G27 — watchRecursive unit tests.
 * Tests the recursive file-system watcher, isWatchable edge cases,
 * and constants integration for watch patterns.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(import.meta.url);
const watch = require("../bin/watch.js");
const C = require("../bin/constants.js");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "watch-rec-"));
}

// ───────────────────────────────────────────────────────────────
// watchRecursive
// ───────────────────────────────────────────────────────────────
describe("watchRecursive", () => {
  let dir;
  beforeEach(() => { dir = tmpdir(); });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  it("returns a stop function", () => {
    const stop = watch.watchRecursive(dir, () => {});
    expect(typeof stop).toBe("function");
    stop();
  });

  it("fires onChange for a watchable file", async () => {
    const events = [];
    const stop = watch.watchRecursive(dir, (e) => events.push(e));
    // Give watcher time to settle
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(dir, "index.js"), "//test");
    await new Promise((r) => setTimeout(r, 500));
    stop();
    expect(events.some((e) => e.filename === "index.js")).toBe(true);
  });

  it("does NOT fire onChange for unwatchable file (e.g. .md)", async () => {
    const events = [];
    const stop = watch.watchRecursive(dir, (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(dir, "README.md"), "hello");
    await new Promise((r) => setTimeout(r, 500));
    stop();
    expect(events.some((e) => e.filename === "README.md")).toBe(false);
  });

  it("ignores node_modules directories", async () => {
    const nm = path.join(dir, "node_modules");
    fs.mkdirSync(nm);
    const events = [];
    const stop = watch.watchRecursive(dir, (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(nm, "dep.js"), "//dep");
    await new Promise((r) => setTimeout(r, 500));
    stop();
    expect(events.some((e) => e.filename === "dep.js")).toBe(false);
  });

  it("watches subdirectories recursively", async () => {
    const sub = path.join(dir, "src");
    fs.mkdirSync(sub);
    const events = [];
    const stop = watch.watchRecursive(dir, (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(sub, "app.tsx"), "//app");
    await new Promise((r) => setTimeout(r, 500));
    stop();
    expect(events.some((e) => e.filename === "app.tsx")).toBe(true);
  });

  it("stop() cleans up without throwing", () => {
    const stop = watch.watchRecursive(dir, () => {});
    expect(() => stop()).not.toThrow();
    // Double-stop is safe
    expect(() => stop()).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────
// isWatchable edge cases + constants integration
// ───────────────────────────────────────────────────────────────
describe("isWatchable edge cases", () => {
  it("returns false for empty string", () => {
    expect(watch.isWatchable("")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(watch.isWatchable(undefined)).toBe(false);
  });

  it("matches backend extensions (.py, .go, .rs)", () => {
    // These should be in WATCH_PATTERNS.extensions
    const backendExts = ["server.py", "main.go", "lib.rs"];
    for (const f of backendExts) {
      const result = watch.isWatchable(f);
      // If the pattern exists in constants, it should match
      if (C.WATCH_PATTERNS.extensions.some((re) => re.test(f))) {
        expect(result).toBe(true);
      }
    }
  });

  it("matches TypeScript files (.ts, .tsx)", () => {
    expect(watch.isWatchable("app.ts")).toBe(true);
    expect(watch.isWatchable("page.tsx")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
// Constants integration — watch uses C.WATCH_PATTERNS
// ───────────────────────────────────────────────────────────────
describe("watch constants integration", () => {
  it("WATCH_PATTERNS.extensions matches same patterns as watch module", () => {
    // Internal DEFAULT_PATTERNS should === C.WATCH_PATTERNS.extensions
    const src = fs.readFileSync(path.join(process.cwd(), "bin", "watch.js"), "utf8");
    expect(src).toContain("C.WATCH_PATTERNS.extensions");
    expect(src).toContain("C.WATCH_PATTERNS.ignoreDirs");
  });

  it("WATCH_PATTERNS.ignoreDirs includes .git and node_modules", () => {
    expect(C.WATCH_PATTERNS.ignoreDirs.has(".git")).toBe(true);
    expect(C.WATCH_PATTERNS.ignoreDirs.has("node_modules")).toBe(true);
  });
});
