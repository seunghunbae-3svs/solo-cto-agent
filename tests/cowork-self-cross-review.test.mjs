import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// Load engine + capture exports for monkey-patching internals.
const engine = require("../bin/cowork-engine.js");

describe("cowork-engine: selfCrossReview integration (mocked Anthropic)", () => {
  // selfCrossReview calls callAnthropic internally — we cannot stub it without
  // import surgery, so we drive selfCrossReview by intercepting at network level
  // via a fake response object. Easier path: we re-create a thin shim by stubbing
  // the module's callAnthropic via the require cache.
  const enginePath = require.resolve("../bin/cowork-engine.js");
  let originalModule;

  beforeEach(() => {
    originalModule = require.cache[enginePath].exports;
  });

  afterEach(() => {
    require.cache[enginePath].exports = originalModule;
  });

  it("PARTIAL: adds 1 missed BLOCKER, removes 1 false positive", async () => {
    // Patch the live module's callAnthropic by reaching into module internals.
    // Since callAnthropic is internal-only, we instead test the parser path:
    // build a synthetic devil's-advocate response and verify selfCrossReview
    // would route correctly. We validate by calling the public function with
    // a fake firstPass and intercepting via __setCallAnthropic if exposed.

    // Simpler validation approach: we test that selfCrossReview hands back a
    // result shape with the expected keys when the underlying call returns a
    // well-formed devil's-advocate response. We mock by replacing https.request.
    const https = require("https");
    const origRequest = https.request;
    const fakeResponse = `[CROSS_VERDICT] PARTIAL

[ADD]
⛔ [src/db/users.ts:42]
  RLS 정책 누락. service_role 키가 client에 노출됨.
  → server-only import 강제 + RLS enable.

[REMOVE]
[src/lib/util.ts:10]
  실제로는 의도된 fallback이라 false positive.

[UPGRADE]
없음

[DOWNGRADE]
없음

[META_REVIEW]
1차가 RLS 누락을 놓침. 보안 감수성 부족.`;

    https.request = (opts, cb) => {
      // emulate Anthropic's response shape
      const fakeRes = {
        statusCode: 200,
        on(event, handler) {
          if (event === "data") handler(JSON.stringify({
            content: [{ type: "text", text: fakeResponse }],
            usage: { input_tokens: 100, output_tokens: 200 },
          }));
          if (event === "end") setTimeout(handler, 0);
        },
      };
      const req = {
        on() { return req; },
        write() {},
        end() { setTimeout(() => cb(fakeRes), 0); },
      };
      return req;
    };

    // Set fake key so callAnthropic doesn't reject early
    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    try {
      const firstPass = {
        verdict: "APPROVE",
        issues: [
          { severity: "SUGGESTION", location: "src/lib/util.ts:10", issue: "Could be cleaner", suggestion: "refactor" },
        ],
        summary: "Mostly fine.",
      };

      const cross = await engine.selfCrossReview({
        diff: "diff --git a/x b/x\n+ console.log('test');",
        firstPass,
        firstPassRaw: "[VERDICT] APPROVE\n[SUMMARY] Mostly fine.",
        systemPromptBase: "test identity",
        model: "claude-sonnet-4-20250514",
        maxRetries: 1,
      });

      expect(cross.crossVerdict).toBe("PARTIAL");
      expect(cross.addedIssues.length).toBeGreaterThanOrEqual(1);
      expect(cross.addedIssues[0].severity).toBe("BLOCKER");
      expect(cross.addedIssues[0].location).toContain("src/db/users.ts");
      expect(cross.removedItems.length).toBeGreaterThanOrEqual(1);
      expect(cross.removedItems[0].location).toContain("src/lib/util.ts");
      // commonBlockers = added BLOCKERs (1) + firstPass BLOCKERs not removed (0)
      expect(cross.commonBlockers).toBe(1);
      expect(cross.metaReview).toContain("RLS");
      expect(cross.tokens.input).toBeGreaterThan(0);
      expect(cross.cost).toBeTruthy();
    } finally {
      https.request = origRequest;
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("AGREE: no added/removed issues when first pass was correct", async () => {
    const https = require("https");
    const origRequest = https.request;
    const fakeResponse = `[CROSS_VERDICT] AGREE

[ADD]
없음

[REMOVE]
없음

[UPGRADE]
없음

[DOWNGRADE]
없음

[META_REVIEW]
1차 리뷰가 정확. 추가 이슈 없음.`;

    https.request = (opts, cb) => {
      const fakeRes = {
        statusCode: 200,
        on(event, handler) {
          if (event === "data") handler(JSON.stringify({
            content: [{ type: "text", text: fakeResponse }],
            usage: { input_tokens: 50, output_tokens: 80 },
          }));
          if (event === "end") setTimeout(handler, 0);
        },
      };
      const req = { on() { return req; }, write() {}, end() { setTimeout(() => cb(fakeRes), 0); } };
      return req;
    };

    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    try {
      const firstPass = {
        verdict: "REQUEST_CHANGES",
        issues: [
          { severity: "BLOCKER", location: "src/api/auth.ts:5", issue: "secret leak", suggestion: "env var" },
        ],
        summary: "Blocker found.",
      };
      const cross = await engine.selfCrossReview({
        diff: "x", firstPass, firstPassRaw: "x", systemPromptBase: "x",
        model: "claude-sonnet-4-20250514", maxRetries: 1,
      });
      expect(cross.crossVerdict).toBe("AGREE");
      expect(cross.addedIssues.length).toBe(0);
      expect(cross.removedItems.length).toBe(0);
      // First pass had 1 BLOCKER, none removed → commonBlockers = 1
      expect(cross.commonBlockers).toBe(1);
    } finally {
      https.request = origRequest;
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });
});
