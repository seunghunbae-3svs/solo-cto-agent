/**
 * external-signals.test.mjs
 *
 * Dedicated unit tests for bin/external-signals.js
 * Tests external signal assessment, identity generation, and formatting functions.
 *
 * NOTE: Functions already heavily tested in other files (ground-truth.test.mjs,
 * security-advisories.test.mjs, external-knowledge.test.mjs, signal-honesty.test.mjs,
 * self-loop-warning.test.mjs) are skipped. Focus here is on exported functions
 * that lack dedicated coverage.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require_ = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const signals = require_(path.join(repoRoot, "bin", "external-signals.js"));

const {
  init,
  assessExternalSignals,
  formatSelfLoopWarning,
  formatPartialSignalHint,
  buildIdentity,
  AGENT_IDENTITY_BY_TIER,
  COLORS,
} = signals;

describe("external-signals.init", () => {
  it("initializes with CONFIG and log objects", () => {
    const mockConfig = { version: "1.0" };
    const mockLog = { info: () => {} };
    expect(() => init(mockConfig, mockLog)).not.toThrow();
  });

  it("handles undefined log gracefully", () => {
    const mockConfig = { version: "1.0" };
    expect(() => init(mockConfig)).not.toThrow();
  });

  it("handles undefined CONFIG gracefully", () => {
    expect(() => init()).not.toThrow();
  });
});

describe("assessExternalSignals — tier combinations", () => {
  it("returns isSelfLoop=true when all tiers are off", () => {
    const s = assessExternalSignals({ env: {} });
    expect(s.isSelfLoop).toBe(true);
    expect(s.activeCount).toBe(0);
    expect(s.t1PeerModel).toBe(false);
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.t3GroundTruth).toBe(false);
  });

  it("detects T1 only (OPENAI_API_KEY)", () => {
    const s = assessExternalSignals({ env: { OPENAI_API_KEY: "sk-xxx" } });
    expect(s.t1PeerModel).toBe(true);
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.t3GroundTruth).toBe(false);
    expect(s.activeCount).toBe(1);
    expect(s.isSelfLoop).toBe(false);
  });

  it("detects T2 only (COWORK_EXTERNAL_KNOWLEDGE=1)", () => {
    const s = assessExternalSignals({ env: { COWORK_EXTERNAL_KNOWLEDGE: "1" } });
    expect(s.t1PeerModel).toBe(false);
    expect(s.t2ExternalKnowledge).toBe(true);
    expect(s.t3GroundTruth).toBe(false);
    expect(s.activeCount).toBe(1);
  });

  it("detects T2 via COWORK_WEB_SEARCH", () => {
    const s = assessExternalSignals({ env: { COWORK_WEB_SEARCH: "1" } });
    expect(s.t2ExternalKnowledge).toBe(true);
    expect(s.activeCount).toBe(1);
  });

  it("detects T2 via COWORK_PACKAGE_REGISTRY", () => {
    const s = assessExternalSignals({ env: { COWORK_PACKAGE_REGISTRY: "1" } });
    expect(s.t2ExternalKnowledge).toBe(true);
  });

  it("detects T3 via VERCEL_TOKEN", () => {
    const s = assessExternalSignals({ env: { VERCEL_TOKEN: "vercel_xxx" } });
    expect(s.t1PeerModel).toBe(false);
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.t3GroundTruth).toBe(true);
    expect(s.activeCount).toBe(1);
  });

  it("detects T3 via SUPABASE_ACCESS_TOKEN", () => {
    const s = assessExternalSignals({ env: { SUPABASE_ACCESS_TOKEN: "sbp_xxx" } });
    expect(s.t3GroundTruth).toBe(true);
  });

  it("detects T3 via COWORK_GROUND_TRUTH=1", () => {
    const s = assessExternalSignals({ env: { COWORK_GROUND_TRUTH: "1" } });
    expect(s.t3GroundTruth).toBe(true);
  });

  it("detects T1+T2 combination", () => {
    const s = assessExternalSignals({
      env: { OPENAI_API_KEY: "sk-x", COWORK_EXTERNAL_KNOWLEDGE: "1" },
    });
    expect(s.activeCount).toBe(2);
    expect(s.isSelfLoop).toBe(false);
    expect(s.t1PeerModel).toBe(true);
    expect(s.t2ExternalKnowledge).toBe(true);
    expect(s.t3GroundTruth).toBe(false);
  });

  it("detects T1+T3 combination", () => {
    const s = assessExternalSignals({
      env: { OPENAI_API_KEY: "sk-x", VERCEL_TOKEN: "v_xxx" },
    });
    expect(s.activeCount).toBe(2);
    expect(s.t1PeerModel).toBe(true);
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.t3GroundTruth).toBe(true);
  });

  it("detects T2+T3 combination", () => {
    const s = assessExternalSignals({
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1", SUPABASE_ACCESS_TOKEN: "sbp_x" },
    });
    expect(s.activeCount).toBe(2);
    expect(s.t1PeerModel).toBe(false);
    expect(s.t2ExternalKnowledge).toBe(true);
    expect(s.t3GroundTruth).toBe(true);
  });

  it("detects all three tiers", () => {
    const s = assessExternalSignals({
      env: {
        OPENAI_API_KEY: "sk-x",
        COWORK_EXTERNAL_KNOWLEDGE: "1",
        VERCEL_TOKEN: "v_xxx",
      },
    });
    expect(s.activeCount).toBe(3);
    expect(s.isSelfLoop).toBe(false);
    expect(s.t1PeerModel).toBe(true);
    expect(s.t2ExternalKnowledge).toBe(true);
    expect(s.t3GroundTruth).toBe(true);
  });
});

describe("assessExternalSignals — outcome-aware assessment", () => {
  it("T2 env set but outcome=false means not applied", () => {
    const s = assessExternalSignals({
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1" },
      outcome: { t2Applied: false },
    });
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.t2EnvSet).toBe(true);
    expect(s.activeCount).toBe(0);
    expect(s.isSelfLoop).toBe(true);
  });

  it("T3 env set but outcome=false means not applied", () => {
    const s = assessExternalSignals({
      env: { VERCEL_TOKEN: "vtok" },
      outcome: { t3Applied: false },
    });
    expect(s.t3GroundTruth).toBe(false);
    expect(s.t3EnvSet).toBe(true);
    expect(s.activeCount).toBe(0);
  });

  it("T1 forced applied when outcome.t1Applied=true", () => {
    const s = assessExternalSignals({
      env: { OPENAI_API_KEY: "sk-x" },
      outcome: { t1Applied: true },
    });
    expect(s.t1PeerModel).toBe(true);
  });

  it("outcome overrides env when provided", () => {
    const s = assessExternalSignals({
      env: {
        OPENAI_API_KEY: "sk-x",
        COWORK_EXTERNAL_KNOWLEDGE: "1",
        VERCEL_TOKEN: "vtok",
      },
      outcome: { t1Applied: true, t2Applied: false, t3Applied: true },
    });
    expect(s.t1PeerModel).toBe(true);
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.t3GroundTruth).toBe(true);
    expect(s.activeCount).toBe(2);
  });

  it("falls back to env when outcome undefined", () => {
    const s = assessExternalSignals({
      env: { OPENAI_API_KEY: "sk-x", COWORK_EXTERNAL_KNOWLEDGE: "1" },
    });
    expect(s.t1PeerModel).toBe(true);
    expect(s.t2ExternalKnowledge).toBe(true);
    expect(s.activeCount).toBe(2);
  });
});

describe("assessExternalSignals — env diagnostics", () => {
  it("exposes t1EnvSet, t2EnvSet, t3EnvSet separately from applied", () => {
    const s = assessExternalSignals({
      env: { OPENAI_API_KEY: "x", COWORK_EXTERNAL_KNOWLEDGE: "1" },
    });
    expect(s.t1EnvSet).toBe(true);
    expect(s.t2EnvSet).toBe(true);
    expect(s.t3EnvSet).toBe(false);
    expect(s.t1PeerModel).toBe(true);
    expect(s.t2ExternalKnowledge).toBe(true);
  });

  it("env diagnostics survive false outcomes (PR-F2 bug detection)", () => {
    const s = assessExternalSignals({
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1", VERCEL_TOKEN: "v" },
      outcome: { t2Applied: false, t3Applied: false },
    });
    expect(s.t2EnvSet).toBe(true);
    expect(s.t3EnvSet).toBe(true);
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.t3GroundTruth).toBe(false);
  });
});

describe("assessExternalSignals — isSelfLoop detection", () => {
  it("isSelfLoop=true when activeCount=0", () => {
    const s = assessExternalSignals({ env: {} });
    expect(s.isSelfLoop).toBe(true);
  });

  it("isSelfLoop=false when activeCount>=1", () => {
    expect(assessExternalSignals({ env: { OPENAI_API_KEY: "x" } }).isSelfLoop).toBe(false);
    expect(assessExternalSignals({ env: { COWORK_EXTERNAL_KNOWLEDGE: "1" } }).isSelfLoop).toBe(false);
    expect(assessExternalSignals({ env: { VERCEL_TOKEN: "x" } }).isSelfLoop).toBe(false);
  });

  it("isSelfLoop=false when activeCount=2", () => {
    const s = assessExternalSignals({
      env: { OPENAI_API_KEY: "x", COWORK_EXTERNAL_KNOWLEDGE: "1" },
    });
    expect(s.isSelfLoop).toBe(false);
  });

  it("isSelfLoop=false when activeCount=3", () => {
    const s = assessExternalSignals({
      env: {
        OPENAI_API_KEY: "x",
        COWORK_EXTERNAL_KNOWLEDGE: "1",
        VERCEL_TOKEN: "x",
      },
    });
    expect(s.isSelfLoop).toBe(false);
  });
});

describe("formatSelfLoopWarning", () => {
  it("returns empty string when not self-loop", () => {
    expect(formatSelfLoopWarning({ isSelfLoop: false })).toBe("");
  });

  it("returns warning block when isSelfLoop=true", () => {
    const output = formatSelfLoopWarning({ isSelfLoop: true });
    expect(output).toContain("SELF-LOOP NOTICE");
    expect(output).toContain("single model family");
    expect(output).toContain("T1");
    expect(output).toContain("T2");
    expect(output).toContain("T3");
  });

  it("includes instructions to close the loop", () => {
    const output = formatSelfLoopWarning({ isSelfLoop: true });
    expect(output).toContain("OPENAI_API_KEY");
    expect(output).toContain("COWORK_EXTERNAL_KNOWLEDGE=1");
    expect(output).toContain("VERCEL_TOKEN");
    expect(output).toContain("SUPABASE_ACCESS_TOKEN");
  });

  it("includes dual-review instruction", () => {
    const output = formatSelfLoopWarning({ isSelfLoop: true });
    expect(output).toContain("dual-review");
  });

  it("handles null input gracefully", () => {
    expect(formatSelfLoopWarning(null)).toBe("");
  });

  it("handles undefined input gracefully", () => {
    expect(formatSelfLoopWarning(undefined)).toBe("");
  });

  it("uses COLORS for formatting", () => {
    const output = formatSelfLoopWarning({ isSelfLoop: true });
    expect(output).toContain(COLORS.yellow);
    expect(output).toContain(COLORS.gray);
    expect(output).toContain(COLORS.reset);
  });
});

describe("formatPartialSignalHint", () => {
  it("returns empty when isSelfLoop=true (separate warning)", () => {
    expect(formatPartialSignalHint({ isSelfLoop: true, activeCount: 0 })).toBe("");
  });

  it("returns empty when all 3 signals active", () => {
    const output = formatPartialSignalHint({
      isSelfLoop: false,
      activeCount: 3,
      t1PeerModel: true,
      t2ExternalKnowledge: true,
      t3GroundTruth: true,
    });
    expect(output).toBe("");
  });

  it("returns hint when 1 signal active (2 missing)", () => {
    const output = formatPartialSignalHint({
      isSelfLoop: false,
      activeCount: 1,
      t1PeerModel: true,
      t2ExternalKnowledge: false,
      t3GroundTruth: false,
    });
    expect(output).toContain("1/3");
    expect(output).toContain("T2 external knowledge");
    expect(output).toContain("T3 ground truth");
    expect(output).not.toContain("T1 peer model");
  });

  it("lists missing signals when 2 active (1 missing)", () => {
    const output = formatPartialSignalHint({
      isSelfLoop: false,
      activeCount: 2,
      t1PeerModel: true,
      t2ExternalKnowledge: true,
      t3GroundTruth: false,
    });
    expect(output).toContain("2/3");
    expect(output).toContain("T3 ground truth");
    expect(output).not.toContain("T1 peer model");
    expect(output).not.toContain("T2 external knowledge");
  });

  it("surfaces stale T2 (env set, no data)", () => {
    const output = formatPartialSignalHint({
      isSelfLoop: false,
      activeCount: 1,
      t1PeerModel: true,
      t2ExternalKnowledge: false,
      t3GroundTruth: false,
      t2EnvSet: true,
      t3EnvSet: false,
    });
    expect(output).toContain("enabled-but-silent");
    expect(output).toContain("T2 (env set, no data)");
  });

  it("surfaces stale T3 (env set, no data)", () => {
    const output = formatPartialSignalHint({
      isSelfLoop: false,
      activeCount: 1,
      t1PeerModel: true,
      t2ExternalKnowledge: false,
      t3GroundTruth: false,
      t2EnvSet: false,
      t3EnvSet: true,
    });
    expect(output).toContain("enabled-but-silent");
    expect(output).toContain("T3 (env set, no data)");
  });

  it("does NOT flag stale when env not set", () => {
    const output = formatPartialSignalHint({
      isSelfLoop: false,
      activeCount: 1,
      t1PeerModel: true,
      t2ExternalKnowledge: false,
      t3GroundTruth: false,
      t2EnvSet: false,
      t3EnvSet: false,
    });
    expect(output).not.toContain("enabled-but-silent");
  });

  it("handles null input gracefully", () => {
    expect(formatPartialSignalHint(null)).toBe("");
  });

  it("handles undefined input gracefully", () => {
    expect(formatPartialSignalHint(undefined)).toBe("");
  });

  it("uses COLORS for formatting", () => {
    const output = formatPartialSignalHint({
      isSelfLoop: false,
      activeCount: 1,
      t1PeerModel: true,
      t2ExternalKnowledge: false,
      t3GroundTruth: false,
    });
    expect(output).toContain(COLORS.gray);
    expect(output).toContain(COLORS.reset);
  });
});

describe("buildIdentity", () => {
  it("builds maker tier identity with cowork config", () => {
    const identity = buildIdentity("maker", "cowork");
    expect(identity).toContain("Maker Tier");
    expect(identity).toContain("학습/검증");
    expect(identity).toContain("Cowork 단독");
  });

  it("builds maker tier identity with dual config", () => {
    const identity = buildIdentity("maker", "cowork+codex");
    expect(identity).toContain("Maker Tier");
    expect(identity).toContain("Cowork + Codex");
  });

  it("builds builder tier identity with cowork config", () => {
    const identity = buildIdentity("builder", "cowork");
    expect(identity).toContain("Builder Tier");
    expect(identity).toContain("실행/배포");
    expect(identity).toContain("코드를 지키는");
  });

  it("builds builder tier identity with dual config", () => {
    const identity = buildIdentity("builder", "cowork+codex");
    expect(identity).toContain("Builder Tier");
    expect(identity).toContain("Cowork + Codex");
  });

  it("builds cto tier identity with cowork config", () => {
    const identity = buildIdentity("cto", "cowork");
    expect(identity).toContain("CTO Tier");
    expect(identity).toContain("멀티 에이전트");
    expect(identity).toContain("Cowork 단독");
  });

  it("builds cto tier identity with dual config", () => {
    const identity = buildIdentity("cto", "cowork+codex");
    expect(identity).toContain("CTO Tier");
    expect(identity).toContain("Cowork + Codex");
  });

  it("defaults to builder tier for unknown tier", () => {
    const identity = buildIdentity("unknown", "cowork");
    expect(identity).toBeTruthy();
    // Should contain builder-level content since it defaults to builder
  });

  it("includes agent configuration in the output", () => {
    const cowork = buildIdentity("maker", "cowork");
    const dual = buildIdentity("maker", "cowork+codex");
    expect(cowork).toContain("에이전트 구성");
    expect(dual).toContain("에이전트 구성");
  });
});

describe("AGENT_IDENTITY_BY_TIER", () => {
  it("defines all three tiers", () => {
    expect(AGENT_IDENTITY_BY_TIER).toHaveProperty("maker");
    expect(AGENT_IDENTITY_BY_TIER).toHaveProperty("builder");
    expect(AGENT_IDENTITY_BY_TIER).toHaveProperty("cto");
  });

  it("maker tier describes learning/validation phase", () => {
    const maker = AGENT_IDENTITY_BY_TIER.maker;
    expect(maker).toContain("Maker Tier");
    expect(maker).toContain("학습/검증");
  });

  it("builder tier describes execution/deployment phase", () => {
    const builder = AGENT_IDENTITY_BY_TIER.builder;
    expect(builder).toContain("Builder Tier");
    expect(builder).toContain("실행/배포");
    expect(builder).toContain("코드를 지키는");
  });

  it("cto tier describes multi-agent orchestration", () => {
    const cto = AGENT_IDENTITY_BY_TIER.cto;
    expect(cto).toContain("CTO Tier");
    expect(cto).toContain("멀티 에이전트");
  });

  it("all tiers are non-empty strings", () => {
    Object.values(AGENT_IDENTITY_BY_TIER).forEach((tier) => {
      expect(tier).toBeTruthy();
      expect(typeof tier).toBe("string");
      expect(tier.length).toBeGreaterThan(0);
    });
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
    expect(COLORS.reset).toContain("\x1b");
    expect(COLORS.red).toContain("\x1b");
    expect(COLORS.green).toContain("\x1b");
  });

  it("reset code is correct", () => {
    expect(COLORS.reset).toBe("\x1b[0m");
  });
});
