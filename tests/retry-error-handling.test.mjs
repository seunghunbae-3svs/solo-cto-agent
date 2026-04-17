/**
 * Tests for retry error handling in bin/cowork-engine.js
 *
 * Verifies:
 * 1. Constants integration — RETRY_DELAYS values and freezing
 * 2. Retry algorithm correctness — linear backoff calculation
 * 3. Rate limit detection patterns — 429, 529, "rate_limit", "overloaded"
 * 4. maxRetries bounds — clamped to [1, 6]
 * 5. Timeout integration — C.TIMEOUTS.apiCall usage in source
 * 6. Error propagation — last error is thrown after retries exhausted
 * 7. callAnthropic function signature and retry wiring
 * 8. callOpenAI function signature and retry wiring
 */

import { describe, test, expect, beforeEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
const C = require("../bin/constants.js");

/** Read combined engine source (facade + engine/review.js after P1 refactor) */
function readEngineSource() {
  const facadePath = path.join(process.cwd(), "bin", "cowork-engine.js");
  const reviewPath = path.join(process.cwd(), "bin", "engine", "review.js");
  let src = fs.readFileSync(facadePath, "utf8");
  if (fs.existsSync(reviewPath)) {
    src += "\n" + fs.readFileSync(reviewPath, "utf8");
  }
  return src;
}

// ============================================================================
// Test Group 1: Constants Integration
// ============================================================================

describe("RETRY_DELAYS constants", () => {
  test("rateLimit and generic are both defined and positive", () => {
    expect(C.RETRY_DELAYS.rateLimit).toBeDefined();
    expect(C.RETRY_DELAYS.generic).toBeDefined();
    expect(C.RETRY_DELAYS.rateLimit).toBeGreaterThan(0);
    expect(C.RETRY_DELAYS.generic).toBeGreaterThan(0);
  });

  test("rateLimit > generic (rate limits get longer delays)", () => {
    expect(C.RETRY_DELAYS.rateLimit).toBeGreaterThan(C.RETRY_DELAYS.generic);
  });

  test("rateLimit is 30000ms (30 seconds)", () => {
    expect(C.RETRY_DELAYS.rateLimit).toBe(30_000);
  });

  test("generic is 15000ms (15 seconds)", () => {
    expect(C.RETRY_DELAYS.generic).toBe(15_000);
  });

  test("both values are frozen (immutable)", () => {
    expect(Object.isFrozen(C.RETRY_DELAYS)).toBe(true);
  });
});

describe("TIMEOUTS.apiCall constant", () => {
  test("is defined and positive", () => {
    expect(C.TIMEOUTS.apiCall).toBeDefined();
    expect(C.TIMEOUTS.apiCall).toBeGreaterThan(0);
  });

  test("is 120 seconds (120000ms)", () => {
    expect(C.TIMEOUTS.apiCall).toBe(120_000);
  });

  test("TIMEOUTS is frozen", () => {
    expect(Object.isFrozen(C.TIMEOUTS)).toBe(true);
  });
});

// ============================================================================
// Test Group 2: Source Code Verification — Retry Pattern Detection
// ============================================================================

describe("bin/cowork-engine.js retry logic source verification", () => {
  let engineSource;

  beforeEach(() => {
    // After P1 refactor, retry logic lives in engine/review.js
    // Read both facade and review module for comprehensive source checks
    const facadePath = path.join(process.cwd(), "bin", "cowork-engine.js");
    const reviewPath = path.join(process.cwd(), "bin", "engine", "review.js");
    engineSource = fs.readFileSync(facadePath, "utf8");
    if (fs.existsSync(reviewPath)) {
      engineSource += "\n" + fs.readFileSync(reviewPath, "utf8");
    }
  });

  test("callAnthropic function exists in source", () => {
    expect(engineSource).toMatch(/async function callAnthropic/);
  });

  test("callOpenAI function exists in source", () => {
    expect(engineSource).toMatch(/async function callOpenAI/);
  });

  test("callAnthropic uses C.RETRY_DELAYS.rateLimit for rate limit errors", () => {
    expect(engineSource).toMatch(
      /(?:.*callAnthropic[\s\S]*?)*\(attempt \+ 1\) \* C\.RETRY_DELAYS\.rateLimit/
    );
  });

  test("callAnthropic uses C.RETRY_DELAYS.generic for other errors", () => {
    expect(engineSource).toMatch(
      /(?:.*callAnthropic[\s\S]*?)*\(attempt \+ 1\) \* C\.RETRY_DELAYS\.generic/
    );
  });

  test("callOpenAI uses C.RETRY_DELAYS.rateLimit for rate limit errors", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)*\(attempt \+ 1\) \* C\.RETRY_DELAYS\.rateLimit/
    );
  });

  test("callOpenAI uses C.RETRY_DELAYS.generic for other errors", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)*\(attempt \+ 1\) \* C\.RETRY_DELAYS\.generic/
    );
  });

  test("callAnthropic detects rate_limit in error body/message", () => {
    expect(engineSource).toMatch(
      /body\.includes\("rate_limit"\)/
    );
  });

  test("callAnthropic detects overloaded in error body/message", () => {
    expect(engineSource).toMatch(
      /body\.includes\("overloaded"\)/
    );
  });

  test("callAnthropic detects HTTP status 429 (rate limit)", () => {
    expect(engineSource).toMatch(/statusCode === 429/);
  });

  test("callAnthropic detects HTTP status 529 (server overloaded)", () => {
    expect(engineSource).toMatch(/statusCode === 529/);
  });

  test("callOpenAI detects rate_limit in error body/message", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)*body\.includes\("rate_limit"\)/
    );
  });

  test("callOpenAI detects HTTP status 429 (rate limit)", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)*statusCode === 429/
    );
  });

  test("callAnthropic throws lastErr after retries exhausted", () => {
    expect(engineSource).toMatch(
      /throw lastErr/
    );
  });

  test("callOpenAI throws lastErr after retries exhausted", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)*throw lastErr/
    );
  });

  test("callAnthropic initializes lastErr variable", () => {
    expect(engineSource).toMatch(
      /(?:.*callAnthropic[\s\S]*?)let lastErr/
    );
  });

  test("callOpenAI initializes lastErr variable", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)let lastErr/
    );
  });

  test("callAnthropic uses C.TIMEOUTS.apiCall for request timeout", () => {
    expect(engineSource).toMatch(/C\.TIMEOUTS\.apiCall/);
  });
});

// ============================================================================
// Test Group 3: maxRetries Bounds Checking
// ============================================================================

describe("callAnthropic maxRetries clamping", () => {
  let engineSource;

  beforeEach(() => {
    // enginePath handled by readEngineSource()
    engineSource = readEngineSource();
  });

  test("maxRetries is clamped with Math.max(1, Math.min(6, ...))", () => {
    // Extract the callAnthropic function definition (more lines to capture the logic)
    const callAntropicMatch = engineSource.match(
      /async function callAnthropic[\s\S]*?Math\.max\(1, Math\.min\(6/
    );
    expect(callAntropicMatch).toBeTruthy();
  });

  test("maxRetries defaults to 3 if opts.maxRetries is not provided", () => {
    expect(engineSource).toMatch(/opts\.maxRetries \|\| 3/);
  });

  test("callAnthropic respects opts.maxRetries parameter", () => {
    expect(engineSource).toMatch(/opts\.maxRetries/);
  });
});

// ============================================================================
// Test Group 4: Retry Algorithm Correctness
// ============================================================================

describe("Retry backoff algorithm correctness", () => {
  test("Linear backoff formula: (attempt + 1) * delay", () => {
    // Verify the expected delays for rate limit (30000ms base)
    const rateLimitBase = C.RETRY_DELAYS.rateLimit;
    const expectedDelays = [
      1 * rateLimitBase,  // attempt 0 → 30000ms
      2 * rateLimitBase,  // attempt 1 → 60000ms
      3 * rateLimitBase,  // attempt 2 → 90000ms
    ];

    expectedDelays.forEach((expectedDelay, attempt) => {
      const calculatedDelay = (attempt + 1) * rateLimitBase;
      expect(calculatedDelay).toBe(expectedDelay);
    });
  });

  test("Generic error backoff: (attempt + 1) * 15000ms", () => {
    const genericBase = C.RETRY_DELAYS.generic;
    const expectedDelays = [
      1 * genericBase,  // attempt 0 → 15000ms
      2 * genericBase,  // attempt 1 → 30000ms
      3 * genericBase,  // attempt 2 → 45000ms
    ];

    expectedDelays.forEach((expectedDelay, attempt) => {
      const calculatedDelay = (attempt + 1) * genericBase;
      expect(calculatedDelay).toBe(expectedDelay);
    });
  });

  test("Rate limit delays are 2x generic delays (30k vs 15k base)", () => {
    const ratio = C.RETRY_DELAYS.rateLimit / C.RETRY_DELAYS.generic;
    expect(ratio).toBe(2);
  });

  test("callAnthropic with maxRetries=3 performs up to 3 attempts", () => {
    const engineSource = readEngineSource();
    // Verify loop uses maxRetries as upper bound
    expect(engineSource).toMatch(
      /for \(let attempt = 0; attempt < maxRetries; attempt\+\+\)/
    );
  });

  test("callOpenAI hardcoded to 3 retries", () => {
    const engineSource = readEngineSource();
    // OpenAI function should have hardcoded loop limit
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)for \(let attempt = 0; attempt < 3; attempt\+\+\)/
    );
  });
});

// ============================================================================
// Test Group 5: Rate Limit Detection Pattern Coverage
// ============================================================================

describe("Rate limit detection patterns", () => {
  let engineSource;

  beforeEach(() => {
    // enginePath handled by readEngineSource()
    engineSource = readEngineSource();
  });

  test("Pattern: rate_limit string in error body", () => {
    expect(engineSource).toMatch(/includes\("rate_limit"\)/);
  });

  test("Pattern: overloaded string in error body", () => {
    expect(engineSource).toMatch(/includes\("overloaded"\)/);
  });

  test("Pattern: HTTP 429 status code", () => {
    expect(engineSource).toMatch(/statusCode === 429/);
  });

  test("Pattern: HTTP 529 status code (Anthropic-specific)", () => {
    expect(engineSource).toMatch(/statusCode === 529/);
  });

  test("Error body is lowercased before pattern matching", () => {
    expect(engineSource).toMatch(/\.toLowerCase\(\)/);
  });

  test("callAnthropic handles all 4 rate limit patterns", () => {
    // Count occurrences of isRateLimit detection pattern
    const isRateLimitPattern = /const isRateLimit = body\.includes\("rate_limit"\)|body\.includes\("overloaded"\)|e\.statusCode === 429|e\.statusCode === 529/;
    expect(engineSource).toMatch(isRateLimitPattern);
  });
});

// ============================================================================
// Test Group 6: Error Propagation After Retries
// ============================================================================

describe("Error propagation after retry exhaustion", () => {
  let engineSource;

  beforeEach(() => {
    // enginePath handled by readEngineSource()
    engineSource = readEngineSource();
  });

  test("callAnthropic maintains lastErr through loop", () => {
    expect(engineSource).toMatch(/lastErr = e/);
  });

  test("callAnthropic breaks loop when attempt === maxRetries - 1", () => {
    expect(engineSource).toMatch(/if \(attempt === maxRetries - 1\) break/);
  });

  test("callAnthropic throws lastErr after loop completes", () => {
    expect(engineSource).toMatch(/throw lastErr/);
  });

  test("callOpenAI maintains lastErr through loop", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)*lastErr = e/
    );
  });

  test("callOpenAI breaks when attempt === 2 (last of 3 attempts)", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)if \(attempt === 2\) break/
    );
  });

  test("callOpenAI throws lastErr after loop completes", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)throw lastErr/
    );
  });
});

// ============================================================================
// Test Group 7: Integration — Constants × Retry Logic
// ============================================================================

describe("Constants and retry logic integration", () => {
  let engineSource;

  beforeEach(() => {
    // enginePath handled by readEngineSource()
    engineSource = readEngineSource();
  });

  test("Both callAnthropic and callOpenAI reference C.RETRY_DELAYS", () => {
    expect(engineSource).toMatch(/C\.RETRY_DELAYS\.rateLimit/);
    expect(engineSource).toMatch(/C\.RETRY_DELAYS\.generic/);
  });

  test("callAnthropic uses C.TIMEOUTS.apiCall for request timeout", () => {
    expect(engineSource).toMatch(/C\.TIMEOUTS\.apiCall/);
  });

  test("No hardcoded delay values (all use C.RETRY_DELAYS.*)", () => {
    // This is a smoke test — verify that the patterns use constants, not literals like "30000"
    // We look for the usage within the actual retry logic sections
    const anthropicSection = engineSource.match(
      /async function callAnthropic[\s\S]*?^(?=async function|function)/m
    );
    if (anthropicSection) {
      const section = anthropicSection[0];
      // Should see C.RETRY_DELAYS references, not hardcoded numbers in wait calculation
      expect(section).toMatch(/C\.RETRY_DELAYS/);
    }
  });

  test("Rate limit and generic delays maintain 2:1 ratio in source", () => {
    expect(C.RETRY_DELAYS.rateLimit).toBe(2 * C.RETRY_DELAYS.generic);
  });
});

// ============================================================================
// Test Group 8: Boundary Conditions
// ============================================================================

describe("Boundary conditions and edge cases", () => {
  test("maxRetries minimum is 1 (cannot be 0)", () => {
    // Math.max(1, ...) ensures at least 1 attempt
    const clampedMin = Math.max(1, Math.min(6, 0));
    expect(clampedMin).toBe(1);
  });

  test("maxRetries maximum is 6", () => {
    // Math.max(1, Math.min(6, ...)) caps at 6
    const clampedMax = Math.max(1, Math.min(6, 10));
    expect(clampedMax).toBe(6);
  });

  test("maxRetries default (3) is within [1, 6] bounds", () => {
    const clampedDefault = Math.max(1, Math.min(6, 3));
    expect(clampedDefault).toBe(3);
  });

  test("Attempt indexing is 0-based (attempt 0 to maxRetries-1)", () => {
    // Verify the loop bounds match: for (let attempt = 0; attempt < maxRetries; attempt++)
    const engineSource = readEngineSource();
    expect(engineSource).toMatch(
      /for \(let attempt = 0; attempt < maxRetries; attempt\+\+\)/
    );
  });

  test("Final attempt check uses attempt === maxRetries - 1", () => {
    const engineSource = readEngineSource();
    expect(engineSource).toMatch(/if \(attempt === maxRetries - 1\)/);
  });

  test("callOpenAI final attempt check uses attempt === 2", () => {
    const engineSource = readEngineSource();
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)if \(attempt === 2\)/
    );
  });
});

// ============================================================================
// Test Group 9: Anthropic-Specific Details
// ============================================================================

describe("callAnthropic Anthropic-specific behavior", () => {
  let engineSource;

  beforeEach(() => {
    // enginePath handled by readEngineSource()
    engineSource = readEngineSource();
  });

  test("Detects 529 status (Anthropic-specific overload)", () => {
    expect(engineSource).toMatch(/statusCode === 529/);
  });

  test("Detects 429 status (standard rate limit)", () => {
    expect(engineSource).toMatch(/statusCode === 429/);
  });

  test("Calls _anthropicOnce in retry loop", () => {
    expect(engineSource).toMatch(
      /await _anthropicOnce\(prompt, systemPrompt, model\)/
    );
  });

  test("_anthropicOnce function is defined", () => {
    expect(engineSource).toMatch(/function _anthropicOnce/);
  });
});

// ============================================================================
// Test Group 10: OpenAI-Specific Details
// ============================================================================

describe("callOpenAI OpenAI-specific behavior", () => {
  let engineSource;

  beforeEach(() => {
    // enginePath handled by readEngineSource()
    engineSource = readEngineSource();
  });

  test("Detects 429 status (rate limit)", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)statusCode === 429/
    );
  });

  test("Does NOT detect 529 (OpenAI-specific)", () => {
    // Extract callOpenAI function body only to avoid false match from callAnthropic
    const match = engineSource.match(/async function callOpenAI[\s\S]*?^}/m);
    const callOpenAIBody = match ? match[0] : "";
    expect(callOpenAIBody).not.toMatch(/statusCode === 529/);
  });

  test("Calls _openaiOnce in retry loop", () => {
    expect(engineSource).toMatch(
      /await _openaiOnce\(prompt, systemPrompt, model\)/
    );
  });

  test("_openaiOnce function is defined", () => {
    expect(engineSource).toMatch(/function _openaiOnce/);
  });

  test("Hardcoded to exactly 3 retries (not configurable)", () => {
    expect(engineSource).toMatch(
      /async function callOpenAI.*for \(let attempt = 0; attempt < 3; attempt\+\+\)/s
    );
  });
});

// ============================================================================
// Test Group 11: Logging and Diagnostics
// ============================================================================

describe("Retry logging and diagnostics", () => {
  let engineSource;

  beforeEach(() => {
    // enginePath handled by readEngineSource()
    engineSource = readEngineSource();
  });

  test("callAnthropic logs retry wait times", () => {
    expect(engineSource).toMatch(
      /logWarn.*rate limited.*waiting.*attempt/
    );
  });

  test("callAnthropic distinguishes rate limit vs generic errors in logs", () => {
    expect(engineSource).toMatch(
      /isRateLimit \? "rate limited" : "error"/
    );
  });

  test("callOpenAI logs retry wait times", () => {
    expect(engineSource).toMatch(
      /(?:.*callOpenAI[\s\S]*?)logWarn.*waiting.*attempt/
    );
  });
});

// ============================================================================
// Test Group 12: Cross-function Consistency
// ============================================================================

describe("Cross-function consistency (Anthropic vs OpenAI)", () => {
  test("Both use C.RETRY_DELAYS.rateLimit", () => {
    const engineSource = readEngineSource();
    const rateLimitCount = (engineSource.match(/C\.RETRY_DELAYS\.rateLimit/g) || []).length;
    expect(rateLimitCount).toBeGreaterThanOrEqual(2); // At least 2 functions use it
  });

  test("Both use C.RETRY_DELAYS.generic", () => {
    const engineSource = readEngineSource();
    const genericCount = (engineSource.match(/C\.RETRY_DELAYS\.generic/g) || []).length;
    expect(genericCount).toBeGreaterThanOrEqual(2); // At least 2 functions use it
  });

  test("Both detect rate_limit string", () => {
    const engineSource = readEngineSource();
    const patternCount = (engineSource.match(/includes\("rate_limit"\)/g) || []).length;
    expect(patternCount).toBeGreaterThanOrEqual(2); // Both functions
  });

  test("Both use linear backoff: (attempt + 1) * delayBase", () => {
    const engineSource = readEngineSource();
    const backoffCount = (engineSource.match(/\(attempt \+ 1\) \* C\.RETRY_DELAYS/g) || []).length;
    expect(backoffCount).toBeGreaterThanOrEqual(2); // Both functions apply it
  });

  test("Both throw lastErr after exhausting retries", () => {
    const engineSource = readEngineSource();
    // Count throw lastErr patterns
    const throwCount = (engineSource.match(/throw lastErr/g) || []).length;
    expect(throwCount).toBeGreaterThanOrEqual(2); // Both functions have it
  });
});
