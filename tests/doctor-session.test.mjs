import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const CLI = path.join(process.cwd(), "bin", "cli.js");

function run(args = [], env = {}) {
  return spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });
}

describe("cli doctor", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sca-doctor-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs without crashing even with no skills installed", () => {
    const r = run(["doctor"], { HOME: tmpDir, USERPROFILE: tmpDir });
    // Exit code 1 is expected when skills missing; we just need it to not crash
    expect([0, 1]).toContain(r.status);
    expect(r.stdout).toContain("doctor");
    expect(r.stdout).toContain("Skills");
    expect(r.stdout).toContain("Engine");
    expect(r.stdout).toContain("API Keys");
  });

  it("reports cowork-main mode when SKILL.md has mode: cowork-main", () => {
    // Install skills first
    run(["init"], { HOME: tmpDir, USERPROFILE: tmpDir });

    const skillPath = path.join(tmpDir, ".claude", "skills", "solo-cto-agent", "SKILL.md");
    const withMode = `---
name: solo-cto-agent
description: "test"
mode: cowork-main
user-invocable: true
---

# Project Stack
| Item | Value |
|---|---|
| OS | Linux |
`;
    fs.writeFileSync(skillPath, withMode);

    const r = run(["doctor"], { HOME: tmpDir, USERPROFILE: tmpDir });
    expect(r.stdout).toContain("cowork-main");
  });

  it("reports help for doctor in --help", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("doctor");
  });

  it("supports doctor --quick with actionable links", () => {
    const r = run(["doctor", "--quick"], { HOME: tmpDir, USERPROFILE: tmpDir });
    expect([0, 1]).toContain(r.status);
    expect(r.stdout).toContain("doctor --quick");
    expect(r.stdout).toContain("https://console.anthropic.com/settings/keys");
    expect(r.stdout).toContain("Template Audit");
  });

  it("shows codex-main setup links when mode is codex-main", () => {
    run(["init"], { HOME: tmpDir, USERPROFILE: tmpDir });
    const skillPath = path.join(tmpDir, ".claude", "skills", "solo-cto-agent", "SKILL.md");
    fs.writeFileSync(
      skillPath,
      `---
name: solo-cto-agent
description: "test"
mode: codex-main
user-invocable: true
---

# Project Stack
| Item | Value |
|---|---|
| OS | Windows |
`
    );
    const r = run(["doctor", "--quick"], { HOME: tmpDir, USERPROFILE: tmpDir });
    expect(r.stdout).toContain("GitHub CLI");
    expect(r.stdout).toContain("GitHub PAT");
    expect(r.stdout).toContain("docs/codex-main-install.md");
  });
});

describe("cli session", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sca-session-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("session save creates a session file with project tag", () => {
    run(["init"], { HOME: tmpDir, USERPROFILE: tmpDir });
    const r = run(["session", "save", "--project", "testproj"], {
      HOME: tmpDir,
      USERPROFILE: tmpDir,
    });
    expect(r.status).toBe(0);

    const sessionsDir = path.join(
      tmpDir,
      ".claude",
      "skills",
      "solo-cto-agent",
      "sessions"
    );
    expect(fs.existsSync(sessionsDir)).toBe(true);
    const files = fs.readdirSync(sessionsDir);
    // Should have at least one session file + latest.json
    expect(files.some((f) => f.endsWith("-session.json"))).toBe(true);
    expect(files.includes("latest.json")).toBe(true);
  });

  it("session list runs without error on empty state", () => {
    const r = run(["session", "list"], { HOME: tmpDir, USERPROFILE: tmpDir });
    // Should not crash
    expect([0, 1]).toContain(r.status);
  });

  it("session restore returns no-op when empty", () => {
    const r = run(["session", "restore"], {
      HOME: tmpDir,
      USERPROFILE: tmpDir,
    });
    // Should not crash even when no sessions exist
    expect([0, 1]).toContain(r.status);
  });

  it("session commands appear in --help", () => {
    const r = run(["--help"]);
    expect(r.stdout).toContain("session");
  });
});

describe("cli mode-aware guards", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sca-mode-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("setup-pipeline shows cowork-main guard when mode is cowork-main", () => {
    run(["init"], { HOME: tmpDir, USERPROFILE: tmpDir });

    // Set mode to cowork-main
    const skillPath = path.join(
      tmpDir,
      ".claude",
      "skills",
      "solo-cto-agent",
      "SKILL.md"
    );
    fs.writeFileSync(
      skillPath,
      `---
name: solo-cto-agent
description: "test"
mode: cowork-main
user-invocable: true
---
# Project Stack
`
    );

    const r = run(["setup-pipeline", "--org", "test"], {
      HOME: tmpDir,
      USERPROFILE: tmpDir,
    });
    // Should show guard message (soft guard, may still exit with 0 or produce info)
    const combined = (r.stdout + r.stderr).toLowerCase();
    expect(combined).toMatch(/cowork-main|not needed|review.*knowledge.*sync/);
  });
});
