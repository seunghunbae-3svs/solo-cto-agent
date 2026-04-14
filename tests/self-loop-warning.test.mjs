import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require_ = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = require_(path.join(repoRoot, "bin", "cowork-engine.js"));

const { assessExternalSignals, formatSelfLoopWarning, formatPartialSignalHint } = engine;

describe("assessExternalSignals", () => {
  it("returns isSelfLoop=true when no external signals are present", () => {
    const s = assessExternalSignals({ env: {} });
    expect(s.isSelfLoop).toBe(true);
    expect(s.activeCount).toBe(0);
    expect(s.t1PeerModel).toBe(false);
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.t3GroundTruth).toBe(false);
  });

  it("detects T1 peer model via OPENAI_API_KEY", () => {
    const s = assessExternalSignals({ env: { OPENAI_API_KEY: "sk-xxx" } });
    expect(s.t1PeerModel).toBe(true);
    expect(s.isSelfLoop).toBe(false);
    expect(s.activeCount).toBe(1);
  });

  it("detects T2 via COWORK_EXTERNAL_KNOWLEDGE=1", () => {
    const s = assessExternalSignals({ env: { COWORK_EXTERNAL_KNOWLEDGE: "1" } });
    expect(s.t2ExternalKnowledge).toBe(true);
    expect(s.isSelfLoop).toBe(false);
  });

  it("detects T3 ground truth via VERCEL_TOKEN", () => {
    const s = assessExternalSignals({ env: { VERCEL_TOKEN: "vercel_xxx" } });
    expect(s.t3GroundTruth).toBe(true);
    expect(s.isSelfLoop).toBe(false);
  });

  it("detects T3 ground truth via SUPABASE_ACCESS_TOKEN", () => {
    const s = assessExternalSignals({ env: { SUPABASE_ACCESS_TOKEN: "sbp_xxx" } });
    expect(s.t3GroundTruth).toBe(true);
  });

  it("combines three tiers correctly", () => {
    const s = assessExternalSignals({
      env: {
        OPENAI_API_KEY: "sk-x",
        COWORK_EXTERNAL_KNOWLEDGE: "1",
        VERCEL_TOKEN: "v",
      },
    });
    expect(s.activeCount).toBe(3);
    expect(s.isSelfLoop).toBe(false);
  });
});

describe("formatSelfLoopWarning", () => {
  it("returns empty string when not self-loop", () => {
    const out = formatSelfLoopWarning({ isSelfLoop: false, activeCount: 1 });
    expect(out).toBe("");
  });

  it("returns warning block when isSelfLoop=true", () => {
    const out = formatSelfLoopWarning({ isSelfLoop: true, activeCount: 0 });
    expect(out).toContain("SELF-LOOP NOTICE");
    expect(out).toContain("peer model");
    expect(out).toContain("external knowledge");
    expect(out).toContain("ground truth");
    expect(out).toContain("dual-review");
    expect(out).toContain("VERCEL_TOKEN");
  });

  it("handles undefined signals gracefully", () => {
    expect(formatSelfLoopWarning(undefined)).toBe("");
    expect(formatSelfLoopWarning(null)).toBe("");
  });
});

describe("formatPartialSignalHint", () => {
  it("returns empty when self-loop (warning handles that)", () => {
    const out = formatPartialSignalHint({ isSelfLoop: true, activeCount: 0 });
    expect(out).toBe("");
  });

  it("returns empty when all three signals active", () => {
    const out = formatPartialSignalHint({
      isSelfLoop: false,
      activeCount: 3,
      t1PeerModel: true,
      t2ExternalKnowledge: true,
      t3GroundTruth: true,
    });
    expect(out).toBe("");
  });

  it("lists missing signals when only T1 active", () => {
    const out = formatPartialSignalHint({
      isSelfLoop: false,
      activeCount: 1,
      t1PeerModel: true,
      t2ExternalKnowledge: false,
      t3GroundTruth: false,
    });
    expect(out).toContain("1/3");
    expect(out).toContain("T2 external knowledge");
    expect(out).toContain("T3 ground truth");
    expect(out).not.toContain("T1 peer model");
  });

  it("lists missing signals when T1+T3 active but T2 missing", () => {
    const out = formatPartialSignalHint({
      isSelfLoop: false,
      activeCount: 2,
      t1PeerModel: true,
      t2ExternalKnowledge: false,
      t3GroundTruth: true,
    });
    expect(out).toContain("2/3");
    expect(out).toContain("T2 external knowledge");
    expect(out).not.toContain("T1 peer model");
    expect(out).not.toContain("T3 ground truth");
  });
});
