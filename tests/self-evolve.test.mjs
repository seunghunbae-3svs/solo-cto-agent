/**
 * Tests for bin/self-evolve.js and bin/self-evolve/*.js engine modules.
 * Verifies: error collection, quality analysis, feedback, skill improvement,
 *           weekly reports, scouting, external trends, and the orchestrator.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(import.meta.url);

// ── Test helpers ──
let tmpDir;

function makeTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "self-evolve-test-"));
  return tmpDir;
}

function cleanTmpDir() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Module loading ──

describe("self-evolve.js public API", () => {
  const se = require("../bin/self-evolve");

  test("exports all expected functions", () => {
    const expected = [
      "collectError", "getTopErrors", "getImprovementTriggers",
      "analyzeQuality", "getQualityTrend", "getWarnFailPatterns",
      "checkTriggers", "applyImprovement", "logChange",
      "recordSatisfaction", "getLowScorePatterns", "getFeedbackSummary", "generateFeedbackPrompt",
      "generateWeeklyReport",
      "getInstalledSkills", "evaluateSkill", "findConflict", "checkCompatibility",
      "checkNpmOutdated", "parseGitHubTrending", "generateTrendsReport",
      "runPostTask", "runSessionEnd", "runWeekly", "runFull",
      "getStatus", "initializeDataFiles",
    ];
    for (const fn of expected) {
      expect(se[fn], `Missing export: ${fn}`).not.toBeNull();
      expect(typeof se[fn]).toBe("function");
    }
  });

  test("DEFAULT_CHECKLISTS has all work types", () => {
    expect(se.DEFAULT_CHECKLISTS.code).toBeDefined();
    expect(se.DEFAULT_CHECKLISTS.design).toBeDefined();
    expect(se.DEFAULT_CHECKLISTS.document).toBeDefined();
    expect(se.DEFAULT_CHECKLISTS.analysis).toBeDefined();
    expect(Array.isArray(se.DEFAULT_CHECKLISTS.code)).toBe(true);
    expect(se.DEFAULT_CHECKLISTS.code.length).toBeGreaterThan(0);
  });
});

// ── Error collector ──

describe("error-collector", () => {
  const ec = require("../bin/self-evolve/error-collector");

  beforeEach(() => makeTmpDir());
  afterEach(() => cleanTmpDir());

  test("collectError creates new entry", () => {
    const result = ec.collectError(tmpDir, {
      skill: "review",
      category: "build",
      symptom: "TypeScript strict error",
      cause: "Missing type",
      fix: "Added type annotation",
      severity: "medium",
    });
    expect(result.isNew).toBe(true);
    expect(result.id).toBe(1);
    expect(result.repeatCount).toBe(1);
    expect(result.triggerImprovement).toBe(false);

    // Verify file was created
    const content = fs.readFileSync(path.join(tmpDir, "error-patterns.md"), "utf8");
    expect(content).toContain("E-1");
    expect(content).toContain("TypeScript strict error");
  });

  test("collectError increments repeat count for similar errors", () => {
    ec.collectError(tmpDir, { skill: "review", category: "build", symptom: "TS error in utils.ts", cause: "x", fix: "y" });
    const r2 = ec.collectError(tmpDir, { skill: "review", category: "build", symptom: "TS error in utils.ts", cause: "x", fix: "y" });
    expect(r2.isNew).toBe(false);
    expect(r2.repeatCount).toBe(2);
  });

  test("collectError triggers improvement at 3 repeats", () => {
    ec.collectError(tmpDir, { skill: "review", category: "build", symptom: "Enum not found", cause: "x", fix: "y" });
    ec.collectError(tmpDir, { skill: "review", category: "build", symptom: "Enum not found", cause: "x", fix: "y" });
    const r3 = ec.collectError(tmpDir, { skill: "review", category: "build", symptom: "Enum not found", cause: "x", fix: "y" });
    expect(r3.triggerImprovement).toBe(true);
    expect(r3.repeatCount).toBe(3);
  });

  test("getTopErrors returns sorted by count", () => {
    ec.collectError(tmpDir, { skill: "a", category: "build", symptom: "err-A", cause: "x", fix: "y" });
    ec.collectError(tmpDir, { skill: "b", category: "build", symptom: "err-B", cause: "x", fix: "y" });
    ec.collectError(tmpDir, { skill: "b", category: "build", symptom: "err-B", cause: "x", fix: "y" });
    const top = ec.getTopErrors(tmpDir, 5);
    expect(top.length).toBe(2);
    expect(top[0].repeatCount).toBeGreaterThanOrEqual(top[1].repeatCount);
  });

  test("getImprovementTriggers returns only 3+ repeats", () => {
    ec.collectError(tmpDir, { skill: "a", category: "build", symptom: "once", cause: "x", fix: "y" });
    for (let i = 0; i < 3; i++) {
      ec.collectError(tmpDir, { skill: "b", category: "build", symptom: "triple", cause: "x", fix: "y" });
    }
    const triggers = ec.getImprovementTriggers(tmpDir, 3);
    expect(triggers.length).toBe(1);
    expect(triggers[0].skill).toBe("b");
  });
});

// ── Quality analyzer ──

describe("quality-analyzer", () => {
  const qa = require("../bin/self-evolve/quality-analyzer");

  beforeEach(() => makeTmpDir());
  afterEach(() => cleanTmpDir());

  test("analyzeQuality records pass/warn/fail correctly", () => {
    const pass = qa.analyzeQuality(tmpDir, { type: "code", skill: "review", checks: { build: "pass", ts: "pass" } });
    expect(pass.overallScore).toBe("pass");
    expect(pass.issues).toHaveLength(0);

    const warn = qa.analyzeQuality(tmpDir, { type: "code", skill: "review", checks: { build: "pass", ts: "warn" } });
    expect(warn.overallScore).toBe("warn");
    expect(warn.issues).toHaveLength(1);

    const fail = qa.analyzeQuality(tmpDir, { type: "design", skill: "craft", checks: { grid: "fail" } });
    expect(fail.overallScore).toBe("fail");
  });

  test("getQualityTrend summarizes by type", () => {
    qa.analyzeQuality(tmpDir, { type: "code", skill: "r", checks: { a: "pass" } });
    qa.analyzeQuality(tmpDir, { type: "code", skill: "r", checks: { a: "warn" } });
    qa.analyzeQuality(tmpDir, { type: "design", skill: "r", checks: { a: "fail" } });

    const trend = qa.getQualityTrend(tmpDir);
    expect(trend.total).toBe(3);
    expect(trend.byType.code.pass).toBe(1);
    expect(trend.byType.code.warn).toBe(1);
    expect(trend.byType.design.fail).toBe(1);
  });

  test("getWarnFailPatterns detects repeated issues", () => {
    for (let i = 0; i < 3; i++) {
      qa.analyzeQuality(tmpDir, { type: "code", skill: "review", checks: { imports: "warn" } });
    }
    const patterns = qa.getWarnFailPatterns(tmpDir, 3);
    expect(patterns.length).toBe(1);
    expect(patterns[0].skill).toBe("review");
    expect(patterns[0].count).toBe(3);
  });
});

// ── Feedback collector ──

describe("feedback-collector", () => {
  const fc = require("../bin/self-evolve/feedback-collector");

  beforeEach(() => makeTmpDir());
  afterEach(() => cleanTmpDir());

  test("recordFeedback creates entry and detects low scores", () => {
    const r1 = fc.recordFeedback(tmpDir, { skill: "review", score: 5, task: "PR review" });
    expect(r1.id).toBe(1);
    expect(r1.isLow).toBe(false);

    const r2 = fc.recordFeedback(tmpDir, { skill: "review", score: 2, task: "Bug fix" });
    expect(r2.isLow).toBe(true);
    expect(r2.triggerL2).toBe(false); // Only 1 low so far
  });

  test("recordFeedback triggers L2 at 3 low scores", () => {
    fc.recordFeedback(tmpDir, { skill: "craft", score: 1, task: "t1" });
    fc.recordFeedback(tmpDir, { skill: "craft", score: 2, task: "t2" });
    const r3 = fc.recordFeedback(tmpDir, { skill: "craft", score: 1, task: "t3" });
    expect(r3.triggerL2).toBe(true);
  });

  test("getFeedbackSummary calculates averages", () => {
    fc.recordFeedback(tmpDir, { skill: "a", score: 5 });
    fc.recordFeedback(tmpDir, { skill: "a", score: 3 });
    fc.recordFeedback(tmpDir, { skill: "b", score: 4 });

    const summary = fc.getFeedbackSummary(tmpDir);
    expect(summary.total).toBe(3);
    expect(parseFloat(summary.avgScore)).toBeCloseTo(4.0, 0);
    expect(summary.bySkill.a.count).toBe(2);
  });

  test("generateFeedbackPrompt returns structured question", () => {
    const prompt = fc.generateFeedbackPrompt("Refactored auth module", "review");
    expect(prompt.question).toBeDefined();
    expect(prompt.scale).toBeDefined();
    expect(prompt.scale[1]).toBeDefined();
    expect(prompt.scale[5]).toBeDefined();
  });

  test("rejects invalid scores", () => {
    expect(() => fc.recordFeedback(tmpDir, { skill: "a", score: 0 })).toThrow();
    expect(() => fc.recordFeedback(tmpDir, { skill: "a", score: 6 })).toThrow();
  });
});

// ── Skill improver ──

describe("skill-improver", () => {
  const si = require("../bin/self-evolve/skill-improver");

  beforeEach(() => makeTmpDir());
  afterEach(() => cleanTmpDir());

  test("logChange appends to skill-changelog.md", () => {
    const id = si.logChange(tmpDir, {
      skill: "review",
      description: "Added build check rule",
      reason: "E-1 (3x repeat)",
    });
    expect(id).toBe(1);

    const content = fs.readFileSync(path.join(tmpDir, "skill-changelog.md"), "utf8");
    expect(content).toContain("C-1");
    expect(content).toContain("Added build check rule");
  });

  test("generatePatch creates correct prevention rule", () => {
    const patch = si.generatePatch({
      type: "prevention-rule",
      symptom: "Missing const delegation",
      cause: "Sub-module extraction",
      ref: "E-5",
      repeatCount: 3,
    });
    expect(patch).toContain("방지 규칙");
    expect(patch).toContain("Missing const delegation");
    expect(patch).toContain("E-5");
  });
});

// ── Skill scout ──

describe("skill-scout", () => {
  const scout = require("../bin/self-evolve/skill-scout");

  test("checkCompatibility filters by stack keywords", () => {
    const compatible = scout.checkCompatibility({
      description: "A Next.js optimization plugin for React apps",
    });
    expect(compatible.compatible).toBe(true);
    expect(compatible.matchedTags.length).toBeGreaterThan(0);

    const incompatible = scout.checkCompatibility({
      description: "Vue.js state management with Angular integration",
    });
    expect(incompatible.compatible).toBe(false);
  });

  test("findConflict detects name overlap", () => {
    const installed = [{ name: "review", path: "/x", hasSkillMd: true, description: "Code review" }];
    const exact = scout.findConflict("review", "Code review skill", installed);
    expect(exact.type).toBe("exact-name");

    const overlap = scout.findConflict("code-review", "Code review skill", installed);
    expect(overlap).not.toBeNull();
  });

  test("evaluateSkill classifies actions correctly", () => {
    const tmpSkills = fs.mkdtempSync(path.join(os.tmpdir(), "skills-"));
    fs.mkdirSync(path.join(tmpSkills, "review"));
    fs.writeFileSync(path.join(tmpSkills, "review", "SKILL.md"), "---\nname: review\n---\nReview skill");

    const result = scout.evaluateSkill(
      { name: "cache-optimizer", description: "Performance cache optimization tool" },
      tmpSkills
    );
    expect(result.action).toBe("auto-install"); // System skill with "performance" keyword

    const result2 = scout.evaluateSkill(
      { name: "ml-pipeline", description: "Machine learning data pipeline" },
      tmpSkills
    );
    expect(result2.action).toBe("recommend"); // New capability

    fs.rmSync(tmpSkills, { recursive: true, force: true });
  });
});

// ── External trends ──

describe("external-trends", () => {
  const et = require("../bin/self-evolve/external-trends");

  test("parseGitHubTrending filters by stack keywords", () => {
    const data = [
      { full_name: "vercel/next.js", description: "The React Framework", language: "TypeScript", stargazers_count: 100000 },
      { full_name: "random/thing", description: "Unrelated tool", language: "Rust", stargazers_count: 500 },
    ];
    const result = et.parseGitHubTrending(JSON.stringify(data));
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("vercel/next.js");
    expect(result[0].relevance.length).toBeGreaterThan(0);
  });

  test("parseAnthropicChangelog extracts entries with types", () => {
    const changelog = `## 2025-04-01 Claude 4 model update
Added support for longer context.

## 2025-03-15 Breaking change in API v2
Deprecated old endpoints.
`;
    const entries = et.parseAnthropicChangelog(changelog);
    expect(entries.length).toBe(2);
    expect(entries[0].type).toBe("model"); // Contains "claude" + "model"
    expect(entries[1].type).toBe("breaking");
  });

  test("generateTrendsReport creates markdown", () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "trends-"));
    const result = et.generateTrendsReport(tmpDir2, {
      npmOutdated: [{ package: "next", current: "14.0.0", latest: "15.0.0", isMajor: true }],
      trending: [{ name: "cool/lib", description: "A lib", stars: 1000, url: "https://github.com/cool/lib", relevance: ["react"] }],
    });
    expect(result.markdown).toContain("npm");
    expect(result.markdown).toContain("next");
    expect(result.markdown).toContain("cool/lib");
    expect(result.path).toBeDefined();
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });
});

// ── Orchestrator ──

describe("self-evolve-orchestrator", () => {
  const orch = require("../bin/self-evolve/self-evolve-orchestrator");

  beforeEach(() => makeTmpDir());
  afterEach(() => cleanTmpDir());

  test("initializeDataFiles creates all directories", () => {
    orch.initializeDataFiles(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, "reports"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "memory"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "memory", "episodes"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "memory", "knowledge"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "LOGS"))).toBe(true);
  });

  test("getStatus reports health", () => {
    orch.initializeDataFiles(tmpDir);
    const status = orch.getStatus(tmpDir);

    expect(status.health).toBeDefined();
    expect(status.files).toBeDefined();
    expect(status.modules).toBeDefined();
    // All modules should be loaded
    for (const [mod, loaded] of Object.entries(status.modules)) {
      expect(loaded, `Module ${mod} should be loaded`).toBe(true);
    }
  });

  test("runPostTask returns quality result", () => {
    orch.initializeDataFiles(tmpDir);
    const result = orch.runPostTask(tmpDir, {
      type: "code",
      skill: "review",
      checks: { build: "pass", ts: "pass" },
    });
    expect(result.qualityResult).not.toBeNull();
    expect(result.qualityResult.overallScore).toBe("pass");
  });

  test("runSessionEnd returns action summary", () => {
    orch.initializeDataFiles(tmpDir);
    const result = orch.runSessionEnd(tmpDir, path.join(tmpDir, "skills"));
    expect(result.timestamp).toBeDefined();
    expect(Array.isArray(result.actions)).toBe(true);
  });
});

// ── Weekly report ──

describe("weekly-report", () => {
  const wr = require("../bin/self-evolve/weekly-report");

  beforeEach(() => makeTmpDir());
  afterEach(() => cleanTmpDir());

  test("generateWeeklyReport produces markdown + data", () => {
    // Seed some data
    const ec = require("../bin/self-evolve/error-collector");
    const qa = require("../bin/self-evolve/quality-analyzer");
    ec.collectError(tmpDir, { skill: "review", category: "build", symptom: "test err", cause: "x", fix: "y" });
    qa.analyzeQuality(tmpDir, { type: "code", skill: "review", checks: { build: "pass" } });

    const result = wr.generateWeeklyReport(tmpDir);
    expect(result.markdown).toContain("주간 리포트");
    expect(result.data).toBeDefined();
    expect(result.data.period).toBeDefined();
    expect(result.path).toBeDefined();
    expect(fs.existsSync(result.path)).toBe(true);
  });
});
