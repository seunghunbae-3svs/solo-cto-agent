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

describe("template audit", () => {
  let tmpHome;
  let tmpRepo;
  let baseEnv;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "sca-audit-home-"));
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "sca-audit-repo-"));
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

  it("registers managed repo entries and reports a clean audit after setup-repo", () => {
    const setup = run(["setup-repo", tmpRepo, "--org", "demo", "--tier", "builder"], { env: baseEnv });
    expect(setup.status).toBe(0);

    const manifestPath = path.join(tmpHome, ".claude", "skills", "solo-cto-agent", "managed-repos.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest.templateAudit.enabled).toBe(true);
    expect(manifest.templateAudit.mode).toBe("report-only");
    expect(manifest.templateAudit.schedule).toBe("daily");
    expect(manifest.repos).toHaveLength(1);
    expect(manifest.repos[0].files.some((file) => file.targetPath === ".github/workflows/claude-auto.yml")).toBe(true);

    const audit = run(["template-audit"], { env: baseEnv });
    expect(audit.status).toBe(0);
    expect(audit.stdout).toContain("Managed repos: 1");
    expect(audit.stdout).toContain("Drifted files:    0");
    expect(audit.stdout).toContain("Customized files: 0");
    expect(audit.stdout).toContain("Missing files:    0");
  });

  it("flags customized workflow files without overwriting them", () => {
    const setup = run(["setup-repo", tmpRepo, "--org", "demo", "--tier", "builder"], { env: baseEnv });
    expect(setup.status).toBe(0);

    const workflowPath = path.join(tmpRepo, ".github", "workflows", "claude-auto.yml");
    fs.appendFileSync(workflowPath, "\n# local customization\n", "utf8");

    const audit = run(["template-audit"], { env: baseEnv });
    expect(audit.status).toBe(0);
    expect(audit.stdout).toContain("Customized files: 1");
  });

  it("setup-pipeline creates orchestrator audit workflow and manifest by default", () => {
    const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "sca-audit-ws-"));
    try {
      const productRepo = path.join(tmpWorkspace, "app1");
      fs.mkdirSync(productRepo, { recursive: true });
      fs.writeFileSync(path.join(productRepo, "package.json"), JSON.stringify({ name: "app1" }, null, 2));

      const setup = run(
        ["setup-pipeline", "--org", "demo", "--tier", "builder", "--repos", "app1"],
        { env: baseEnv, cwd: tmpWorkspace }
      );
      expect(setup.status).toBe(0);

      const orchDir = path.join(tmpWorkspace, "dual-agent-orchestrator");
      expect(fs.existsSync(path.join(orchDir, ".github", "workflows", "template-audit.yml"))).toBe(true);
      expect(fs.existsSync(path.join(orchDir, "ops", "scripts", "template-audit.js"))).toBe(true);

      const orchManifestPath = path.join(orchDir, "ops", "orchestrator", "managed-repos.json");
      expect(fs.existsSync(orchManifestPath)).toBe(true);
      const orchManifest = JSON.parse(fs.readFileSync(orchManifestPath, "utf8"));
      expect(orchManifest.templateAudit.enabled).toBe(true);
      expect(orchManifest.templateAudit.schedule).toBe("daily");
      expect(orchManifest.repos.length).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    }
  });
});
