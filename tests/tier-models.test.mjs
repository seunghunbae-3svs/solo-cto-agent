import { describe, test, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const { resolveModelForTier, CONFIG } = require("../bin/cowork-engine.js");

describe("tier-aware model resolution (PR-G2)", () => {
  test("maker tier defaults to Haiku", () => {
    const m = resolveModelForTier("maker", { env: {} });
    expect(m).toMatch(/haiku/i);
  });

  test("builder tier defaults to Sonnet", () => {
    const m = resolveModelForTier("builder", { env: {} });
    expect(m).toMatch(/sonnet/i);
  });

  test("cto tier defaults to Opus", () => {
    const m = resolveModelForTier("cto", { env: {} });
    expect(m).toMatch(/opus/i);
  });

  test("case-insensitive tier name (MAKER, Maker, maker)", () => {
    expect(resolveModelForTier("MAKER", { env: {} })).toMatch(/haiku/i);
    expect(resolveModelForTier("Maker", { env: {} })).toMatch(/haiku/i);
    expect(resolveModelForTier("maker", { env: {} })).toMatch(/haiku/i);
  });

  test("tier-specific env override beats tier default (CLAUDE_MODEL_CTO)", () => {
    const m = resolveModelForTier("cto", {
      env: { CLAUDE_MODEL_CTO: "claude-custom-cto-model" },
    });
    expect(m).toBe("claude-custom-cto-model");
  });

  test("tier-specific env only applies to matching tier", () => {
    // CLAUDE_MODEL_CTO should not affect builder
    const m = resolveModelForTier("builder", {
      env: { CLAUDE_MODEL_CTO: "claude-custom-cto-model" },
    });
    expect(m).toMatch(/sonnet/i);
  });

  test("global CLAUDE_MODEL env overrides all tiers", () => {
    const env = { CLAUDE_MODEL: "claude-global-override" };
    expect(resolveModelForTier("maker",   { env })).toBe("claude-global-override");
    expect(resolveModelForTier("builder", { env })).toBe("claude-global-override");
    expect(resolveModelForTier("cto",     { env })).toBe("claude-global-override");
  });

  test("tier-specific env beats global env (more specific wins)", () => {
    const env = {
      CLAUDE_MODEL: "claude-global",
      CLAUDE_MODEL_CTO: "claude-cto-specific",
    };
    expect(resolveModelForTier("cto",     { env })).toBe("claude-cto-specific");
    expect(resolveModelForTier("builder", { env })).toBe("claude-global");
  });

  test("unknown tier falls back to default model", () => {
    const m = resolveModelForTier("architect", { env: {} });
    expect(m).toBe(CONFIG.defaultModel.claude);
  });

  test("empty/null tier falls back to default model", () => {
    expect(resolveModelForTier("", { env: {} })).toBe(CONFIG.defaultModel.claude);
    expect(resolveModelForTier(null, { env: {} })).toBe(CONFIG.defaultModel.claude);
    expect(resolveModelForTier(undefined, { env: {} })).toBe(CONFIG.defaultModel.claude);
  });

  test("whitespace-only env value is ignored", () => {
    const m = resolveModelForTier("cto", { env: { CLAUDE_MODEL_CTO: "   " } });
    expect(m).toMatch(/opus/i);
  });

  test("three tier defaults are distinct models", () => {
    const maker   = resolveModelForTier("maker",   { env: {} });
    const builder = resolveModelForTier("builder", { env: {} });
    const cto     = resolveModelForTier("cto",     { env: {} });
    expect(new Set([maker, builder, cto]).size).toBe(3);
  });

  test("CONFIG.tierModels.claude has all three tiers populated", () => {
    expect(CONFIG.tierModels.claude.maker).toBeTruthy();
    expect(CONFIG.tierModels.claude.builder).toBeTruthy();
    expect(CONFIG.tierModels.claude.cto).toBeTruthy();
  });
});
