/**
 * constants.js — Shared constants for solo-cto-agent.
 *
 * Centralizes magic numbers, default model names, API hostnames, timeouts,
 * buffer sizes, and pricing. Every hardcoded value that appears in more than
 * one file (or that a user might reasonably want to change) lives here.
 *
 * Usage:
 *   const C = require("./constants");
 *   const req = https.request({ hostname: C.API_HOSTS.anthropic, ... });
 */

// ============================================================================
// API HOSTNAMES
// ============================================================================

const API_HOSTS = Object.freeze({
  anthropic: "api.anthropic.com",
  openai:    "api.openai.com",
});

// ============================================================================
// DEFAULT MODEL NAMES
// ============================================================================

const MODELS = Object.freeze({
  claude:     "claude-sonnet-4-20250514",
  codex:      "gpt-4o-mini",
  openai:     "gpt-4o",
  // Tier-specific defaults
  tier: Object.freeze({
    maker:   "claude-haiku-4-5-20251001",
    builder: "claude-sonnet-4-5-20250929",
    cto:     "claude-opus-4-5-20250929",
  }),
  // Managed Agents default
  managedAgent: "claude-sonnet-4-6",
});

// ============================================================================
// TIMEOUTS (milliseconds)
// ============================================================================

const TIMEOUTS = Object.freeze({
  /** LLM API call — 2 minutes (large diffs can be slow) */
  apiCall:          120_000,
  /** Vercel / Supabase ground-truth fetch */
  externalFetch:      8_000,
  /** npm registry / OSV advisory fetch */
  registryFetch:      5_000,
  /** Telegram bot HTTP requests */
  telegram:          15_000,
  /** Telegram chat ID capture polling window */
  telegramCapture:   60_000,
  /** Telegram poll interval */
  telegramPoll:       2_000,
  /** CLI subprocess timeout (E2E tests, etc.) */
  cliSubprocess:     30_000,
  /** Managed Agent session default */
  managedAgent:     300_000,
  /** local-review subprocess */
  localReview:       60_000,
});

// ============================================================================
// RETRY DELAYS (milliseconds) — multiplied by (attempt + 1)
// ============================================================================

const RETRY_DELAYS = Object.freeze({
  /** Delay multiplier on rate-limit (429/529) */
  rateLimit: 30_000,
  /** Delay multiplier on generic API error */
  generic:   15_000,
});

// ============================================================================
// BUFFER & SIZE LIMITS
// ============================================================================

const LIMITS = Object.freeze({
  /** execSync maxBuffer for git diff (5MB) */
  gitDiffBuffer:   1024 * 1024 * 5,
  /** execSync maxBuffer for smaller git commands (1MB) */
  gitCommandBuffer: 1024 * 1024,
  /** Default max diff chunk size before splitting (50KB) */
  maxChunkBytes:   50_000,
  /** Default max_tokens for LLM API calls */
  maxTokens:       4_096,
  /** max_tokens for Managed Agent deep-review */
  maxTokensDeep:   8_192,
  /** Vercel deployment fetch limit */
  vercelFetchLimit: 10,
});

// ============================================================================
// TOKEN PRICING ($ per token)
// ============================================================================

const PRICING = Object.freeze({
  "claude-sonnet-4-20250514":   { input: 0.003,   output: 0.015  },
  "claude-opus-4-20250514":     { input: 0.015,   output: 0.075  },
  "claude-haiku-4-5-20251001":  { input: 0.0008,  output: 0.004  },
  "claude-sonnet-4-5-20250929": { input: 0.003,   output: 0.015  },
  "claude-opus-4-5-20250929":   { input: 0.015,   output: 0.075  },
  "gpt-4o-mini":          { input: 0.0005,  output: 0.0015 },
  "gpt-4o":                     { input: 0.005,   output: 0.015  },
  "claude-sonnet-4-6":          { input: 0.003,   output: 0.015  },
  "claude-opus-4-6":            { input: 0.015,   output: 0.075  },
  /** Managed Agent runtime surcharge per session-hour */
  managedAgentRuntime: 0.08,
});

// ============================================================================
// BETA HEADERS
// ============================================================================

const BETA_HEADERS = Object.freeze({
  routines:      "experimental-cc-routine-2026-04-01",
  managedAgents: "managed-agents-2026-04-01",
});

// ============================================================================
// ANTHROPIC API VERSION
// ============================================================================

const ANTHROPIC_API_VERSION = "2023-06-01";

// ============================================================================
// FILE WATCHER PATTERNS
// ============================================================================

const WATCH_PATTERNS = Object.freeze({
  extensions: [/\.tsx?$/, /\.jsx?$/, /\.css$/, /\.scss$/, /\.html$/, /\.svelte$/, /\.vue$/],
  ignoreDirs: new Set([
    "node_modules", ".git", ".next", "dist", "build",
    ".turbo", ".cache", ".vercel", "coverage",
  ]),
});

module.exports = {
  API_HOSTS,
  MODELS,
  TIMEOUTS,
  RETRY_DELAYS,
  LIMITS,
  PRICING,
  BETA_HEADERS,
  ANTHROPIC_API_VERSION,
  WATCH_PATTERNS,
};
