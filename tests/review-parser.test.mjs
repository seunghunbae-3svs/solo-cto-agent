/**
 * review-parser.test.mjs
 *
 * Dedicated unit tests for bin/review-parser.js
 * Tests extracted review parsing + formatting functions.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require_ = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parser = require_(path.join(repoRoot, "bin", "review-parser.js"));

const {
  init,
  normalizeVerdict,
  verdictLabel,
  normalizeSeverity,
  parseReviewResponse,
  formatCrossCheck,
  formatTerminalOutput,
  COLORS,
} = parser;

describe("review-parser.init", () => {
  it("initializes with a log object", () => {
    const mockLog = { info: () => {}, warn: () => {} };
    expect(() => init(mockLog)).not.toThrow();
  });

  it("handles undefined log gracefully", () => {
    expect(() => init()).not.toThrow();
  });
});

describe("normalizeVerdict", () => {
  // REQUEST_CHANGES variants
  it("normalizes 'REQUEST_CHANGES' to REQUEST_CHANGES", () => {
    expect(normalizeVerdict("REQUEST_CHANGES")).toBe("REQUEST_CHANGES");
  });

  it("normalizes 'CHANGES_REQUESTED' to REQUEST_CHANGES", () => {
    expect(normalizeVerdict("CHANGES_REQUESTED")).toBe("REQUEST_CHANGES");
  });

  it("normalizes 'REQUEST CHANGES' (spaces) to REQUEST_CHANGES", () => {
    expect(normalizeVerdict("REQUEST CHANGES")).toBe("REQUEST_CHANGES");
  });

  it("normalizes 'CHANGES REQUESTED' (spaces) to REQUEST_CHANGES", () => {
    expect(normalizeVerdict("CHANGES REQUESTED")).toBe("REQUEST_CHANGES");
  });

  it("normalizes Korean '수정요청' to REQUEST_CHANGES", () => {
    expect(normalizeVerdict("수정요청")).toBe("REQUEST_CHANGES");
  });

  it("normalizes Korean '변경요청' to REQUEST_CHANGES", () => {
    expect(normalizeVerdict("변경요청")).toBe("REQUEST_CHANGES");
  });

  // APPROVE variants
  it("normalizes 'APPROVE' to APPROVE", () => {
    expect(normalizeVerdict("APPROVE")).toBe("APPROVE");
  });

  it("normalizes 'approve' (lowercase) to APPROVE", () => {
    expect(normalizeVerdict("approve")).toBe("APPROVE");
  });

  it("normalizes Korean '승인' to APPROVE", () => {
    expect(normalizeVerdict("승인")).toBe("APPROVE");
  });

  // COMMENT as default
  it("normalizes 'COMMENT' to COMMENT", () => {
    expect(normalizeVerdict("COMMENT")).toBe("COMMENT");
  });

  it("normalizes Korean '보류' to COMMENT", () => {
    expect(normalizeVerdict("보류")).toBe("COMMENT");
  });

  // Edge cases
  it("normalizes null to COMMENT", () => {
    expect(normalizeVerdict(null)).toBe("COMMENT");
  });

  it("normalizes undefined to COMMENT", () => {
    expect(normalizeVerdict(undefined)).toBe("COMMENT");
  });

  it("normalizes empty string to COMMENT", () => {
    expect(normalizeVerdict("")).toBe("COMMENT");
  });

  it("normalizes unknown string to COMMENT", () => {
    expect(normalizeVerdict("RANDOM_VERDICT")).toBe("COMMENT");
  });

  it("normalizes mixed case 'ApProVe' to APPROVE", () => {
    expect(normalizeVerdict("ApProVe")).toBe("APPROVE");
  });

  it("case-insensitive REQUEST_CHANGES detection", () => {
    expect(normalizeVerdict("request_changes")).toBe("REQUEST_CHANGES");
  });
});

describe("verdictLabel", () => {
  it("translates APPROVE to Korean '승인'", () => {
    expect(verdictLabel("APPROVE")).toBe("승인");
  });

  it("translates REQUEST_CHANGES to Korean '수정요청'", () => {
    expect(verdictLabel("REQUEST_CHANGES")).toBe("수정요청");
  });

  it("translates COMMENT to Korean '보류'", () => {
    expect(verdictLabel("COMMENT")).toBe("보류");
  });

  it("defaults unknown verdict to '보류'", () => {
    expect(verdictLabel("UNKNOWN")).toBe("보류");
  });
});

describe("normalizeSeverity", () => {
  // BLOCKER variants
  it("normalizes 'BLOCKER' to BLOCKER", () => {
    expect(normalizeSeverity("BLOCKER")).toBe("BLOCKER");
  });

  it("normalizes 'CRITICAL' to BLOCKER", () => {
    expect(normalizeSeverity("CRITICAL")).toBe("BLOCKER");
  });

  // SUGGESTION variants
  it("normalizes 'SUGGESTION' to SUGGESTION", () => {
    expect(normalizeSeverity("SUGGESTION")).toBe("SUGGESTION");
  });

  it("normalizes 'WARNING' to SUGGESTION", () => {
    expect(normalizeSeverity("WARNING")).toBe("SUGGESTION");
  });

  it("normalizes 'WARN' to SUGGESTION", () => {
    expect(normalizeSeverity("WARN")).toBe("SUGGESTION");
  });

  // NIT as default
  it("normalizes 'NIT' to NIT", () => {
    expect(normalizeSeverity("NIT")).toBe("NIT");
  });

  it("normalizes null to NIT", () => {
    expect(normalizeSeverity(null)).toBe("NIT");
  });

  it("normalizes undefined to NIT", () => {
    expect(normalizeSeverity(undefined)).toBe("NIT");
  });

  it("normalizes unknown string to NIT", () => {
    expect(normalizeSeverity("UNKNOWN")).toBe("NIT");
  });

  it("case-insensitive 'blocker' detection", () => {
    expect(normalizeSeverity("blocker")).toBe("BLOCKER");
  });

  it("case-insensitive 'critical' detection", () => {
    expect(normalizeSeverity("critical")).toBe("BLOCKER");
  });
});

describe("parseReviewResponse", () => {
  it("parses basic review with [VERDICT] header", () => {
    const text = "[VERDICT]: APPROVE\n\nThis looks good.";
    const result = parseReviewResponse(text);
    expect(result.verdict).toBe("APPROVE");
    expect(result.verdictKo).toBe("승인");
  });

  it("parses verdict without explicit header (scans text)", () => {
    const text = "I approve this change.\n\n[SUMMARY]\nLooks good overall.";
    const result = parseReviewResponse(text);
    expect(result.verdict).toBe("APPROVE");
  });

  it("extracts issues with ⛔ (BLOCKER) marker", () => {
    const text = `⛔ [src/main.js]
Critical bug found
→ Fix the logic here`;
    const result = parseReviewResponse(text);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("BLOCKER");
    expect(result.issues[0].location).toBe("src/main.js");
    expect(result.issues[0].issue).toBe("Critical bug found");
    expect(result.issues[0].suggestion).toBe("Fix the logic here");
  });

  it("extracts issues with ⚠️ (SUGGESTION) marker", () => {
    const text = `⚠️ [utils/helpers.ts]
Code style issue
→ Use consistent naming`;
    const result = parseReviewResponse(text);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("SUGGESTION");
  });

  it("extracts issues with 💡 (NIT) marker", () => {
    const text = `💡 [config.json]
Minor suggestion
→ Consider adding a comment`;
    const result = parseReviewResponse(text);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("NIT");
  });

  it("parses multiple issues", () => {
    const text = `
⛔ [file1.js]
Issue 1
→ Fix 1

⚠️ [file2.js]
Issue 2
→ Fix 2

💡 [file3.js]
Issue 3
→ Fix 3
`;
    const result = parseReviewResponse(text);
    expect(result.issues).toHaveLength(3);
    expect(result.issues[0].severity).toBe("BLOCKER");
    expect(result.issues[1].severity).toBe("SUGGESTION");
    expect(result.issues[2].severity).toBe("NIT");
  });

  it("extracts summary section", () => {
    const text = `[VERDICT]: APPROVE

[SUMMARY]
This is a well-structured change. All tests pass.
The implementation follows best practices.`;
    const result = parseReviewResponse(text);
    expect(result.summary).toContain("well-structured change");
    expect(result.summary).toContain("best practices");
  });

  it("extracts next action section", () => {
    const text = `[VERDICT]: REQUEST_CHANGES

[SUMMARY]
Needs revision.

[NEXT_ACTION]
Address the blocker in main.js, then re-request review.`;
    const result = parseReviewResponse(text);
    expect(result.nextAction).toContain("blocker");
  });

  it("handles next action with underscore vs space", () => {
    const text = `[NEXT ACTION]
First action here

[NEXT_ACTION]
Second action here`;
    const result = parseReviewResponse(text);
    // Should match the pattern and capture
    expect(result.nextAction).toBeTruthy();
  });

  it("handles arrow variants: →, ->, =>", () => {
    const text1 = `⛔ [file1.js]\nIssue\n→ Fix`;
    const text2 = `⛔ [file2.js]\nIssue\n-> Fix`;
    const text3 = `⛔ [file3.js]\nIssue\n=> Fix`;

    expect(parseReviewResponse(text1).issues).toHaveLength(1);
    expect(parseReviewResponse(text2).issues).toHaveLength(1);
    expect(parseReviewResponse(text3).issues).toHaveLength(1);
  });

  it("returns empty issues list for text without issue markers", () => {
    const text = "This is a simple approval without detailed issues.";
    const result = parseReviewResponse(text);
    expect(result.issues).toHaveLength(0);
  });

  it("handles empty text", () => {
    const result = parseReviewResponse("");
    expect(result.verdict).toBe("COMMENT");
    expect(result.issues).toHaveLength(0);
    expect(result.summary).toBe("");
    expect(result.nextAction).toBe("");
  });

  it("returns verdictKo correctly for each verdict", () => {
    expect(parseReviewResponse("APPROVE").verdictKo).toBe("승인");
    expect(parseReviewResponse("REQUEST_CHANGES").verdictKo).toBe("수정요청");
    expect(parseReviewResponse("COMMENT").verdictKo).toBe("보류");
  });
});

describe("formatCrossCheck", () => {
  it("returns empty string for null input", () => {
    expect(formatCrossCheck(null)).toBe("");
  });

  it("returns empty string for undefined input", () => {
    expect(formatCrossCheck(undefined)).toBe("");
  });

  it("formats crosscheck with verdict header", () => {
    const cc = {
      crossVerdict: "REQUEST_CHANGES",
      addedIssues: [],
      removedItems: [],
    };
    const output = formatCrossCheck(cc);
    expect(output).toContain("[CROSS-CHECK]");
    expect(output).toContain("REQUEST_CHANGES");
  });

  it("formats added issues section", () => {
    const cc = {
      crossVerdict: "REQUEST_CHANGES",
      addedIssues: [
        {
          severity: "BLOCKER",
          location: "src/main.js",
          issue: "New blocker found",
          suggestion: "Fix it now",
        },
        {
          severity: "SUGGESTION",
          location: "test.js",
          issue: "Missing test",
          suggestion: "Add test case",
        },
      ],
      removedItems: [],
    };
    const output = formatCrossCheck(cc);
    expect(output).toContain("추가 발견");
    expect(output).toContain("⛔");
    expect(output).toContain("⚠️");
    expect(output).toContain("src/main.js");
    expect(output).toContain("test.js");
  });

  it("formats removed items section (false positives)", () => {
    const cc = {
      crossVerdict: "APPROVE",
      addedIssues: [],
      removedItems: [
        { location: "util.js", reason: "False positive - not dead code" },
        { location: "config.json", reason: "Already fixed in diff" },
      ],
    };
    const output = formatCrossCheck(cc);
    expect(output).toContain("false positive");
    expect(output).toContain("util.js");
    expect(output).toContain("config.json");
  });

  it("formats upgrade block (severity escalation)", () => {
    const cc = {
      crossVerdict: "REQUEST_CHANGES",
      addedIssues: [],
      removedItems: [],
      upgradeBlock: "This pattern can lead to security issues in production.",
    };
    const output = formatCrossCheck(cc);
    expect(output).toContain("심각도 상향");
    expect(output).toContain("security issues");
  });

  it("formats downgrade block (severity reduction)", () => {
    const cc = {
      crossVerdict: "APPROVE",
      addedIssues: [],
      removedItems: [],
      downgradeBlock: "This is a nitpick, not a blocker.",
    };
    const output = formatCrossCheck(cc);
    expect(output).toContain("심각도 하향");
    expect(output).toContain("nitpick");
  });

  it("formats meta review", () => {
    const cc = {
      crossVerdict: "REQUEST_CHANGES",
      addedIssues: [],
      removedItems: [],
      metaReview: "Second pass revealed one more issue.",
    };
    const output = formatCrossCheck(cc);
    expect(output).toContain("meta:");
    expect(output).toContain("Second pass");
  });

  it("formats full crosscheck with all sections", () => {
    const cc = {
      crossVerdict: "REQUEST_CHANGES",
      addedIssues: [
        { severity: "BLOCKER", location: "main.js", issue: "Bug", suggestion: "Fix" },
      ],
      removedItems: [
        { location: "util.js", reason: "Not an issue" },
      ],
      upgradeBlock: "Could be more serious.",
      downgradeBlock: "Actually a minor issue.",
      metaReview: "Comprehensive review complete.",
    };
    const output = formatCrossCheck(cc);
    expect(output).toContain("[CROSS-CHECK]");
    expect(output).toContain("추가 발견");
    expect(output).toContain("false positive");
    expect(output).toContain("심각도 상향");
    expect(output).toContain("심각도 하향");
    expect(output).toContain("meta:");
  });

  it("handles multiline upgrade/downgrade blocks with proper indentation", () => {
    const cc = {
      crossVerdict: "REQUEST_CHANGES",
      addedIssues: [],
      removedItems: [],
      upgradeBlock: "Line 1\nLine 2\nLine 3",
      downgradeBlock: null,
    };
    const output = formatCrossCheck(cc);
    // Should indent continuation lines
    expect(output).toContain("Line 1");
    expect(output).toContain("  Line 2");
  });
});

describe("formatTerminalOutput", () => {
  it("formats review with APPROVE verdict", () => {
    const review = {
      verdict: "APPROVE",
      verdictKo: "승인",
      issues: [],
      summary: "All looks good",
      nextAction: "",
    };
    const sourceInfo = { path: "src/main.js" };
    const costInfo = { total: "0.15", inputTokens: "1.2", outputTokens: "0.8", savedPath: "/tmp/review.json" };

    const output = formatTerminalOutput(review, sourceInfo, costInfo);
    expect(output).toContain("VERDICT");
    expect(output).toContain("APPROVE");
    expect(output).toContain("승인");
    expect(output).toContain(COLORS.green);
  });

  it("formats review with REQUEST_CHANGES verdict", () => {
    const review = {
      verdict: "REQUEST_CHANGES",
      verdictKo: "수정요청",
      issues: [],
      summary: "",
      nextAction: "",
    };
    const sourceInfo = {};
    const costInfo = { total: "0.20", inputTokens: "1.5", outputTokens: "1.0", savedPath: "/tmp/review.json" };

    const output = formatTerminalOutput(review, sourceInfo, costInfo);
    expect(output).toContain("REQUEST_CHANGES");
    expect(output).toContain(COLORS.red);
  });

  it("formats review with COMMENT verdict", () => {
    const review = {
      verdict: "COMMENT",
      verdictKo: "보류",
      issues: [],
      summary: "",
      nextAction: "",
    };
    const sourceInfo = {};
    const costInfo = { total: "0.10", inputTokens: "1.0", outputTokens: "0.5", savedPath: "/tmp/review.json" };

    const output = formatTerminalOutput(review, sourceInfo, costInfo);
    expect(output).toContain("COMMENT");
    expect(output).toContain(COLORS.blue);
  });

  it("counts and displays issue severity breakdown", () => {
    const review = {
      verdict: "REQUEST_CHANGES",
      verdictKo: "수정요청",
      issues: [
        { severity: "BLOCKER", location: "main.js", issue: "Critical", suggestion: "Fix" },
        { severity: "BLOCKER", location: "utils.js", issue: "Critical", suggestion: "Fix" },
        { severity: "SUGGESTION", location: "test.js", issue: "Test", suggestion: "Add" },
        { severity: "NIT", location: "comment.js", issue: "Style", suggestion: "Polish" },
      ],
      summary: "",
      nextAction: "",
    };
    const sourceInfo = {};
    const costInfo = { total: "0.25", inputTokens: "2.0", outputTokens: "1.5", savedPath: "/tmp/review.json" };

    const output = formatTerminalOutput(review, sourceInfo, costInfo);
    expect(output).toContain("Issues: 4");
    expect(output).toContain("⛔ 2 BLOCKER");
    expect(output).toContain("⚠️  1 SUGGESTION");
    expect(output).toContain("💡 1 NIT");
  });

  it("formats each issue with proper iconography", () => {
    const review = {
      verdict: "REQUEST_CHANGES",
      verdictKo: "수정요청",
      issues: [
        { severity: "BLOCKER", location: "file1.js", issue: "Bug 1", suggestion: "Fix 1" },
        { severity: "SUGGESTION", location: "file2.js", issue: "Issue 2", suggestion: "Fix 2" },
        { severity: "NIT", location: "file3.js", issue: "Nit 3", suggestion: "Fix 3" },
      ],
      summary: "",
      nextAction: "",
    };
    const sourceInfo = {};
    const costInfo = { total: "0.30", inputTokens: "2.5", outputTokens: "2.0", savedPath: "/tmp/review.json" };

    const output = formatTerminalOutput(review, sourceInfo, costInfo);
    expect(output).toContain("⛔");
    expect(output).toContain("⚠️");
    expect(output).toContain("💡");
    expect(output).toContain("[file1.js]");
    expect(output).toContain("[file2.js]");
    expect(output).toContain("[file3.js]");
    expect(output).toContain("→");
  });

  it("includes summary section when present", () => {
    const review = {
      verdict: "APPROVE",
      verdictKo: "승인",
      issues: [],
      summary: "This change improves code quality.",
      nextAction: "",
    };
    const sourceInfo = {};
    const costInfo = { total: "0.15", inputTokens: "1.0", outputTokens: "0.8", savedPath: "/tmp/review.json" };

    const output = formatTerminalOutput(review, sourceInfo, costInfo);
    expect(output).toContain("[SUMMARY]");
    expect(output).toContain("improves code quality");
  });

  it("includes next action section when present", () => {
    const review = {
      verdict: "REQUEST_CHANGES",
      verdictKo: "수정요청",
      issues: [],
      summary: "",
      nextAction: "Address the blocker and re-request review.",
    };
    const sourceInfo = {};
    const costInfo = { total: "0.15", inputTokens: "1.0", outputTokens: "0.8", savedPath: "/tmp/review.json" };

    const output = formatTerminalOutput(review, sourceInfo, costInfo);
    expect(output).toContain("[NEXT ACTION]");
    expect(output).toContain("re-request review");
  });

  it("displays cost information correctly", () => {
    const review = {
      verdict: "APPROVE",
      verdictKo: "승인",
      issues: [],
      summary: "",
      nextAction: "",
    };
    const sourceInfo = {};
    const costInfo = { total: "1.23", inputTokens: "5.5", outputTokens: "3.2", savedPath: "/tmp/review.json" };

    const output = formatTerminalOutput(review, sourceInfo, costInfo);
    expect(output).toContain("$1.23");
    expect(output).toContain("5.5K");
    expect(output).toContain("3.2K");
    expect(output).toContain("/tmp/review.json");
  });

  it("handles reviews with no issues", () => {
    const review = {
      verdict: "APPROVE",
      verdictKo: "승인",
      issues: [],
      summary: "Perfect!",
      nextAction: "",
    };
    const sourceInfo = {};
    const costInfo = { total: "0.10", inputTokens: "1.0", outputTokens: "0.5", savedPath: "/tmp/review.json" };

    const output = formatTerminalOutput(review, sourceInfo, costInfo);
    expect(output).toContain("Issues: 0");
    expect(output).not.toContain("BLOCKER");
    expect(output).not.toContain("SUGGESTION");
  });
});

describe("COLORS", () => {
  it("exports all required color codes", () => {
    expect(COLORS).toHaveProperty("reset");
    expect(COLORS).toHaveProperty("bold");
    expect(COLORS).toHaveProperty("red");
    expect(COLORS).toHaveProperty("yellow");
    expect(COLORS).toHaveProperty("green");
    expect(COLORS).toHaveProperty("blue");
    expect(COLORS).toHaveProperty("gray");
  });

  it("color codes are ANSI escape sequences", () => {
    expect(COLORS.red).toContain("\x1b");
    expect(COLORS.green).toContain("\x1b");
    expect(COLORS.reset).toBe("\x1b[0m");
    expect(COLORS.bold).toBe("\x1b[1m");
  });
});
