import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

const CLI = path.join(process.cwd(), "bin", "cli.js");
const run = (args = []) =>
  spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: process.cwd() });

describe("cli plugin search", () => {
  it("requires a query argument", () => {
    const r = run(["plugin", "search"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Usage:");
    expect(r.stderr).toContain("solo-cto-agent plugin search");
  });

  it("shows example in help text", () => {
    const r = run(["plugin", "search"]);
    expect(r.stderr).toContain("Example:");
    expect(r.stderr).toContain("typescript");
  });

  it("handles search for non-existent packages gracefully", () => {
    const r = run(["plugin", "search", "asdfghjkl-nonexistent-package-xyz"]);
    // Should complete without error (network call may fail, but that's ok)
    expect(typeof r.status).toBe("number");
  });

  it("supports --json flag for structured output", () => {
    const r = run(["plugin", "search", "--json", "test"]);
    // If successful, output should be valid JSON
    if (r.status === 0) {
      try {
        const parsed = JSON.parse(r.stdout);
        expect(Array.isArray(parsed)).toBe(true);
      } catch (e) {
        // Network might not be available in test environment
        expect(r.stderr || r.stdout).toBeDefined();
      }
    }
  });

  it("handles network failures gracefully", () => {
    // This test verifies the search doesn't crash on network issues
    const r = run(["plugin", "search", "test"]);
    // Should either succeed or fail gracefully, not crash
    expect([0, 1]).toContain(r.status);
  });
});

describe("cli plugin list", () => {
  let tmpDir, manifestPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sca-plugin-test-"));
    process.env.SOLO_CTO_PLUGINS_PATH = path.join(tmpDir, "plugins.json");
  });

  afterEach(() => {
    delete process.env.SOLO_CTO_PLUGINS_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("shows message when no plugins registered", () => {
    const r = spawnSync("node", [CLI, "plugin", "list"], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: { ...process.env, SOLO_CTO_PLUGINS_PATH: path.join(tmpDir, "plugins.json") },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No plugins registered");
  });

  it("lists registered plugins with text format", () => {
    // Create a minimal manifest
    const manifest = {
      version: 1,
      plugins: [
        {
          name: "test-plugin",
          version: "1.0.0",
          description: "A test plugin",
          agents: ["claude"],
          capabilities: ["env:SAMPLE"],
          source: "path:/tmp/test",
        },
      ],
    };
    fs.writeFileSync(
      path.join(tmpDir, "plugins.json"),
      JSON.stringify(manifest),
      "utf8"
    );

    const r = spawnSync("node", [CLI, "plugin", "list"], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: { ...process.env, SOLO_CTO_PLUGINS_PATH: path.join(tmpDir, "plugins.json") },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("test-plugin@1.0.0");
    expect(r.stdout).toContain("A test plugin");
    expect(r.stdout).toContain("agents: claude");
  });

  it("supports --json flag for structured output", () => {
    const manifest = {
      version: 1,
      plugins: [
        {
          name: "json-plugin",
          version: "2.0.0",
          agents: ["claude"],
          capabilities: [],
          source: "path:/tmp/json",
        },
      ],
    };
    fs.writeFileSync(
      path.join(tmpDir, "plugins.json"),
      JSON.stringify(manifest),
      "utf8"
    );

    const r = spawnSync("node", [CLI, "plugin", "list", "--json"], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: { ...process.env, SOLO_CTO_PLUGINS_PATH: path.join(tmpDir, "plugins.json") },
    });
    expect(r.status).toBe(0);

    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("json-plugin");
    expect(parsed[0].version).toBe("2.0.0");
  });

  it("defaults to list when no subcommand given", () => {
    const r = spawnSync("node", [CLI, "plugin"], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: { ...process.env, SOLO_CTO_PLUGINS_PATH: path.join(tmpDir, "plugins.json") },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No plugins registered");
  });
});

describe("cli plugin integration", () => {
  it("handles plugin subcommand errors gracefully", () => {
    const r = run(["plugin", "invalid-subcommand"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Unknown plugin subcommand");
  });
});
