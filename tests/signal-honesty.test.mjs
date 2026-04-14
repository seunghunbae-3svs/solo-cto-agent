// PR-F2 — tests for outcome-aware assessExternalSignals.
//
// Drive-run discovery on palate-pilot + 3stripe-event revealed:
// COWORK_EXTERNAL_KNOWLEDGE=1 was set, but the repo had no (or nested)
// package.json at root, so the T2 fetch silently produced zero data —
// and yet the summary reported "1/3 active signals". That's a
// false-confidence bug. Users think they've closed the self-loop when
// they haven't. Outcome-aware assessment fixes it.

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engine = await import(path.join(__dirname, "..", "bin", "cowork-engine.js"));

describe("F2 — assessExternalSignals: env-only (backward compatible)", () => {
  it("no env + no outcome → self-loop, activeCount=0", () => {
    const s = engine.assessExternalSignals({ env: {} });
    expect(s.isSelfLoop).toBe(true);
    expect(s.activeCount).toBe(0);
    expect(s.t1PeerModel).toBe(false);
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.t3GroundTruth).toBe(false);
  });

  it("all env flags set + no outcome → env-based active=3 (backward compat)", () => {
    const s = engine.assessExternalSignals({
      env: {
        OPENAI_API_KEY: "sk-xxx",
        COWORK_EXTERNAL_KNOWLEDGE: "1",
        VERCEL_TOKEN: "vtok",
      },
    });
    expect(s.activeCount).toBe(3);
    expect(s.isSelfLoop).toBe(false);
  });

  it("exposes envSet diagnostic fields even without outcome", () => {
    const s = engine.assessExternalSignals({
      env: { OPENAI_API_KEY: "x", COWORK_EXTERNAL_KNOWLEDGE: "1" },
    });
    expect(s.t1EnvSet).toBe(true);
    expect(s.t2EnvSet).toBe(true);
    expect(s.t3EnvSet).toBe(false);
  });
});

describe("F2 — assessExternalSignals: outcome-aware (the PR-F2 fix)", () => {
  it("T2 env set but scan produced no data → not applied, activeCount stays honest", () => {
    const s = engine.assessExternalSignals({
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1" },
      outcome: { t2Applied: false },
    });
    expect(s.t2ExternalKnowledge).toBe(false); // NOT applied
    expect(s.t2EnvSet).toBe(true); // but env WAS set — diagnostic retained
    expect(s.activeCount).toBe(0);
    expect(s.isSelfLoop).toBe(true);
  });

  it("T2 env set AND scan succeeded → applied, counts correctly", () => {
    const s = engine.assessExternalSignals({
      env: { COWORK_EXTERNAL_KNOWLEDGE: "1" },
      outcome: { t2Applied: true },
    });
    expect(s.t2ExternalKnowledge).toBe(true);
    expect(s.activeCount).toBe(1);
    expect(s.isSelfLoop).toBe(false);
  });

  it("T3 env set but fetch returned no data → not applied", () => {
    const s = engine.assessExternalSignals({
      env: { VERCEL_TOKEN: "vtok" },
      outcome: { t3Applied: false },
    });
    expect(s.t3GroundTruth).toBe(false);
    expect(s.t3EnvSet).toBe(true);
    expect(s.activeCount).toBe(0);
  });

  it("mixed: T1 peer key set, T2 enabled-but-silent, T3 off → 1/3 (T1 only)", () => {
    const s = engine.assessExternalSignals({
      env: { OPENAI_API_KEY: "sk-x", COWORK_EXTERNAL_KNOWLEDGE: "1" },
      outcome: { t1Applied: true, t2Applied: false, t3Applied: false },
    });
    expect(s.t1PeerModel).toBe(true);
    expect(s.t2ExternalKnowledge).toBe(false);
    expect(s.activeCount).toBe(1);
    expect(s.t2EnvSet).toBe(true); // diagnostic: env set, no data
  });

  it("dual-review shape: T1 forced applied + T2/T3 outcome-driven", () => {
    const s = engine.assessExternalSignals({
      env: {
        OPENAI_API_KEY: "sk-x",
        COWORK_EXTERNAL_KNOWLEDGE: "1",
        VERCEL_TOKEN: "vtok",
      },
      outcome: { t1Applied: true, t2Applied: true, t3Applied: false },
    });
    expect(s.activeCount).toBe(2);
    expect(s.t3EnvSet).toBe(true);
    expect(s.t3GroundTruth).toBe(false);
  });
});

describe("F2 — formatPartialSignalHint surfaces enabled-but-silent", () => {
  it("flags 'env set, no data' for T2 when outcome=false", () => {
    const s = engine.assessExternalSignals({
      env: { OPENAI_API_KEY: "x", COWORK_EXTERNAL_KNOWLEDGE: "1" },
      outcome: { t1Applied: true, t2Applied: false },
    });
    const hint = engine.formatPartialSignalHint(s);
    expect(hint).toMatch(/enabled-but-silent/);
    expect(hint).toMatch(/T2/);
  });

  it("does NOT flag enabled-but-silent when env is not set", () => {
    const s = engine.assessExternalSignals({
      env: { OPENAI_API_KEY: "x" },
      outcome: { t1Applied: true },
    });
    const hint = engine.formatPartialSignalHint(s);
    expect(hint).not.toMatch(/enabled-but-silent/);
  });

  it("does NOT flag enabled-but-silent when T2 actually applied", () => {
    const s = engine.assessExternalSignals({
      env: { OPENAI_API_KEY: "x", COWORK_EXTERNAL_KNOWLEDGE: "1" },
      outcome: { t1Applied: true, t2Applied: true },
    });
    const hint = engine.formatPartialSignalHint(s);
    expect(hint).not.toMatch(/enabled-but-silent/);
  });
});
