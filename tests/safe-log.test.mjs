import { describe, it, expect } from "vitest";
import { mask, maskArgs, PATTERNS } from "../bin/safe-log.js";

describe("safe-log", () => {
  describe("mask()", () => {
    it("masks Anthropic API keys", () => {
      const input = "Using key sk-ant-api03-FAKEKEYFAKEKEYFAKEKEYFAKEKEY0000";
      expect(mask(input)).toBe("Using key sk-ant-***");
      expect(mask(input)).not.toContain("Mz4NRW7");
    });

    it("masks OpenAI API keys", () => {
      const input = "export OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345";
      const result = mask(input);
      expect(result).not.toContain("abc123def456");
    });

    it("masks GitHub PATs (classic)", () => {
      const input = "token ghp_AAAAAAAAAAAABBBBBBBBBBBBCCCCCCCCCCCCDDDD";
      expect(mask(input)).toBe("token ghp_***");
      expect(mask(input)).not.toContain("U5rRJMA5");
    });

    it("masks GitHub fine-grained PATs", () => {
      const input = "auth: github_pat_11AABCCDD_abcdefghij1234567890abcdefghij";
      expect(mask(input)).toContain("github_pat_***");
      expect(mask(input)).not.toContain("11AABCCDD");
    });

    it("masks Telegram bot tokens", () => {
      const input = "TELEGRAM_BOT_TOKEN=12345678:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh";
      const result = mask(input);
      expect(result).not.toContain("ABCDEFGHIJKLMNOP");
    });

    it("masks generic KEY=value patterns", () => {
      const input = "API_KEY = my-super-secret-key-12345";
      const result = mask(input);
      expect(result).toContain("***");
      expect(result).not.toContain("my-super-secret");
    });

    it("preserves non-secret strings", () => {
      const input = "Running review on 42 files...";
      expect(mask(input)).toBe(input);
    });

    it("handles multiple secrets in one string", () => {
      const input = "keys: sk-ant-api03-FAKEKEYFAKEKEYFAKEKEY00 and ghp_AAAAAAAAAAAABBBBBBBBBBBBCCCCCCCCCCCCDDDD";
      const result = mask(input);
      expect(result).toBe("keys: sk-ant-*** and ghp_***");
    });

    it("returns non-string inputs unchanged", () => {
      expect(mask(42)).toBe(42);
      expect(mask(null)).toBe(null);
      expect(mask(undefined)).toBe(undefined);
    });
  });

  describe("maskArgs()", () => {
    it("masks strings in argument array", () => {
      const args = ["file:", "key=sk-ant-api03-FAKEKEYFAKEKEYFAKEKEY00", 42];
      const result = maskArgs(args);
      expect(result[0]).toBe("file:");
      expect(result[1]).toContain("sk-ant-***");
      expect(result[2]).toBe(42);
    });

    it("masks Error messages", () => {
      const err = new Error("API failed with key ghp_AAAAAAAAAAAABBBBBBBBBBBBCCCCCCCCCCCCDDDD");
      const result = maskArgs([err]);
      expect(result[0].message).toContain("ghp_***");
    });
  });
});
