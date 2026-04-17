import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const CLI = path.join(process.cwd(), "bin", "cli.js");

function run(args = [], { env = {}, cwd = process.cwd() } = {}) {
  return spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, ...env },
  });
}

describe("template-audit --apply", () => {
  let tmpHome;
  let tmpRepo;
  let baseEnv;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "sca-apply-home-"));
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "sca-apply-repo-"));
    baseEnv = { HOME: tmpHome, USERPROFILE: tmpHome };
    fs.writeFileSync(
      path.join(tmpRepo, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { "next-auth": "1.0.0" } }, null, 2)
    );
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it("applies fixes by restoring missing files", () => {
    const setup = run(["setup-repo", tmpRepo, "--org", "demo", "--tier", "builder"], { env: baseEnv });
    expect(setup.status).toBe(0);

    // Remove a critical file to test MISSING status
    const workflowPath = path.join(tmpRepo, ".github", "workflows", "claude-auto.yml");
    const originalContent = fs.readFileSync(workflowPath, "utf8");
    fs.rmSync(workflowPath, { force: true });

    // Verify it's missing
    const auditBefore = run(["template-audit"], { env: baseEnv });
    expect(auditBefore.status).toBe(0);
    expect(auditBefore.stdout).toContain("Missing files:    1");

    // Run dry-run apply
    const dryRun = run(["template-audit", "--apply", "--dry-run"], { env: baseEnv });
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).toContain("Applying fixes");
    expect(dryRun.stdout).toContain("DRY RUN");
    expect(dryRun.stdout).toContain("Fixed:   1");

    // Verify file wasn't created in dry-run
    expect(fs.existsSync(workflowPath)).toBe(false);

    // Apply the fix
    const apply = run(["template-audit", "--apply"], { env: baseEnv });
    expect(apply.status).toBe(0);
    expect(apply.stdout).toContain("Applying fixes");
    expect(apply.stdout).toContain("Fixed:   1");
    expect(apply.stdout).not.toContain("DRY RUN");

    // Verify file was created
    expect(fs.existsSync(workflowPath)).toBe(true);
    const recreatedContent = fs.readFileSync(workflowPath, "utf8");
    expect(recreatedContent).toEqual(originalContent);

    // Verify audit is now clean
    const auditAfter = run(["template-audit"], { env: baseEnv });
    expect(auditAfter.status).toBe(0);
    expect(auditAfter.stdout).toContain("Missing files:    0");
  });

  it("creates missing files with --apply", () => {
    const setup = run(["setup-repo", tmpRepo, "--org", "demo", "--tier", "builder"], { env: baseEnv });
    expect(setup.status).toBe(0);

    // Remove a file to simulate missing
    const workflowPath = path.join(tmpRepo, ".github", "workflows", "claude-auto.yml");
    fs.rmSync(workflowPath, { force: true });

    // Verify it's missing
    const auditBefore = run(["template-audit"], { env: baseEnv });
    expect(auditBefore.status).toBe(0);
    expect(auditBefore.stdout).toContain("Missing files:    1");

    // Apply the fix
    const apply = run(["template-audit", "--apply"], { env: baseEnv });
    expect(apply.status).toBe(0);
    expect(apply.stdout).toContain("Fixed:   1");

    // Verify file was created
    expect(fs.existsSync(workflowPath)).toBe(true);

    // Verify audit is now clean
    const auditAfter = run(["template-audit"], { env: baseEnv });
    expect(auditAfter.status).toBe(0);
    expect(auditAfter.stdout).toContain("Missing files:    0");
  });

  it("skips customized files when applying fixes", () => {
    const setup = run(["setup-repo", tmpRepo, "--org", "demo", "--tier", "builder"], { env: baseEnv });
    expect(setup.status).toBe(0);

    // Customize a file by changing its content significantly
    const workflowPath = path.join(tmpRepo, ".github", "workflows", "claude-auto.yml");
    fs.writeFileSync(workflowPath, "name: custom\n", "utf8");

    // Verify it's customized (not drifted, but actual content changed)
    const auditBefore = run(["template-audit"], { env: baseEnv });
    expect(auditBefore.status).toBe(0);
    expect(auditBefore.stdout).toContain("Customized files: 1");

    // Apply the fix
    const apply = run(["template-audit", "--apply"], { env: baseEnv });
    expect(apply.status).toBe(0);
    expect(apply.stdout).toContain("Skipped: 1");

    // Verify file was NOT changed (customization preserved)
    const afterApply = fs.readFileSync(workflowPath, "utf8");
    expect(afterApply).toEqual("name: custom\n");
  });
});
