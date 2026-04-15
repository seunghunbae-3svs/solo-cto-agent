/**
 * E2E integration tests — exercise full CLI workflows in a real git repo
 * without making API calls. Tests the init → doctor → review --dry-run →
 * status → session save/restore pipeline end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const CLI = path.join(process.cwd(), "bin", "cli.js");
const run = (args, env = {}) =>
  spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    timeout: 30000,
  });

let tmpHome;
let tmpRepo;

beforeAll(() => {
  // Create isolated HOME so init doesn't touch real ~/.claude
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-home-"));

  // Create a real git repo with a staged change for review testing
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-repo-"));
  execSync("git init", { cwd: tmpRepo });
  execSync('git config user.email "test@test.com"', { cwd: tmpRepo });
  execSync('git config user.name "Test"', { cwd: tmpRepo });
  fs.writeFileSync(path.join(tmpRepo, "index.js"), 'console.log("hello");\n');
  execSync("git add index.js", { cwd: tmpRepo });
  execSync('git commit -m "initial"', { cwd: tmpRepo });
  // Stage a change for review
  fs.writeFileSync(path.join(tmpRepo, "index.js"), 'console.log("hello world");\n');
  execSync("git add index.js", { cwd: tmpRepo });
});

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpRepo, { recursive: true, force: true });
});

const homeEnv = { HOME: tmpHome, USERPROFILE: tmpHome };

// ===========================================================================
// 1. Full init → doctor → status pipeline
// ===========================================================================
describe("E2E: init → doctor → status pipeline", () => {
  it("init installs skills to isolated HOME", () => {
    const r = spawnSync("node", [CLI, "init", "--preset", "builder"], {
      encoding: "utf8",
      env: { ...process.env, ...homeEnv },
    });
    expect(r.status).toBe(0);
    const output = r.stdout + r.stderr;
    expect(output).toMatch(/init|install|skills|copied/i);
  });

  it("doctor runs after init and reports findings", () => {
    const r = spawnSync("node", [CLI, "doctor"], {
      encoding: "utf8",
      env: { ...process.env, ...homeEnv },
    });
    // Doctor may exit 1 if API key not set, but it should still produce output
    const output = r.stdout + r.stderr;
    expect(output).toMatch(/doctor|check|skill|key|engine/i);
  });

  it("status reports installed skills", () => {
    const r = spawnSync("node", [CLI, "status"], {
      encoding: "utf8",
      env: { ...process.env, ...homeEnv },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Skills:");
  });
});

// ===========================================================================
// 2. Review --dry-run in real git repo
// ===========================================================================
describe("E2E: review --dry-run", () => {
  it("review --dry-run with staged changes shows prompt info", () => {
    const r = spawnSync("node", [CLI, "review", "--dry-run", "--staged"], {
      encoding: "utf8",
      cwd: tmpRepo,
      env: {
        ...process.env,
        ...homeEnv,
        ANTHROPIC_API_KEY: "sk-ant-test-fake-key",
      },
    });
    expect(r.status).toBe(0);
    const output = r.stdout + r.stderr;
    expect(output).toMatch(/DRY RUN|dry.run/i);
    expect(output).toMatch(/prompt|chars/i);
  });

  it("review without API key shows clear error message", () => {
    const r = spawnSync("node", [CLI, "review", "--dry-run", "--staged"], {
      encoding: "utf8",
      cwd: tmpRepo,
      env: {
        ...process.env,
        ...homeEnv,
        ANTHROPIC_API_KEY: "",
      },
    });
    // Without API key, review should fail with a clear error
    const output = r.stdout + r.stderr;
    expect(output).toMatch(/ANTHROPIC_API_KEY|API key/i);
  });
});

// ===========================================================================
// 3. Session save/restore/list cycle
// ===========================================================================
describe("E2E: session lifecycle", () => {
  it("session save creates a session file", () => {
    const r = spawnSync("node", [CLI, "session", "save", "--project", "e2e-test"], {
      encoding: "utf8",
      cwd: tmpRepo,
      env: { ...process.env, ...homeEnv },
    });
    expect(r.status).toBe(0);
    const output = r.stdout + r.stderr;
    expect(output).toMatch(/save|session/i);
  });

  it("session list shows saved sessions", () => {
    const r = spawnSync("node", [CLI, "session", "list", "--limit", "5"], {
      encoding: "utf8",
      env: { ...process.env, ...homeEnv },
    });
    expect(r.status).toBe(0);
    // Should list at least the session we just saved
    const output = r.stdout + r.stderr;
    expect(output).toMatch(/session|list|e2e-test|\.json/i);
  });

  it("session restore retrieves the saved session", () => {
    const r = spawnSync("node", [CLI, "session", "restore"], {
      encoding: "utf8",
      env: { ...process.env, ...homeEnv },
    });
    expect(r.status).toBe(0);
    const output = r.stdout + r.stderr;
    expect(output).toMatch(/restore|session|loaded/i);
  });
});

// ===========================================================================
// 4. Lint on the repo itself
// ===========================================================================
describe("E2E: lint", () => {
  it("lint passes on the solo-cto-agent repo", () => {
    const r = run(["lint"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("lint");
  });
});

// ===========================================================================
// 5. --version and --completions
// ===========================================================================
describe("E2E: meta commands", () => {
  it("--version returns semver", () => {
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("--completions bash outputs valid bash", () => {
    const r = run(["--completions", "bash"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("complete -F");
  });

  it("--completions zsh outputs valid zsh", () => {
    const r = run(["--completions", "zsh"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("#compdef");
  });
});

// ===========================================================================
// 6. Config file integration
// ===========================================================================
describe("E2E: config file", () => {
  it("runs with custom config file via SOLO_CTO_CONFIG", () => {
    const configDir = path.join(tmpHome, ".solo-cto-agent");
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({
      models: { claude: "custom-model-test" },
      diff: { maxChunkBytes: 75000 },
    }));

    // Status should still work with custom config (doctor may exit 1 for missing API key)
    const r = spawnSync("node", [CLI, "status"], {
      encoding: "utf8",
      env: { ...process.env, ...homeEnv, SOLO_CTO_CONFIG: configPath },
    });
    expect(r.status).toBe(0);
  });

  it("malformed config shows warning but doesn't crash", () => {
    const configPath = path.join(tmpHome, "bad-config.json");
    fs.writeFileSync(configPath, "{ not valid json !!!");

    const r = spawnSync("node", [CLI, "status"], {
      encoding: "utf8",
      env: { ...process.env, ...homeEnv, SOLO_CTO_CONFIG: configPath },
    });
    // Should still run (falls back to defaults)
    expect(r.status).toBe(0);
    // Warning should appear in stderr
    const output = r.stdout + r.stderr;
    expect(output).toMatch(/not valid JSON|Config|warn/i);
  });
});
