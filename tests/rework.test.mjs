import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const require = createRequire(import.meta.url);
const rework = require("../bin/rework.js");

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rework-test-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email test@test", { cwd: dir });
  execSync("git config user.name test", { cwd: dir });
  fs.writeFileSync(path.join(dir, "a.txt"), "hello\nworld\n");
  execSync("git add . && git commit -q -m init", { cwd: dir });
  return dir;
}

describe("rework: parseFixes", () => {
  it("extracts FIX blocks with index, severity, location, patch", () => {
    const text = `
[FIX #1 — BLOCKER] [src/foo.tsx:12]
Some explanation.
\`\`\`diff
--- a/src/foo.tsx
+++ b/src/foo.tsx
@@
-old
+new
\`\`\`

[FIX #2 — SUGGESTION] [src/bar.tsx:5]
\`\`\`diff
--- a/src/bar.tsx
+++ b/src/bar.tsx
@@
-x
+y
\`\`\`
`;
    const { fixes } = rework.parseFixes(text);
    expect(fixes).toHaveLength(2);
    expect(fixes[0]).toMatchObject({ index: 1, severity: "BLOCKER", location: "src/foo.tsx:12" });
    expect(fixes[0].patch).toContain("--- a/src/foo.tsx");
    expect(fixes[1].severity).toBe("SUGGESTION");
  });

  it("extracts SKIP blocks", () => {
    const text = `[SKIP #3 — too risky to auto-apply]`;
    const { skips } = rework.parseFixes(text);
    expect(skips).toEqual([{ index: 3, reason: "too risky to auto-apply" }]);
  });
});

describe("rework: loadReviewFixes", () => {
  it("loads pre-parsed .fixes[] shape", () => {
    const tmp = path.join(os.tmpdir(), `rev-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ fixes: [{ index: 1, severity: "BLOCKER", location: "x", patch: "p" }] }));
    const { fixes, source } = rework.loadReviewFixes(tmp);
    expect(source).toBe("parsed");
    expect(fixes).toHaveLength(1);
    fs.unlinkSync(tmp);
  });

  it("loads raw review and parses [FIX] blocks", () => {
    const raw = "[FIX #1 — BLOCKER] [a.txt]\n```diff\n--- a/a.txt\n+++ b/a.txt\n@@\n-x\n+y\n```";
    const tmp = path.join(os.tmpdir(), `rev-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ raw }));
    const { fixes, source } = rework.loadReviewFixes(tmp);
    expect(source).toBe("raw");
    expect(fixes).toHaveLength(1);
    fs.unlinkSync(tmp);
  });

  it("throws on missing file", () => {
    expect(() => rework.loadReviewFixes("/nonexistent.json")).toThrow(/not found/);
  });
});

describe("rework: applyFixes safety + dry-run", () => {
  let repo;
  beforeEach(() => { repo = makeTempRepo(); });
  afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch (_) {} });

  it("dry-run validates patches without modifying files", async () => {
    // Build a valid patch against the temp repo's a.txt
    const patch = "--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-hello\n+HELLO\n world\n";
    const reviewFile = path.join(repo, "review.json");
    fs.writeFileSync(reviewFile, JSON.stringify({ fixes: [{ index: 1, severity: "BLOCKER", location: "a.txt", patch }] }));

    const result = await rework.applyFixes({ reviewFile, apply: false, cwd: repo, cleanCheck: true });
    expect(result.mode).toBe("dry-run");
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]).toMatchObject({ applied: false, dryRun: true, validated: true });
    // File untouched
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf8")).toBe("hello\nworld\n");
  });

  it("--apply actually patches files when validation passes", async () => {
    const patch = "--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-hello\n+HELLO\n world\n";
    // Write reviewFile OUTSIDE the repo so it doesn't dirty the working tree
    const reviewFile = path.join(os.tmpdir(), `apply-rev-${Date.now()}.json`);
    fs.writeFileSync(reviewFile, JSON.stringify({ fixes: [{ index: 1, severity: "BLOCKER", location: "a.txt", patch }] }));

    const result = await rework.applyFixes({ reviewFile, apply: true, cwd: repo, cleanCheck: true });
    fs.unlinkSync(reviewFile);
    expect(result.cleanBefore).toBe(true);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].applied).toBe(true);
    expect(fs.readFileSync(path.join(repo, "a.txt"), "utf8")).toBe("HELLO\nworld\n");
  });

  it("refuses --apply when working tree is dirty (cleanCheck on)", async () => {
    fs.writeFileSync(path.join(repo, "dirty.txt"), "uncommitted");
    const reviewFile = path.join(repo, "review.json");
    fs.writeFileSync(reviewFile, JSON.stringify({ fixes: [] }));

    const result = await rework.applyFixes({ reviewFile, apply: true, cwd: repo, cleanCheck: true });
    expect(result.summary).toMatch(/not clean/);
    expect(result.applied).toHaveLength(0);
  });

  it("circuit-breaker: caps applied fixes at maxFixes", async () => {
    const fixes = [];
    for (let i = 1; i <= 8; i++) {
      // Invalid patches — we just want to see the cap behavior
      fixes.push({ index: i, severity: "BLOCKER", location: `f${i}.txt`, patch: "invalid" });
    }
    const reviewFile = path.join(repo, "review.json");
    fs.writeFileSync(reviewFile, JSON.stringify({ fixes }));

    const result = await rework.applyFixes({ reviewFile, apply: false, cwd: repo, maxFixes: 3, cleanCheck: false });
    // 3 attempted (validate-failed since invalid), 5 skipped by cap
    expect(result.capped).toBe(3);
    expect(result.skipped).toHaveLength(5);
    expect(result.skipped[0].reason).toMatch(/circuit-breaker/);
  });

  it("severity filter: --only BLOCKER excludes SUGGESTION", async () => {
    const reviewFile = path.join(repo, "review.json");
    fs.writeFileSync(reviewFile, JSON.stringify({
      fixes: [
        { index: 1, severity: "BLOCKER", location: "a", patch: "x" },
        { index: 2, severity: "SUGGESTION", location: "b", patch: "y" },
        { index: 3, severity: "NIT", location: "c", patch: "z" },
      ],
    }));
    const result = await rework.applyFixes({ reviewFile, apply: false, cwd: repo, only: ["BLOCKER"], cleanCheck: false });
    expect(result.eligible).toBe(1);
  });
});
