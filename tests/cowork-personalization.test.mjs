import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import os from "os";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);

// Use a per-suite temp skill dir via the engine's override hook.
const TMP_BASE = path.join(os.tmpdir(), `cowork-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const TMP_SKILL = path.join(TMP_BASE, ".claude", "skills", "solo-cto-agent");

const engine = require("../bin/cowork-engine.js");
engine._setSkillDirOverride(TMP_SKILL);

describe("cowork-engine: personalization layer", () => {
  beforeEach(() => {
    fs.mkdirSync(TMP_SKILL, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(TMP_BASE, { recursive: true, force: true }); } catch (_) {}
  });

  it("returns empty default when no personalization file exists", () => {
    const p = engine.loadPersonalization();
    expect(p.reviewCount).toBe(0);
    expect(p.acceptedPatterns).toEqual([]);
    expect(p.repeatErrors).toEqual([]);
  });

  it("personalizationContext returns empty string for fresh state", () => {
    const ctx = engine.personalizationContext();
    expect(ctx).toBe("");
  });

  it("updatePersonalizationFromReview accumulates repeat errors", () => {
    const review = {
      issues: [
        { location: "src/api/users.ts:42", severity: "BLOCKER", issue: "x", suggestion: "y" },
        { location: "src/api/users.ts:55", severity: "BLOCKER", issue: "z", suggestion: "w" },
        { location: "src/lib/auth.ts:10", severity: "SUGGESTION", issue: "a", suggestion: "b" },
      ],
    };
    engine.updatePersonalizationFromReview(review);
    engine.updatePersonalizationFromReview(review);
    const p = engine.loadPersonalization();
    expect(p.reviewCount).toBe(2);
    // src/api/users.ts BLOCKER seen 4 times across 2 reviews (2 issues × 2 reviews)
    const usersBlocker = p.repeatErrors.find((e) => e.location === "src/api/users.ts" && e.severity === "BLOCKER");
    expect(usersBlocker.count).toBe(4);
  });

  it("personalizationContext shows repeat hotspots after accumulation", () => {
    const review = {
      issues: [
        { location: "src/db/queries.ts:1", severity: "BLOCKER", issue: "x", suggestion: "y" },
      ],
    };
    engine.updatePersonalizationFromReview(review);
    engine.updatePersonalizationFromReview(review);
    engine.updatePersonalizationFromReview(review);
    const ctx = engine.personalizationContext();
    expect(ctx).toContain("누적 개인화 컨텍스트");
    expect(ctx).toContain("src/db/queries.ts");
    expect(ctx).toContain("3회");
  });
});

describe("cowork-engine: tier + identity", () => {
  beforeEach(() => {
    fs.mkdirSync(TMP_SKILL, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(TMP_BASE, { recursive: true, force: true }); } catch (_) {}
  });

  it("readTier defaults to builder when SKILL.md missing", () => {
    expect(engine.readTier()).toBe("builder");
  });

  it("readTier reads tier: maker from SKILL.md", () => {
    const skillMd = `---
name: solo-cto-agent
mode: cowork-main
tier: maker
---
`;
    fs.writeFileSync(path.join(TMP_SKILL, "SKILL.md"), skillMd);
    expect(engine.readTier()).toBe("maker");
  });

  it("readMode reads mode: cowork-main", () => {
    const skillMd = `---
mode: cowork-main
tier: cto
---`;
    fs.writeFileSync(path.join(TMP_SKILL, "SKILL.md"), skillMd);
    expect(engine.readMode()).toBe("cowork-main");
    expect(engine.readTier()).toBe("cto");
  });

  it("buildIdentity returns Maker tone with no strong CTO assertion", () => {
    const id = engine.buildIdentity("maker", "cowork");
    expect(id).toContain("Maker");
    expect(id).toContain("학습");
    // Maker tier should NOT include the strong "어시스턴트가 아니다 CTO다" line
    expect(id).not.toMatch(/어시스턴트가 아니다/);
  });

  it("buildIdentity returns CTO tone with strong assertion", () => {
    const id = engine.buildIdentity("cto", "cowork+codex");
    expect(id).toContain("CTO");
    expect(id).toContain("Cowork + Codex");
  });

  it("buildIdentity defaults to builder for unknown tier", () => {
    const id = engine.buildIdentity("nonsense", "cowork");
    expect(id).toContain("Builder");
  });

  it("AGENT_IDENTITY_BY_TIER has all three tiers", () => {
    expect(engine.AGENT_IDENTITY_BY_TIER.maker).toBeTruthy();
    expect(engine.AGENT_IDENTITY_BY_TIER.builder).toBeTruthy();
    expect(engine.AGENT_IDENTITY_BY_TIER.cto).toBeTruthy();
  });
});

describe("cowork-engine: live source detection", () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    fs.mkdirSync(TMP_SKILL, { recursive: true });
    delete process.env.MCP_GITHUB;
    delete process.env.MCP_VERCEL;
    delete process.env.MCP_SUPABASE;
    delete process.env.GITHUB_TOKEN;
    delete process.env.VERCEL_TOKEN;
    delete process.env.SUPABASE_ACCESS_TOKEN;
  });

  afterEach(() => {
    try { fs.rmSync(TMP_BASE, { recursive: true, force: true }); } catch (_) {}
    process.env = { ...ORIG_ENV };
  });

  it("returns empty list when no MCP env vars set", () => {
    const sources = engine.detectLiveSources();
    expect(sources).toEqual([]);
  });

  it("detects GitHub via GITHUB_TOKEN", () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    expect(engine.detectLiveSources()).toContain("github");
  });

  it("detects Vercel + Supabase via env vars", () => {
    process.env.VERCEL_TOKEN = "v_test";
    process.env.SUPABASE_ACCESS_TOKEN = "sb_test";
    const sources = engine.detectLiveSources();
    expect(sources).toContain("vercel");
    expect(sources).toContain("supabase");
  });

  it("liveSourceContext returns offline note when no sources", () => {
    const ctx = engine.liveSourceContext();
    expect(ctx).toContain("MCP 라이브 소스 없음");
  });

  it("liveSourceContext shows env-only MCPs as inferred (추정), not confirmed", () => {
    // env tokens alone are NOT proof an MCP server is wired — must be [추정] only.
    process.env.GITHUB_TOKEN = "x";
    process.env.VERCEL_TOKEN = "y";
    const ctx = engine.liveSourceContext();
    expect(ctx).toContain("추정 MCP");
    expect(ctx).toContain("github");
    expect(ctx).toContain("vercel");
    // Critical: env-only must NOT claim "확정" priority
    expect(ctx).not.toContain("확정 MCP");
  });

  it("detectLiveSources separates confirmed (mcp.json/SKILL.md) from inferred (env)", () => {
    process.env.GITHUB_TOKEN = "x";
    const sources = engine.detectLiveSources();
    expect(sources.confirmed).toEqual([]);
    expect(sources.inferred).toContain("github");
    // Backward compat: flat array still includes everything
    expect(sources).toContain("github");
  });
});

// Cleanup override after suite
process.on("exit", () => {
  engine._setSkillDirOverride(null);
});
