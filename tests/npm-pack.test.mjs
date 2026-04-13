import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";

describe("npm pack", () => {
  it("produces a tarball with required files", () => {
    const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    expect(r.status).toBe(0);

    const output = JSON.parse(r.stdout);
    const files = output[0].files.map((f) => f.path);

    // Critical files must be in the package
    expect(files).toContain("bin/cli.js");
    expect(files).toContain("package.json");
    expect(files).toContain("README.md");
    expect(files).toContain("failure-catalog.json");
    expect(files).toContain("failure-catalog.schema.json");

    // Skills must be included
    const skillFiles = files.filter((f) => f.startsWith("skills/"));
    expect(skillFiles.length).toBeGreaterThan(0);

    // Templates must be included
    const templateFiles = files.filter((f) => f.startsWith("templates/"));
    expect(templateFiles.length).toBeGreaterThan(0);

    // Docs must be included
    const docFiles = files.filter((f) => f.startsWith("docs/"));
    expect(docFiles.length).toBeGreaterThan(0);
  });

  it("does not include test or CI files", () => {
    const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    const output = JSON.parse(r.stdout);
    const files = output[0].files.map((f) => f.path);

    const testFiles = files.filter((f) => f.startsWith("tests/"));
    // Only flag top-level .github/ files (repo's own CI), not templates/*/.github/ (legitimate template payload)
    const workflowFiles = files.filter((f) => f.startsWith(".github/"));

    expect(testFiles.length).toBe(0);
    expect(workflowFiles.length).toBe(0);
  });
});
