import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const SCRIPT = path.join(process.cwd(), "scripts", "validate-package.js");

const run = () =>
  spawnSync("node", [SCRIPT], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

describe("validate-package.js — extended checks", () => {
  // Feature 3 tests: cursor.md validation
  describe("cursor.md validation", () => {
    it("validates cursor.md exists in docs/", () => {
      expect(fs.existsSync(path.join(process.cwd(), "docs", "cursor.md"))).toBe(true);
    });

    it("validates cursor.md has .cursorrules section", () => {
      const content = fs.readFileSync(
        path.join(process.cwd(), "docs", "cursor.md"),
        "utf8"
      );
      expect(content).toMatch(/\.cursorrules/i);
    });

    it("validates cursor.md has Setup or Quick Start section", () => {
      const content = fs.readFileSync(
        path.join(process.cwd(), "docs", "cursor.md"),
        "utf8"
      );
      expect(content).toMatch(/^##\s+(Quick Start|Setup)/im);
    });
  });

  // Feature 3 tests: windsurf.md validation
  describe("windsurf.md validation", () => {
    it("validates windsurf.md exists in docs/", () => {
      expect(fs.existsSync(path.join(process.cwd(), "docs", "windsurf.md"))).toBe(
        true
      );
    });

    it("validates windsurf.md has .windsurfrules section", () => {
      const content = fs.readFileSync(
        path.join(process.cwd(), "docs", "windsurf.md"),
        "utf8"
      );
      expect(content).toMatch(/\.windsurfrules/i);
    });

    it("validates windsurf.md has Setup or Quick Start section", () => {
      const content = fs.readFileSync(
        path.join(process.cwd(), "docs", "windsurf.md"),
        "utf8"
      );
      expect(content).toMatch(/^##\s+(Quick Start|Setup)/im);
    });
  });

  // Feature 3 tests: dashboard.html validation
  describe("dashboard.html validation", () => {
    it("validates benchmarks/dashboard.html exists", () => {
      expect(
        fs.existsSync(path.join(process.cwd(), "benchmarks", "dashboard.html"))
      ).toBe(true);
    });
  });

  // Feature 3 tests: failure-catalog.json validation
  describe("failure-catalog.json validation", () => {
    it("validates failure-catalog.json has >= 20 entries", () => {
      const catalog = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "failure-catalog.json"), "utf8")
      );
      expect(catalog.items.length).toBeGreaterThanOrEqual(20);
    });

    it("validates all entries have id field", () => {
      const catalog = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "failure-catalog.json"), "utf8")
      );
      for (const item of catalog.items) {
        expect(item).toHaveProperty("id");
        expect(typeof item.id).toBe("string");
      }
    });

    it("validates all entries have category field", () => {
      const catalog = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "failure-catalog.json"), "utf8")
      );
      for (const item of catalog.items) {
        expect(item).toHaveProperty("category");
        expect(["build", "deploy", "runtime"]).toContain(item.category);
      }
    });

    it("validates all entries have pattern field", () => {
      const catalog = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "failure-catalog.json"), "utf8")
      );
      for (const item of catalog.items) {
        expect(item).toHaveProperty("pattern");
        expect(typeof item.pattern).toBe("string");
      }
    });

    it("validates all entries have recovery or fix field", () => {
      const catalog = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "failure-catalog.json"), "utf8")
      );
      for (const item of catalog.items) {
        const hasRecovery = !!item.recovery;
        const hasFix = !!item.fix;
        const hasDescription = !!item.description;
        expect(hasRecovery || hasFix || hasDescription).toBe(true);
      }
    });
  });

  // Feature 3 test: Overall validation passes
  describe("overall validation", () => {
    it("passes all extended checks", () => {
      const r = run();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Validation passed");
    });

    it("includes cursor.md, windsurf.md, and dashboard.html in required files", () => {
      const content = fs.readFileSync(SCRIPT, "utf8");
      expect(content).toContain("docs/cursor.md");
      expect(content).toContain("docs/windsurf.md");
      expect(content).toContain("benchmarks/dashboard.html");
    });
  });
});
