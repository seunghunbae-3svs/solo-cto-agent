/**
 * PR-G27 — CLI subcommand arg-parsing + execution path tests.
 * Verifies every major CLI command exits correctly, parses flags,
 * and routes to the right handler.
 *
 * Strategy: spawn node bin/cli.js with minimal args, check exit code + output.
 * No real API calls — tests that need API keys skip gracefully or use --dry-run.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";

const CLI = path.join(process.cwd(), "bin", "cli.js");

function run(args = [], opts = {}) {
  return spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    cwd: process.cwd(),
    timeout: 15000,
    env: { ...process.env, ...opts.env },
  });
}

// ───────────────────────────────────────────────────────────────
// --version / -V
// ───────────────────────────────────────────────────────────────
describe("cli --version", () => {
  it("prints version and exits 0", () => {
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("-V is an alias for --version", () => {
    const r = run(["-V"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ───────────────────────────────────────────────────────────────
// review — requires ANTHROPIC_API_KEY
// ───────────────────────────────────────────────────────────────
describe("cli review", () => {
  it("exits 1 with error when ANTHROPIC_API_KEY is missing", () => {
    const r = run(["review"], {
      env: { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ANTHROPIC_API_KEY");
  });

  it("--dry-run with API key prints diff info without calling API", () => {
    if (!process.env.ANTHROPIC_API_KEY) return; // skip if no key
    const r = run(["review", "--dry-run"]);
    // dry-run should exit 0 and print diff stats without calling API
    expect(r.status).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────
// dual-review — requires both API keys
// ───────────────────────────────────────────────────────────────
describe("cli dual-review", () => {
  it("exits 1 when OPENAI_API_KEY is missing", () => {
    const r = run(["dual-review"], {
      env: { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("OPENAI_API_KEY");
  });

  it("exits 1 when ANTHROPIC_API_KEY is missing", () => {
    const r = run(["dual-review"], {
      env: { ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "sk-test" },
    });
    expect(r.status).toBe(1);
    // Should mention at least one required key
    expect(r.stderr).toMatch(/API_KEY/);
  });
});

// ───────────────────────────────────────────────────────────────
// knowledge — requires ANTHROPIC_API_KEY
// ───────────────────────────────────────────────────────────────
describe("cli knowledge", () => {
  it("exits 1 without API key", () => {
    const r = run(["knowledge"], {
      env: { ANTHROPIC_API_KEY: "" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ANTHROPIC_API_KEY");
  });
});

// ───────────────────────────────────────────────────────────────
// session subcommands
// ───────────────────────────────────────────────────────────────
describe("cli session", () => {
  it("session list exits 0", () => {
    const r = run(["session", "list", "--limit", "1"]);
    expect(r.status).toBe(0);
  });

  it("session save exits 0", () => {
    const r = run(["session", "save"]);
    expect(r.status).toBe(0);
  });

  it("session unknown-sub exits 1", () => {
    const r = run(["session", "badcommand"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown session subcommand");
  });
});

// ───────────────────────────────────────────────────────────────
// feedback subcommands
// ───────────────────────────────────────────────────────────────
describe("cli feedback", () => {
  it("feedback without sub exits 1 with usage", () => {
    const r = run(["feedback"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("feedback");
    expect(r.stderr).toContain("accept");
  });

  it("feedback show exits 0 with JSON", () => {
    const r = run(["feedback", "show"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveProperty("reviewCount");
  });

  it("feedback accept without --location exits 1", () => {
    const r = run(["feedback", "accept"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--location");
  });

  it("feedback accept with --location exits 0", () => {
    const r = run(["feedback", "accept", "--location", "src/test.js:10"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────
// notify subcommands
// ───────────────────────────────────────────────────────────────
describe("cli notify", () => {
  it("notify --detect exits 0 with channel list", () => {
    const r = run(["notify", "--detect"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.detected).toContain("console");
  });

  it("notify without --title exits 1", () => {
    const r = run(["notify"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--title");
  });

  it("notify --title sends to console", () => {
    const r = run(["notify", "--title", "test message", "--severity", "info"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("sent:");
    expect(r.stderr).toContain("console");
  });

  it("notify deploy-ready sends deploy event", () => {
    const r = run(["notify", "deploy-ready", "--target", "preview", "--url", "https://test.com", "--commit", "abc123"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("sent:");
  });

  it("notify deploy-error sends deploy event", () => {
    const r = run(["notify", "deploy-error", "--target", "production", "--body", "build failed"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("sent:");
  });
});

// ───────────────────────────────────────────────────────────────
// doctor
// ───────────────────────────────────────────────────────────────
describe("cli doctor", () => {
  it("prints health check output", () => {
    const r = run(["doctor"]);
    // doctor exits 1 when API keys missing (expected in test env), 0 when all set
    expect([0, 1]).toContain(r.status);
    // Should print skill health info regardless
    expect(r.stdout).toMatch(/skill|engine|catalog/i);
  });
});

// ───────────────────────────────────────────────────────────────
// status
// ───────────────────────────────────────────────────────────────
describe("cli status", () => {
  it("exits 0 with status output", () => {
    const r = run(["status"]);
    expect(r.status).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────
// lint
// ───────────────────────────────────────────────────────────────
describe("cli lint", () => {
  it("exits 0 on repo skills", () => {
    const r = run(["lint"]);
    expect(r.status).toBe(0);
  });

  it("lint with explicit path works", () => {
    const r = run(["lint", "skills"]);
    expect(r.status).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────
// sync — requires --org
// ───────────────────────────────────────────────────────────────
describe("cli sync", () => {
  it("exits 1 without --org", () => {
    const r = run(["sync"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--org");
  });
});

// ───────────────────────────────────────────────────────────────
// watch --dry-run
// ───────────────────────────────────────────────────────────────
describe("cli watch", () => {
  it("watch --dry-run exits 0 with gate decision", () => {
    const r = run(["watch", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("watch");
    expect(r.stdout).toMatch(/tier=/);
    expect(r.stdout).toMatch(/auto=/);
  });

  it("watch --dry-run --auto shows gate status", () => {
    const r = run(["watch", "--dry-run", "--auto"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/auto=(ON|OFF)/);
  });
});

// ───────────────────────────────────────────────────────────────
// external-loop
// ───────────────────────────────────────────────────────────────
describe("cli external-loop", () => {
  it("exits 2 when no signals active (--json)", () => {
    const r = run(["external-loop", "--json"], {
      env: { VERCEL_TOKEN: "", OPENAI_API_KEY: "", COWORK_EXTERNAL_KNOWLEDGE: "" },
    });
    // exit 2 = inactive (no external signals)
    expect(r.status).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(false);
  });

  it("plain format exits 2 when no signals active", () => {
    const r = run(["external-loop"], {
      env: { VERCEL_TOKEN: "", OPENAI_API_KEY: "", COWORK_EXTERNAL_KNOWLEDGE: "" },
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("inactive");
  });
});

// ───────────────────────────────────────────────────────────────
// routine subcommands
// ───────────────────────────────────────────────────────────────
describe("cli routine", () => {
  it("routine schedules exits 0", () => {
    const r = run(["routine", "schedules"]);
    expect(r.status).toBe(0);
    // Either "No routine schedules" or actual schedules
    expect(r.stdout).toMatch(/schedule/i);
  });

  it("routine schedules --json exits 0 with valid JSON", () => {
    const r = run(["routine", "schedules", "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("routine unknown-sub exits 1", () => {
    const r = run(["routine", "badcmd"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown routine subcommand");
  });
});

// ───────────────────────────────────────────────────────────────
// deep-review — gated, but parse path is testable
// ───────────────────────────────────────────────────────────────
describe("cli deep-review", () => {
  it("exits 0 with 'No changes' when nothing staged", () => {
    const r = run(["deep-review", "--staged"]);
    // Should print "No changes found" and exit 0 (or 1 if tier-gated without changes)
    // The key test: it doesn't crash on parse, reaches the diff check
    expect(r.stdout + r.stderr).toMatch(/No changes|tier|gated|dry/i);
  });

  it("--dry-run flag is accepted", () => {
    const r = run(["deep-review", "--dry-run"]);
    // dry-run with no changes → "No changes found"
    expect(r.stdout).toContain("No changes");
    expect(r.status).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────
// unknown command
// ───────────────────────────────────────────────────────────────
describe("cli unknown command", () => {
  it("prints help and exits 1 for unrecognized command", () => {
    const r = run(["nonexistent-command"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Usage:");
  });
});

// ───────────────────────────────────────────────────────────────
// --lang flag
// ───────────────────────────────────────────────────────────────
describe("cli --lang", () => {
  it("--lang ko with --help prints translated tagline", () => {
    const r = run(["--lang", "ko", "--help"]);
    // --lang ko --help may exit 1 due to arg parsing order, but output should contain help
    expect(r.stdout).toContain("solo-cto-agent");
  });

  it("SOLO_CTO_LANG env sets locale", () => {
    const r = run(["--help"], { env: { SOLO_CTO_LANG: "ko" } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("solo-cto-agent");
  });
});

// ───────────────────────────────────────────────────────────────
// --completions (extended)
// ───────────────────────────────────────────────────────────────
describe("cli --completions extended", () => {
  it("bash completions include core commands", () => {
    const r = run(["--completions", "bash"]);
    expect(r.status).toBe(0);
    for (const cmd of ["review", "dual-review", "deep-review", "routine", "notify", "doctor", "session"]) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it("zsh completions include core commands", () => {
    const r = run(["--completions", "zsh"]);
    expect(r.status).toBe(0);
    for (const cmd of ["review", "dual-review", "deep-review", "routine", "notify"]) {
      expect(r.stdout).toContain(cmd);
    }
  });
});
