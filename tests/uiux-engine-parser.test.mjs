import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const uiux = require("../bin/uiux-engine.js");

describe("uiux-engine: parseScores", () => {
  it("parses 6-axis scores from [SCORES] block", () => {
    const text = `[VERDICT] APPROVE

[SCORES]
layout: 8
typography: 7
spacing: 9
color: 6
accessibility: 5
polish: 7

[ISSUES]
none`;
    const scores = uiux.parseScores(text);
    expect(scores.layout).toBe(8);
    expect(scores.typography).toBe(7);
    expect(scores.spacing).toBe(9);
    expect(scores.color).toBe(6);
    expect(scores.accessibility).toBe(5);
    expect(scores.polish).toBe(7);
  });

  it("supports x/10 score format", () => {
    const text = `[SCORES]\nlayout: 8/10\npolish: 6.5/10\n`;
    const scores = uiux.parseScores(text);
    expect(scores.layout).toBe(8);
    expect(scores.polish).toBe(6.5);
  });

  it("returns empty object when SCORES block missing", () => {
    const text = `[VERDICT] APPROVE\n[ISSUES]\nnone`;
    const scores = uiux.parseScores(text);
    expect(scores).toEqual({});
  });
});

describe("uiux-engine: parseStrengths", () => {
  it("extracts bullet items from [STRENGTHS] block", () => {
    const text = `[STRENGTHS]
- Clear visual hierarchy
- Consistent spacing scale
- Strong CTAs

[ISSUES]
none`;
    const strengths = uiux.parseStrengths(text);
    expect(strengths.length).toBe(3);
    expect(strengths[0]).toContain("hierarchy");
    expect(strengths[2]).toContain("CTAs");
  });

  it("returns empty array when missing", () => {
    expect(uiux.parseStrengths("[VERDICT] APPROVE")).toEqual([]);
  });
});

describe("uiux-engine: extractCategory", () => {
  it("extracts category from 'category:xxx' pattern in location string", () => {
    expect(uiux.extractCategory("src/Btn.tsx:42 category:a11y")).toBe("a11y");
    expect(uiux.extractCategory("category: design-system")).toBe("design-system");
  });

  it("returns 'unknown' when no category tag", () => {
    expect(uiux.extractCategory("src/Btn.tsx:42")).toBe("unknown");
    expect(uiux.extractCategory(null)).toBe("unknown");
    expect(uiux.extractCategory("")).toBe("unknown");
  });
});

describe("uiux-engine: extractDesignTokens", () => {
  it("returns a token summary object even on empty project dir", () => {
    // Use OS tmp dir as a stand-in for an empty project — should not throw.
    const out = uiux.extractDesignTokens("/tmp/nonexistent-uiux-test-dir");
    expect(out).toHaveProperty("tokenFiles");
    expect(out).toHaveProperty("colors");
    expect(out).toHaveProperty("spacing");
  });

  it("summarizeTokens produces a string", () => {
    const summary = uiux.summarizeTokens({
      tokenFiles: [],
      colors: ["#ff0000"],
      spacing: ["4px", "8px"],
      fontFamilies: ["Inter"],
      borderRadius: [],
      cssVars: {},
      tailwind: null,
      configFile: null,
    });
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
  });
});
