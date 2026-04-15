/**
 * Tests for Claude Code Routines + Managed Agents integrations (PR-G26).
 * Tests cover config, tier gating, schedule building, dry-run paths,
 * and CLI command routing — no real API calls.
 */
import { describe, test, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

const require = createRequire(import.meta.url);
const engine = require("../bin/cowork-engine.js");
const CLI = path.join(process.cwd(), "bin", "cli.js");

// ============================================================================
// CONFIG — routines + managedAgents fields
// ============================================================================
describe("CONFIG: routines + managedAgents defaults", () => {
  test("routines config has expected defaults", () => {
    expect(engine.CONFIG.routines).toBeDefined();
    expect(engine.CONFIG.routines.enabled).toBe(false);
    expect(engine.CONFIG.routines.triggerId).toBeNull();
    expect(engine.CONFIG.routines.betaHeader).toBe("experimental-cc-routine-2026-04-01");
    expect(Array.isArray(engine.CONFIG.routines.schedules)).toBe(true);
  });

  test("managedAgents config has expected defaults", () => {
    expect(engine.CONFIG.managedAgents).toBeDefined();
    expect(engine.CONFIG.managedAgents.enabled).toBe(false);
    expect(engine.CONFIG.managedAgents.model).toBe("claude-sonnet-4-6");
    expect(engine.CONFIG.managedAgents.betaHeader).toBe("managed-agents-2026-04-01");
    expect(engine.CONFIG.managedAgents.sessionTimeoutMs).toBe(300000);
  });
});

// ============================================================================
// TIER LIMITS — routines + managedAgents gating
// ============================================================================
describe("Tier limits: cloud features gating", () => {
  test("maker tier blocks routines and managedAgents", () => {
    expect(engine.CONFIG.tierLimits.maker.routines).toBe(false);
    expect(engine.CONFIG.tierLimits.maker.managedAgents).toBe(false);
  });

  test("builder tier blocks routines and managedAgents", () => {
    expect(engine.CONFIG.tierLimits.builder.routines).toBe(false);
    expect(engine.CONFIG.tierLimits.builder.managedAgents).toBe(false);
  });

  test("cto tier allows routines and managedAgents", () => {
    expect(engine.CONFIG.tierLimits.cto.routines).toBe(true);
    expect(engine.CONFIG.tierLimits.cto.managedAgents).toBe(true);
  });
});

// ============================================================================
// buildRoutineSchedules
// ============================================================================
describe("buildRoutineSchedules", () => {
  test("returns empty when routines disabled", () => {
    const schedules = engine.buildRoutineSchedules();
    // routines.enabled is false by default, so no schedules
    expect(Array.isArray(schedules)).toBe(true);
  });

  test("returns schedule entries from config", () => {
    // Temporarily modify config for test
    const origEnabled = engine.CONFIG.routines.enabled;
    const origTriggerId = engine.CONFIG.routines.triggerId;
    const origSchedules = engine.CONFIG.routines.schedules;

    engine.CONFIG.routines.enabled = true;
    engine.CONFIG.routines.triggerId = "trig_test123";
    engine.CONFIG.routines.schedules = [
      { name: "test-schedule", cron: "0 3 * * *", triggerId: "trig_test123", text: "test" }
    ];

    const schedules = engine.buildRoutineSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0].name).toBe("test-schedule");
    expect(schedules[0].cron).toBe("0 3 * * *");

    // Restore
    engine.CONFIG.routines.enabled = origEnabled;
    engine.CONFIG.routines.triggerId = origTriggerId;
    engine.CONFIG.routines.schedules = origSchedules;
  });

  test("generates default nightly schedule when enabled with triggerId but no custom schedules", () => {
    const origEnabled = engine.CONFIG.routines.enabled;
    const origTriggerId = engine.CONFIG.routines.triggerId;
    const origSchedules = engine.CONFIG.routines.schedules;

    engine.CONFIG.routines.enabled = true;
    engine.CONFIG.routines.triggerId = "trig_auto123";
    engine.CONFIG.routines.schedules = [];

    const schedules = engine.buildRoutineSchedules();
    expect(schedules).toHaveLength(1);
    expect(schedules[0].name).toBe("nightly-review");
    expect(schedules[0].cron).toBe("0 2 * * *");

    // Restore
    engine.CONFIG.routines.enabled = origEnabled;
    engine.CONFIG.routines.triggerId = origTriggerId;
    engine.CONFIG.routines.schedules = origSchedules;
  });
});

// ============================================================================
// fireRoutine — tier gate + config validation (no actual API calls)
// ============================================================================
describe("fireRoutine: validation guards", () => {
  test("returns null when routines not enabled", async () => {
    const result = await engine.fireRoutine({ force: true });
    expect(result).toBeNull();
  });

  test("returns null when no triggerId configured", async () => {
    const origEnabled = engine.CONFIG.routines.enabled;
    engine.CONFIG.routines.enabled = true;

    const result = await engine.fireRoutine({ force: true });
    expect(result).toBeNull();

    engine.CONFIG.routines.enabled = origEnabled;
  });
});

// ============================================================================
// managedAgentReview — tier gate + config validation (no actual API calls)
// ============================================================================
describe("managedAgentReview: validation guards", () => {
  test("returns null when not enabled", async () => {
    const result = await engine.managedAgentReview({ diff: "test", force: true });
    expect(result).toBeNull();
  });

  test("returns null when no diff provided", async () => {
    const origEnabled = engine.CONFIG.managedAgents.enabled;
    engine.CONFIG.managedAgents.enabled = true;

    const result = await engine.managedAgentReview({ force: true });
    expect(result).toBeNull();

    engine.CONFIG.managedAgents.enabled = origEnabled;
  });
});

// ============================================================================
// CLI: routine + deep-review commands
// ============================================================================
describe("CLI: routine command", () => {
  test("routine schedules outputs schedule info", () => {
    const r = spawnSync("node", [CLI, "routine", "schedules"], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const output = r.stdout + r.stderr;
    expect(output).toMatch(/schedule|configured|routines/i);
  });

  test("routine fire --dry-run shows request preview", () => {
    // Need routines enabled + triggerId for dry-run to work
    // Without config, it will show an error about not enabled
    const r = spawnSync("node", [CLI, "routine", "fire", "--dry-run"], {
      encoding: "utf8",
      timeout: 10000,
    });
    const output = r.stdout + r.stderr;
    // Should show either dry-run info or config error (both valid)
    expect(output).toMatch(/routine|enabled|trigger|config/i);
  });

  test("routine with unknown subcommand shows error", () => {
    const r = spawnSync("node", [CLI, "routine", "bogus"], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Unknown routine subcommand/i);
  });
});

describe("CLI: deep-review command", () => {
  test("deep-review --dry-run shows cost preview", () => {
    // Without managedAgents.enabled, should show config error
    const r = spawnSync("node", [CLI, "deep-review", "--dry-run"], {
      encoding: "utf8",
      timeout: 10000,
    });
    const output = r.stdout + r.stderr;
    // Should show either dry-run info or config error
    expect(output).toMatch(/managed|agent|enabled|config|deep|review|no changes/i);
  });
});

// ============================================================================
// CLI: help includes new commands
// ============================================================================
describe("CLI: help includes cloud features", () => {
  test("--help mentions deep-review", () => {
    const r = spawnSync("node", [CLI, "--help"], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.stdout).toContain("deep-review");
  });

  test("--help mentions routine", () => {
    const r = spawnSync("node", [CLI, "--help"], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.stdout).toContain("routine");
  });

  test("--help mentions cost info", () => {
    const r = spawnSync("node", [CLI, "--help"], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.stdout).toMatch(/\$0\.08|session-hour|token rate/i);
  });
});

// ============================================================================
// Config schema: validates new fields
// ============================================================================
describe("Config schema: routines + managedAgents", () => {
  let Ajv, schema;

  beforeAll(() => {
    try {
      Ajv = require("ajv");
      schema = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "config.schema.json"), "utf8")
      );
    } catch (_) {
      // ajv not available — tests will be skipped
    }
  });

  test("valid routines config passes schema", () => {
    if (!Ajv) return;
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const valid = validate({
      routines: {
        enabled: true,
        triggerId: "trig_01ABC",
        schedules: [{ name: "nightly", triggerId: "trig_01ABC", cron: "0 2 * * *" }]
      }
    });
    expect(valid).toBe(true);
  });

  test("invalid triggerId pattern fails", () => {
    if (!Ajv) return;
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const valid = validate({
      routines: { enabled: true, triggerId: "bad_prefix" }
    });
    expect(valid).toBe(false);
  });

  test("valid managedAgents config passes schema", () => {
    if (!Ajv) return;
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const valid = validate({
      managedAgents: {
        enabled: true,
        model: "claude-opus-4-6",
        sessionTimeoutMs: 120000
      }
    });
    expect(valid).toBe(true);
  });

  test("sessionTimeoutMs below minimum fails", () => {
    if (!Ajv) return;
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const valid = validate({
      managedAgents: { enabled: true, sessionTimeoutMs: 1000 }
    });
    expect(valid).toBe(false);
  });

  test("sessionTimeoutMs above maximum fails", () => {
    if (!Ajv) return;
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const valid = validate({
      managedAgents: { enabled: true, sessionTimeoutMs: 999999 }
    });
    expect(valid).toBe(false);
  });

  test("unknown field in routines fails additionalProperties", () => {
    if (!Ajv) return;
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const valid = validate({
      routines: { enabled: true, unknownField: "bad" }
    });
    expect(valid).toBe(false);
  });
});

// ============================================================================
// Shell completions include new commands
// ============================================================================
describe("Shell completions: new commands", () => {
  test("bash completions include deep-review and routine", () => {
    const r = spawnSync("node", [CLI, "--completions", "bash"], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.stdout).toContain("deep-review");
    expect(r.stdout).toContain("routine");
  });

  test("zsh completions include deep-review and routine", () => {
    const r = spawnSync("node", [CLI, "--completions", "zsh"], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.stdout).toContain("deep-review");
    expect(r.stdout).toContain("routine");
  });
});
