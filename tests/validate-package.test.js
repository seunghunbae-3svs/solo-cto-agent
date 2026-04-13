const { describe, it, expect } = require("vitest");
const { spawnSync } = require("child_process");

describe("validate-package.js", () => {
  it("passes on current repo", () => {
    const result = spawnSync("node", ["scripts/validate-package.js"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });
});
