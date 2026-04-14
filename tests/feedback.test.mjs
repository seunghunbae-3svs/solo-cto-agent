import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(import.meta.url);
const engine = require("../bin/cowork-engine.js");

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-test-"));
  engine._setSkillDirOverride(tmpDir);
});
afterEach(() => {
  engine._setSkillDirOverride(null);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

describe("recordFeedback: input validation", () => {
  it("throws on invalid verdict", () => {
    expect(() => engine.recordFeedback({ verdict: "maybe", location: "a.tsx" })).toThrow(/accept.*reject/);
  });
  it("throws on missing location", () => {
    expect(() => engine.recordFeedback({ verdict: "accept" })).toThrow(/location/);
  });
});

describe("recordFeedback: persistence", () => {
  it("appends accepted pattern + bumps count on repeat", () => {
    engine.recordFeedback({ verdict: "accept", location: "src/Btn.tsx:42", severity: "BLOCKER" });
    let p = engine.loadPersonalization();
    expect(p.acceptedPatterns).toHaveLength(1);
    expect(p.acceptedPatterns[0]).toMatchObject({ location: "src/Btn.tsx", severity: "BLOCKER", count: 1 });

    engine.recordFeedback({ verdict: "accept", location: "src/Btn.tsx:99", severity: "BLOCKER" });
    p = engine.loadPersonalization();
    expect(p.acceptedPatterns).toHaveLength(1); // merged on path+severity
    expect(p.acceptedPatterns[0].count).toBe(2);
  });

  it("rejected and accepted are separate buckets", () => {
    engine.recordFeedback({ verdict: "accept", location: "a.tsx", severity: "BLOCKER" });
    engine.recordFeedback({ verdict: "reject", location: "b.tsx", severity: "SUGGESTION", note: "false positive" });
    const p = engine.loadPersonalization();
    expect(p.acceptedPatterns.map((x) => x.location)).toEqual(["a.tsx"]);
    expect(p.rejectedPatterns.map((x) => x.location)).toEqual(["b.tsx"]);
    expect(p.rejectedPatterns[0].note).toBe("false positive");
  });

  it("returns summary with totalInBucket", () => {
    const r = engine.recordFeedback({ verdict: "accept", location: "x.ts", severity: "NIT" });
    expect(r).toMatchObject({ verdict: "accept", location: "x.ts", severity: "NIT", totalInBucket: 1 });
  });
});

describe("personalizationContext: anti-bias rotation (deterministic via opts.exploration)", () => {
  beforeEach(() => {
    // Seed personalization with a review history so context is non-empty
    const p = engine.loadPersonalization();
    p.reviewCount = 5;
    p.repeatErrors = [{ location: "src/Foo.tsx", severity: "BLOCKER", count: 3, lastSeen: new Date().toISOString() }];
    p.acceptedPatterns = [{ location: "src/Bar.tsx", severity: "SUGGESTION", count: 2 }];
    p.rejectedPatterns = [{ location: "src/Baz.tsx", severity: "BLOCKER", count: 1 }];
    engine.savePersonalization(p);
  });

  it("exploration:true returns minimal/explore block", () => {
    const out = engine.personalizationContext({ exploration: true });
    expect(out).toMatch(/탐색 모드/);
    expect(out).not.toMatch(/반복 발생 핫스팟/);
  });

  it("exploration:false returns full exploit block with hotspots/accept/reject", () => {
    const out = engine.personalizationContext({ exploration: false });
    expect(out).toMatch(/반복 발생 핫스팟/);
    expect(out).toMatch(/src\/Foo\.tsx/);
    expect(out).toMatch(/사용자가 이전에 동의한 패턴/);
    expect(out).toMatch(/사용자가 이전에 거부한 패턴/);
  });

  it("returns empty string when reviewCount is 0", () => {
    const p = engine.loadPersonalization();
    p.reviewCount = 0;
    engine.savePersonalization(p);
    expect(engine.personalizationContext({ exploration: false })).toBe("");
  });
});
