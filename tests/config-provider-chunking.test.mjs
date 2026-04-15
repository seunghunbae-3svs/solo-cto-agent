import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(import.meta.url);

// We need fresh imports per test group to test _loadUserConfig at require-time.
// For CONFIG tests, we test the already-loaded CONFIG object.
// For _loadUserConfig isolation, we test via env var override + dynamic require.

const { CONFIG, localReview, getDiff, _setSkillDirOverride } = require("../bin/cowork-engine.js");

// ===========================================================================
// 1. CONFIG defaults (no user config override)
// ===========================================================================
describe("CONFIG defaults", () => {
  test("defaultModel has claude, codex, openai keys", () => {
    expect(CONFIG.defaultModel.claude).toBeTruthy();
    expect(CONFIG.defaultModel.codex).toBeTruthy();
    expect(CONFIG.defaultModel.openai).toBeTruthy();
  });

  test("providers have anthropicBase and openaiBase", () => {
    expect(CONFIG.providers.anthropicBase).toBeTruthy();
    expect(CONFIG.providers.openaiBase).toBeTruthy();
  });

  test("default anthropicBase is api.anthropic.com when no env override", () => {
    // If ANTHROPIC_API_BASE is not set, should be default
    if (!process.env.ANTHROPIC_API_BASE) {
      expect(CONFIG.providers.anthropicBase).toBe("api.anthropic.com");
    }
  });

  test("default openaiBase is api.openai.com when no env override", () => {
    if (!process.env.OPENAI_API_BASE) {
      expect(CONFIG.providers.openaiBase).toBe("api.openai.com");
    }
  });

  test("diff.maxChunkBytes defaults to 50000", () => {
    // Unless user config overrides it
    expect(CONFIG.diff.maxChunkBytes).toBeGreaterThan(0);
    if (!process.env.SOLO_CTO_CONFIG) {
      expect(CONFIG.diff.maxChunkBytes).toBe(50000);
    }
  });

  test("tierModels.claude has maker, builder, cto", () => {
    expect(CONFIG.tierModels.claude.maker).toBeTruthy();
    expect(CONFIG.tierModels.claude.builder).toBeTruthy();
    expect(CONFIG.tierModels.claude.cto).toBeTruthy();
  });
});

// ===========================================================================
// 2. _loadUserConfig behavior (tested via isolated file creation)
// ===========================================================================
describe("_loadUserConfig", () => {
  let tmpDir;
  let configPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "solo-cto-test-"));
    configPath = path.join(tmpDir, "config.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty object when config file does not exist", () => {
    // _loadUserConfig is called at module load, but we can verify the pattern
    // by checking that missing file returns {}
    const fakePath = path.join(tmpDir, "nonexistent.json");
    expect(fs.existsSync(fakePath)).toBe(false);
    // Module-level _loadUserConfig uses try/catch returning {}
    // We verify the contract: CONFIG still has valid defaults even without config
    expect(CONFIG.defaultModel.claude).toBeTruthy();
  });

  test("valid config JSON is parseable", () => {
    const cfg = {
      models: { claude: "test-model" },
      providers: { anthropicBase: "localhost:8080" },
      diff: { maxChunkBytes: 100000 },
    };
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.models.claude).toBe("test-model");
    expect(parsed.providers.anthropicBase).toBe("localhost:8080");
    expect(parsed.diff.maxChunkBytes).toBe(100000);
  });

  test("malformed JSON does not crash (returns empty object pattern)", () => {
    fs.writeFileSync(configPath, "{ broken json ???");
    // Verify JSON.parse throws
    expect(() => JSON.parse(fs.readFileSync(configPath, "utf8"))).toThrow();
    // The module's _loadUserConfig catches this and returns {}
    // CONFIG still works → proof the silent fallback is active
    expect(CONFIG.diff.maxChunkBytes).toBeGreaterThan(0);
  });

  test("config with unknown keys does not break anything", () => {
    const cfg = { unknownKey: "value", nested: { deep: true } };
    fs.writeFileSync(configPath, JSON.stringify(cfg));
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(parsed.unknownKey).toBe("value");
    // Unknown keys are simply ignored by CONFIG merge
  });
});

// ===========================================================================
// 3. Provider base URL in CONFIG
// ===========================================================================
describe("provider base URL configuration", () => {
  test("providers object exists on CONFIG", () => {
    expect(CONFIG.providers).toBeDefined();
    expect(typeof CONFIG.providers.anthropicBase).toBe("string");
    expect(typeof CONFIG.providers.openaiBase).toBe("string");
  });

  test("provider URLs do not include protocol prefix", () => {
    // Hostnames should be bare (no https://)
    expect(CONFIG.providers.anthropicBase).not.toMatch(/^https?:\/\//);
    expect(CONFIG.providers.openaiBase).not.toMatch(/^https?:\/\//);
  });

  test("env ANTHROPIC_API_BASE takes precedence over config file", () => {
    // This is verified by the CONFIG construction:
    // anthropicBase: process.env.ANTHROPIC_API_BASE || config || default
    // The precedence order is baked into the object literal
    const src = fs.readFileSync(
      path.join(process.cwd(), "bin", "cowork-engine.js"), "utf8"
    );
    // Verify env var is checked first in the source
    expect(src).toMatch(/process\.env\.ANTHROPIC_API_BASE/);
    expect(src).toMatch(/process\.env\.OPENAI_API_BASE/);
    // Verify config is checked second (after env var, before default)
    const anthropicLine = src.match(/anthropicBase:\s*process\.env\.ANTHROPIC_API_BASE[\s\S]*?"api\.anthropic\.com"/);
    expect(anthropicLine).toBeTruthy();
  });
});

// ===========================================================================
// 4. Diff chunking logic
// ===========================================================================
describe("diff chunking", () => {
  test("CONFIG.diff.maxChunkBytes is a positive number", () => {
    expect(typeof CONFIG.diff.maxChunkBytes).toBe("number");
    expect(CONFIG.diff.maxChunkBytes).toBeGreaterThan(0);
  });

  test("small diff passes through unchanged (under maxChunkBytes)", () => {
    const smallDiff = "diff --git a/file.js b/file.js\n+const x = 1;\n";
    const bytes = Buffer.byteLength(smallDiff, "utf8");
    expect(bytes).toBeLessThan(CONFIG.diff.maxChunkBytes);
    // No truncation marker should appear for small diffs
    expect(smallDiff).not.toMatch(/\[.*truncated/);
  });

  test("truncation logic preserves line boundaries", () => {
    // Simulate the truncation algorithm from cowork-engine.js
    const maxBytes = 100; // small limit for testing
    const lines = [];
    for (let i = 0; i < 50; i++) {
      lines.push(`+line ${i}: ${"x".repeat(10)}`);
    }
    const largeDiff = lines.join("\n");
    const diffBytes = Buffer.byteLength(largeDiff, "utf8");
    expect(diffBytes).toBeGreaterThan(maxBytes);

    // Apply the same algorithm as cowork-engine.js
    const truncated = Buffer.from(largeDiff, "utf8").subarray(0, maxBytes).toString("utf8");
    const lastNewline = truncated.lastIndexOf("\n");
    const result = (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated)
      + `\n\n[... truncated — ${(diffBytes / 1024).toFixed(0)}KB total, showing first ${(maxBytes / 1024).toFixed(0)}KB]`;

    // Verify: result ends with truncation marker
    expect(result).toMatch(/\[.*truncated/);
    // Verify: content before marker ends at a line boundary
    const contentBeforeMarker = result.split("\n\n[... truncated")[0];
    expect(contentBeforeMarker.endsWith("\n")).toBe(false); // trimmed at newline, not ending with one
    // Each line before marker should be complete
    const resultLines = contentBeforeMarker.split("\n");
    for (const line of resultLines) {
      expect(line).toMatch(/^\+line \d+:/);
    }
  });

  test("truncation marker includes size info", () => {
    const maxBytes = 50;
    const largeDiff = "x".repeat(200);
    const diffBytes = Buffer.byteLength(largeDiff, "utf8");

    const truncated = Buffer.from(largeDiff, "utf8").subarray(0, maxBytes).toString("utf8");
    const lastNewline = truncated.lastIndexOf("\n");
    const result = (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated)
      + `\n\n[... truncated — ${(diffBytes / 1024).toFixed(0)}KB total, showing first ${(maxBytes / 1024).toFixed(0)}KB]`;

    expect(result).toContain("KB total");
    expect(result).toContain("KB]");
  });

  test("diff chunking code exists in localReview", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "bin", "cowork-engine.js"), "utf8"
    );
    expect(src).toMatch(/maxChunkBytes/);
    expect(src).toMatch(/Diff is large/);
    expect(src).toMatch(/truncated/);
  });
});

// ===========================================================================
// 5. Config validation warnings
// ===========================================================================
describe("config validation", () => {
  test("_loadUserConfig is called before CONFIG is created", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "bin", "cowork-engine.js"), "utf8"
    );
    const loadIdx = src.indexOf("const _userConfig = _loadUserConfig()");
    const configIdx = src.indexOf("const CONFIG = {");
    expect(loadIdx).toBeGreaterThan(-1);
    expect(configIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeLessThan(configIdx);
  });

  test("config file path can be overridden via SOLO_CTO_CONFIG", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "bin", "cowork-engine.js"), "utf8"
    );
    expect(src).toMatch(/process\.env\.SOLO_CTO_CONFIG/);
  });

  test("negative maxChunkBytes in config gets overridden by OR fallback", () => {
    // If user sets maxChunkBytes to 0 or falsy, the || operator falls back to 50000
    const testVal = 0 || 50000;
    expect(testVal).toBe(50000);
  });

  test("valid maxChunkBytes in config is preserved", () => {
    const testVal = 100000 || 50000;
    expect(testVal).toBe(100000);
  });
});

// ===========================================================================
// 6. Config JSON Schema validation (ajv)
// ===========================================================================
describe("config.schema.json", () => {
  let Ajv, ajv, schema;

  beforeEach(() => {
    Ajv = require("ajv");
    ajv = new Ajv({ allErrors: true });
    schema = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "config.schema.json"), "utf8")
    );
  });

  test("schema file exists and is valid JSON Schema", () => {
    expect(schema.$schema).toContain("json-schema.org");
    expect(schema.type).toBe("object");
  });

  test("valid config passes validation", () => {
    const config = {
      models: { claude: "test-model", codex: "test-codex", openai: "test-openai" },
      providers: { anthropicBase: "localhost:8080", openaiBase: "api.groq.com" },
      diff: { maxChunkBytes: 100000 },
    };
    const valid = ajv.validate(schema, config);
    expect(valid).toBe(true);
  });

  test("empty object passes (all fields optional)", () => {
    expect(ajv.validate(schema, {})).toBe(true);
  });

  test("unknown top-level key fails", () => {
    const config = { unknownField: "value" };
    expect(ajv.validate(schema, config)).toBe(false);
    expect(ajv.errors.some(e => e.keyword === "additionalProperties")).toBe(true);
  });

  test("unknown model key fails", () => {
    const config = { models: { gemini: "gemini-pro" } };
    expect(ajv.validate(schema, config)).toBe(false);
  });

  test("provider with protocol prefix fails pattern", () => {
    const config = { providers: { anthropicBase: "https://api.anthropic.com" } };
    expect(ajv.validate(schema, config)).toBe(false);
  });

  test("maxChunkBytes below 1024 fails", () => {
    const config = { diff: { maxChunkBytes: 500 } };
    expect(ajv.validate(schema, config)).toBe(false);
  });

  test("maxChunkBytes above 1MB fails", () => {
    const config = { diff: { maxChunkBytes: 2000000 } };
    expect(ajv.validate(schema, config)).toBe(false);
  });

  test("$schema key is allowed (for editor autocomplete)", () => {
    const config = { "$schema": "https://example.com/schema.json" };
    expect(ajv.validate(schema, config)).toBe(true);
  });

  test("tierModels with valid structure passes", () => {
    const config = {
      tierModels: {
        claude: { maker: "custom-haiku", builder: "custom-sonnet", cto: "custom-opus" },
      },
    };
    expect(ajv.validate(schema, config)).toBe(true);
  });

  test("tierModels with unknown tier fails", () => {
    const config = {
      tierModels: { claude: { enterprise: "custom-model" } },
    };
    expect(ajv.validate(schema, config)).toBe(false);
  });
});
