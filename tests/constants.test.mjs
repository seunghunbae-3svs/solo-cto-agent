/**
 * Tests for bin/constants.js — verify all shared constants are correctly
 * exported, have expected types, and are frozen (immutable).
 */
import { describe, test, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const C = require("../bin/constants.js");

describe("constants.js exports", () => {
  test("exports all expected top-level keys", () => {
    const keys = [
      "API_HOSTS", "MODELS", "TIMEOUTS", "RETRY_DELAYS",
      "LIMITS", "PRICING", "BETA_HEADERS", "ANTHROPIC_API_VERSION",
      "WATCH_PATTERNS",
    ];
    for (const k of keys) {
      expect(C[k]).toBeDefined();
    }
  });
});

describe("API_HOSTS", () => {
  test("contains anthropic and openai hostnames", () => {
    expect(C.API_HOSTS.anthropic).toBe("api.anthropic.com");
    expect(C.API_HOSTS.openai).toBe("api.openai.com");
  });

  test("is frozen", () => {
    expect(Object.isFrozen(C.API_HOSTS)).toBe(true);
  });
});

describe("MODELS", () => {
  test("has default model names", () => {
    expect(C.MODELS.claude).toMatch(/^claude-/);
    expect(C.MODELS.codex).toMatch(/codex/);
    expect(C.MODELS.openai).toMatch(/gpt/);
  });

  test("has tier-specific models", () => {
    expect(C.MODELS.tier.maker).toMatch(/haiku/);
    expect(C.MODELS.tier.builder).toMatch(/sonnet/);
    expect(C.MODELS.tier.cto).toMatch(/opus/);
  });

  test("has managed agent model", () => {
    expect(C.MODELS.managedAgent).toMatch(/claude-/);
  });

  test("is frozen (including nested tier)", () => {
    expect(Object.isFrozen(C.MODELS)).toBe(true);
    expect(Object.isFrozen(C.MODELS.tier)).toBe(true);
  });
});

describe("TIMEOUTS", () => {
  test("apiCall is 120 seconds", () => {
    expect(C.TIMEOUTS.apiCall).toBe(120_000);
  });

  test("all values are positive numbers", () => {
    for (const [key, val] of Object.entries(C.TIMEOUTS)) {
      expect(typeof val).toBe("number");
      expect(val).toBeGreaterThan(0);
    }
  });

  test("is frozen", () => {
    expect(Object.isFrozen(C.TIMEOUTS)).toBe(true);
  });
});

describe("RETRY_DELAYS", () => {
  test("rate limit delay > generic delay", () => {
    expect(C.RETRY_DELAYS.rateLimit).toBeGreaterThan(C.RETRY_DELAYS.generic);
  });
});

describe("LIMITS", () => {
  test("gitDiffBuffer is 5MB", () => {
    expect(C.LIMITS.gitDiffBuffer).toBe(5 * 1024 * 1024);
  });

  test("maxChunkBytes is 50KB", () => {
    expect(C.LIMITS.maxChunkBytes).toBe(50_000);
  });

  test("maxTokens is 4096", () => {
    expect(C.LIMITS.maxTokens).toBe(4096);
  });

  test("maxTokensDeep is 8192", () => {
    expect(C.LIMITS.maxTokensDeep).toBe(8192);
  });
});

describe("PRICING", () => {
  test("has entries for all default models", () => {
    expect(C.PRICING[C.MODELS.claude]).toBeDefined();
    expect(C.PRICING[C.MODELS.tier.maker]).toBeDefined();
    expect(C.PRICING[C.MODELS.tier.builder]).toBeDefined();
    expect(C.PRICING[C.MODELS.tier.cto]).toBeDefined();
    expect(C.PRICING[C.MODELS.codex]).toBeDefined();
  });

  test("all rates have input and output fields", () => {
    for (const [key, val] of Object.entries(C.PRICING)) {
      if (key === "managedAgentRuntime") continue;
      expect(val.input).toBeGreaterThan(0);
      expect(val.output).toBeGreaterThan(0);
    }
  });

  test("managedAgentRuntime is $0.08", () => {
    expect(C.PRICING.managedAgentRuntime).toBe(0.08);
  });
});

describe("BETA_HEADERS", () => {
  test("has routines and managedAgents headers", () => {
    expect(C.BETA_HEADERS.routines).toMatch(/routine/);
    expect(C.BETA_HEADERS.managedAgents).toMatch(/managed-agents/);
  });
});

describe("ANTHROPIC_API_VERSION", () => {
  test("is a date string", () => {
    expect(C.ANTHROPIC_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("WATCH_PATTERNS", () => {
  test("extensions are regex array", () => {
    expect(Array.isArray(C.WATCH_PATTERNS.extensions)).toBe(true);
    expect(C.WATCH_PATTERNS.extensions.length).toBeGreaterThan(0);
    for (const p of C.WATCH_PATTERNS.extensions) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });

  test("ignoreDirs is a Set containing node_modules", () => {
    expect(C.WATCH_PATTERNS.ignoreDirs).toBeInstanceOf(Set);
    expect(C.WATCH_PATTERNS.ignoreDirs.has("node_modules")).toBe(true);
    expect(C.WATCH_PATTERNS.ignoreDirs.has(".git")).toBe(true);
  });
});

describe("cross-file consistency", () => {
  test("cowork-engine CONFIG uses constants values", () => {
    const engine = require("../bin/cowork-engine.js");
    // Verify CONFIG references match constants
    expect(engine.CONFIG.providers.anthropicBase).toBe(C.API_HOSTS.anthropic);
    expect(engine.CONFIG.providers.openaiBase).toBe(C.API_HOSTS.openai);
    expect(engine.CONFIG.defaultModel.claude).toBe(C.MODELS.claude);
    expect(engine.CONFIG.defaultModel.codex).toBe(C.MODELS.codex);
    expect(engine.CONFIG.defaultModel.openai).toBe(C.MODELS.openai);
    expect(engine.CONFIG.diff.maxChunkBytes).toBe(C.LIMITS.maxChunkBytes);
  });
});
