import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const CLI = path.join(process.cwd(), "bin", "cli.js");
const run = (args = []) =>
  spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: process.cwd() });

describe("cli --help", () => {
  it("prints usage and exits 0", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("solo-cto-agent");
    expect(r.stdout).toContain("init");
    expect(r.stdout).toContain("status");
  });

  it("prints help for unknown command", () => {
    const r = run(["unknown-cmd"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Usage:");
  });
});

describe("cli init", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sca-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scaffolds SKILL.md and failure-catalog.json", () => {
    const r = spawnSync("node", [CLI, "init"], {
      encoding: "utf8",
      env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("initialized");

    const skillDir = path.join(tmpDir, ".claude", "skills", "solo-cto-agent");
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillDir, "failure-catalog.json"))).toBe(true);

    // SKILL.md has valid frontmatter
    const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---/);
    expect(skill).toContain("name:");
    expect(skill).toContain("{{YOUR_OS}}");
  });

  it("does not overwrite existing files without --force", () => {
    // First init
    spawnSync("node", [CLI, "init"], {
      encoding: "utf8",
      env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
    });

    const skillPath = path.join(tmpDir, ".claude", "skills", "solo-cto-agent", "SKILL.md");
    fs.writeFileSync(skillPath, "custom content", "utf8");

    // Second init without --force
    spawnSync("node", [CLI, "init"], {
      encoding: "utf8",
      env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
    });

    expect(fs.readFileSync(skillPath, "utf8")).toBe("custom content");
  });

  it("overwrites existing files with --force", () => {
    spawnSync("node", [CLI, "init"], {
      encoding: "utf8",
      env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
    });

    const skillPath = path.join(tmpDir, ".claude", "skills", "solo-cto-agent", "SKILL.md");
    fs.writeFileSync(skillPath, "custom content", "utf8");

    spawnSync("node", [CLI, "init", "--force"], {
      encoding: "utf8",
      env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
    });

    expect(fs.readFileSync(skillPath, "utf8")).not.toBe("custom content");
  });
});

describe("cli status", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sca-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports not found when not initialized", () => {
    const r = spawnSync("node", [CLI, "status"], {
      encoding: "utf8",
      env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not found");
  });

  it("reports installed after init", () => {
    spawnSync("node", [CLI, "init"], {
      encoding: "utf8",
      env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
    });

    const r = spawnSync("node", [CLI, "status"], {
      encoding: "utf8",
      env: { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Skills:");
    expect(r.stdout).toContain("Error catalog:");
  });
});

describe("cli --completions", () => {
  it("outputs bash completions", () => {
    const r = run(["--completions", "bash"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("complete -F");
    expect(r.stdout).toContain("solo-cto-agent");
  });

  it("outputs zsh completions", () => {
    const r = run(["--completions", "zsh"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("#compdef");
    expect(r.stdout).toContain("solo-cto-agent");
  });

  it("defaults to bash when no shell specified", () => {
    const r = run(["--completions"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("complete -F");
  });
});

describe("cli lint", () => {
  it("passes on repo skills", () => {
    const r = run(["lint"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("lint");
  });
});
