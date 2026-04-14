// PR-G8-review-emit — wiring smoke test.
//
// Verifies that bin/cowork-engine.js actually invokes notifyReviewResult
// from both localReview and dualReview code paths. A full end-to-end
// test would need to stub Claude + OpenAI; this guard-rail ensures the
// call site never gets dropped silently during a future refactor.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const engineSrc = fs.readFileSync(
  path.join(__dirname, "..", "bin", "cowork-engine.js"),
  "utf8",
);

describe("cowork-engine → notify wiring (PR-G8)", () => {
  it("calls notifyReviewResult at least twice (local + dual paths)", () => {
    const occurrences = engineSrc.match(/notifyReviewResult\s*\(/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("requires ./notify lazily so tests without notify env still work", () => {
    expect(engineSrc).toMatch(/require\(["']\.\/notify["']\)/);
  });

  it("swallows notify errors so reviews never abort on a notify fault", () => {
    // The call site must use .catch(() => {}) or a try/catch around require.
    expect(engineSrc).toMatch(/notifyReviewResult[\s\S]{0,400}\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/);
  });

  it("dual-review adapter forces crossVerdict sentinel when verdictMatch is false", () => {
    // PR-G11 — the adapter must route disagreement to a DISAGREE sentinel
    // AND handle the partial/undefined cases (missing verdict, missing
    // comparison field) without silently collapsing into a false-agree.
    expect(engineSrc).toMatch(/comparison\.verdictMatch\s*===\s*true/);
    expect(engineSrc).toMatch(/comparison\.verdictMatch\s*===\s*false/);
    expect(engineSrc).toMatch(/crossVerdict\s*=\s*["']DISAGREE["']/);
  });

  it("dual-review adapter treats missing verdicts as DISAGREE (conservative)", () => {
    // PR-G11 — if either reviewer failed to produce a verdict, the adapter
    // must NOT pretend they agreed. The guard string stays in the source
    // so future refactors can't quietly flip the behavior.
    expect(engineSrc).toMatch(/missing verdict/);
    expect(engineSrc).toMatch(/if\s*\(\s*!cv\s*\|\|\s*!xv\s*\)/);
  });
});
