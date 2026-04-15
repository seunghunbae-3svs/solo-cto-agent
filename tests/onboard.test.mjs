/**
 * tests/onboard.test.mjs — Unit tests for bin/onboard.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// We need to mock fs and https before requiring the module
let onboard;

describe("onboard module", () => {
  beforeEach(() => {
    // Fresh require for each test
    vi.resetModules();
    onboard = require("../bin/onboard.js");
  });

  describe("PRIORITIES", () => {
    it("defines P0-P4 levels", () => {
      expect(onboard.PRIORITIES).toBeDefined();
      expect(Object.keys(onboard.PRIORITIES)).toEqual(["P0", "P1", "P2", "P3", "P4"]);
    });

    it("each priority has label, icon, desc", () => {
      for (const [key, val] of Object.entries(onboard.PRIORITIES)) {
        expect(val).toHaveProperty("label");
        expect(val).toHaveProperty("icon");
        expect(val).toHaveProperty("desc");
        expect(typeof val.label).toBe("string");
        expect(typeof val.icon).toBe("string");
        expect(typeof val.desc).toBe("string");
      }
    });

    it("P0 is CRITICAL", () => {
      expect(onboard.PRIORITIES.P0.label).toBe("CRITICAL");
    });

    it("P1 is BLOCKER", () => {
      expect(onboard.PRIORITIES.P1.label).toBe("BLOCKER");
    });

    it("P4 is NIT", () => {
      expect(onboard.PRIORITIES.P4.label).toBe("NIT");
    });
  });

  describe("defaultConfig()", () => {
    it("returns a valid config object", () => {
      const config = onboard.defaultConfig();
      expect(config).toHaveProperty("version", 1);
      expect(config).toHaveProperty("repos");
      expect(config).toHaveProperty("confirmation");
      expect(config).toHaveProperty("notifications");
      expect(config).toHaveProperty("review");
    });

    it("default notifications minPriority is P1", () => {
      const config = onboard.defaultConfig();
      expect(config.notifications.minPriority).toBe("P1");
    });

    it("default batchDigest is true", () => {
      const config = onboard.defaultConfig();
      expect(config.notifications.batchDigest).toBe(true);
    });

    it("default digestInterval is daily", () => {
      const config = onboard.defaultConfig();
      expect(config.notifications.digestInterval).toBe("daily");
    });

    it("default autoMerge is false", () => {
      const config = onboard.defaultConfig();
      expect(config.confirmation.autoMerge).toBe(false);
    });

    it("default autoFix is false", () => {
      const config = onboard.defaultConfig();
      expect(config.confirmation.autoFix).toBe(false);
    });

    it("default review passes is 3", () => {
      const config = onboard.defaultConfig();
      expect(config.review.passes).toBe(3);
    });

    it("default priorityLevels includes all P0-P4", () => {
      const config = onboard.defaultConfig();
      expect(config.review.priorityLevels).toEqual(["P0", "P1", "P2", "P3", "P4"]);
    });
  });

  describe("printBanner()", () => {
    it("outputs without throwing", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(() => onboard.printBanner()).not.toThrow();
      expect(spy).toHaveBeenCalled();

      // Check it includes key content
      const output = spy.mock.calls.map(c => c[0]).join("\n");
      expect(output).toContain("solo-cto-agent");
      expect(output).toContain("Sponsor");
      spy.mockRestore();
    });
  });

  describe("formatRepoList()", () => {
    it("handles empty repos", () => {
      const result = onboard.formatRepoList([]);
      expect(result).toBe("");
    });

    it("formats repos with status indicators", () => {
      const repos = [
        {
          name: "test-repo",
          fullName: "user/test-repo",
          language: "TypeScript",
          defaultBranch: "main",
          isPrivate: false,
          url: "https://github.com/user/test-repo",
          hasWorkflow: true,
          hasApiKey: true,
          pushedAt: "2024-01-01T00:00:00Z",
        },
        {
          name: "other-repo",
          fullName: "user/other-repo",
          language: "JavaScript",
          defaultBranch: "main",
          isPrivate: true,
          url: "https://github.com/user/other-repo",
          hasWorkflow: false,
          hasApiKey: false,
          pushedAt: "2024-01-01T00:00:00Z",
        },
      ];

      const result = onboard.formatRepoList(repos);
      expect(result).toContain("test-repo");
      expect(result).toContain("other-repo");
      expect(result).toContain("TypeScript");
      expect(result).toContain("Total: 2 repos");
    });
  });

  describe("formatPriorityTable()", () => {
    it("returns formatted priority table", () => {
      const result = onboard.formatPriorityTable();
      expect(result).toContain("P0");
      expect(result).toContain("P1");
      expect(result).toContain("P2");
      expect(result).toContain("P3");
      expect(result).toContain("P4");
      expect(result).toContain("CRITICAL");
      expect(result).toContain("BLOCKER");
    });
  });

  describe("addToDigest()", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const digestFile = path.join(os.homedir(), ".solo-cto-agent", "digest-queue.json");

    beforeEach(() => {
      // Clean up digest file
      try { fs.unlinkSync(digestFile); } catch (_) {}
    });

    afterEach(() => {
      try { fs.unlinkSync(digestFile); } catch (_) {}
    });

    it("adds finding to digest queue", () => {
      const count = onboard.addToDigest({
        repo: "user/test-repo",
        pr: 42,
        priority: "P1",
        issue: "Missing error handling",
        suggestion: "Add try-catch block",
        pass: 1,
      });

      expect(count).toBe(1);

      // Read back
      const queue = JSON.parse(fs.readFileSync(digestFile, "utf8"));
      expect(queue).toHaveLength(1);
      expect(queue[0].repo).toBe("user/test-repo");
      expect(queue[0].priority).toBe("P1");
      expect(queue[0]).toHaveProperty("timestamp");
    });

    it("appends to existing queue", () => {
      onboard.addToDigest({ repo: "a", priority: "P0" });
      onboard.addToDigest({ repo: "b", priority: "P2" });
      const count = onboard.addToDigest({ repo: "c", priority: "P4" });

      expect(count).toBe(3);
    });
  });

  describe("flushDigest()", () => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const digestFile = path.join(os.homedir(), ".solo-cto-agent", "digest-queue.json");

    beforeEach(() => {
      try { fs.unlinkSync(digestFile); } catch (_) {}
    });

    afterEach(() => {
      try { fs.unlinkSync(digestFile); } catch (_) {}
    });

    it("returns null for empty queue", () => {
      const result = onboard.flushDigest();
      expect(result).toBeNull();
    });

    it("groups findings by repo", () => {
      onboard.addToDigest({ repo: "user/repo-a", pr: 1, priority: "P0", issue: "Security bug" });
      onboard.addToDigest({ repo: "user/repo-a", pr: 2, priority: "P2", issue: "Perf issue" });
      onboard.addToDigest({ repo: "user/repo-b", pr: 3, priority: "P3", issue: "Naming" });

      const result = onboard.flushDigest();
      expect(result).toBeDefined();
      expect(Object.keys(result)).toHaveLength(2);
      expect(result["user/repo-a"]).toBeDefined();
      expect(result["user/repo-a"].findings).toHaveLength(2);
      expect(result["user/repo-a"].prCount).toBe(2);
      expect(result["user/repo-a"].priorityCounts.P0).toBe(1);
      expect(result["user/repo-a"].priorityCounts.P2).toBe(1);

      expect(result["user/repo-b"].findings).toHaveLength(1);
    });

    it("clears queue after flush", () => {
      onboard.addToDigest({ repo: "x", priority: "P1" });
      onboard.flushDigest();

      const queue = JSON.parse(fs.readFileSync(digestFile, "utf8"));
      expect(queue).toHaveLength(0);
    });
  });

  describe("formatDigest()", () => {
    it("handles null/empty input", () => {
      expect(onboard.formatDigest(null)).toContain("No pending");
      expect(onboard.formatDigest({})).toContain("No pending");
    });

    it("formats grouped findings", () => {
      const grouped = {
        "user/repo-a": {
          repo: "user/repo-a",
          findings: [
            { priority: "P0", issue: "XSS vulnerability", suggestion: "Sanitize input" },
            { priority: "P2", issue: "Slow query", suggestion: "Add index" },
          ],
          prCount: 2,
          priorityCounts: { P0: 1, P2: 1 },
        },
      };

      const result = onboard.formatDigest(grouped);
      expect(result).toContain("repo-a");
      expect(result).toContain("P0");
      expect(result).toContain("XSS vulnerability");
      expect(result).toContain("Sponsor");
    });
  });

  describe("loadConfig() / saveConfig()", () => {
    const fs = require("fs");

    it("returns default config when no file exists", () => {
      // loadConfig with non-existent file should return defaults
      const config = onboard.loadConfig();
      expect(config).toHaveProperty("version");
      expect(config).toHaveProperty("notifications");
    });

    it("saveConfig writes and loadConfig reads back", () => {
      const config = onboard.defaultConfig();
      config.notifications.minPriority = "P0";
      config.repos = [{ fullName: "test/repo", enabledAt: "2024-01-01" }];

      const savedPath = onboard.saveConfig(config);
      expect(fs.existsSync(savedPath)).toBe(true);

      const loaded = onboard.loadConfig();
      expect(loaded.notifications.minPriority).toBe("P0");
      expect(loaded.repos).toHaveLength(1);

      // Cleanup
      try { fs.unlinkSync(savedPath); } catch (_) {}
    });
  });

  describe("constants", () => {
    it("exports GITHUB_URL", () => {
      expect(onboard.GITHUB_URL).toContain("github.com");
      expect(onboard.GITHUB_URL).toContain("solo-cto-agent");
    });

    it("exports SPONSOR_URL", () => {
      expect(onboard.SPONSOR_URL).toContain("sponsors");
    });

    it("exports CONFIG_DIR", () => {
      expect(onboard.CONFIG_DIR).toContain(".solo-cto-agent");
    });
  });
});
