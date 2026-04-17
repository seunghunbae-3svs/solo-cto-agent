import { describe, it, expect } from "vitest";
import { scanDiff, redactDiff, formatWarning } from "../bin/diff-guard.js";

describe("diff-guard", () => {
  describe("scanDiff()", () => {
    it("detects Anthropic API key in added lines", () => {
      const diff = `diff --git a/.env b/.env
--- a/.env
+++ b/.env
+ANTHROPIC_API_KEY=sk-ant-api03-FAKEKEYFAKEKEYFAKEKEYFAKEKEY000000`;
      const result = scanDiff(diff);
      expect(result.hasSecrets).toBe(true);
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0].severity).toBe("critical");
    });

    it("detects GitHub PAT in added lines", () => {
      const diff = `+const token = "ghp_AAAAAAAAAAAABBBBBBBBBBBBCCCCCCCCCCCCDDDD";`;
      const result = scanDiff(diff);
      expect(result.hasSecrets).toBe(true);
      expect(result.findings.some((f) => f.name === "GitHub PAT")).toBe(true);
    });

    it("detects password assignments", () => {
      const diff = `+  password: "my-super-secret-password-123"`;
      const result = scanDiff(diff);
      expect(result.findings.some((f) => f.name === "Password assignment")).toBe(true);
    });

    it("detects database URLs with credentials", () => {
      const diff = `+DATABASE_URL=postgres://admin:secretpass@db.example.com:5432/mydb`;
      const result = scanDiff(diff);
      expect(result.hasSecrets).toBe(true);
      expect(result.findings.some((f) => f.name === "Database URL with credentials")).toBe(true);
    });

    it("detects AWS access keys", () => {
      const diff = `+AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE`;
      const result = scanDiff(diff);
      expect(result.hasSecrets).toBe(true);
      expect(result.findings.some((f) => f.name === "AWS Access Key")).toBe(true);
    });

    it("detects Stripe keys", () => {
      const diff = `+const stripeKey = "sk_test_FAKESTRIPEKEY00000000000000";`;
      const result = scanDiff(diff);
      expect(result.hasSecrets).toBe(true);
    });

    it("ignores removed lines (- prefix)", () => {
      const diff = `-ANTHROPIC_API_KEY=sk-ant-api03-FAKEKEYFAKEKEYFAKEKEYFAKEKEY000000`;
      const result = scanDiff(diff);
      expect(result.hasSecrets).toBe(false);
    });

    it("returns clean for normal code diffs", () => {
      const diff = `diff --git a/src/app.js b/src/app.js
--- a/src/app.js
+++ b/src/app.js
+function handleRequest(req, res) {
+  const userId = req.params.id;
+  return res.json({ ok: true });
+}`;
      const result = scanDiff(diff);
      expect(result.hasSecrets).toBe(false);
      expect(result.findings.length).toBe(0);
    });

    it("handles null/empty input", () => {
      expect(scanDiff(null).hasSecrets).toBe(false);
      expect(scanDiff("").hasSecrets).toBe(false);
      expect(scanDiff(undefined).hasSecrets).toBe(false);
    });
  });

  describe("redactDiff()", () => {
    it("replaces secrets with REDACTED labels", () => {
      const diff = `+ANTHROPIC_API_KEY=sk-ant-api03-FAKEKEYFAKEKEYFAKEKEYFAKEKEY000000`;
      const result = redactDiff(diff);
      expect(result).toContain("[REDACTED-Anthropic API Key]");
      expect(result).not.toContain("Mz4NRW7");
    });

    it("redacts multiple different secrets", () => {
      const diff = `+KEY1=sk-ant-api03-FAKEKEYFAKEKEYFAKEKEY00
+KEY2=ghp_AAAAAAAAAAAABBBBBBBBBBBBCCCCCCCCCCCCDDDD`;
      const result = redactDiff(diff);
      expect(result).toContain("[REDACTED-Anthropic API Key]");
      expect(result).toContain("[REDACTED-GitHub PAT]");
    });

    it("preserves non-secret content", () => {
      const diff = `+function hello() { return "world"; }`;
      expect(redactDiff(diff)).toBe(diff);
    });
  });

  describe("formatWarning()", () => {
    it("formats critical findings", () => {
      const findings = [
        { name: "Anthropic API Key", severity: "critical", line: "+KEY=sk-ant-...", lineNum: 5 },
      ];
      const warning = formatWarning(findings);
      expect(warning).toContain("CRITICAL");
      expect(warning).toContain("Anthropic API Key");
      expect(warning).toContain("--redact");
    });

    it("returns empty for no findings", () => {
      expect(formatWarning([])).toBe("");
      expect(formatWarning(null)).toBe("");
    });
  });
});
