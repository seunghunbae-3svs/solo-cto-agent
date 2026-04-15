/**
 * external-signals.js
 *
 * External signal assessment & ground truth fetching.
 * Extracted from cowork-engine.js for modularity.
 *
 * Exports:
 *   - T1 Peer Model assessment (OpenAI API key detection)
 *   - T2 External Knowledge (npm registry, OSV.dev advisories)
 *   - T3 Ground Truth (Vercel deployments, Supabase projects)
 *   - Live source detection (MCP config sniffing)
 *   - Agent identity formatting
 *   - AGENT_IDENTITY_BY_TIER constant
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const C = require("./constants");

// ============================================================================
// INJECTED DEPENDENCIES
// ============================================================================

let _CONFIG = null;
let _log = {};

function init(CONFIG, log) {
  _CONFIG = CONFIG;
  _log = log || {};
}

// ============================================================================
// CONSTANTS
// ============================================================================

// D. Tier 별 에이전트 아이덴티티
// CLAUDE.md 의 "Maker Tier 에 강한 톤 적용 금지" 규칙 반영
const AGENT_IDENTITY_BY_TIER = {
  maker: `당신은 사용자의 desktop 에서 동작하는 페어 CTO 다. (Maker Tier — 학습/검증 단계)
- 사용자가 명시적으로 호출한 작업만 수행한다.
- 약점·리스크를 친절하게 짚되, 단정짓지 않는다. 검증 액션을 함께 제시한다.
- "이건 틀렸다" 보다 "이 가정이 깨지면 ~" 식 조건부 표현 우선.
- desktop runtime + 클라우드 amplifier (MCP, web search, scheduled task) 를 엮어 한 호출에서 가치를 최대로 뽑는다.`,
  builder: `당신은 사용자의 desktop 에서 동작하는 페어 CTO 다. (Builder Tier — 실행/배포 단계)
- 코드를 지키는 사람이지, 추가만 하는 사람이 아니다.
- 깨질 것을 먼저 보고, 만들 것을 나중에 본다.
- 자동 적용 가능한 LOW 리스크 변경은 제안과 함께 가드(typecheck/test) 결과를 첨부한다.
- desktop runtime + 클라우드 amplifier 의 라이브 소스 ([확정]) 를 우선 인용한다.`,
  cto: `당신은 CTO급 co-founder 다. (CTO Tier — 멀티 에이전트 오케스트레이션)
- 배포되는 것은 전부 본인 책임이라는 전제에서 움직인다.
- 유저가 신난다고 해도 틀린 아이디어는 막아선다.
- Cowork+Codex 또는 self cross-review 결과의 합의/불일치를 명시하고 우선순위를 정한다.
- 정책상 CTO Tier 의 완전 자율 실행은 Full-auto + Dual 에서만. Semi-auto 에서는 사용자 명시 호출에 따라 동작.`,
};

// 호환용 (구 코드/테스트가 AGENT_IDENTITY 직접 참조하는 경우)
const AGENT_IDENTITY = AGENT_IDENTITY_BY_TIER.builder;

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

// ============================================================================
// EXTERNAL SIGNAL ASSESSMENT (PR-F2)
// ============================================================================

/**
 * Assess which external-signal tiers are active for this review.
 *
 * The three tiers of external evaluation (see docs/external-loop-policy.md):
 *   T1 Peer Model     — another AI family reviewing (Claude + OpenAI dual)
 *   T2 External Knowledge — web search / package registry / trend data
 *   T3 Ground Truth    — real runtime logs / deploy status / production errors
 *
 * Without at least one tier active the review is a pure self-loop — the
 * same model's opinion reinforcing itself. This function detects the
 * environment so `formatSelfLoopWarning` can label the output honestly.
 */
function assessExternalSignals(opts = {}) {
  const env = opts.env || process.env;
  // outcome (optional) — the ACTUAL result of the T2/T3 fetches. When supplied,
  // a tier is only counted as active if (a) its env flag is set AND (b) the
  // fetch produced data. Without outcome we fall back to env-only so callers
  // that don't have fetch results (e.g. dry-run BEFORE fetches run) still get
  // a best-effort answer.
  //
  // Dogfood discovery (PR-F2): the drive-run on palate-pilot + 3stripe-event
  // showed that COWORK_EXTERNAL_KNOWLEDGE=1 in a repo with no (or nested)
  // package.json silently produced no T2 context, yet `activeCount` still
  // read "1/3". That's a false-confidence bug — the user thinks they closed
  // the self-loop when they haven't. Outcome-aware assessment fixes it.
  const outcome = opts.outcome || {};
  const t1Env = !!env.OPENAI_API_KEY;
  const t2Env =
    env.COWORK_EXTERNAL_KNOWLEDGE === "1"
    || !!env.COWORK_WEB_SEARCH
    || !!env.COWORK_PACKAGE_REGISTRY;
  const t3Env =
    !!env.VERCEL_TOKEN
    || !!env.SUPABASE_ACCESS_TOKEN
    || env.COWORK_GROUND_TRUTH === "1";

  // When outcome supplied, require successful application. When not supplied,
  // defer to env flag (backward compatible for callers without fetch data).
  const t2Applied = outcome.t2Applied !== undefined ? !!outcome.t2Applied : t2Env;
  const t3Applied = outcome.t3Applied !== undefined ? !!outcome.t3Applied : t3Env;
  // T1 is "applied" whenever the key exists — the dual-review caller decides
  // whether to actually invoke it; the peer model's mere availability is the
  // signal here.
  const t1Applied = outcome.t1Applied !== undefined ? !!outcome.t1Applied : t1Env;

  const flags = {
    t1PeerModel: t1Applied,
    t2ExternalKnowledge: t2Applied,
    t3GroundTruth: t3Applied,
    // Env-only view (useful for diagnostics: "env set but no data").
    t1EnvSet: t1Env,
    t2EnvSet: t2Env,
    t3EnvSet: t3Env,
  };
  const activeCount = [t1Applied, t2Applied, t3Applied].filter(Boolean).length;
  flags.activeCount = activeCount;
  flags.isSelfLoop = activeCount === 0;
  return flags;
}

/**
 * Render a visible warning when the review has no external-signal backing.
 *
 * The review itself is still produced — we don't gate on this — but the
 * warning makes the self-loop limitation legible to the user so they can
 * decide whether to run `dual-review`, wire up MCP sources, or accept
 * the narrower coverage.
 */
function formatSelfLoopWarning(signals) {
  if (!signals || !signals.isSelfLoop) return "";
  const box = `\n${COLORS.yellow}⚠️  [SELF-LOOP NOTICE]${COLORS.reset}\n`
    + `${COLORS.gray}This review was produced by a single model family with no external signals.${COLORS.reset}\n`
    + `${COLORS.gray}Missing: T1 peer model · T2 external knowledge · T3 ground truth.${COLORS.reset}\n`
    + `${COLORS.gray}Why it matters: opinions reinforce themselves — blind spots persist.${COLORS.reset}\n`
    + `${COLORS.gray}To close the loop, enable any of:${COLORS.reset}\n`
    + `${COLORS.gray}  • T1 — set OPENAI_API_KEY and use 'solo-cto-agent dual-review'${COLORS.reset}\n`
    + `${COLORS.gray}  • T2 — set COWORK_EXTERNAL_KNOWLEDGE=1 (trend + package checks)${COLORS.reset}\n`
    + `${COLORS.gray}  • T3 — set VERCEL_TOKEN or SUPABASE_ACCESS_TOKEN (runtime signals)${COLORS.reset}\n`;
  return box;
}

function formatPartialSignalHint(signals) {
  if (!signals || signals.isSelfLoop || signals.activeCount >= 3) return "";
  const missing = [];
  if (!signals.t1PeerModel) missing.push("T1 peer model");
  if (!signals.t2ExternalKnowledge) missing.push("T2 external knowledge");
  if (!signals.t3GroundTruth) missing.push("T3 ground truth");
  if (missing.length === 0) return "";
  // PR-F2 — surface false-confidence cases: env flag set but tier didn't
  // actually contribute. This is the palate-pilot / 3stripe-event bug.
  const stale = [];
  if (signals.t2EnvSet && !signals.t2ExternalKnowledge) stale.push("T2 (env set, no data)");
  if (signals.t3EnvSet && !signals.t3GroundTruth) stale.push("T3 (env set, no data)");
  const staleSuffix = stale.length
    ? ` · ${COLORS.yellow}enabled-but-silent: ${stale.join(", ")}${COLORS.reset}${COLORS.gray}`
    : "";
  return `\n${COLORS.gray}ℹ️  Active external signals: ${signals.activeCount}/3. Missing: ${missing.join(", ")}.${staleSuffix}${COLORS.reset}\n`;
}

// ============================================================================
// T3 Ground Truth — real runtime signals (PR-E1)
// ============================================================================
// Fetches actual deployment/runtime state from external services so the review
// prompt can be grounded in what's actually shipped, not what the model
// thinks is probably shipped. Currently: Vercel deployments. Supabase wiring
// is stubbed (project-ref resolution only — full log API is follow-up).

/**
 * Resolve Vercel project identifier for the current working dir.
 * Order:
 *   1. .vercel/project.json (created by `vercel link` — most reliable)
 *   2. VERCEL_PROJECT_ID env var
 *   3. VERCEL_PROJECT env var (name, requires list lookup — we return as-is)
 * Returns { projectId, orgId, source } or null.
 */
function resolveVercelProject(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  try {
    const p = path.join(cwd, ".vercel", "project.json");
    if (fs.existsSync(p)) {
      const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
      if (cfg.projectId) {
        return {
          projectId: cfg.projectId,
          orgId: cfg.orgId || null,
          source: ".vercel/project.json",
        };
      }
    }
  } catch (_) { /* ignore */ }
  if (env.VERCEL_PROJECT_ID) {
    return {
      projectId: env.VERCEL_PROJECT_ID,
      orgId: env.VERCEL_TEAM_ID || env.VERCEL_ORG_ID || null,
      source: "VERCEL_PROJECT_ID env",
    };
  }
  if (env.VERCEL_PROJECT) {
    return {
      projectId: env.VERCEL_PROJECT,
      orgId: env.VERCEL_TEAM_ID || env.VERCEL_ORG_ID || null,
      source: "VERCEL_PROJECT env (name)",
    };
  }
  return null;
}

function resolveSupabaseProject(opts = {}) {
  const env = opts.env || process.env;
  if (env.SUPABASE_PROJECT_REF) {
    return { projectRef: env.SUPABASE_PROJECT_REF, source: "SUPABASE_PROJECT_REF env" };
  }
  return null;
}

/**
 * Fetch last N deployments from Vercel REST API.
 * Returns { ok: true, deployments: [...], summary: {...} } or { ok: false, error }.
 * Network failures, timeouts, and auth errors are all soft — they return
 * ok:false with a reason string so the review can proceed without GT.
 */
async function fetchVercelGroundTruth(opts) {
  const { token, projectId, orgId = null, limit = 10, timeoutMs = 8000, fetchImpl } = opts;
  if (!token || !projectId) return { ok: false, error: "missing token or projectId" };
  const qs = new URLSearchParams({ projectId, limit: String(limit) });
  if (orgId) qs.set("teamId", orgId);
  const url = `https://api.vercel.com/v6/deployments?${qs.toString()}`;
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, error: "fetch not available" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: `vercel http ${res.status}` };
    }
    const data = await res.json();
    const deployments = (data.deployments || []).map((d) => ({
      uid: d.uid,
      state: d.state || d.readyState || "UNKNOWN",
      url: d.url,
      target: d.target || null,
      createdAt: d.created || d.createdAt,
      ready: d.ready,
      aliasError: d.aliasError || null,
    }));
    return { ok: true, deployments, summary: summarizeVercelDeployments(deployments) };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e.name === "AbortError" ? "timeout" : String(e.message || e) };
  }
}

function summarizeVercelDeployments(deployments) {
  const total = deployments.length;
  const byState = {};
  for (const d of deployments) {
    byState[d.state] = (byState[d.state] || 0) + 1;
  }
  const production = deployments.filter((d) => d.target === "production");
  const latestProduction = production[0] || null;
  const latestError = deployments.find((d) => d.state === "ERROR") || null;
  return {
    total,
    byState,
    latestProduction,
    latestError,
    errorCount: byState.ERROR || 0,
  };
}

/**
 * Top-level orchestrator. Runs all available GT fetchers in parallel with a
 * shared deadline. Returns a normalized payload that the review prompt
 * formatter can consume. Never throws — failures are captured per-source.
 */
async function fetchGroundTruth(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const timeoutMs = opts.timeoutMs || 8000;
  const fetchImpl = opts.fetchImpl;
  const result = {
    fetchedAt: new Date().toISOString(),
    vercel: null,
    supabase: null,
    hasData: false,
  };
  const jobs = [];

  if (env.VERCEL_TOKEN) {
    const proj = resolveVercelProject({ cwd, env });
    if (proj) {
      jobs.push(
        fetchVercelGroundTruth({
          token: env.VERCEL_TOKEN,
          projectId: proj.projectId,
          orgId: proj.orgId,
          timeoutMs,
          fetchImpl,
        }).then((r) => {
          result.vercel = { ...r, resolved: proj };
        }),
      );
    } else {
      result.vercel = { ok: false, error: "project not identified (no .vercel/project.json, no VERCEL_PROJECT_ID)" };
    }
  }

  if (env.SUPABASE_ACCESS_TOKEN) {
    const proj = resolveSupabaseProject({ env });
    if (proj) {
      result.supabase = { ok: false, error: "supabase log fetch not implemented yet (PR-E1.5)", resolved: proj };
    } else {
      result.supabase = { ok: false, error: "project not identified (set SUPABASE_PROJECT_REF)" };
    }
  }

  if (jobs.length) await Promise.allSettled(jobs);
  result.hasData = !!(result.vercel && result.vercel.ok && result.vercel.deployments && result.vercel.deployments.length);
  return result;
}

/**
 * Render ground-truth payload as a Korean markdown section for injection
 * into the review system prompt. Empty string if no data — the review still
 * runs, it just lacks the grounding section.
 */
function formatGroundTruthContext(gt) {
  if (!gt) return "";
  const lines = [];
  const vercel = gt.vercel;
  const supabase = gt.supabase;

  const hasAnything = (vercel && (vercel.ok || vercel.error)) || (supabase && (supabase.ok || supabase.error));
  if (!hasAnything) return "";

  lines.push(`\n## 최근 프로덕션 신호 (T3 Ground Truth)`);
  lines.push(`> 실제 배포/런타임 상태. [확정] 자료로 인용 가능. 아래 내용과 diff 가 충돌하면 diff 쪽을 의심한다.`);

  if (vercel) {
    lines.push(`\n### Vercel`);
    if (!vercel.ok) {
      lines.push(`- 조회 실패: ${vercel.error}. 배포 상태는 [미검증].`);
    } else {
      const s = vercel.summary || {};
      const stateStr = Object.entries(s.byState || {})
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "(없음)";
      lines.push(`- 최근 ${s.total} 개 배포 상태: ${stateStr}`);
      if (s.latestProduction) {
        const lp = s.latestProduction;
        lines.push(`- 최신 production: \`${lp.state}\` · ${lp.url || "(no url)"} · ${lp.createdAt ? new Date(lp.createdAt).toISOString() : "n/a"}`);
      } else {
        lines.push(`- 최신 production 배포 없음 (preview 만 존재).`);
      }
      if (s.errorCount > 0 && s.latestError) {
        lines.push(`- 최근 ERROR 배포 있음: \`${s.latestError.uid}\` @ ${s.latestError.createdAt ? new Date(s.latestError.createdAt).toISOString() : "n/a"}. 이 diff 가 그 에러와 관련될 가능성 의심.`);
      } else if (s.errorCount === 0) {
        lines.push(`- 최근 ${s.total} 개 중 ERROR 없음.`);
      }
    }
  }

  if (supabase) {
    lines.push(`\n### Supabase`);
    if (!supabase.ok) {
      lines.push(`- ${supabase.error}`);
    }
  }

  lines.push(``);
  lines.push(`위 Ground Truth 를 review 의 근거로 삼아라. diff 가 production 에러 근처를 건드리면 반드시 언급한다.`);
  return lines.join("\n") + "\n";
}

// ============================================================================
// T2 External Knowledge — package currency / stack freshness (PR-E2)
// ============================================================================
// Pulls real npm registry data for the project's direct dependencies so the
// review model knows the actual latest versions + deprecation status instead
// of relying on (potentially stale) training-data knowledge. Opt-in via
// COWORK_EXTERNAL_KNOWLEDGE=1 — registry traffic is public so no auth needed
// but we still gate it behind the flag to keep offline/air-gapped runs clean.

/**
 * Scan `package.json` in the working dir. Returns normalized dep lists.
 * Returns null if no package.json found or parse fails.
 */
function scanPackageJson(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const pkgPath = path.join(cwd, "package.json");
  try {
    if (!fs.existsSync(pkgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const dependencies = raw.dependencies || {};
    const devDependencies = raw.devDependencies || {};
    return {
      name: raw.name || null,
      version: raw.version || null,
      engines: raw.engines || {},
      dependencies,
      devDependencies,
      totalDeps: Object.keys(dependencies).length,
      totalDevDeps: Object.keys(devDependencies).length,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Strip semver prefixes (^, ~, >=, etc) and return major.minor.patch as
 * a plain string. Returns null for non-standard specifiers (git:, file:,
 * workspace:, npm:alias@, link:, etc) since we can't meaningfully compare.
 */
function parsePinnedVersion(spec) {
  if (!spec || typeof spec !== "string") return null;
  if (/^(workspace|file|link|git|github|npm|https?|\.)/.test(spec)) return null;
  const m = spec.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * Compare semver-ish versions. Returns { diff: "ahead"|"same"|"patch"|
 * "minor"|"major"|"unknown" } where "patch/minor/major" means installed
 * is BEHIND latest by that level.
 */
function compareVersions(installed, latest) {
  const pi = parsePinnedVersion(installed);
  const pl = parsePinnedVersion(latest);
  if (!pi || !pl) return { diff: "unknown", installed, latest };
  const [i1, i2, i3] = pi.split(".").map(Number);
  const [l1, l2, l3] = pl.split(".").map(Number);
  if (i1 > l1 || (i1 === l1 && i2 > l2) || (i1 === l1 && i2 === l2 && i3 > l3)) {
    return { diff: "ahead", installed: pi, latest: pl };
  }
  if (i1 === l1 && i2 === l2 && i3 === l3) return { diff: "same", installed: pi, latest: pl };
  if (i1 < l1) return { diff: "major", installed: pi, latest: pl };
  if (i2 < l2) return { diff: "minor", installed: pi, latest: pl };
  return { diff: "patch", installed: pi, latest: pl };
}

/**
 * Fetch a single package's registry metadata. Public API — no auth.
 * 5 s timeout. Returns { name, latest, deprecated } or { ok:false, error }.
 */
async function fetchNpmRegistry(name, opts = {}) {
  const { fetchImpl, timeoutMs = 5000 } = opts;
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, name, error: "fetch not available" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, name, error: `registry http ${res.status}` };
    const data = await res.json();
    const latest = (data["dist-tags"] && data["dist-tags"].latest) || null;
    // The abbreviated metadata includes per-version info in `versions`.
    const versionInfo = latest && data.versions && data.versions[latest];
    const deprecated = versionInfo && versionInfo.deprecated ? String(versionInfo.deprecated) : null;
    return { ok: true, name, latest, deprecated };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, name, error: e.name === "AbortError" ? "timeout" : String(e.message || e) };
  }
}

/**
 * Fetch currency info for a bag of deps. Returns report with entries sorted
 * by staleness (major > minor > patch). Concurrency-limited to be polite
 * to the public registry.
 */
async function fetchPackageCurrency(opts) {
  const {
    deps = {},
    fetchImpl,
    timeoutMs = 5000,
    concurrency = 6,
    limit = 20,
  } = opts;
  const names = Object.keys(deps).slice(0, limit);
  const results = [];
  // Simple concurrency pool.
  let idx = 0;
  async function worker() {
    while (idx < names.length) {
      const i = idx++;
      const name = names[i];
      const installedSpec = deps[name];
      const reg = await fetchNpmRegistry(name, { fetchImpl, timeoutMs });
      if (!reg.ok) {
        results.push({ name, installedSpec, ok: false, error: reg.error });
        continue;
      }
      const cmp = compareVersions(installedSpec, reg.latest);
      results.push({
        name,
        installedSpec,
        installed: cmp.installed,
        latest: reg.latest,
        diff: cmp.diff,
        deprecated: reg.deprecated,
        ok: true,
      });
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, names.length) }, worker);
  await Promise.all(workers);
  // Sort: major > minor > patch > deprecated > same/ahead/unknown
  const rank = { major: 0, minor: 1, patch: 2, same: 4, ahead: 5, unknown: 6 };
  results.sort((a, b) => {
    if (a.deprecated && !b.deprecated) return -1;
    if (!a.deprecated && b.deprecated) return 1;
    return (rank[a.diff] ?? 7) - (rank[b.diff] ?? 7);
  });
  return {
    scanned: names.length,
    total: Object.keys(deps).length,
    entries: results,
    summary: {
      major: results.filter((r) => r.diff === "major").length,
      minor: results.filter((r) => r.diff === "minor").length,
      patch: results.filter((r) => r.diff === "patch").length,
      deprecated: results.filter((r) => r.deprecated).length,
      errored: results.filter((r) => !r.ok).length,
    },
  };
}

// ============================================================================
// T2 Security Advisories — OSV.dev (PR-G4)
// ============================================================================
// Queries the public OSV.dev API for known vulnerabilities affecting each
// direct dependency at the pinned version. OSV aggregates GitHub Security
// Advisory Database (GHSA), CVE, npm advisories, and others — no auth
// required, public rate limits, 5 s timeout per request.
//
// Gate: COWORK_EXTERNAL_KNOWLEDGE_SECURITY. Defaults to ON when
// COWORK_EXTERNAL_KNOWLEDGE=1 is set (same trust boundary as registry
// traffic). Set to "0" to disable explicitly.

/**
 * Normalize a raw OSV severity block to a simple tag.
 * OSV returns severity as an array of {type, score} entries (CVSS_V3 /
 * CVSS_V4), and also an optional `database_specific.severity` string
 * ("LOW"|"MODERATE"|"HIGH"|"CRITICAL"). We prefer database_specific when
 * present, otherwise derive from CVSS score.
 */
function normalizeOsvSeverity(vuln) {
  const db = vuln && vuln.database_specific;
  if (db && typeof db.severity === "string") {
    const s = db.severity.toUpperCase();
    if (s === "CRITICAL" || s === "HIGH" || s === "MODERATE" || s === "LOW") return s;
  }
  const sev = Array.isArray(vuln && vuln.severity) ? vuln.severity : [];
  for (const entry of sev) {
    if (!entry || typeof entry.score !== "string") continue;
    // CVSS vector string — pull the base score if it looks like a pure number,
    // otherwise fall through to keyword heuristics below.
    const asNum = Number(entry.score);
    if (!Number.isNaN(asNum)) {
      if (asNum >= 9.0) return "CRITICAL";
      if (asNum >= 7.0) return "HIGH";
      if (asNum >= 4.0) return "MODERATE";
      if (asNum > 0) return "LOW";
    }
  }
  return "UNKNOWN";
}

/**
 * Severity rank for sorting. Higher number = more urgent.
 */
function severityRank(sev) {
  switch ((sev || "").toUpperCase()) {
    case "CRITICAL": return 4;
    case "HIGH": return 3;
    case "MODERATE": return 2;
    case "LOW": return 1;
    default: return 0;
  }
}

/**
 * Query OSV.dev for a single package@version. Returns
 * { ok, name, version, vulns:[{id, summary, severity, references}] } or
 * { ok:false, error }.
 */
async function fetchOsvAdvisories(name, version, opts = {}) {
  const { fetchImpl, timeoutMs = 5000 } = opts;
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, name, version, error: "fetch not available" };
  if (!name || !version) return { ok: false, name, version, error: "missing name or version" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        package: { name, ecosystem: "npm" },
        version,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, name, version, error: `osv http ${res.status}` };
    const data = await res.json();
    const rawVulns = Array.isArray(data && data.vulns) ? data.vulns : [];
    const vulns = rawVulns.map((v) => {
      const refs = Array.isArray(v.references) ? v.references.map((r) => r && r.url).filter(Boolean).slice(0, 3) : [];
      const aliases = Array.isArray(v.aliases) ? v.aliases : [];
      const cve = aliases.find((a) => /^CVE-/i.test(a)) || null;
      const ghsa = aliases.find((a) => /^GHSA-/i.test(a)) || (/^GHSA-/i.test(v.id || "") ? v.id : null);
      return {
        id: v.id || null,
        cve,
        ghsa,
        summary: typeof v.summary === "string" ? v.summary : null,
        severity: normalizeOsvSeverity(v),
        published: v.published || null,
        modified: v.modified || null,
        references: refs,
      };
    });
    // Sort by severity desc, then id.
    vulns.sort((a, b) => {
      const d = severityRank(b.severity) - severityRank(a.severity);
      if (d) return d;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
    return { ok: true, name, version, vulns };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, name, version, error: e.name === "AbortError" ? "timeout" : String(e.message || e) };
  }
}

/**
 * Batched OSV lookup across a list of { name, version } entries. Uses the
 * same concurrency pool as package-currency to be polite. Skips entries
 * with unresolvable versions (git:, workspace:, etc).
 */
async function fetchSecurityAdvisories(opts) {
  const {
    deps = {},
    fetchImpl,
    timeoutMs = 5000,
    concurrency = 6,
    limit = 20,
  } = opts;
  const names = Object.keys(deps).slice(0, limit);
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < names.length) {
      const i = idx++;
      const name = names[i];
      const spec = deps[name];
      const version = parsePinnedVersion(spec);
      if (!version) {
        results.push({ name, installedSpec: spec, ok: false, skipped: true, error: "unresolvable version" });
        continue;
      }
      const r = await fetchOsvAdvisories(name, version, { fetchImpl, timeoutMs });
      if (!r.ok) {
        results.push({ name, installedSpec: spec, version, ok: false, error: r.error });
        continue;
      }
      results.push({ name, installedSpec: spec, version, ok: true, vulns: r.vulns });
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, names.length) }, worker);
  await Promise.all(workers);
  // Sort entries: vulnerable packages first (by highest severity), then clean.
  results.sort((a, b) => {
    const av = a.ok && a.vulns && a.vulns.length ? severityRank(a.vulns[0].severity) : -1;
    const bv = b.ok && b.vulns && b.vulns.length ? severityRank(b.vulns[0].severity) : -1;
    if (bv !== av) return bv - av;
    return String(a.name).localeCompare(String(b.name));
  });
  const vulnerable = results.filter((r) => r.ok && r.vulns && r.vulns.length);
  const summary = {
    critical: 0, high: 0, moderate: 0, low: 0, unknown: 0,
    packagesAffected: vulnerable.length,
    totalVulns: 0,
    errored: results.filter((r) => !r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
  };
  for (const r of vulnerable) {
    for (const v of r.vulns) {
      summary.totalVulns++;
      const key = (v.severity || "UNKNOWN").toLowerCase();
      if (summary[key] !== undefined) summary[key]++;
    }
  }
  return {
    scanned: names.length,
    total: Object.keys(deps).length,
    entries: results,
    summary,
  };
}

/**
 * Top-level T2 orchestrator. Runs only when COWORK_EXTERNAL_KNOWLEDGE=1 is
 * set (or one of the granular flags). Always resolves.
 */
async function fetchExternalKnowledge(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const fetchImpl = opts.fetchImpl;
  const timeoutMs = opts.timeoutMs || 5000;
  const includeDev = env.COWORK_EXTERNAL_KNOWLEDGE_INCLUDE_DEV === "1";

  const enabled =
    env.COWORK_EXTERNAL_KNOWLEDGE === "1"
    || !!env.COWORK_PACKAGE_REGISTRY;
  if (!enabled) {
    return {
      enabled: false,
      fetchedAt: null,
      packageCurrency: null,
      securityAdvisories: null,
      hasData: false,
    };
  }

  const pkg = scanPackageJson({ cwd });
  if (!pkg) {
    return {
      enabled: true,
      fetchedAt: new Date().toISOString(),
      packageCurrency: null,
      securityAdvisories: null,
      hasData: false,
      error: "no package.json found",
    };
  }

  const deps = includeDev
    ? { ...pkg.dependencies, ...pkg.devDependencies }
    : pkg.dependencies;

  // Security advisories default to ON when T2 is enabled. Opt-out with "0".
  const securityEnabled = env.COWORK_EXTERNAL_KNOWLEDGE_SECURITY !== "0";

  // Fetch currency + advisories in parallel — both hit independent public APIs.
  const [packageCurrency, securityAdvisories] = await Promise.all([
    fetchPackageCurrency({ deps, fetchImpl, timeoutMs }),
    securityEnabled
      ? fetchSecurityAdvisories({ deps, fetchImpl, timeoutMs }).catch((e) => ({
          scanned: 0, total: Object.keys(deps).length, entries: [],
          summary: { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0, packagesAffected: 0, totalVulns: 0, errored: 0, skipped: 0, fatal: String(e.message || e) },
        }))
      : Promise.resolve(null),
  ]);

  const hasCurrency = !!(packageCurrency && packageCurrency.entries.length);
  const hasAdvisories = !!(securityAdvisories && securityAdvisories.summary && securityAdvisories.summary.totalVulns > 0);

  return {
    enabled: true,
    fetchedAt: new Date().toISOString(),
    projectName: pkg.name,
    projectVersion: pkg.version,
    engines: pkg.engines,
    packageCurrency,
    securityAdvisories,
    hasData: hasCurrency || hasAdvisories,
  };
}

/**
 * Render T2 payload as markdown for prompt injection. Empty string if
 * nothing useful to report.
 */
function formatExternalKnowledgeContext(ek) {
  if (!ek || !ek.enabled) return "";
  const pc = ek.packageCurrency;
  const sa = ek.securityAdvisories;
  const hasCurrency = !!(pc && pc.entries && pc.entries.length);
  const hasAdvisories = !!(sa && sa.summary && sa.summary.totalVulns > 0);
  if (!hasCurrency && !hasAdvisories) return "";

  const lines = [];

  if (hasCurrency) {
    lines.push(`\n## 스택 최신성 (T2 External Knowledge)`);
    lines.push(`> npm registry 실시간 조회 결과 (상위 ${pc.scanned}/${pc.total} 개 direct dep). [확정] 자료.`);

    const s = pc.summary;
    const tags = [];
    if (s.major) tags.push(`major behind: ${s.major}`);
    if (s.minor) tags.push(`minor behind: ${s.minor}`);
    if (s.patch) tags.push(`patch behind: ${s.patch}`);
    if (s.deprecated) tags.push(`deprecated: ${s.deprecated}`);
    if (s.errored) tags.push(`lookup 실패: ${s.errored}`);
    lines.push(`- 요약: ${tags.length ? tags.join(", ") : "모든 패키지 최신 또는 ahead"}`);

    // Surface the most interesting items — deprecated + major/minor behind.
    const flagged = pc.entries.filter(
      (e) => e.deprecated || e.diff === "major" || e.diff === "minor",
    );
    if (flagged.length) {
      lines.push(``);
      lines.push(`### 주의 대상 패키지`);
      for (const e of flagged.slice(0, 10)) {
        if (!e.ok) continue;
        if (e.deprecated) {
          lines.push(`- ⚠️ \`${e.name}@${e.installed || e.installedSpec}\` — **deprecated**: ${e.deprecated.slice(0, 120)}`);
        } else if (e.diff === "major") {
          lines.push(`- ⛔ \`${e.name}\` installed=${e.installed}, latest=${e.latest} — **major** 뒤처짐. breaking change 가능성.`);
        } else if (e.diff === "minor") {
          lines.push(`- ⚠️ \`${e.name}\` installed=${e.installed}, latest=${e.latest} — minor 뒤처짐.`);
        }
      }
    }
  }

  if (hasAdvisories) {
    const ss = sa.summary;
    lines.push(`\n## 보안 취약점 (T2 Security Advisories — OSV.dev / GHSA / CVE)`);
    lines.push(`> OSV.dev 실시간 조회. ${ss.packagesAffected}개 패키지에 ${ss.totalVulns}개 알려진 취약점. [확정] 자료.`);
    const sevTags = [];
    if (ss.critical) sevTags.push(`CRITICAL: ${ss.critical}`);
    if (ss.high) sevTags.push(`HIGH: ${ss.high}`);
    if (ss.moderate) sevTags.push(`MODERATE: ${ss.moderate}`);
    if (ss.low) sevTags.push(`LOW: ${ss.low}`);
    if (ss.unknown) sevTags.push(`UNKNOWN: ${ss.unknown}`);
    if (sevTags.length) lines.push(`- 심각도: ${sevTags.join(", ")}`);

    // Show top vulnerable packages with their highest-severity advisory first.
    const vulnerable = sa.entries.filter((e) => e.ok && e.vulns && e.vulns.length).slice(0, 8);
    if (vulnerable.length) {
      lines.push(``);
      lines.push(`### 영향받는 패키지`);
      for (const e of vulnerable) {
        const top = e.vulns[0];
        const icon = top.severity === "CRITICAL" || top.severity === "HIGH" ? "⛔" : "⚠️";
        const idStr = top.cve || top.ghsa || top.id || "advisory";
        const extra = e.vulns.length > 1 ? ` (+${e.vulns.length - 1} more)` : "";
        const summary = top.summary ? ` — ${top.summary.slice(0, 140)}` : "";
        lines.push(`- ${icon} \`${e.name}@${e.version}\` · **${top.severity}** · [${idStr}]${extra}${summary}`);
      }
    }
    lines.push(``);
    lines.push(`diff 가 위 패키지를 건드리면 취약점 수정 여부를 함께 검토한다. 취약점이 BLOCKER 수준이면 리뷰 verdict에 반영.`);
  } else if (hasCurrency) {
    // Only add the currency trailer when there are no advisories.
    lines.push(``);
    lines.push(`diff 가 위 패키지를 사용하는 파일을 건드리면 버전 차이를 감안해 리뷰한다. 학습 데이터 기반 기억보다 위 수치를 우선한다.`);
  }

  return lines.join("\n") + "\n";
}

// ============================================================================
// LIVE SOURCES & AGENT IDENTITY
// ============================================================================

/**
 * Detect which MCP live sources are available. Probes:
 *   1. Claude Desktop config (most authoritative)
 *   2. SKILL.md mcp: field (user-declared)
 *   3. Env var hints (inferred but not confirmed)
 *
 * Returns array with .confirmed and .inferred non-enumerable properties.
 *
 * Heuristic note: env-var detection used to claim "connected" — that's wrong because
 * a token can exist without the MCP server being registered. Now downgraded to [추정].
 */
function detectLiveSources() {
  const confirmed = new Set();
  const inferred = new Set();

  // Probe 1: Claude Desktop MCP config (most authoritative on Cowork)
  const desktopConfigPaths = [
    process.env.CLAUDE_DESKTOP_CONFIG,
    path.join(os.homedir(), ".claude", "mcp.json"),
    path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    path.join(os.homedir(), "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
    path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json"),
  ].filter(Boolean);
  for (const p of desktopConfigPaths) {
    try {
      if (!fs.existsSync(p)) continue;
      const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
      const servers = cfg.mcpServers || cfg.mcp_servers || cfg.mcp || {};
      Object.keys(servers).forEach((name) => {
        const norm = name.toLowerCase();
        if (norm.includes("github")) confirmed.add("github");
        else if (norm.includes("vercel")) confirmed.add("vercel");
        else if (norm.includes("supabase")) confirmed.add("supabase");
        else if (norm.includes("figma")) confirmed.add("figma");
        else if (norm.includes("gdrive") || norm.includes("google-drive") || norm.includes("google_drive")) confirmed.add("gdrive");
        else if (norm.includes("gcal") || norm.includes("calendar")) confirmed.add("gcal");
        else if (norm.includes("slack")) confirmed.add("slack");
        else if (norm.includes("notion")) confirmed.add("notion");
        else confirmed.add(norm);
      });
      break; // first found wins
    } catch (_) { /* ignore parse error, try next */ }
  }

  // Probe 2: solo-cto-agent SKILL.md `mcp:` field (user-declared)
  try {
    if (_CONFIG && _CONFIG.skillDir) {
      const text = fs.readFileSync(path.join(_CONFIG.skillDir, "SKILL.md"), "utf8");
      const m = text.match(/^mcp:\s*\[([^\]]+)\]/im);
      if (m) {
        m[1].split(",").map((s) => s.trim().replace(/['"]/g, "")).forEach((s) => {
          if (s) confirmed.add(s.toLowerCase());
        });
      }
    }
  } catch (_) {}

  // Inferred: env-var hints (credentials exist, not the same as MCP being wired)
  if (process.env.MCP_GITHUB || process.env.GITHUB_TOKEN) inferred.add("github");
  if (process.env.MCP_VERCEL || process.env.VERCEL_TOKEN) inferred.add("vercel");
  if (process.env.MCP_SUPABASE || process.env.SUPABASE_ACCESS_TOKEN) inferred.add("supabase");
  if (process.env.MCP_FIGMA || process.env.FIGMA_TOKEN) inferred.add("figma");

  // Drop inferred entries that are already confirmed
  confirmed.forEach((c) => inferred.delete(c));

  // Backward compat: flat array contains both (test suites + existing callers).
  // Provenance attached as non-enumerable .confirmed / .inferred for context-aware printers.
  const result = [...confirmed, ...inferred];
  Object.defineProperty(result, "confirmed", { value: Array.from(confirmed), enumerable: false });
  Object.defineProperty(result, "inferred", { value: Array.from(inferred), enumerable: false });
  return result;
}

function liveSourceContext() {
  const sources = detectLiveSources();
  const confirmed = sources.confirmed || sources;
  const inferred = sources.inferred || [];

  if (!confirmed.length && !inferred.length) {
    return `\n## 라이브 소스\nMCP 라이브 소스 없음 (Claude Desktop mcp.json 미발견 + env 힌트 없음).\n모든 외부 상태는 [추정] 또는 [미검증] 으로 표기.\n오프라인 폴백: 캐시된 failure-catalog 와 personalization 만 사용.\n`;
  }

  const lines = [`\n## 라이브 소스`];
  if (confirmed.length) {
    lines.push(`확정 MCP (Claude Desktop config 또는 SKILL.md mcp: 명시) — [확정] 자료로 인용 가능:`);
    lines.push(`  ${confirmed.join(", ")}`);
  }
  if (inferred.length) {
    lines.push(`추정 MCP (env 토큰만 존재 — MCP 서버 등록 여부 미확인) — [추정] 으로만 인용:`);
    lines.push(`  ${inferred.join(", ")}`);
  }
  const has = (n) => confirmed.includes(n);
  lines.push(``);
  lines.push(`- 배포 상태: ${has("vercel") ? "Vercel MCP 직접 조회 가능 [확정]" : "라이브 MCP 없음 → [추정]"}`);
  lines.push(`- DB 상태:   ${has("supabase") ? "Supabase MCP 직접 조회 가능 [확정]" : "라이브 MCP 없음 → [추정]"}`);
  lines.push(`- 코드 상태: ${has("github") ? "GitHub MCP 직접 조회 가능 [확정]" : "로컬 git 만 → [캐시]"}`);
  lines.push(`문서/이전 기억보다 위 라이브 소스를 우선한다. 추정 항목은 단정 표현 금지.`);
  return lines.join("\n") + "\n";
}

/**
 * Tier 에 맞는 에이전트 아이덴티티 + agent 구성 표시.
 * agent: "cowork" | "cowork+codex"
 */
function buildIdentity(tier, agent) {
  const id = AGENT_IDENTITY_BY_TIER[tier] || AGENT_IDENTITY_BY_TIER.builder;
  const agentLine = agent === "cowork+codex"
    ? "\n에이전트 구성: Cowork + Codex (dual). 합의/불일치를 명시한다."
    : "\n에이전트 구성: Cowork 단독. 자기 검증 (self cross-review) 으로 단일 시점 의견의 한계를 보완한다.";
  return id + agentLine;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  init,
  // External signal assessment
  assessExternalSignals,
  formatSelfLoopWarning,
  formatPartialSignalHint,
  // T3 Ground Truth
  resolveVercelProject,
  resolveSupabaseProject,
  fetchVercelGroundTruth,
  summarizeVercelDeployments,
  fetchGroundTruth,
  formatGroundTruthContext,
  // T2 External Knowledge
  scanPackageJson,
  parsePinnedVersion,
  compareVersions,
  fetchNpmRegistry,
  fetchPackageCurrency,
  fetchExternalKnowledge,
  formatExternalKnowledgeContext,
  // T2 Security Advisories
  normalizeOsvSeverity,
  severityRank,
  fetchOsvAdvisories,
  fetchSecurityAdvisories,
  // Live sources & identity
  detectLiveSources,
  liveSourceContext,
  buildIdentity,
  // Constants
  AGENT_IDENTITY_BY_TIER,
  AGENT_IDENTITY,
  COLORS,
};
