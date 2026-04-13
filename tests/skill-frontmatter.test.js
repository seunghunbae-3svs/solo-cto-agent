const { describe, it, expect } = require("vitest");
const fs = require("fs");
const path = require("path");

function parseFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") {
    return { ok: false, reason: "missing opening frontmatter" };
  }
  const closeIndex = lines.slice(1).findIndex((l) => l.trim() === "---");
  if (closeIndex === -1) {
    return { ok: false, reason: "missing closing frontmatter" };
  }
  const fm = lines.slice(1, closeIndex + 1).join("\n");
  const hasName = /name:\s*\S+/i.test(fm);
  const hasDescription = /description:\s*.+/i.test(fm);
  return { ok: hasName && hasDescription, hasName, hasDescription };
}

describe("SKILL frontmatter", () => {
  it("all skills have name and description", () => {
    const skillsDir = path.join(process.cwd(), "skills");
    const dirs = fs.readdirSync(skillsDir).filter((d) =>
      fs.statSync(path.join(skillsDir, d)).isDirectory()
    );

    const failures = [];
    for (const dir of dirs) {
      const filePath = path.join(skillsDir, dir, "SKILL.md");
      const result = parseFrontmatter(filePath);
      if (!result.ok) {
        failures.push(`${dir}: ${result.reason || "missing fields"}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
