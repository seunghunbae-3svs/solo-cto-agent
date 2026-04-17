/**
 * diff-guard.js — Detect secrets in git diff before sending to AI APIs
 *
 * Scans diff content for API keys, passwords, tokens, and other credentials.
 * Warns the user and optionally blocks the API call.
 *
 * Usage:
 *   const { scanDiff, redactDiff } = require("./diff-guard");
 *   const result = scanDiff(diffString);
 *   if (result.hasSecrets) { // warn or block }
 *   const safeDiff = redactDiff(diffString);  // replaces secrets with placeholders
 */

"use strict";

// ─── Secret patterns ─────────────────────────────────
// Each: { name, pattern, severity }
// severity: "critical" (API keys, passwords) | "warning" (emails, IPs)
const SECRET_PATTERNS = [
  // API Keys
  { name: "Anthropic API Key", pattern: /sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/g, severity: "critical" },
  { name: "OpenAI API Key", pattern: /sk-[A-Za-z0-9]{20,}/g, severity: "critical" },
  { name: "GitHub PAT", pattern: /ghp_[A-Za-z0-9]{36,}/g, severity: "critical" },
  { name: "GitHub Fine-grained PAT", pattern: /github_pat_[A-Za-z0-9_]{22,}/g, severity: "critical" },
  { name: "AWS Access Key", pattern: /AKIA[A-Z0-9]{16}/g, severity: "critical" },
  { name: "AWS Secret Key", pattern: /(?:aws_secret_access_key|secret_key)\s*[=:]\s*[A-Za-z0-9/+=]{40}/gi, severity: "critical" },
  { name: "Stripe Key", pattern: /(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{20,}/g, severity: "critical" },
  { name: "Telegram Bot Token", pattern: /\d{8,}:[A-Za-z0-9_-]{30,}/g, severity: "critical" },

  // Passwords & secrets in config
  { name: "Password assignment", pattern: /(?:password|passwd|pwd)\s*[=:]\s*["']?[^\s"',;}{)]{8,}/gi, severity: "critical" },
  { name: "Secret assignment", pattern: /(?:secret|credential|private_key)\s*[=:]\s*["']?[^\s"',;}{)]{8,}/gi, severity: "critical" },
  { name: "Database URL with credentials", pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/gi, severity: "critical" },

  // JWTs
  { name: "JWT Token", pattern: /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}/g, severity: "warning" },

  // Generic env patterns (only in added lines)
  { name: "Env var with value", pattern: /^[+].*(?:API_KEY|SECRET|TOKEN|PRIVATE_KEY)\s*=\s*[^\s]{10,}/gm, severity: "warning" },
];

/**
 * Scan a diff string for secrets.
 * Only scans added lines (lines starting with +) to avoid false positives from removed code.
 *
 * @param {string} diff - git diff content
 * @returns {{ hasSecrets: boolean, findings: Array<{name: string, severity: string, line: string, lineNum: number}> }}
 */
function scanDiff(diff) {
  if (!diff || typeof diff !== "string") return { hasSecrets: false, findings: [] };

  const findings = [];
  const lines = diff.split("\n");

  // Focus on added lines (+ prefix) and context for file headers
  const addedLines = [];
  lines.forEach((line, idx) => {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      addedLines.push({ text: line, num: idx + 1 });
    }
  });

  const addedText = addedLines.map((l) => l.text).join("\n");

  for (const { name, pattern, severity } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(addedText)) !== null) {
      // Find which added line contains this match
      const matchPos = match.index;
      let charCount = 0;
      let sourceLine = addedLines[0];
      for (const line of addedLines) {
        if (charCount + line.text.length >= matchPos) {
          sourceLine = line;
          break;
        }
        charCount += line.text.length + 1; // +1 for \n
      }

      // Avoid duplicate findings for the same line
      const alreadyFound = findings.some(
        (f) => f.lineNum === sourceLine.num && f.name === name
      );
      if (!alreadyFound) {
        findings.push({
          name,
          severity,
          line: sourceLine.text.slice(0, 120) + (sourceLine.text.length > 120 ? "..." : ""),
          lineNum: sourceLine.num,
        });
      }
    }
  }

  return {
    hasSecrets: findings.some((f) => f.severity === "critical"),
    findings,
  };
}

/**
 * Redact detected secrets from a diff string.
 * Replaces matched patterns with [REDACTED-{name}].
 *
 * @param {string} diff
 * @returns {string} redacted diff
 */
function redactDiff(diff) {
  if (!diff || typeof diff !== "string") return diff;
  let result = diff;
  // Apply specific patterns first, skip generic "Env var with value" for redaction
  // (it matches entire lines and destroys more specific replacements)
  for (const { name, pattern, severity } of SECRET_PATTERNS) {
    if (name === "Env var with value") continue; // scan-only, not redact
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED-${name}]`);
  }
  return result;
}

/**
 * Format findings as a human-readable warning string.
 * @param {Array} findings
 * @returns {string}
 */
function formatWarning(findings) {
  if (!findings || findings.length === 0) return "";

  const critical = findings.filter((f) => f.severity === "critical");
  const warnings = findings.filter((f) => f.severity === "warning");

  let msg = "\n⚠️  SECRETS DETECTED IN DIFF\n";
  msg += "═".repeat(40) + "\n";

  if (critical.length > 0) {
    msg += "\n🔴 CRITICAL (will be sent to AI API):\n";
    for (const f of critical) {
      msg += `   Line ${f.lineNum}: ${f.name}\n`;
    }
  }

  if (warnings.length > 0) {
    msg += "\n🟡 WARNING:\n";
    for (const f of warnings) {
      msg += `   Line ${f.lineNum}: ${f.name}\n`;
    }
  }

  msg += "\n" + "═".repeat(40);
  msg += "\nOptions:";
  msg += "\n  --redact     Auto-redact secrets before sending";
  msg += "\n  --force      Send anyway (not recommended)";
  msg += "\n  Ctrl+C       Abort\n";

  return msg;
}

module.exports = { scanDiff, redactDiff, formatWarning, SECRET_PATTERNS };
