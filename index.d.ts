/**
 * solo-cto-agent — TypeScript type definitions
 * Provides type hints for consumers of the public API
 */

// ============================================================================
// Shared Type Definitions
// ============================================================================

export interface ReviewIssue {
  file: string;
  line?: number;
  column?: number;
  message: string;
  severity: "BLOCKER" | "CRITICAL" | "WARNING" | "SUGGESTION" | "NIT";
  code?: string;
  ruleId?: string;
}

export interface ReviewResult {
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | "UNKNOWN";
  issues: ReviewIssue[];
  summary?: string;
  metadata?: Record<string, unknown>;
  rawResponse?: string;
  costInfo?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
}

export interface NotifyOptions {
  severity?: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
  channels?: ("slack" | "telegram" | "email" | "webhook")[];
  webhookUrl?: string;
}

export interface NotifyResult {
  ok: boolean;
  error?: string;
  channels?: Record<string, { ok: boolean; error?: string }>;
}

export interface SignalFlags {
  /** T1: Peer model (OpenAI API key) active */
  t1PeerModel: boolean;
  /** T2: External knowledge (package registry, web search) active */
  t2ExternalKnowledge: boolean;
  /** T3: Ground truth (Vercel, Supabase) active */
  t3GroundTruth: boolean;
  /** Environment flag for T1 */
  t1EnvSet: boolean;
  /** Environment flag for T2 */
  t2EnvSet: boolean;
  /** Environment flag for T3 */
  t3EnvSet: boolean;
  /** Count of active signals (0-3) */
  activeCount: number;
  /** True if no external signals configured (self-loop) */
  isSelfLoop: boolean;
}

export interface ExternalSignalOutcome {
  t1Applied?: boolean;
  t2Applied?: boolean;
  t3Applied?: boolean;
}

export interface PersonalizationData {
  acceptedPatterns: string[];
  rejectedPatterns: string[];
  repeatErrors: string[];
  stylePrefs: Record<string, unknown>;
  reviewCount: number;
  lastUpdated: string | null;
}

export interface VercelDeployment {
  id: string;
  url: string;
  state: "READY" | "BUILDING" | "ERROR" | "CANCELED";
  created: number;
  updated?: number;
  environment: "production" | "preview";
  errorMessage?: string;
}

export interface SupabaseProject {
  id: string;
  name: string;
  region: string;
  status: "active" | "inactive" | "deleted";
}

export interface GroundTruthContext {
  vercelDeployments?: VercelDeployment[];
  supabaseSchema?: Record<string, unknown>;
  packageJson?: Record<string, unknown>;
}

export interface BenchmarkMetrics {
  name: string;
  description?: string;
  value: number | string;
  unit: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkDiffResult {
  baseline: number;
  current: number;
  delta: number;
  percentChange: number;
  improved: boolean;
}

export interface PluginSearchResult {
  name: string;
  version: string;
  description?: string;
  author?: string;
  keywords?: string[];
  links?: {
    npm?: string;
    repository?: string;
    homepage?: string;
  };
}

export interface HistoryEntry {
  timestamp: string;
  metrics: BenchmarkMetrics[];
  changes?: Array<{
    metric: string;
    before: number;
    after: number;
  }>;
}

export interface ExternalKnowledgeContext {
  packageCurrency?: Record<string, string>;
  securityAdvisories?: Array<{
    id: string;
    severity: "critical" | "high" | "moderate" | "low";
    description: string;
    affectedVersions: string[];
  }>;
  npmData?: Record<string, unknown>;
}

// ============================================================================
// Module: bin/safe-log.js (P0 — secret masking for CLI output)
// ============================================================================

export declare module "solo-cto-agent/bin/safe-log" {
  /** Secret-matching regex patterns: [regex, replacement][] */
  export const PATTERNS: Array<[RegExp, string]>;

  /** Mask secrets in a string. Non-string inputs returned unchanged. */
  export function mask(input: string): string;
  export function mask(input: any): any;

  /** Mask secrets in an array of arguments (console.log-style). */
  export function maskArgs(args: any[]): any[];

  /**
   * Wrap global console methods (log/error/warn/info) to auto-mask secrets.
   * Idempotent — safe to call multiple times.
   */
  export function wrapConsole(): void;
}

// ============================================================================
// Module: bin/diff-guard.js (P0 — diff secret detection)
// ============================================================================

export interface DiffFinding {
  name: string;
  severity: "critical" | "high" | "medium";
  line: string;
  lineNum: number;
}

export interface DiffScanResult {
  hasSecrets: boolean;
  findings: DiffFinding[];
}

export declare module "solo-cto-agent/bin/diff-guard" {
  export const SECRET_PATTERNS: Array<{
    name: string;
    regex: RegExp;
    severity: "critical" | "high" | "medium";
    redact?: string;
  }>;

  /** Scan a git diff for secrets in added lines. */
  export function scanDiff(diff: string | null | undefined): DiffScanResult;

  /** Replace detected secrets with [REDACTED-*] labels. */
  export function redactDiff(diff: string): string;

  /** Format human-readable warning for terminal output. */
  export function formatWarning(findings: DiffFinding[] | null): string;
}

// ============================================================================
// Module: bin/plugin-manager.js (P1 additions)
// ============================================================================

export interface PluginInstallResult {
  ok: boolean;
  name: string;
  version?: string;
  error?: string;
}

export declare module "solo-cto-agent/bin/plugin-manager" {
  export function searchRegistry(query: string): Promise<PluginSearchResult[]>;
  export function installFromRegistry(name: string, opts?: { agent?: string }): Promise<PluginInstallResult>;
  export function installFromPath(localPath: string, opts?: { agent?: string }): Promise<PluginInstallResult>;
  export function addPlugin(manifest: any, plugin: any): void;
  export function removePlugin(manifest: any, name: string): void;
  export function findPlugin(manifest: any, name: string): any;
  export function listPlugins(manifest: any): any[];
  export function validatePluginPackage(pkg: any): { valid: boolean; errors: string[] };
}

// ============================================================================
// Module: bin/template-audit.js (P1 additions)
// ============================================================================

export interface ApplyFixResult {
  fixed: string[];
  skipped: string[];
  errors: string[];
  details: Array<{ file: string; action: string; error?: string }>;
}

export declare module "solo-cto-agent/bin/template-audit" {
  export function applyFixes(
    auditResults: any,
    packageRoot: string,
    opts?: { dryRun?: boolean; exclude?: string[] }
  ): Promise<ApplyFixResult>;
  export function auditManagedRepos(settings?: any): Promise<any>;
}

// ============================================================================
// Module: bin/constants.js
// ============================================================================

export declare module "solo-cto-agent/bin/constants" {
  export const API_HOSTS: {
    anthropic: string;
    openai: string;
    github: string;
    vercel: string;
    supabase: string;
    npm: string;
    osv: string;
    coworkBackend: string;
  };

  export const MODELS: {
    [key: string]: {
      provider: string;
      maxTokens: number;
      costMultiplier: number;
    };
  };

  export const TIMEOUTS: {
    [key: string]: number;
  };

  export const RETRY_DELAYS: {
    rateLimit: number;
    generic: number;
  };

  export const LIMITS: {
    gitDiffBuffer: number;
    gitCommandBuffer: number;
    maxChunkBytes: number;
    maxTokens: number;
    maxTokensDeep: number;
    vercelFetchLimit: number;
  };

  export const PRICING: {
    [modelName: string]: {
      input: number;
      output: number;
    };
    managedAgentRuntime: number;
  };

  export const BETA_HEADERS: {
    routines: string;
    managedAgents: string;
  };

  export const ANTHROPIC_API_VERSION: string;

  export const WATCH_PATTERNS: {
    sources: string[];
    exclude: string[];
  };
}

// ============================================================================
// Module: bin/review-parser.js
// ============================================================================

export declare module "solo-cto-agent/bin/review-parser" {
  export interface ColorScheme {
    reset: string;
    bold: string;
    dim: string;
    green: string;
    yellow: string;
    red: string;
    blue: string;
    cyan: string;
  }

  /**
   * Initialize the review parser with a logger.
   * @param log - Logger object
   */
  export function init(log?: any): void;

  /**
   * Normalize raw verdict text to canonical taxonomy.
   * @param raw - Raw verdict string ("approved", "changes requested", etc.)
   * @returns Normalized verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | "UNKNOWN"
   */
  export function normalizeVerdict(raw: string): string;

  /**
   * Get human-readable label for a verdict.
   * @param verdict - Canonical verdict
   * @returns Display label
   */
  export function verdictLabel(verdict: string): string;

  /**
   * Normalize raw severity to canonical taxonomy.
   * @param raw - Raw severity string ("blocker", "critical", "warning", etc.)
   * @returns Normalized severity: "BLOCKER" | "CRITICAL" | "WARNING" | "SUGGESTION" | "NIT"
   */
  export function normalizeSeverity(raw: string): string;

  /**
   * Parse a review response into structured issues.
   * @param text - Raw review response text
   * @returns Parsed ReviewResult
   */
  export function parseReviewResponse(text: string): ReviewResult;

  /**
   * Format cross-check output (consistency validation).
   * @param crossCheckData - Cross-check findings
   * @returns Formatted string
   */
  export function formatCrossCheck(crossCheckData: any): string;

  /**
   * Format output for terminal display.
   * @param result - ReviewResult
   * @param options - Formatting options
   * @returns ANSI-formatted string
   */
  export function formatTerminalOutput(result: ReviewResult, options?: any): string;

  export const COLORS: ColorScheme;
}

// ============================================================================
// Module: bin/external-signals.js
// ============================================================================

export declare module "solo-cto-agent/bin/external-signals" {
  /**
   * Initialize external signals module.
   * @param config - Configuration object
   */
  export function init(config?: any): void;

  /**
   * Assess which external signals are active.
   * @param opts - Assessment options
   * @param opts.env - Environment variables (default: process.env)
   * @param opts.outcome - Fetch outcome metadata
   * @returns SignalFlags describing active signals
   */
  export function assessExternalSignals(opts?: {
    env?: Record<string, string | undefined>;
    outcome?: ExternalSignalOutcome;
  }): SignalFlags;

  /**
   * Format warning when no external signals configured.
   * @param flags - SignalFlags
   * @returns Formatted warning message
   */
  export function formatSelfLoopWarning(flags: SignalFlags): string;

  /**
   * Format hint when external signal is partially applied.
   * @param tier - Signal tier ("t1", "t2", "t3")
   * @param outcome - Fetch result
   * @returns Formatted hint message
   */
  export function formatPartialSignalHint(tier: string, outcome: any): string;

  /**
   * Resolve Vercel project ID from environment.
   * @param projectId - Project ID or name
   * @returns Resolved project ID
   */
  export function resolveVercelProject(projectId: string): Promise<string>;

  /**
   * Resolve Supabase project ID from environment.
   * @param projectId - Project ID or name
   * @returns Resolved project ID
   */
  export function resolveSupabaseProject(projectId: string): Promise<string>;

  /**
   * Fetch ground truth from Vercel deployments.
   * @param projectId - Vercel project ID
   * @returns Array of deployments
   */
  export function fetchVercelGroundTruth(projectId: string): Promise<VercelDeployment[]>;

  /**
   * Summarize Vercel deployments into context.
   * @param deployments - Vercel deployments
   * @returns Summary context
   */
  export function summarizeVercelDeployments(deployments: VercelDeployment[]): string;

  /**
   * Fetch complete ground truth (Vercel + Supabase + local schema).
   * @param opts - Options
   * @returns Ground truth context
   */
  export function fetchGroundTruth(opts?: any): Promise<GroundTruthContext>;

  /**
   * Format ground truth into context string.
   * @param context - Ground truth context
   * @returns Formatted string
   */
  export function formatGroundTruthContext(context: GroundTruthContext): string;

  /**
   * Scan package.json for project metadata.
   * @param packagePath - Path to package.json
   * @returns Parsed package object
   */
  export function scanPackageJson(packagePath: string): any;

  /**
   * Parse pinned version string.
   * @param versionStr - Version string (e.g., "^1.2.3", "1.2.3")
   * @returns Parsed version
   */
  export function parsePinnedVersion(versionStr: string): { major: number; minor: number; patch: number };

  /**
   * Compare two versions.
   * @param v1 - First version
   * @param v2 - Second version
   * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  export function compareVersions(v1: any, v2: any): number;

  /**
   * Fetch data from npm registry.
   * @param packageName - Package name
   * @returns Package metadata
   */
  export function fetchNpmRegistry(packageName: string): Promise<any>;

  /**
   * Check if package has updates available.
   * @param packageName - Package name
   * @param currentVersion - Current version
   * @returns Update info
   */
  export function fetchPackageCurrency(packageName: string, currentVersion: string): Promise<any>;

  /**
   * Fetch external knowledge (package updates, deps).
   * @param opts - Options
   * @returns External knowledge context
   */
  export function fetchExternalKnowledge(opts?: any): Promise<ExternalKnowledgeContext>;

  /**
   * Format external knowledge into context string.
   * @param context - External knowledge context
   * @returns Formatted string
   */
  export function formatExternalKnowledgeContext(context: ExternalKnowledgeContext): string;

  /**
   * Normalize OSV severity level.
   * @param osvSeverity - OSV severity string
   * @returns Normalized severity
   */
  export function normalizeOsvSeverity(osvSeverity: string): string;

  /**
   * Get rank for severity (higher = more critical).
   * @param severity - Normalized severity
   * @returns Numeric rank
   */
  export function severityRank(severity: string): number;

  /**
   * Fetch security advisories from OSV.
   * @param packageName - Package name
   * @returns Array of advisories
   */
  export function fetchOsvAdvisories(packageName: string): Promise<any[]>;

  /**
   * Fetch all security advisories.
   * @param opts - Options
   * @returns Security advisories
   */
  export function fetchSecurityAdvisories(opts?: any): Promise<any>;

  /**
   * Detect which live sources are available.
   * @returns List of available sources
   */
  export function detectLiveSources(): string[];

  /**
   * Build context from live sources.
   * @returns Live source context
   */
  export function liveSourceContext(): string;

  /**
   * Build agent identity (tier-specific).
   * @param tier - Agent tier ("builder" | "cto")
   * @returns Agent identity description
   */
  export function buildIdentity(tier: string): string;

  export const AGENT_IDENTITY_BY_TIER: Record<string, string>;
  export const AGENT_IDENTITY: string;
  export const COLORS: Record<string, string>;
}

// ============================================================================
// Module: bin/personalization.js
// ============================================================================

export declare module "solo-cto-agent/bin/personalization" {
  /**
   * Initialize personalization module with config.
   * @param config - Configuration object
   */
  export function init(config?: any): void;

  /**
   * Read agent tier from environment or config.
   * @returns Tier: "maker" | "builder" | "cto"
   */
  export function readTier(): string;

  /**
   * Read agent mode from environment.
   * @returns Mode: "solo" | "managed" | "dual"
   */
  export function readMode(): string;

  /**
   * Load personalization data from disk.
   * @returns PersonalizationData object
   */
  export function loadPersonalization(): PersonalizationData;

  /**
   * Persist personalization data to disk.
   * @param data - PersonalizationData to save
   */
  export function savePersonalization(data: PersonalizationData): void;

  /**
   * Update personalization based on review feedback.
   * @param result - ReviewResult
   * @param accepted - Whether user accepted the review
   */
  export function updatePersonalizationFromReview(result: ReviewResult, accepted: boolean): void;

  /**
   * Record user feedback on a specific issue.
   * @param issueCode - Issue code or rule ID
   * @param feedback - "helpful" | "false_positive" | "ignore"
   */
  export function recordFeedback(issueCode: string, feedback: string): void;

  /**
   * Get personalization context for LLM prompt.
   * @returns Formatted context string
   */
  export function personalizationContext(): string;
}

// ============================================================================
// Module: bin/notify.js
// ============================================================================

export declare module "solo-cto-agent/bin/notify" {
  /**
   * Send notification to configured channels.
   * @param opts - Notification options
   * @returns Promise<NotifyResult>
   */
  export function notify(opts: NotifyOptions): Promise<NotifyResult>;

  /**
   * Detect available notification channels.
   * @returns List of available channels
   */
  export function detectChannels(): string[];

  /**
   * Format and send a review result notification.
   * @param result - ReviewResult
   * @param channels - Target channels
   */
  export function notifyReviewResult(result: ReviewResult, channels?: string[]): Promise<NotifyResult>;

  /**
   * Format and send an apply result notification.
   * @param applyResult - Apply operation result
   * @param channels - Target channels
   */
  export function notifyApplyResult(applyResult: any, channels?: string[]): Promise<NotifyResult>;

  /**
   * Format and send a deployment result notification.
   * @param deployResult - Deployment operation result
   * @param channels - Target channels
   */
  export function notifyDeployResult(deployResult: any, channels?: string[]): Promise<NotifyResult>;
}

// ============================================================================
// Module: bin/cowork-engine.js (partial — key exports)
// ============================================================================

export declare module "solo-cto-agent/bin/cowork-engine" {
  /** Runtime configuration object. */
  export const CONFIG: Record<string, any>;

  /** Execute local code review. */
  export function localReview(opts: any): Promise<ReviewResult>;

  /** Capture knowledge from review session. */
  export function knowledgeCapture(knowledge: any): Promise<void>;

  /** Run dual-mode review (solo + managed agent). */
  export function dualReview(opts: any): Promise<ReviewResult>;

  /** Self cross-review (Claude ↔ OpenAI consistency check). */
  export function selfCrossReview(opts: any): Promise<ReviewResult>;

  /** Auto-sync: watch for changes and trigger reviews. */
  export function autoSync(opts?: any): Promise<void>;

  /** Detect review mode from environment/args. */
  export function detectMode(): string;

  /** Detect default git branch (main/master). */
  export function detectDefaultBranch(): string;

  /** Get git diff for review. */
  export function getDiff(opts: any): string;

  /** Estimate token cost for a diff. */
  export function estimateCost(diff: string, tier?: string): { inputTokens: number; outputTokens: number; estimatedCostUsd: number };

  /** Resolve model name for a given tier. */
  export function resolveModelForTier(tier: string): string;

  /** Read .skill context files for prompt enrichment. */
  export function readSkillContext(dir?: string): string;

  /** Read failure catalog for known-error matching. */
  export function readFailureCatalog(path?: string): any[];

  /** Save session state to disk. */
  export function sessionSave(sessionData: any): Promise<void>;

  /** Restore previous session. */
  export function sessionRestore(sessionId: string): Promise<any>;

  /** List available sessions. */
  export function sessionList(): Promise<any[]>;

  /** Create context checkpoint for long sessions. */
  export function contextCheckpoint(data: any): Promise<void>;

  /** Restore context from checkpoint. */
  export function contextRestore(checkpointId?: string): Promise<any>;

  /** Refresh context for rework cycles. */
  export function reworkContextRefresh(opts?: any): Promise<any>;

  /** Record user feedback on review. */
  export function recordFeedback(feedbackData: any): Promise<void>;

  /** Set log channel (stdout, file, webhook). */
  export function setLogChannel(channel: string): void;

  /** Get current log channel. */
  export function getLogChannel(): string;

  /** Fire a scheduled routine. */
  export function fireRoutine(routineId: string): Promise<void>;

  /** Build scheduled routine definitions. */
  export function buildRoutineSchedules(config: any): any[];

  /** Run managed-agent review (requires external service). */
  export function managedAgentReview(opts: any): Promise<ReviewResult>;
}

// ============================================================================
// Main Package Exports (if "main" field is set or require("solo-cto-agent"))
// ============================================================================

export interface SoloCtoAgentApi {
  // Constants
  API_HOSTS: typeof import("solo-cto-agent/bin/constants").API_HOSTS;
  MODELS: typeof import("solo-cto-agent/bin/constants").MODELS;
  TIMEOUTS: typeof import("solo-cto-agent/bin/constants").TIMEOUTS;
  PRICING: typeof import("solo-cto-agent/bin/constants").PRICING;

  // Review Parser
  parseReviewResponse: typeof import("solo-cto-agent/bin/review-parser").parseReviewResponse;
  normalizeVerdict: typeof import("solo-cto-agent/bin/review-parser").normalizeVerdict;
  normalizeSeverity: typeof import("solo-cto-agent/bin/review-parser").normalizeSeverity;

  // External Signals
  assessExternalSignals: typeof import("solo-cto-agent/bin/external-signals").assessExternalSignals;
  fetchGroundTruth: typeof import("solo-cto-agent/bin/external-signals").fetchGroundTruth;
  fetchExternalKnowledge: typeof import("solo-cto-agent/bin/external-signals").fetchExternalKnowledge;

  // Personalization
  loadPersonalization: typeof import("solo-cto-agent/bin/personalization").loadPersonalization;
  savePersonalization: typeof import("solo-cto-agent/bin/personalization").savePersonalization;
  readTier: typeof import("solo-cto-agent/bin/personalization").readTier;

  // Notifications
  notify: typeof import("solo-cto-agent/bin/notify").notify;
  detectChannels: typeof import("solo-cto-agent/bin/notify").detectChannels;

  // Core Engine
  localReview: typeof import("solo-cto-agent/bin/cowork-engine").localReview;
  dualReview: typeof import("solo-cto-agent/bin/cowork-engine").dualReview;
  detectMode: typeof import("solo-cto-agent/bin/cowork-engine").detectMode;
}

// Export public API
export const API_HOSTS: typeof import("solo-cto-agent/bin/constants").API_HOSTS;
export const MODELS: typeof import("solo-cto-agent/bin/constants").MODELS;
export const TIMEOUTS: typeof import("solo-cto-agent/bin/constants").TIMEOUTS;
export const LIMITS: typeof import("solo-cto-agent/bin/constants").LIMITS;
export const PRICING: typeof import("solo-cto-agent/bin/constants").PRICING;

export function parseReviewResponse(text: string): ReviewResult;
export function normalizeVerdict(raw: string): string;
export function normalizeSeverity(raw: string): string;

export function assessExternalSignals(opts?: {
  env?: Record<string, string | undefined>;
  outcome?: ExternalSignalOutcome;
}): SignalFlags;

export function fetchGroundTruth(opts?: any): Promise<GroundTruthContext>;
export function fetchExternalKnowledge(opts?: any): Promise<ExternalKnowledgeContext>;

export function loadPersonalization(): PersonalizationData;
export function savePersonalization(data: PersonalizationData): void;
export function readTier(): string;
export function readMode(): string;

export function notify(opts: NotifyOptions): Promise<NotifyResult>;
export function detectChannels(): string[];

export function localReview(opts: any): Promise<ReviewResult>;
export function dualReview(opts: any): Promise<ReviewResult>;
export function detectMode(): string;

// P0: Secret masking & diff guard
export function mask(input: string): string;
export function wrapConsole(): void;
export function scanDiff(diff: string | null | undefined): DiffScanResult;
export function redactDiff(diff: string): string;

// P1: Plugin install & template fix
export function installFromRegistry(name: string, opts?: any): Promise<PluginInstallResult>;
export function installFromPath(localPath: string, opts?: any): Promise<PluginInstallResult>;
export function applyFixes(auditResults: any, packageRoot: string, opts?: any): Promise<ApplyFixResult>;

// Re-export shared types
export type {
  ReviewIssue,
  ReviewResult,
  NotifyOptions,
  NotifyResult,
  SignalFlags,
  PersonalizationData,
  GroundTruthContext,
  ExternalKnowledgeContext,
  VercelDeployment,
  SupabaseProject,
  BenchmarkMetrics,
  BenchmarkDiffResult,
  PluginSearchResult,
  HistoryEntry,
  DiffFinding,
  DiffScanResult,
  PluginInstallResult,
  ApplyFixResult,
};
