/**
 * safe-log.js — Secret masking for CLI output
 *
 * Masks API keys, tokens, and credentials in any string before logging.
 * Prevents accidental exposure in CI logs, terminal output, and error messages.
 *
 * Usage:
 *   const { mask, wrapConsole } = require("./safe-log");
 *   const safeMsg = mask(someString);
 *   wrapConsole();  // patches global console.log/warn/error
 */

"use strict";

// ─── Masking patterns ────────────────────────────────
// Each entry: [regex, replacement label]
const PATTERNS = [
  // Anthropic API keys
  [/sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}/g, "sk-ant-***"],
  // OpenAI API keys
  [/sk-[A-Za-z0-9]{20,}/g, "sk-***"],
  // GitHub PATs (classic)
  [/ghp_[A-Za-z0-9]{36,}/g, "ghp_***"],
  // GitHub PATs (fine-grained)
  [/github_pat_[A-Za-z0-9_]{22,}/g, "github_pat_***"],
  // GitHub OAuth tokens
  [/gho_[A-Za-z0-9]{36,}/g, "gho_***"],
  // Telegram bot tokens (numeric:alphanumeric)
  [/\d{8,}:[A-Za-z0-9_-]{30,}/g, "TELEGRAM_***"],
  // Vercel tokens
  [/(?:bearer\s+)?[A-Za-z0-9]{24,}(?=.*vercel)/gi, "VERCEL_***"],
  // Supabase service keys (eyJ... JWT pattern)
  [/eyJ[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{50,}/g, "JWT_***"],
  // Generic "key=value" in env-like strings
  [/((?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[\s]*[=:]\s*)[^\s"',;}{)]+/gi, "$1***"],
];

/**
 * Mask secrets in a string.
 * @param {string} input
 * @returns {string} masked output
 */
function mask(input) {
  if (typeof input !== "string") return input;
  let result = input;
  for (const [pattern, replacement] of PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Mask secrets in any number of arguments (for console.log-style calls).
 * @param  {...any} args
 * @returns {any[]} masked args
 */
function maskArgs(args) {
  return args.map((arg) => {
    if (typeof arg === "string") return mask(arg);
    if (arg instanceof Error) {
      arg.message = mask(arg.message);
      if (arg.stack) arg.stack = mask(arg.stack);
      return arg;
    }
    return arg;
  });
}

/**
 * Wrap global console methods to auto-mask secrets.
 * Call once at process startup.
 * Idempotent — calling multiple times is safe.
 */
let _wrapped = false;
function wrapConsole() {
  if (_wrapped) return;
  _wrapped = true;

  const original = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
  };

  console.log = (...args) => original.log(...maskArgs(args));
  console.error = (...args) => original.error(...maskArgs(args));
  console.warn = (...args) => original.warn(...maskArgs(args));
  console.info = (...args) => original.info(...maskArgs(args));

  // Expose originals for cases where masking must be bypassed (e.g., writing to file)
  console._original = original;
}

module.exports = { mask, maskArgs, wrapConsole, PATTERNS };
