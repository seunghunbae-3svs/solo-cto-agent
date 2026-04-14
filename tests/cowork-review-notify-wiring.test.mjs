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
    // The adapter must convert !verdictMatch into a DISAGREE sentinel so
    // notifyReviewResult routes to review.dual-disagree deterministically.
    expect(engineSrc).toMatch(/!comparison\.verdictMatch/);
    expect(engineSrc).toMatch(/crossVerdict:\s*dualDisagreed\s*\?\s*["']DISAGREE["']/);
  });
});
