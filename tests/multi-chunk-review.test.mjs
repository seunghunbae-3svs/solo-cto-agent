import { describe, test, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { _splitDiffIntoChunks, _mergeChunkReviews } = require("../bin/cowork-engine.js");

// ===========================================================================
// _splitDiffIntoChunks
// ===========================================================================
describe("_splitDiffIntoChunks", () => {
  test("small diff returns single chunk", () => {
    const diff = "diff --git a/file.js b/file.js\n+const x = 1;\n";
    const chunks = _splitDiffIntoChunks(diff, 50000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(diff);
  });

  test("multi-file diff splits at file boundaries", () => {
    const file1 = "diff --git a/a.js b/a.js\n+line1\n+line2\n";
    const file2 = "diff --git a/b.js b/b.js\n+line3\n+line4\n";
    const diff = file1 + file2;
    // Set limit so each file fits alone but not both together
    const limit = Buffer.byteLength(file1, "utf8") + 10;
    const chunks = _splitDiffIntoChunks(diff, limit);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain("a.js");
    expect(chunks[1]).toContain("b.js");
  });

  test("files that fit together are grouped in same chunk", () => {
    const file1 = "diff --git a/a.js b/a.js\n+x\n";
    const file2 = "diff --git a/b.js b/b.js\n+y\n";
    const diff = file1 + file2;
    const limit = 10000; // both fit easily
    const chunks = _splitDiffIntoChunks(diff, limit);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("a.js");
    expect(chunks[0]).toContain("b.js");
  });

  test("single oversized file gets truncated", () => {
    const bigContent = "diff --git a/huge.js b/huge.js\n" + "+x\n".repeat(5000);
    const limit = 1000;
    const chunks = _splitDiffIntoChunks(bigContent, limit);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("truncated");
    expect(Buffer.byteLength(chunks[0], "utf8")).toBeLessThanOrEqual(limit + 200); // marker overhead
  });

  test("mixed: small files + one oversized file", () => {
    const small1 = "diff --git a/ok.js b/ok.js\n+fine\n";
    const big = "diff --git a/huge.js b/huge.js\n" + "+data\n".repeat(3000);
    const small2 = "diff --git a/also-ok.js b/also-ok.js\n+also fine\n";
    const diff = small1 + big + small2;
    const limit = 1000;
    const chunks = _splitDiffIntoChunks(diff, limit);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // At least one chunk should contain the truncation marker
    expect(chunks.some(c => c.includes("truncated"))).toBe(true);
    // Small files should be present somewhere
    expect(chunks.some(c => c.includes("ok.js"))).toBe(true);
    expect(chunks.some(c => c.includes("also-ok.js"))).toBe(true);
  });

  test("three files each just under limit = three chunks", () => {
    const makeFile = (name, size) =>
      `diff --git a/${name} b/${name}\n` + "+x\n".repeat(size);
    const limit = 500;
    const f1 = makeFile("a.js", 50);
    const f2 = makeFile("b.js", 50);
    const f3 = makeFile("c.js", 50);
    const diff = f1 + f2 + f3;
    const chunks = _splitDiffIntoChunks(diff, limit);
    // Each file is ~180 bytes, limit is 500, so f1+f2 fit but f1+f2+f3 don't
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  test("no diff --git boundary = single chunk truncation", () => {
    const raw = "+line\n".repeat(10000);
    const limit = 500;
    const chunks = _splitDiffIntoChunks(raw, limit);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("truncated");
  });
});

// ===========================================================================
// _mergeChunkReviews
// ===========================================================================
describe("_mergeChunkReviews", () => {
  test("merges verdicts — worst wins", () => {
    const reviews = [
      { verdict: "APPROVE", issues: [], summary: "chunk1 ok", nextAction: "" },
      { verdict: "REQUEST_CHANGES", issues: [], summary: "chunk2 bad", nextAction: "" },
    ];
    const merged = _mergeChunkReviews(reviews);
    expect(merged.verdict).toBe("REQUEST_CHANGES");
    expect(merged.chunkCount).toBe(2);
  });

  test("all APPROVE = APPROVE", () => {
    const reviews = [
      { verdict: "APPROVE", issues: [], summary: "ok", nextAction: "" },
      { verdict: "APPROVE", issues: [], summary: "ok", nextAction: "" },
    ];
    expect(_mergeChunkReviews(reviews).verdict).toBe("APPROVE");
  });

  test("COMMENT + APPROVE = COMMENT", () => {
    const reviews = [
      { verdict: "COMMENT", issues: [], summary: "note", nextAction: "" },
      { verdict: "APPROVE", issues: [], summary: "fine", nextAction: "" },
    ];
    expect(_mergeChunkReviews(reviews).verdict).toBe("COMMENT");
  });

  test("deduplicates issues by location+description", () => {
    const issue = { location: "file.js:10", issue: "missing null check", suggestion: "add check", severity: "SUGGESTION" };
    const reviews = [
      { verdict: "COMMENT", issues: [issue], summary: "", nextAction: "" },
      { verdict: "COMMENT", issues: [issue], summary: "", nextAction: "" },
    ];
    const merged = _mergeChunkReviews(reviews);
    expect(merged.issues).toHaveLength(1);
  });

  test("preserves unique issues from different chunks", () => {
    const issue1 = { location: "a.js:1", issue: "bug1", suggestion: "fix1", severity: "BLOCKER" };
    const issue2 = { location: "b.js:5", issue: "bug2", suggestion: "fix2", severity: "SUGGESTION" };
    const reviews = [
      { verdict: "REQUEST_CHANGES", issues: [issue1], summary: "chunk1", nextAction: "fix a" },
      { verdict: "COMMENT", issues: [issue2], summary: "chunk2", nextAction: "fix b" },
    ];
    const merged = _mergeChunkReviews(reviews);
    expect(merged.issues).toHaveLength(2);
    expect(merged.summary).toContain("chunk1");
    expect(merged.summary).toContain("chunk2");
    expect(merged.nextAction).toContain("fix a");
    expect(merged.nextAction).toContain("fix b");
  });

  test("single chunk review passthrough", () => {
    const reviews = [
      { verdict: "APPROVE", issues: [{ location: "x.js:1", issue: "nit", suggestion: "s", severity: "NIT" }], summary: "ok", nextAction: "none" },
    ];
    const merged = _mergeChunkReviews(reviews);
    expect(merged.verdict).toBe("APPROVE");
    expect(merged.issues).toHaveLength(1);
    expect(merged.chunkCount).toBe(1);
  });

  test("empty reviews array", () => {
    const merged = _mergeChunkReviews([]);
    expect(merged.verdict).toBe("APPROVE");
    expect(merged.issues).toHaveLength(0);
    expect(merged.chunkCount).toBe(0);
  });
});
