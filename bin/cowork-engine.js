#!/usr/bin/env node

/**
 * cowork-engine.js
 *
 * Core engine for Cowork mode ??LOCAL execution without GitHub Actions.
 * Supports:
 *   - Mode A: Cowork Solo (Claude-only, all local)
 *   - Mode B: Cowork+Codex Dual (Claude + Codex cross-review)
 *
 * Usage:
 *   node bin/cowork-engine.js local-review [--staged|--branch|--file <path>] [--dry-run] [--json]
 *   node bin/cowork-engine.js knowledge-capture [--session|--file <path>] [--project <tag>]
 *   node bin/cowork-engine.js dual-review [--staged|--branch] [--json]
 *   node bin/cowork-engine.js detect-mode
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

// Lazy path getters ??resolve $HOME at call time so tests can override.
// Tests can also set COWORK_SKILL_DIR_OVERRIDE env var or via _setSkillDirOverride().
let _skillDirOverride = null;
function _setSkillDirOverride(p) { _skillDirOverride = p; }
const _skillBase = () => _skillDirOverride
  || process.env.COWORK_SKILL_DIR_OVERRIDE
  || path.join(os.homedir(), ".claude", "skills", "solo-cto-agent");
const CONFIG = {
  get skillDir() { return _skillBase(); },
  get reviewsDir() { return path.join(_skillBase(), "reviews"); },
  get knowledgeDir() { return path.join(_skillBase(), "knowledge"); },
  get sessionsDir() { return path.join(_skillBase(), "sessions"); },
  get personalizationFile() { return path.join(_skillBase(), "personalization.json"); },
  defaultModel: {
    claude: "claude-sonnet-4-20250514",
    codex: "codex-mini-latest",
  },
  // Tier 횞 Mode ?먮룞???쒓퀎 (Semi-auto mode)
  tierLimits: {
    maker:   { maxRetries: 2, selfCrossReview: false, autoMcpProbe: false, maxIssuesShown: 5  },
    builder: { maxRetries: 3, selfCrossReview: true,  autoMcpProbe: true,  maxIssuesShown: 10 },
    cto:     { maxRetries: 3, selfCrossReview: true,  autoMcpProbe: true,  maxIssuesShown: 20 },
  },
};

// ============================================================================
// EMBEDDED SKILL CONTEXT
// ?뺥솗??蹂몃Ц? skills/_shared/skill-context.md ? ?숆린??(build-time check)
// ============================================================================

// A. ?댁쁺 ?먯튃 (?ㅽ깮 臾닿?)
const OPERATING_PRINCIPLES = `
## ?댁쁺 ?먯튃 (?ㅽ깮 臾닿?)
- Live Source of Truth: 諛고룷쨌DB쨌肄붾뱶쨌濡쒓렇????긽 ?쇱씠釉??뚯뒪 吏곸젒 議고쉶. 臾몄꽌 湲곗뼲 ?섏〈 湲덉?.
  ???쇱씠釉?= [?뺤젙], 罹먯떆 = [罹먯떆], 異붿젙 = [異붿젙], 誘명솗??= [誘멸?利?
- 理쒖냼 ?덉쟾 ?섏젙: ?붿껌 踰붿쐞 諛?由ы뙥?좊쭅 湲덉?. diff 諛??뚯씪 ?멸툒 湲덉?.
- ?먮윭 泥섎━: 議곗슜???ㅽ뙣 湲덉?. try-catch ???ㅼ젣 ?ㅽ뙣 吏?먯뿉留? 援ъ“?붾맂 ?먮윭 諛섑솚.
- ?⑺듃 湲곕컲: 紐⑤뱺 ?섏튂쨌二쇱옣??[?뺤젙]/[異붿젙]/[誘멸?利?/[罹먯떆]/[OFFLINE] ?쒓렇.
- PR 蹂몃Ц ?꾩닔: ?붿빟 / 由ъ뒪??LOW쨌MEDIUM쨌HIGH) / 濡ㅻ갚 / Preview 留곹겕.
- Circuit Breaker: 媛숈? ?먮윭 3???ъ떆???ㅽ뙣 ???뺤? ??蹂닿퀬.
`;

// B. Common Stack ?⑦꽩 (?먯＜ ?깆옣?섎뒗 ?ㅽ깮)
const COMMON_STACK_PATTERNS = `
## Common Stack 諛섎났 ?먮윭 ?⑦꽩 (?ъ슜??stack 留ㅼ묶 ???쒖꽦)
- Next.js: import @/ ?덈?寃쎈줈, 14/15 params ?숆린/Promise ?쇱슜 湲덉?, Tailwind v3/v4 ?쇱슜 湲덉?, 'use client' ?뺥솗??
- Prisma: Drizzle ? ?숈떆 ?ъ슜 湲덉?, prisma generate ??대컢 (postinstall ?먮뒗 build pre-step), schema 蹂寃???留덉씠洹몃젅?댁뀡 ?꾩닔
- NextAuth: session.user ?뺤옣 ??next-auth.d.ts types ?꾩슂, callback URL ?섍꼍蹂?遺꾨━
- Supabase: RLS ?쒖꽦??(鍮꾪솢??BLOCKER), service_role ?대씪?댁뼵???몄텧 湲덉?, N+1 荑쇰━ ?먭?
- Vercel: env 蹂???꾨씫 / prisma generate ??대컢 / build command 遺덉씪移?= 鍮뚮뱶 ?ㅽ뙣 ?곸쐞 3
`;

// C. 由щ럭 ?곗꽑?쒖쐞
const REVIEW_PRIORITY = `
## 由щ럭 ?곗꽑?쒖쐞 (?믪쓬 ????쓬)
1. 蹂댁븞 (secret ?몄텧, auth bypass, SQL injection, RLS 鍮꾪솢?? ??BLOCKER
2. ?곗씠???먯떎 ?꾪뿕 (留덉씠洹몃젅?댁뀡 ?꾨씫, 臾댁감蹂?delete, ?몃옖??뀡 ?꾨씫) ??BLOCKER
3. ????덉쟾??(any, strict ?꾨컲) ??SUGGESTION (?섎룄 紐낇솗?섎㈃ NIT)
4. ?먮윭 泥섎━ (議곗슜???ㅽ뙣, 援ъ“?????? ??SUGGESTION
5. ?ㅽ깮 ?쇨???(Common Stack ?⑦꽩 ?꾨컲) ??SUGGESTION ?먮뒗 BLOCKER
6. PR 蹂몃Ц ?꾨씫 ??SUGGESTION
7. ?깅뒫 (N+1, 遺덊븘??re-render, ??踰덈뱾) ??SUGGESTION
8. ?ㅽ????쇨?????NIT
`;

// ?듯빀 SKILL_CONTEXT (?명솚??alias ??湲곗〈 肄붾뱶? ?몃? 李몄“??
const SKILL_CONTEXT = OPERATING_PRINCIPLES + "\n" + COMMON_STACK_PATTERNS;
const SKILL_REVIEW_CRITERIA = REVIEW_PRIORITY;

// D. Tier 蹂??먯씠?꾪듃 ?꾩씠?댄떚??
// CLAUDE.md ??"Maker Tier ??媛뺥븳 ???곸슜 湲덉?" 洹쒖튃 諛섏쁺
const AGENT_IDENTITY_BY_TIER = {
  maker: `?뱀떊? ?ъ슜?먯쓽 desktop ?먯꽌 ?숈옉?섎뒗 ?섏뼱 CTO ?? (Maker Tier ???숈뒿/寃利??④퀎)
- ?ъ슜?먭? 紐낆떆?곸쑝濡??몄텧???묒뾽留??섑뻾?쒕떎.
- ?쎌젏쨌由ъ뒪?щ? 移쒖젅?섍쾶 吏싲릺, ?⑥젙吏볦? ?딅뒗?? 寃利??≪뀡???④퍡 ?쒖떆?쒕떎.
- "?닿굔 ??몃떎" 蹂대떎 "??媛?뺤씠 源⑥?硫?~" ??議곌굔遺 ?쒗쁽 ?곗꽑.
- desktop runtime + ?대씪?곕뱶 amplifier (MCP, web search, scheduled task) 瑜???뼱 ???몄텧?먯꽌 媛移섎? 理쒕?濡?戮묐뒗??`,
  builder: `?뱀떊? ?ъ슜?먯쓽 desktop ?먯꽌 ?숈옉?섎뒗 ?섏뼱 CTO ?? (Builder Tier ???ㅽ뻾/諛고룷 ?④퀎)
- 肄붾뱶瑜?吏?ㅻ뒗 ?щ엺?댁?, 異붽?留??섎뒗 ?щ엺???꾨땲??
- 源⑥쭏 寃껋쓣 癒쇱? 蹂닿퀬, 留뚮뱾 寃껋쓣 ?섏쨷??蹂몃떎.
- ?먮룞 ?곸슜 媛?ν븳 LOW 由ъ뒪??蹂寃쎌? ?쒖븞怨??④퍡 媛??typecheck/test) 寃곌낵瑜?泥⑤??쒕떎.
- desktop runtime + ?대씪?곕뱶 amplifier ???쇱씠釉??뚯뒪 ([?뺤젙]) 瑜??곗꽑 ?몄슜?쒕떎.`,
  cto: `?뱀떊? CTO湲?co-founder ?? (CTO Tier ??硫???먯씠?꾪듃 ?ㅼ??ㅽ듃?덉씠??
- 諛고룷?섎뒗 寃껋? ?꾨? 蹂몄씤 梨낆엫?대씪???꾩젣?먯꽌 ?吏곸씤??
- ?좎?媛 ?좊궃?ㅺ퀬 ?대룄 ?由??꾩씠?붿뼱??留됱븘?좊떎.
- Cowork+Codex ?먮뒗 self cross-review 寃곌낵???⑹쓽/遺덉씪移섎? 紐낆떆?섍퀬 ?곗꽑?쒖쐞瑜??뺥븳??
- ?뺤콉??CTO Tier ???꾩쟾 ?먯쑉 ?ㅽ뻾? Full-auto + Dual ?먯꽌留? Semi-auto ?먯꽌???ъ슜??紐낆떆 ?몄텧???곕씪 ?숈옉.`,
};

// ?명솚??(援?肄붾뱶/?뚯뒪?멸? AGENT_IDENTITY 吏곸젒 李몄“?섎뒗 寃쎌슦)
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
// TIER 쨌 PERSONALIZATION 쨌 LIVE SOURCE LAYER (Cowork-specific)
// ============================================================================

/**
 * SKILL.md ?먯꽌 tier 異붿텧. ?놁쑝硫?builder (?덉쟾??湲곕낯).
 * tier: ?먮뒗 mode ?꾨뱶瑜?frontmatter ?먮뒗 蹂몃Ц?먯꽌 ?ㅼ틪.
 */
function readTier() {
  const skillPath = path.join(CONFIG.skillDir, "SKILL.md");
  try {
    const text = fs.readFileSync(skillPath, "utf8");
    const m = text.match(/^tier:\s*(maker|builder|cto)/im);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return "builder";
}

/**
 * SKILL.md ??mode ?꾨뱶 (cowork-main / codex-main). ?놁쑝硫?cowork-main.
 */
function readMode() {
  const skillPath = path.join(CONFIG.skillDir, "SKILL.md");
  try {
    const text = fs.readFileSync(skillPath, "utf8");
    const m = text.match(/^mode:\s*(cowork-main|codex-main)/im);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return "cowork-main";
}

/**
 * 媛쒖씤???꾩쟻 ?곗씠??濡쒕뱶. ?꾩쟻 ??ぉ:
 * - acceptedPatterns: ?ъ슜?먭? ?섎씫???쒖븞 ?⑦꽩 (location ?먮뒗 keyword)
 * - rejectedPatterns: ?ъ슜?먭? 嫄곕?/臾댁떆???쒖븞 ?⑦꽩
 * - repeatErrors: 諛섎났 諛쒖깮 ?먮윭 (failure-catalog 蹂닿컯??
 * - stylePrefs: { verbosity, commentDensity, naming } ???꾩쟻 ?대━?ㅽ떛
 * - lastUpdated: ISO timestamp
 */
function loadPersonalization() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG.personalizationFile, "utf8"));
  } catch (_) {
    return {
      acceptedPatterns: [],
      rejectedPatterns: [],
      repeatErrors: [],
      stylePrefs: {},
      reviewCount: 0,
      lastUpdated: null,
    };
  }
}

function savePersonalization(p) {
  ensureDir(CONFIG.skillDir);
  p.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CONFIG.personalizationFile, JSON.stringify(p, null, 2));
}

/**
 * 由щ럭 寃곌낵瑜?personalization ??諛섏쁺.
 * - ??reviewCount + 1
 * - ??BLOCKER/SUGGESTION ??낆쓽 location keyword ???꾩냽 異붿쟻??
 * - ?숈씪 location ??N???댁긽 諛섎났 ??repeatErrors ?깅줉
 */
function updatePersonalizationFromReview(review) {
  const p = loadPersonalization();
  p.reviewCount = (p.reviewCount || 0) + 1;

  // 媛?issue ??location ???ㅼ썙???뺥깭濡??꾩쟻
  for (const issue of review.issues || []) {
    const key = (issue.location || "").split(":")[0]; // path 遺遺꾨쭔
    if (!key) continue;
    const idx = p.repeatErrors.findIndex((e) => e.location === key && e.severity === issue.severity);
    if (idx >= 0) {
      p.repeatErrors[idx].count = (p.repeatErrors[idx].count || 1) + 1;
      p.repeatErrors[idx].lastSeen = new Date().toISOString();
    } else {
      p.repeatErrors.push({
        location: key,
        severity: issue.severity,
        count: 1,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  // ?곸쐞 50媛쒕쭔 ?좎?
  p.repeatErrors.sort((a, b) => (b.count || 0) - (a.count || 0));
  p.repeatErrors = p.repeatErrors.slice(0, 50);

  savePersonalization(p);
  return p;
}

/**
 * Record explicit accept/reject feedback on a review issue.
 * Used by `solo-cto-agent feedback accept|reject ...` CLI.
 *
 * Anti-bias contract: accepted patterns inform future "trust this verdict",
 * rejected patterns inform "user disputes this severity" so we down-weight
 * similar future findings. personalizationContext() consumes both.
 */
function recordFeedback({ verdict, location, severity, note = "" }) {
  if (!verdict || !["accept", "reject"].includes(verdict)) {
    throw new Error(`recordFeedback: verdict must be 'accept' or 'reject' (got: ${verdict})`);
  }
  if (!location) throw new Error("recordFeedback: location is required");

  const p = loadPersonalization();
  const bucket = verdict === "accept" ? "acceptedPatterns" : "rejectedPatterns";
  if (!Array.isArray(p[bucket])) p[bucket] = [];

  const pathOnly = location.split(":")[0];
  const existing = p[bucket].find((x) => x.location === pathOnly && x.severity === severity);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.lastSeen = new Date().toISOString();
    if (note) existing.note = note;
  } else {
    p[bucket].push({
      location: pathOnly,
      severity: severity || "UNKNOWN",
      count: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      note,
    });
  }

  // Keep buckets bounded
  p[bucket].sort((a, b) => (b.count || 0) - (a.count || 0));
  p[bucket] = p[bucket].slice(0, 100);

  savePersonalization(p);
  return { verdict, location: pathOnly, severity, totalInBucket: p[bucket].length };
}

/**
 * 媛쒖씤???꾩쟻 ?곗씠?곕? ?꾨＼?꾪듃 二쇱엯???띿뒪??釉붾줉?쇰줈 蹂??
 * 鍮??곹깭 (泥??ъ슜) 硫?鍮?臾몄옄??諛섑솚.
 *
 * Anti-bias rotation:
 *   - 80% of calls: full personalization context (exploit accumulated knowledge)
 *   - 20% of calls: minimal context with explicit "fresh look" hint (explore)
 *   This prevents over-fitting to past patterns and false-positive lock-in.
 *   Override deterministically via opts.exploration = true | false.
 */
function personalizationContext(opts = {}) {
  const p = loadPersonalization();
  if (!p.reviewCount) return "";

  // Decide rotation slot
  const explore = opts.exploration === true
    || (opts.exploration !== false && Math.random() < 0.20);

  if (explore) {
    return `\n## 媛쒖씤??而⑦뀓?ㅽ듃 (?먯깋 紐⑤뱶 ??怨쇨굅 ?⑦꽩 ?섏〈????땄)
?ъ슜???덉뒪?좊━ ${p.reviewCount}???꾩쟻?섏뼱 ?덉쑝???대쾲 由щ럭?????쒓컖?쇰줈 蹂몃떎.
怨쇨굅 ?レ뒪??嫄곕? ?⑦꽩? 李몄“留? ?⑥젙 洹쇨굅濡쒕뒗 ?ъ슜 湲덉?.
`;
  }

  const top = (p.repeatErrors || [])
    .filter((e) => (e.count || 0) >= 2)
    .slice(0, 8)
    .map((e) => `- ${e.location} (${e.severity}, ${e.count}??`)
    .join("\n");

  const accepted = (p.acceptedPatterns || [])
    .slice(0, 5)
    .map((x) => `- ${x.location} (${x.severity}, accept 횞${x.count})`)
    .join("\n");

  const rejected = (p.rejectedPatterns || [])
    .slice(0, 5)
    .map((x) => `- ${x.location} (${x.severity}, reject 횞${x.count})${x.note ? ` ??${x.note}` : ""}`)
    .join("\n");

  const styleLines = Object.entries(p.stylePrefs || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  let out = `\n## ?꾩쟻 媛쒖씤??而⑦뀓?ㅽ듃 (?ъ슜???덉뒪?좊━ ${p.reviewCount}??由щ럭 湲곗?)\n`;
  if (top) out += `\n諛섎났 諛쒖깮 ?レ뒪??(?곗꽑 ?먭?):\n${top}\n`;
  if (accepted) out += `\n?ъ슜?먭? ?댁쟾???숈쓽???⑦꽩 (媛以묒튂 ??:\n${accepted}\n`;
  if (rejected) out += `\n?ъ슜?먭? ?댁쟾??嫄곕????⑦꽩 (false positive 媛????媛以묒튂 ??:\n${rejected}\n`;
  if (styleLines) out += `\n?ъ슜???ㅽ????좏샇:\n${styleLines}\n`;
  if (!top && !accepted && !rejected && !styleLines) return "";
  return out;
}

/**
 * ?쇱씠釉??뚯뒪 (MCP 而ㅻ꽖?? 媛???щ? 媛먯?.
 * Semi-auto mode ?먯꽌??desktop runtime ???섍꼍 ?먮뒗 ?ъ슜??SKILL.md ??mcp ?꾨뱶瑜?蹂몃떎.
 * ?섍꼍蹂???뚰듃: MCP_VERCEL=1, MCP_SUPABASE=1, MCP_GITHUB=1 ??
 */
/**
 * Detect MCP live sources with provenance.
 *
 * Returns: { confirmed: [...], inferred: [...], all: [...] }
 *   - confirmed: probed from ~/.claude/mcp.json or claude_desktop_config.json (Claude Desktop)
 *                or solo-cto-agent SKILL.md `mcp:` field
 *   - inferred:  env vars only (token presence ??MCP installed; only suggests credentials exist)
 *
 * Heuristic note: env-var detection used to claim "connected" ??that's wrong because
 * a token can exist without the MCP server being registered. Now downgraded to [異붿젙].
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
    const text = fs.readFileSync(path.join(CONFIG.skillDir, "SKILL.md"), "utf8");
    const m = text.match(/^mcp:\s*\[([^\]]+)\]/im);
    if (m) {
      m[1].split(",").map((s) => s.trim().replace(/['"]/g, "")).forEach((s) => {
        if (s) confirmed.add(s.toLowerCase());
      });
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
    return `\n## ?쇱씠釉??뚯뒪\nMCP ?쇱씠釉??뚯뒪 ?놁쓬 (Claude Desktop mcp.json 誘몃컻寃?+ env ?뚰듃 ?놁쓬).\n紐⑤뱺 ?몃? ?곹깭??[異붿젙] ?먮뒗 [誘멸?利? ?쇰줈 ?쒓린.\n?ㅽ봽?쇱씤 ?대갚: 罹먯떆??failure-catalog ? personalization 留??ъ슜.\n`;
  }

  const lines = [`\n## ?쇱씠釉??뚯뒪`];
  if (confirmed.length) {
    lines.push(`?뺤젙 MCP (Claude Desktop config ?먮뒗 SKILL.md mcp: 紐낆떆) ??[?뺤젙] ?먮즺濡??몄슜 媛??`);
    lines.push(`  ${confirmed.join(", ")}`);
  }
  if (inferred.length) {
    lines.push(`異붿젙 MCP (env ?좏겙留?議댁옱 ??MCP ?쒕쾭 ?깅줉 ?щ? 誘명솗?? ??[異붿젙] ?쇰줈留??몄슜:`);
    lines.push(`  ${inferred.join(", ")}`);
  }
  const has = (n) => confirmed.includes(n);
  lines.push(``);
  lines.push(`- 諛고룷 ?곹깭: ${has("vercel") ? "Vercel MCP 吏곸젒 議고쉶 媛??[?뺤젙]" : "?쇱씠釉?MCP ?놁쓬 ??[異붿젙]"}`);
  lines.push(`- DB ?곹깭:   ${has("supabase") ? "Supabase MCP 吏곸젒 議고쉶 媛??[?뺤젙]" : "?쇱씠釉?MCP ?놁쓬 ??[異붿젙]"}`);
  lines.push(`- 肄붾뱶 ?곹깭: ${has("github") ? "GitHub MCP 吏곸젒 議고쉶 媛??[?뺤젙]" : "濡쒖뺄 git 留???[罹먯떆]"}`);
  lines.push(`臾몄꽌/?댁쟾 湲곗뼲蹂대떎 ???쇱씠釉??뚯뒪瑜??곗꽑?쒕떎. 異붿젙 ??ぉ? ?⑥젙 ?쒗쁽 湲덉?.`);
  return lines.join("\n") + "\n";
}

/**
 * Tier ??留욌뒗 ?먯씠?꾪듃 ?꾩씠?댄떚??+ agent 援ъ꽦 ?쒖떆.
 * agent: "cowork" | "cowork+codex"
 */
function buildIdentity(tier, agent) {
  const id = AGENT_IDENTITY_BY_TIER[tier] || AGENT_IDENTITY_BY_TIER.builder;
  const agentLine = agent === "cowork+codex"
    ? "\n?먯씠?꾪듃 援ъ꽦: Cowork + Codex (dual). ?⑹쓽/遺덉씪移섎? 紐낆떆?쒕떎."
    : "\n?먯씠?꾪듃 援ъ꽦: Cowork ?⑤룆. ?먭린 寃利?(self cross-review) ?쇰줈 ?⑥씪 ?쒖젏 ?섍껄???쒓퀎瑜?蹂댁셿?쒕떎.";
  return id + agentLine;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function log(...args) {
  console.log(...args);
}

function logSection(title) {
  log(`\n${COLORS.bold}${title}${COLORS.reset}`);
  log("?".repeat(Math.min(title.length, 40)));
}

function logSuccess(msg) {
  log(`${COLORS.green}??{COLORS.reset} ${msg}`);
}

function logError(msg) {
  log(`${COLORS.red}??{COLORS.reset} ${msg}`);
}

function logWarn(msg) {
  log(`${COLORS.yellow}??{COLORS.reset} ${msg}`);
}

function logInfo(msg) {
  log(`${COLORS.blue}??{COLORS.reset} ${msg}`);
}

function logDim(msg) {
  log(`${COLORS.gray}${msg}${COLORS.reset}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getDiff(source, target) {
  try {
    let cmd;
    switch (source) {
      case "staged":
        cmd = "git diff --staged";
        break;
      case "branch":
        cmd = `git diff ${target || "main"}...HEAD`;
        break;
      case "file":
        if (!target) throw new Error("--file requires target path");
        cmd = `git diff -- ${target}`;
        break;
      default:
        cmd = "git diff --staged";
    }
    return execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 5 });
  } catch (e) {
    if (e.status === 128) {
      logError("Not a git repository");
      return "";
    }
    return "";
  }
}

function readSkillContext() {
  const skillPath = path.join(CONFIG.skillDir, "SKILL.md");
  try {
    return fs.readFileSync(skillPath, "utf8");
  } catch {
    return "";
  }
}

function readFailureCatalog() {
  const catPath = path.join(CONFIG.skillDir, "failure-catalog.json");
  try {
    return JSON.parse(fs.readFileSync(catPath, "utf8"));
  } catch {
    return { patterns: [] };
  }
}

function getRecentCommits(hours = 24) {
  try {
    const since = `${hours}h`;
    const log = execSync(`git log --since="${since}" --format=%B`, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return log;
  } catch {
    return "";
  }
}

function estimateCost(inputTokens, outputTokens, model) {
  // Rough estimates (as of 2026-04)
  const rates = {
    "claude-sonnet-4-20250514": { input: 0.003, output: 0.015 }, // per 1K tokens
    "claude-opus-4-20250514": { input: 0.015, output: 0.075 },
    "codex-mini-latest": { input: 0.0005, output: 0.0015 },
  };

  const rate = rates[model] || { input: 0.003, output: 0.015 };
  const cost =
    (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
  return cost.toFixed(4);
}

// ============================================================================
// API CALL FUNCTIONS
// ============================================================================

function _anthropicOnce(prompt, systemPrompt, model) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      reject(new Error("ANTHROPIC_API_KEY environment variable not set"));
      return;
    }

    const body = JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          const err = new Error(
            `Anthropic API error ${res.statusCode}: ${data.slice(0, 300)}`
          );
          err.statusCode = res.statusCode;
          err.body = data;
          return reject(err);
        }
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.[0]?.text || "";
          resolve({
            text,
            usage: parsed.usage || { input_tokens: 0, output_tokens: 0 },
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Tier-aware retry with rate-limit backoff (mirrors codex-main/claude-worker.js claude()).
// maxRetries is wired from CONFIG.tierLimits[tier].maxRetries by callers; defaults to 3.
async function callAnthropic(prompt, systemPrompt, model, opts = {}) {
  const maxRetries = Math.max(1, Math.min(6, opts.maxRetries || 3));
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await _anthropicOnce(prompt, systemPrompt, model);
    } catch (e) {
      lastErr = e;
      const body = (e.body || e.message || "").toLowerCase();
      const isRateLimit = body.includes("rate_limit") || body.includes("overloaded") || e.statusCode === 429 || e.statusCode === 529;
      if (attempt === maxRetries - 1) break;
      const waitMs = isRateLimit ? (attempt + 1) * 30000 : (attempt + 1) * 15000;
      logWarn(`Anthropic ${isRateLimit ? "rate limited" : "error"}, waiting ${waitMs / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

function _openaiOnce(prompt, systemPrompt, model) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      reject(new Error("OPENAI_API_KEY environment variable not set"));
      return;
    }

    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 4096,
    });

    const options = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          const err = new Error(
            `OpenAI API error ${res.statusCode}: ${data.slice(0, 300)}`
          );
          err.statusCode = res.statusCode;
          err.body = data;
          return reject(err);
        }
        try {
          const parsed = JSON.parse(data);
          const text =
            parsed.choices?.[0]?.message?.content ||
            parsed.output_text ||
            "";
          resolve({
            text,
            usage: parsed.usage || { prompt_tokens: 0, completion_tokens: 0 },
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function callOpenAI(prompt, systemPrompt, model) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await _openaiOnce(prompt, systemPrompt, model);
    } catch (e) {
      lastErr = e;
      const body = (e.body || e.message || "").toLowerCase();
      const isRateLimit = body.includes("rate_limit") || e.statusCode === 429;
      if (attempt === 2) break;
      const waitMs = isRateLimit ? (attempt + 1) * 30000 : (attempt + 1) * 15000;
      logWarn(`OpenAI ${isRateLimit ? "rate limited" : "error"}, waiting ${waitMs / 1000}s (attempt ${attempt + 1}/3)...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ============================================================================
// REVIEW LOGIC & PARSING
// ============================================================================

// Normalize verdict to canonical taxonomy: APPROVE | REQUEST_CHANGES | COMMENT
function normalizeVerdict(raw) {
  if (!raw) return "COMMENT";
  const up = raw.toUpperCase();
  if (up.includes("REQUEST_CHANGES") || up.includes("CHANGES_REQUESTED") || up.includes("REQUEST CHANGES") || up.includes("CHANGES REQUESTED")) {
    return "REQUEST_CHANGES";
  }
  if (raw.includes("?섏젙?붿껌") || raw.includes("蹂寃쎌슂泥?)) return "REQUEST_CHANGES";
  if (up.includes("APPROVE")) return "APPROVE";
  if (raw.includes("?뱀씤")) return "APPROVE";
  if (up.includes("COMMENT")) return "COMMENT";
  if (raw.includes("蹂대쪟")) return "COMMENT";
  return "COMMENT";
}

// Korean label for verdict
function verdictLabel(v) {
  return v === "APPROVE" ? "?뱀씤" : v === "REQUEST_CHANGES" ? "?섏젙?붿껌" : "蹂대쪟";
}

// Severity: BLOCKER | SUGGESTION | NIT (with backwards-compat aliases)
function normalizeSeverity(raw) {
  if (!raw) return "NIT";
  const up = raw.toUpperCase();
  if (up.includes("BLOCKER") || up === "CRITICAL") return "BLOCKER";
  if (up.includes("SUGGEST") || up === "WARNING" || up === "WARN") return "SUGGESTION";
  return "NIT";
}

function parseReviewResponse(text) {
  // Verdict: prefer [VERDICT] header, fall back to scanning entire text
  const verdictHeader = text.match(/\[VERDICT\][:\s]*([A-Za-z_\s媛-??+)/i);
  const verdict = normalizeVerdict(verdictHeader ? verdictHeader[1] : text);

  // Parse issues: look for ???좑툘/?뮕 markers followed by [location] then description+arrow+fix
  const issues = [];
  const issuePattern =
    /(???좑툘|?뮕)\s*\[([^\]]+)\]\s*\n\s*([^\n]+)\n\s*(?:??->|=>)\s*([^\n]+)/g;

  let match;
  while ((match = issuePattern.exec(text)) !== null) {
    const icon = match[1];
    const location = match[2].trim();
    const issue = match[3].trim();
    const suggestion = match[4].trim();
    const severity = icon === "?? ? "BLOCKER" : icon === "?좑툘" ? "SUGGESTION" : "NIT";
    issues.push({ location, issue, suggestion, severity });
  }

  // Summary + optional next action
  const summary = (text.match(/\[SUMMARY\][:\s]*([^\n]+(?:\n(?!\[)[^\n]+)*)/i) || ["", ""])[1].trim();
  const nextAction = (text.match(/\[NEXT[_\s]ACTION\][:\s]*([\s\S]*?)(?=\n\[|$)/i) || ["", ""])[1].trim();

  return { verdict, verdictKo: verdictLabel(verdict), issues, summary, nextAction };
}

/**
 * Assess which external-signal tiers are active for this review.
 *
 * The three tiers of external evaluation (see docs/external-loop-policy.md):
 *   T1 Peer Model     ??another AI family reviewing (Claude + OpenAI dual)
 *   T2 External Knowledge ??web search / package registry / trend data
 *   T3 Ground Truth    ??real runtime logs / deploy status / production errors
 *
 * Without at least one tier active the review is a pure self-loop ??the
 * same model's opinion reinforcing itself. This function detects the
 * environment so `formatSelfLoopWarning` can label the output honestly.
 */
function assessExternalSignals(opts = {}) {
  const env = opts.env || process.env;
  const overrides = opts.overrides || {};
  const flags = {
    t1PeerModel: !!env.OPENAI_API_KEY,
    t2ExternalKnowledge:
      env.COWORK_EXTERNAL_KNOWLEDGE === "1"
      || !!env.COWORK_WEB_SEARCH
      || !!env.COWORK_PACKAGE_REGISTRY,
    t3GroundTruth:
      !!env.VERCEL_TOKEN
      || !!env.SUPABASE_ACCESS_TOKEN
      || env.COWORK_GROUND_TRUTH === "1",
  };
  if (typeof overrides.t1PeerModel === "boolean") flags.t1PeerModel = overrides.t1PeerModel;
  if (typeof overrides.t2ExternalKnowledge === "boolean") flags.t2ExternalKnowledge = overrides.t2ExternalKnowledge;
  if (typeof overrides.t3GroundTruth === "boolean") flags.t3GroundTruth = overrides.t3GroundTruth;
  const activeCount = Object.values(flags).filter(Boolean).length;
  flags.activeCount = activeCount;
  flags.isSelfLoop = activeCount === 0;
  return flags;
}

function shouldUseExternalKnowledge(env) {
  return env.COWORK_EXTERNAL_KNOWLEDGE === "1"
    || env.COWORK_WEB_SEARCH === "1"
    || env.COWORK_PACKAGE_REGISTRY === "1";
}

function shouldUseGroundTruth(env) {
  return env.COWORK_GROUND_TRUTH === "1"
    || !!env.VERCEL_TOKEN
    || !!env.SUPABASE_ACCESS_TOKEN
    || !!env.GITHUB_TOKEN
    || !!env.GH_TOKEN
    || !!env.ORCHESTRATOR_PAT;
}

function readPackageJson() {
  const pkgPath = path.join(process.cwd(), "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (_) {
    return null;
  }
}

function normalizeVersion(v) {
  if (!v) return "";
  return String(v).trim().replace(/^[^0-9]*/, "");
}

function majorVersion(v) {
  const m = String(v || "").match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe", timeout: 2000 }).trim();
  } catch (_) {
    return "";
  }
}

function getRepoFromGit() {
  try {
    const remote = execSync("git config --get remote.origin.url", { encoding: "utf8", stdio: "pipe" }).trim();
    if (!remote) return null;
    // https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const httpsMatch = remote.match(/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
    const sshMatch = remote.match(/github\.com:([^/]+)\/([^/.]+)(\.git)?$/);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  } catch (_) {}
  return null;
}

function githubApi(pathname, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path: pathname,
      method: "GET",
      headers: {
        "User-Agent": "solo-cto-agent",
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function collectExternalKnowledge(opts = {}) {
  const env = opts.env || process.env;
  if (!shouldUseExternalKnowledge(env)) {
    return { active: false, summary: "", packages: [] };
  }

  const pkg = readPackageJson();
  if (!pkg) {
    return { active: false, summary: "", packages: [], reason: "package.json not found" };
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const focus = [
    "next",
    "react",
    "react-dom",
    "tailwindcss",
    "prisma",
    "@supabase/supabase-js",
    "next-auth",
    "@auth/core",
  ];

  const rows = [];
  for (const name of focus) {
    if (!deps[name]) continue;
    const current = normalizeVersion(deps[name]);
    let latest = "";
    if (env.COWORK_EXTERNAL_KNOWLEDGE === "1" || env.COWORK_PACKAGE_REGISTRY === "1") {
      latest = normalizeVersion(safeExec(`npm view ${name} version`));
    }
    const currMajor = majorVersion(current);
    const latestMajor = majorVersion(latest);
    let note = "";
    if (currMajor !== null && latestMajor !== null && latestMajor > currMajor) {
      note = "major behind";
    }
    rows.push({ name, current, latest, note });
  }

  if (!rows.length) {
    return { active: false, summary: "", packages: [], reason: "no tracked packages" };
  }

  const summaryLines = rows.map((r) => {
    const latestPart = r.latest ? ` ??latest ${r.latest}` : "";
    const notePart = r.note ? ` (${r.note})` : "";
    return `- ${r.name}: ${r.current}${latestPart}${notePart}`;
  });

  return {
    active: rows.some((r) => !!r.latest),
    summary: summaryLines.join("\n"),
    packages: rows,
  };
}

async function collectGroundTruth(opts = {}) {
  const env = opts.env || process.env;
  if (!shouldUseGroundTruth(env)) {
    return { active: false, summary: "", meta: {} };
  }

  const repo = getRepoFromGit();
  if (!repo) {
    return { active: false, summary: "", meta: { reason: "no git remote" } };
  }

  const token = env.GITHUB_TOKEN || env.GH_TOKEN || env.ORCHESTRATOR_PAT || "";
  try {
    const deployments = await githubApi(`/repos/${repo.owner}/${repo.repo}/deployments?per_page=5`, token);
    if (!Array.isArray(deployments) || deployments.length === 0) {
      return { active: false, summary: "", meta: { reason: "no deployments" } };
    }

    const latest = deployments[0];
    const statuses = await githubApi(`/repos/${repo.owner}/${repo.repo}/deployments/${latest.id}/statuses?per_page=5`, token);
    const statusList = Array.isArray(statuses) ? statuses : [];
    const lastStatus = statusList[0];
    const failureCount = statusList.filter((s) => s.state === "failure" || s.state === "error").length;
    const state = lastStatus?.state || "unknown";
    const envName = latest.environment || "unknown";
    const when = latest.created_at || lastStatus?.created_at || "";

    const summary = [
      `- Latest deployment: ${envName} 쨌 ${state}${when ? ` 쨌 ${when}` : ""}`,
      `- Recent deploy failures: ${failureCount}/${statusList.length || 0}`,
    ].join("\n");

    return {
      active: true,
      summary,
      meta: {
        owner: repo.owner,
        repo: repo.repo,
        environment: envName,
        state,
        failureCount,
      },
    };
  } catch (e) {
    return { active: false, summary: "", meta: { error: e.message } };
  }
}

function formatExternalSections(externalKnowledge, groundTruth) {
  const sections = [];
  if (externalKnowledge && externalKnowledge.summary) {
    sections.push(`## ?몃? 吏???좏샇 (T2)\n${externalKnowledge.summary}`);
  }
  if (groundTruth && groundTruth.summary) {
    sections.push(`## Ground Truth ?좏샇 (T3)\n${groundTruth.summary}`);
  }
  return sections.length ? `\n${sections.join("\n\n")}\n` : "";
}

/**
 * Render a visible warning when the review has no external-signal backing.
 *
 * The review itself is still produced ??we don't gate on this ??but the
 * warning makes the self-loop limitation legible to the user so they can
 * decide whether to run `dual-review`, wire up MCP sources, or accept
 * the narrower coverage.
 */
function formatSelfLoopWarning(signals) {
  if (!signals || !signals.isSelfLoop) return "";
  const box = `\n${COLORS.yellow}?좑툘  [SELF-LOOP NOTICE]${COLORS.reset}\n`
    + `${COLORS.gray}This review was produced by a single model family with no external signals.${COLORS.reset}\n`
    + `${COLORS.gray}Missing: T1 peer model 쨌 T2 external knowledge 쨌 T3 ground truth.${COLORS.reset}\n`
    + `${COLORS.gray}Why it matters: opinions reinforce themselves ??blind spots persist.${COLORS.reset}\n`
    + `${COLORS.gray}To close the loop, enable any of:${COLORS.reset}\n`
    + `${COLORS.gray}  ??T1 ??set OPENAI_API_KEY and use 'solo-cto-agent dual-review'${COLORS.reset}\n`
    + `${COLORS.gray}  ??T2 ??set COWORK_EXTERNAL_KNOWLEDGE=1 (trend + package checks)${COLORS.reset}\n`
    + `${COLORS.gray}  ??T3 ??set VERCEL_TOKEN or SUPABASE_ACCESS_TOKEN (runtime signals)${COLORS.reset}\n`;
  return box;
}

function formatPartialSignalHint(signals) {
  if (!signals || signals.isSelfLoop || signals.activeCount >= 3) return "";
  const missing = [];
  if (!signals.t1PeerModel) missing.push("T1 peer model");
  if (!signals.t2ExternalKnowledge) missing.push("T2 external knowledge");
  if (!signals.t3GroundTruth) missing.push("T3 ground truth");
  if (missing.length === 0) return "";
  return `\n${COLORS.gray}?뱄툘  Active external signals: ${signals.activeCount}/3. Missing: ${missing.join(", ")}.${COLORS.reset}\n`;
}

function formatCrossCheck(cc) {
  if (!cc) return "";
  let out = `\n${COLORS.bold}[CROSS-CHECK]${COLORS.reset} ${cc.crossVerdict}\n`;
  if (cc.addedIssues.length) {
    out += `${COLORS.gray}+ 異붽? 諛쒓껄 (${cc.addedIssues.length}):${COLORS.reset}\n`;
    for (const i of cc.addedIssues) {
      const icon = i.severity === "BLOCKER" ? `${COLORS.red}??{COLORS.reset}` : i.severity === "SUGGESTION" ? `${COLORS.yellow}?좑툘${COLORS.reset}` : `${COLORS.blue}?뮕${COLORS.reset}`;
      out += `  ${icon} [${i.location}] ${i.issue} ??${i.suggestion}\n`;
    }
  }
  if (cc.removedItems.length) {
    out += `${COLORS.gray}- 1李?false positive ?섏떖 (${cc.removedItems.length}):${COLORS.reset}\n`;
    for (const r of cc.removedItems) {
      out += `  쨌 [${r.location}] ${r.reason}\n`;
    }
  }
  if (cc.upgradeBlock) out += `${COLORS.gray}???ш컖???곹뼢:${COLORS.reset}\n  ${cc.upgradeBlock.replace(/\n/g, "\n  ")}\n`;
  if (cc.downgradeBlock) out += `${COLORS.gray}???ш컖???섑뼢:${COLORS.reset}\n  ${cc.downgradeBlock.replace(/\n/g, "\n  ")}\n`;
  if (cc.metaReview) out += `${COLORS.gray}meta:${COLORS.reset} ${cc.metaReview}\n`;
  return out;
}

function formatTerminalOutput(review, sourceInfo, costInfo) {
  const issueCounts = {
    BLOCKER: review.issues.filter((i) => i.severity === "BLOCKER").length,
    SUGGESTION: review.issues.filter((i) => i.severity === "SUGGESTION").length,
    NIT: review.issues.filter((i) => i.severity === "NIT").length,
  };

  const totalIssues = review.issues.length;

  const verdictColor =
    review.verdict === "APPROVE"
      ? COLORS.green
      : review.verdict === "REQUEST_CHANGES"
      ? COLORS.red
      : COLORS.blue;

  const header = `VERDICT: ${review.verdict} (${review.verdictKo})`;
  let output = "\n";
  output += `${COLORS.bold}${verdictColor}${header}${COLORS.reset}\n`;
  output += `${COLORS.gray}${"?".repeat(header.length)}${COLORS.reset}\n`;
  output += `Issues: ${totalIssues}`;
  if (issueCounts.BLOCKER) output += `  ${COLORS.red}??${issueCounts.BLOCKER} BLOCKER${COLORS.reset}`;
  if (issueCounts.SUGGESTION) output += `  ${COLORS.yellow}?좑툘  ${issueCounts.SUGGESTION} SUGGESTION${COLORS.reset}`;
  if (issueCounts.NIT) output += `  ${COLORS.blue}?뮕 ${issueCounts.NIT} NIT${COLORS.reset}`;
  output += `\n\n`;

  for (const issue of review.issues) {
    const icon =
      issue.severity === "BLOCKER"
        ? `${COLORS.red}??{COLORS.reset}`
        : issue.severity === "SUGGESTION"
        ? `${COLORS.yellow}?좑툘${COLORS.reset}`
        : `${COLORS.blue}?뮕${COLORS.reset}`;
    output += `${icon} [${issue.location}]\n`;
    output += `   ${issue.issue}\n`;
    output += `   ??${issue.suggestion}\n\n`;
  }

  if (review.summary) {
    output += `${COLORS.bold}[SUMMARY]${COLORS.reset}\n${review.summary}\n`;
  }
  if (review.nextAction) {
    output += `\n${COLORS.bold}[NEXT ACTION]${COLORS.reset}\n${review.nextAction}\n`;
  }

  output += `\n${COLORS.gray}Cost: $${costInfo.total} (${costInfo.inputTokens}K input, ${costInfo.outputTokens}K output)${COLORS.reset}\n`;
  output += `${COLORS.gray}Saved: ${costInfo.savedPath}${COLORS.reset}\n`;

  return output;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

async function localReview(options = {}) {
  const {
    diffSource = "staged",
    target = null,
    model = CONFIG.defaultModel.claude,
    dryRun = false,
    outputFormat = "terminal",
    crossCheck = null, // null = tier 湲곕낯媛??곕쫫, true/false = 媛뺤젣
  } = options;

  // Tier 쨌 agent 쨌 personalization 쨌 live-source 而⑦뀓?ㅽ듃 寃곗젙
  const tier = readTier();
  const mode = readMode();
  const agent = process.env.OPENAI_API_KEY ? "cowork+codex" : "cowork";
  const tierLimits = CONFIG.tierLimits[tier] || CONFIG.tierLimits.builder;
  const useCrossCheck = crossCheck !== null ? crossCheck : tierLimits.selfCrossReview;

  logSection("solo-cto-agent review");
  logInfo(`Mode: ${mode} | Agent: ${agent} | Tier: ${tier}`);
  logInfo(`Source: ${diffSource} changes`);
  logInfo(`Model: ${model}`);
  if (useCrossCheck) logInfo(`Self cross-review: ON (tier=${tier})`);

  // Get diff
  const diff = getDiff(diffSource, target);
  if (!diff || diff.trim().length === 0) {
    logWarn("No changes found");
    return null;
  }

  logInfo(`Diff: ${diff.split("\n").length} lines`);

  // Load context
  const skillContext = readSkillContext();
  const failureCatalog = readFailureCatalog();
  const personalCtx = personalizationContext();
  const liveCtx = liveSourceContext();
  const identity = buildIdentity(tier, agent);
  const externalKnowledge = await collectExternalKnowledge({ env: process.env });
  const groundTruth = await collectGroundTruth({ env: process.env });
  const externalSections = formatExternalSections(externalKnowledge, groundTruth);

  const errorPatterns = failureCatalog.patterns
    ?.map((p) => `- ${p.pattern}: ${p.fix}`)
    .join("\n") || "No patterns loaded";

  // Build review prompt (Korean, codex-main parity + cowork enhancements)
  const systemPrompt = `${identity}

?뱀떊? Claude, ????쒕땲??肄붾뱶 由щ럭?대떎. ?꾨옒 diff瑜?由щ럭?쒕떎.

${OPERATING_PRINCIPLES}
${COMMON_STACK_PATTERNS}
${REVIEW_PRIORITY}
${liveCtx}${personalCtx}

## ?ш컖??遺꾨쪟
- ??BLOCKER  ??癒몄?/諛고룷 李⑤떒. 移섎챸 踰꾧렇, 蹂댁븞, ?곗씠???먯떎 ?꾪뿕.
- ?좑툘 SUGGESTION ??媛뺥븯寃?沅뚰븯??媛쒖꽑. ?먮윭 泥섎━ ?꾨씫, ?깅뒫, 援ъ“.
- ?뮕 NIT ??痍⑦뼢 ?섏?. ?ㅽ??? ?쇨???

## ?ъ슜???꾨줈?앺듃??湲곗〈 ?먮윭 ?⑦꽩
${errorPatterns}

## 異쒕젰 ?뺤떇 (???щ㎎???뺥솗???곕Ⅸ??

[VERDICT] APPROVE | REQUEST_CHANGES | COMMENT

[ISSUES]
??[path/to/file.ts:42]
  ?댁뒋 ?ㅻ챸 ??以?
  ??援ъ껜???섏젙 諛⑸쾿.

?좑툘 [path/to/file.ts:17]
  ?댁뒋 ?ㅻ챸 ??以?
  ??援ъ껜???섏젙 諛⑸쾿.

?뮕 [path/to/file.ts:3]
  ?댁뒋 ?ㅻ챸 ??以?
  ??援ъ껜???섏젙 諛⑸쾿.

[SUMMARY]
?꾩껜 ?됯? 1~2臾몄옣. ?섏튂??[?뺤젙]/[異붿젙]/[誘멸?利? ?쒓렇 ?ъ슜.

[NEXT ACTION]
- ?섏젙????ぉ 1
- ?섏젙????ぉ 2

## 洹쒖튃
- ?쒓뎅??議대뙎留??놁씠 媛꾧껐?섍쾶. 湲곗닠 ?⑹뼱???곸뼱 洹몃?濡?
- "醫뗭뒿?덈떎", "?뚮??⑸땲?? 媛숈? 移?갔 湲덉?.
- BLOCKER媛 0媛쒕㈃ REQUEST_CHANGES ?곗? ?딅뒗?? APPROVE ?먮뒗 COMMENT.
- BLOCKER媛 1媛쒕씪???덉쑝硫?REQUEST_CHANGES.
- diff 踰붿쐞 諛??뚯씪? ?멸툒?섏? ?딅뒗??`;

  const userPrompt = `## ?꾨줈?앺듃 而⑦뀓?ㅽ듃 (SKILL.md)
${skillContext}
${externalSections}

## 由щ럭 ???diff
\`\`\`diff
${diff}
\`\`\`

??異쒕젰 ?뺤떇 洹몃?濡?由щ럭?섎씪.`;

  if (dryRun) {
    log("\n[DRY RUN] Would call Anthropic API with:");
    log(`System prompt length: ${systemPrompt.length} chars`);
    log(`User prompt length: ${userPrompt.length} chars`);
    return null;
  }

  logInfo(`Calling Anthropic API (maxRetries=${tierLimits.maxRetries})...`);

  try {
    const response = await callAnthropic(userPrompt, systemPrompt, model, { maxRetries: tierLimits.maxRetries });
    const review = parseReviewResponse(response.text);

    // Estimate tokens
    const inputTokens = Math.ceil(
      (systemPrompt.length + userPrompt.length) / 4
    );
    const outputTokens = Math.ceil(response.text.length / 4);
    const totalCost = estimateCost(inputTokens, outputTokens, model);

    // Save review
    ensureDir(CONFIG.reviewsDir);
    const reviewFile = path.join(
      CONFIG.reviewsDir,
      `${timestamp()}.json`
    );

    const reviewData = {
      timestamp: new Date().toISOString(),
      mode,
      agent,
      tier,
      model,
      diffSource,
      verdict: review.verdict,
      issueCount: review.issues.length,
      issues: review.issues,
      summary: review.summary,
      raw: response.text,
      tokens: {
        input: inputTokens,
        output: outputTokens,
      },
      cost: totalCost,
    };

    // Self cross-review (Cowork ?⑤룆 援ъ꽦???듭떖 ?덉쭏 寃뚯씠??
    if (useCrossCheck && agent === "cowork") {
      logInfo("Running self cross-review (devil's advocate pass)...");
      try {
        const cross = await selfCrossReview({
          diff,
          firstPass: review,
          firstPassRaw: response.text,
          systemPromptBase: identity,
          model,
          maxRetries: tierLimits.maxRetries,
        });
        reviewData.crossCheck = cross;
        // ?⑹쓽 BLOCKER 媛 ?덉쑝硫?verdict 媛뺥솕
        if (cross.commonBlockers > 0 && reviewData.verdict !== "REQUEST_CHANGES") {
          reviewData.verdict = "REQUEST_CHANGES";
          reviewData.verdictUpgradedBy = "self-cross-review";
        }
        // ?좏겙/鍮꾩슜 ?⑹궛
        reviewData.tokens.input += cross.tokens.input;
        reviewData.tokens.output += cross.tokens.output;
        reviewData.cost = (parseFloat(reviewData.cost) + parseFloat(cross.cost)).toFixed(4);
      } catch (err) {
        logWarn(`Self cross-review failed: ${err.message} ??1李?寃곌낵留?蹂닿퀬`);
        reviewData.crossCheckError = err.message;
      }
    }

    // Personalization ?꾩쟻 (諛섎났 ?レ뒪??異붿쟻)
    try {
      updatePersonalizationFromReview(review);
    } catch (_) { /* personalization ?낅뜲?댄듃 ?ㅽ뙣??由щ럭 寃곌낵???곹뼢 ?놁쓬 */ }

    // External-signal assessment ??tells the user whether this review had any
    // non-self-loop backing (peer model / external knowledge / ground truth).
    const externalSignals = assessExternalSignals({
      overrides: {
        t1PeerModel: agent === "cowork+codex",
        t2ExternalKnowledge: !!externalKnowledge.active,
        t3GroundTruth: !!groundTruth.active,
      },
    });
    reviewData.externalSignals = externalSignals;
    if (externalKnowledge.summary) reviewData.externalKnowledge = externalKnowledge;
    if (groundTruth.summary) reviewData.groundTruth = groundTruth;

    fs.writeFileSync(reviewFile, JSON.stringify(reviewData, null, 2));

    // Output based on format
    if (outputFormat === "json") {
      log(JSON.stringify(reviewData, null, 2));
    } else if (outputFormat === "markdown") {
      log(response.text);
      if (externalSignals.isSelfLoop) {
        log("\n> ?좑툘 **SELF-LOOP NOTICE** ??no external signals (peer model / external knowledge / ground truth) were active for this review. Run `dual-review` or set `VERCEL_TOKEN` / `SUPABASE_ACCESS_TOKEN` / `COWORK_EXTERNAL_KNOWLEDGE=1` to close the loop.\n");
      }
    } else {
      // terminal format
      const costInfo = {
        inputTokens: (inputTokens / 1000).toFixed(1),
        outputTokens: (outputTokens / 1000).toFixed(1),
        total: totalCost,
        savedPath: reviewFile,
      };
      const output = formatTerminalOutput(review, { diffSource }, costInfo);
      log(output);
      if (reviewData.crossCheck) {
        log(formatCrossCheck(reviewData.crossCheck));
      }
      // Self-loop warning (if applicable) ??or hint about partial signals.
      const warning = formatSelfLoopWarning(externalSignals);
      if (warning) log(warning);
      else {
        const hint = formatPartialSignalHint(externalSignals);
        if (hint) log(hint);
      }
    }

    logSuccess(`Review saved to ${reviewFile}`);
    return reviewData;
  } catch (err) {
    logError(`API call failed: ${err.message}`);
    throw err;
  }
}

/**
 * Self Cross-Review (Cowork ?⑤룆???듭떖 ?덉쭏 寃뚯씠??
 *
 * 1李?由щ럭??寃곌낵瑜???踰덉㎏ ?⑥뒪 (devil's advocate ?섎Ⅴ?뚮굹) 媛 寃利앺븳??
 * - 1李④? ?볦튇 BLOCKER 媛 ?덈뒗媛?
 * - 1李④? 怨쇰? ?됯?????ぉ???덈뒗媛?
 * - 1李⑥쓽 false positive / false negative ?섏떖 吏?먯??
 *
 * ???⑥뒪???⑹쓽쨌遺덉씪移섎? ?뺣━???⑥씪 ?쒖젏 ?섍껄???쒓퀎瑜?蹂댁셿.
 * Cowork+Codex 媛 ?놁쓣 ??媛????媛移섎? 留뚮뱺??
 */
async function selfCrossReview({ diff, firstPass, firstPassRaw, systemPromptBase, model, maxRetries }) {
  const advocateSystem = `${systemPromptBase}

?뱀떊? ?숈씪 diff ??1李?由щ럭 寃곌낵瑜?寃利앺븯??**devil's advocate 由щ럭??* ??
1李?由щ럭???먭린 ?먯떊????李⑤? ?묐떟?대떎. ?먭린 寃利앹쓽 ?쒓퀎瑜??몄젙?섍퀬,
?섎룄?곸쑝濡??ㅻⅨ ?쒓컖?먯꽌 蹂몃떎. ?숈쓽瑜??꾪븳 ?숈쓽??湲덉?.

寃利???ぉ:
1. 1李④? ?볦튇 BLOCKER (蹂댁븞, ?곗씠???먯떎, 紐낅갚??踰꾧렇) 媛 ?덈뒗媛?
2. 1李④? BLOCKER 濡?蹂???ぉ 以??ъ떎 SUGGESTION ?닿굅??false positive ??寃껋씠 ?덈뒗媛?
3. 1李④? SUGGESTION/NIT 濡?臾띠뿀吏留??ㅼ젣濡쒕뒗 BLOCKER ????ぉ??
4. 1李?summary ??[?뺤젙]/[異붿젙] ?쒓렇媛 ?곸젅?쒓?? (?쇱씠釉??뚯뒪 ?놁씠 [?뺤젙] ?⑥젙 吏볦쭊 ?딆븯?붿?)

## 異쒕젰 ?뺤떇 (諛섎뱶???대?濡?

[CROSS_VERDICT] AGREE | DISAGREE | PARTIAL

[ADD]                  ??1李④? ?볦튇 ??ぉ (?놁쑝硫?"?놁쓬")
???좑툘/?뮕 [path:line]
  ?댁뒋.
  ???섏젙.

[REMOVE]               ??1李⑥쓽 false positive (?놁쑝硫?"?놁쓬")
[path:line]
  ?ъ쑀.

[UPGRADE]              ???ш컖???곹뼢 (?놁쑝硫?"?놁쓬")
[path:line] SUGGESTION?묪LOCKER
  ?ъ쑀.

[DOWNGRADE]            ???ш컖???섑뼢 (?놁쑝硫?"?놁쓬")
[path:line] BLOCKER?뭆UGGESTION
  ?ъ쑀.

[META_REVIEW]
1~2臾몄옣. 1李?由щ럭 ?먯껜???덉쭏 ?됯?.

## 洹쒖튃
- ?쒓뎅?? 移?갔 湲덉?, 媛꾧껐.
- 1李⑥? ?숈씪 ??ぉ 諛섎났 湲덉?. 1李⑥뿉 異붽?/?섏젙??寃??놁쑝硫?洹몃깷 "?놁쓬".
- ?먭린 寃利앹쓽 ?쒓퀎 紐낆떆: 媛숈? 紐⑤뜽쨌媛숈? 而⑦뀓?ㅽ듃???쒓퀎媛 ?덈떎.`;

  const advocateUser = `## 1李?由щ럭 寃곌낵 (寃利????

VERDICT: ${firstPass.verdict}
ISSUES (${firstPass.issues.length}媛?:
${firstPass.issues.map((i) => `  ${i.severity === "BLOCKER" ? "?? : i.severity === "SUGGESTION" ? "?좑툘" : "?뮕"} [${i.location}] ${i.issue}`).join("\n")}
SUMMARY: ${firstPass.summary}

## 1李?由щ럭 ?먮Ц
${firstPassRaw}

## 寃利????diff
\`\`\`diff
${diff}
\`\`\`

??異쒕젰 ?뺤떇 洹몃?濡? devil's advocate ?쒓컖?먯꽌 寃利앺븯??`;

  const response = await callAnthropic(advocateUser, advocateSystem, model, { maxRetries: maxRetries || 3 });
  const text = response.text;

  // Parse cross-check response
  const crossVerdict = (text.match(/\[CROSS_VERDICT\][:\s]*([A-Z]+)/i) || [])[1] || "AGREE";

  // ADD section: extract issue patterns
  const addBlock = (text.match(/\[ADD\]([\s\S]*?)(?=\[REMOVE\]|\[UPGRADE\]|\[DOWNGRADE\]|\[META_REVIEW\]|$)/i) || [])[1] || "";
  const addedIssues = [];
  const addPattern = /(???좑툘|?뮕)\s*\[([^\]]+)\]\s*\n\s*([^\n]+)\n\s*(?:??->)\s*([^\n]+)/g;
  let m;
  while ((m = addPattern.exec(addBlock)) !== null) {
    addedIssues.push({
      severity: m[1] === "?? ? "BLOCKER" : m[1] === "?좑툘" ? "SUGGESTION" : "NIT",
      location: m[2].trim(),
      issue: m[3].trim(),
      suggestion: m[4].trim(),
    });
  }

  // REMOVE section: false positives
  const removeBlock = (text.match(/\[REMOVE\]([\s\S]*?)(?=\[UPGRADE\]|\[DOWNGRADE\]|\[META_REVIEW\]|$)/i) || [])[1] || "";
  const removedItems = [];
  const removePattern = /\[([^\]]+)\]\s*\n\s*([^\n[]+)/g;
  while ((m = removePattern.exec(removeBlock)) !== null) {
    if (m[1].trim().toLowerCase() === "?놁쓬") continue;
    removedItems.push({ location: m[1].trim(), reason: m[2].trim() });
  }

  const upgradeBlock = (text.match(/\[UPGRADE\]([\s\S]*?)(?=\[DOWNGRADE\]|\[META_REVIEW\]|$)/i) || [])[1] || "";
  const downgradeBlock = (text.match(/\[DOWNGRADE\]([\s\S]*?)(?=\[META_REVIEW\]|$)/i) || [])[1] || "";
  const metaReview = ((text.match(/\[META_REVIEW\]([\s\S]*?)$/i) || [])[1] || "").trim();

  const commonBlockers = addedIssues.filter((i) => i.severity === "BLOCKER").length
    + firstPass.issues.filter((i) => i.severity === "BLOCKER" && !removedItems.find((r) => r.location === i.location)).length;

  // Token cost
  const inputTokens = Math.ceil((advocateSystem.length + advocateUser.length) / 4);
  const outputTokens = Math.ceil(text.length / 4);
  const cost = estimateCost(inputTokens, outputTokens, model);

  return {
    crossVerdict,
    addedIssues,
    removedItems,
    upgradeBlock: upgradeBlock.trim(),
    downgradeBlock: downgradeBlock.trim(),
    metaReview,
    commonBlockers,
    raw: text,
    tokens: { input: inputTokens, output: outputTokens },
    cost,
  };
}

async function knowledgeCapture(options = {}) {
  const { source = "session", input = null, projectTag = null } = options;

  logSection("solo-cto-agent knowledge-capture");
  logInfo(`Source: ${source}`);
  if (projectTag) logInfo(`Project: ${projectTag}`);

  let content = "";

  if (source === "session") {
    logInfo("Scanning recent commits (24h)...");
    content = getRecentCommits(24);
    if (!content) {
      logWarn("No recent commits found");
      return null;
    }
  } else if (source === "file") {
    if (!input) {
      logError("--file requires --input <path>");
      return null;
    }
    logInfo(`Reading from ${input}...`);
    try {
      content = fs.readFileSync(input, "utf8");
    } catch (err) {
      logError(`Failed to read file: ${err.message}`);
      return null;
    }
  } else if (source === "manual") {
    if (!input) {
      logError("manual source requires --input <text>");
      return null;
    }
    content = input;
  }

  const systemPrompt = `${AGENT_IDENTITY}

?몄뀡 ?곗씠?곗뿉???ъ궗??媛?ν븳 吏?앹쓣 異붿텧?쒕떎.
?섏쨷??媛숈? ?ㅼ닔瑜?諛섎났?섏? ?딄린 ?꾪븳 ?먮즺?? 異붿륫 湲덉?, ?ㅼ젣 諛쒖깮??寃껊쭔 ?곷뒗??

## 異쒕젰 ?뺤떇

[TITLE]: ??以?二쇱젣

[DECISIONS]:
- {寃곗젙}: {洹쇨굅}
- {寃곗젙}: {洹쇨굅}

[ERROR_PATTERNS]:
- {?먮윭 ?⑦꽩}: {?섏젙 諛⑸쾿}
- {?먮윭 ?⑦꽩}: {?섏젙 諛⑸쾿}

[PREFERENCES]:
- {?좎? ?좏샇 / 肄붾뵫 ?ㅽ???/ ?뚰겕?뚮줈??洹쒖튃}

[OPEN_THREADS]:
- {誘명빐寃???ぉ}

## 洹쒖튃
- ?쒓뎅?? 媛꾧껐?섍쾶. ?쇰컲濡?湲덉?, ???몄뀡?먯꽌 ?ㅼ젣濡??섏삩 寃껊쭔.
- ?섏튂??[?뺤젙] / [異붿젙] / [誘멸?利? ?쒓렇.
- ?숈씪????ぉ 諛섎났 湲덉?.`;

  const userPrompt = `## 遺꾩꽍 ???

${content}`;

  logInfo("Calling Anthropic API...");

  try {
    const response = await callAnthropic(userPrompt, systemPrompt, CONFIG.defaultModel.claude);

    // Parse response
    const titleMatch = response.text.match(/\[TITLE\]:\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled";

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50);

    // Build markdown
    let markdown = `# ${title} ??Knowledge Article\n`;
    markdown += `> Created: ${new Date().toISOString().split("T")[0]}\n`;
    if (projectTag) markdown += `> Project: ${projectTag}\n`;
    markdown += `> Source: ${source}\n\n`;

    const sections = {
      DECISIONS: response.text.match(/\[DECISIONS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
      ERROR_PATTERNS: response.text.match(/\[ERROR_PATTERNS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
      PREFERENCES: response.text.match(/\[PREFERENCES\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
      OPEN_THREADS: response.text.match(/\[OPEN_THREADS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "",
    };

    if (sections.DECISIONS.trim()) {
      markdown += `## Decisions\n${sections.DECISIONS.trim()}\n\n`;
    }
    if (sections.ERROR_PATTERNS.trim()) {
      markdown += `## Error Patterns\n${sections.ERROR_PATTERNS.trim()}\n\n`;
    }
    if (sections.PREFERENCES.trim()) {
      markdown += `## Preferences\n${sections.PREFERENCES.trim()}\n\n`;
    }
    if (sections.OPEN_THREADS.trim()) {
      markdown += `## Open Threads\n${sections.OPEN_THREADS.trim()}\n\n`;
    }

    // Save knowledge article
    ensureDir(CONFIG.knowledgeDir);
    const articleFile = path.join(
      CONFIG.knowledgeDir,
      `${new Date().toISOString().split("T")[0]}-${slug}.md`
    );

    fs.writeFileSync(articleFile, markdown);
    logSuccess(`Knowledge article saved to ${articleFile}`);

    // Update index
    const indexFile = path.join(CONFIG.knowledgeDir, "index.md");
    let indexContent = "";

    if (fs.existsSync(indexFile)) {
      indexContent = fs.readFileSync(indexFile, "utf8");
    } else {
      indexContent = "# Knowledge Index\n\n";
    }

    const indexEntry = `- [${title}](./${path.basename(articleFile)}) ??${projectTag || "general"}`;
    if (!indexContent.includes(indexEntry)) {
      indexContent += indexEntry + "\n";
      fs.writeFileSync(indexFile, indexContent);
      logSuccess(`Updated knowledge index`);
    }

    // Merge patterns into failure catalog
    const patterns = response.text
      .match(/\[ERROR_PATTERNS\]:([\s\S]*?)(?=\[|$)/i)?.[1] || "";
    if (patterns.trim()) {
      const catalogPath = path.join(CONFIG.skillDir, "failure-catalog.json");
      let catalog = { patterns: [] };

      if (fs.existsSync(catalogPath)) {
        try {
          catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
        } catch {
          catalog = { patterns: [] };
        }
      }

      const newPatterns = patterns
        .split("\n")
        .filter((p) => p.trim())
        .map((p) => {
          const match = p.match(/^\s*-\s*([^:]+):\s*(.+)$/);
          return match ? { pattern: match[1].trim(), fix: match[2].trim() } : null;
        })
        .filter((p) => p !== null);

      catalog.patterns = [...catalog.patterns, ...newPatterns];
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
      logSuccess(`Updated failure catalog with ${newPatterns.length} patterns`);
    }

    return { articleFile, indexFile };
  } catch (err) {
    logError(`API call failed: ${err.message}`);
    throw err;
  }
}

async function dualReview(options = {}) {
  const {
    diffSource = "staged",
    target = null,
    claudeModel = CONFIG.defaultModel.claude,
    codexModel = CONFIG.defaultModel.codex,
  } = options;

  logSection("solo-cto-agent dual-review");
  logInfo(`Mode: dual (Claude + OpenAI)`);
  logInfo(`Source: ${diffSource} changes`);

  const diff = getDiff(diffSource, target);
  if (!diff || diff.trim().length === 0) {
    logWarn("No changes found");
    return null;
  }

  logInfo(`Diff: ${diff.split("\n").length} lines`);

  const skillContext = readSkillContext();
  const failureCatalog = readFailureCatalog();
  const errorPatterns = failureCatalog.patterns
    ?.map((p) => `- ${p.pattern}: ${p.fix}`)
    .join("\n") || "No patterns loaded";
  const externalKnowledge = await collectExternalKnowledge({ env: process.env });
  const groundTruth = await collectGroundTruth({ env: process.env });
  const externalSections = formatExternalSections(externalKnowledge, groundTruth);

  // Dual-review prompt (identical spec for Claude + OpenAI ??codex-main parity)
  const systemPrompt = `${AGENT_IDENTITY}

????쒕땲??肄붾뱶 由щ럭?대떎. ?꾨옒 diff瑜?由щ럭?쒕떎.

${SKILL_CONTEXT}
${SKILL_REVIEW_CRITERIA}

## ?ш컖??
- ??BLOCKER  癒몄? 李⑤떒 (移섎챸 踰꾧렇, 蹂댁븞, ?곗씠???먯떎)
- ?좑툘 SUGGESTION 媛뺥븳 媛쒖꽑 沅뚭퀬
- ?뮕 NIT 痍⑦뼢 ?섏?

## 湲곗〈 ?먮윭 ?⑦꽩
${errorPatterns}

## 異쒕젰 ?뺤떇
[VERDICT] APPROVE | REQUEST_CHANGES | COMMENT

[ISSUES]
??[path:line]
  ?ㅻ챸.
  ???섏젙.

?좑툘 [path:line]
  ?ㅻ챸.
  ???섏젙.

?뮕 [path:line]
  ?ㅻ챸.
  ???섏젙.

[SUMMARY]
1~2臾몄옣. ?섏튂??[?뺤젙]/[異붿젙]/[誘멸?利?.

[NEXT ACTION]
- ??ぉ

## 洹쒖튃
- ?쒓뎅?? 移?갔 湲덉?. 媛꾧껐?섍쾶.
- BLOCKER 1媛??댁긽?대㈃ REQUEST_CHANGES.
- diff 諛??뚯씪 ?멸툒 湲덉?.`;

  const userPrompt = `## ?꾨줈?앺듃 而⑦뀓?ㅽ듃
${skillContext}
${externalSections}

## diff
\`\`\`diff
${diff}
\`\`\``;

  logInfo("Calling Claude...");
  let claudeResponse, codexResponse;

  try {
    claudeResponse = await callAnthropic(userPrompt, systemPrompt, claudeModel);
    logSuccess("Claude review complete");
  } catch (err) {
    logError(`Claude API failed: ${err.message}`);
    claudeResponse = { text: "[FAILURE] Claude API error", usage: {} };
  }

  logInfo("Calling OpenAI...");
  try {
    codexResponse = await callOpenAI(userPrompt, systemPrompt, codexModel);
    logSuccess("OpenAI review complete");
  } catch (err) {
    logError(`OpenAI API failed: ${err.message}`);
    codexResponse = { text: "[FAILURE] OpenAI API error", usage: {} };
  }

  // Parse both
  const claudeReview = parseReviewResponse(claudeResponse.text);
  const codexReview = parseReviewResponse(codexResponse.text);

  // Cross-compare
  const comparison = {
    agreement: claudeReview.verdict === codexReview.verdict,
    verdictMatch: claudeReview.verdict === codexReview.verdict,
    claudeVerdict: claudeReview.verdict,
    codexVerdict: codexReview.verdict,
    claudeIssueCount: claudeReview.issues.length,
    codexIssueCount: codexReview.issues.length,
    commonIssues: [],
    claudeOnlyIssues: [],
    codexOnlyIssues: [],
  };

  // Simple string matching for common issues
  for (const claudeIssue of claudeReview.issues) {
    const found = codexReview.issues.find((c) =>
      c.location === claudeIssue.location
    );
    if (found) {
      comparison.commonIssues.push(claudeIssue);
    } else {
      comparison.claudeOnlyIssues.push(claudeIssue);
    }
  }

  for (const codexIssue of codexReview.issues) {
    if (!comparison.commonIssues.find((c) => c.location === codexIssue.location)) {
      comparison.codexOnlyIssues.push(codexIssue);
    }
  }

  // Final verdict
  const finalVerdict =
    claudeReview.verdict === "CHANGES_REQUESTED" ||
    codexReview.verdict === "CHANGES_REQUESTED"
      ? "CHANGES_REQUESTED"
      : claudeReview.verdict === "COMMENT" || codexReview.verdict === "COMMENT"
      ? "COMMENT"
      : "APPROVE";

  // Save dual review
  ensureDir(CONFIG.reviewsDir);
  const reviewFile = path.join(
    CONFIG.reviewsDir,
    `${timestamp()}-dual.json`
  );

  const dualReviewData = {
    timestamp: new Date().toISOString(),
    mode: "dual",
    models: { claude: claudeModel, openai: codexModel },
    diffSource,
    finalVerdict,
    comparison,
    claudeReview,
    codexReview,
    raw: {
      claude: claudeResponse.text,
      openai: codexResponse.text,
    },
  };

  // External-signal assessment. dual-review always has T1 (peer model) active,
  // so this mostly surfaces whether T2/T3 are also present for full coverage.
  const externalSignals = assessExternalSignals({
    overrides: {
      t1PeerModel: true,
      t2ExternalKnowledge: !!externalKnowledge.active,
      t3GroundTruth: !!groundTruth.active,
    },
  });
  dualReviewData.externalSignals = externalSignals;
  if (externalKnowledge.summary) dualReviewData.externalKnowledge = externalKnowledge;
  if (groundTruth.summary) dualReviewData.groundTruth = groundTruth;

  fs.writeFileSync(reviewFile, JSON.stringify(dualReviewData, null, 2));
  logSuccess(`Dual review saved to ${reviewFile}`);

  // Terminal output
  log("\n");
  log(`${COLORS.bold}?뚢? CROSS-REVIEW SUMMARY ???{COLORS.reset}`);
  log(
    `${COLORS.bold}??{COLORS.reset} Final Verdict: ${
      finalVerdict === "APPROVE"
        ? COLORS.green
        : finalVerdict === "CHANGES_REQUESTED"
        ? COLORS.red
        : COLORS.blue
    }${finalVerdict}${COLORS.reset}`
  );
  log(
    `${COLORS.bold}??{COLORS.reset} Agreement: ${
      comparison.verdictMatch ? COLORS.green + "YES" : COLORS.red + "NO"
    }${COLORS.reset}`
  );
  log(
    `${COLORS.bold}??{COLORS.reset} Claude Issues: ${claudeReview.issues.length}`
  );
  log(
    `${COLORS.bold}??{COLORS.reset} OpenAI Issues: ${codexReview.issues.length}`
  );
  log(`${COLORS.bold}??{COLORS.reset} Common Issues: ${comparison.commonIssues.length}`);
  log(`${COLORS.bold}?붴??????????????????????????{COLORS.reset}`);

  // T1 is active here by definition (both keys present); hint about T2/T3 gaps.
  const hint = formatPartialSignalHint(externalSignals);
  if (hint) log(hint);

  return dualReviewData;
}

function sessionSave(options = {}) {
  const {
    projectTag = null,
    decisions = [],
    errors = [],
    reviews = [],
    threads = [],
  } = options;

  ensureDir(CONFIG.sessionsDir);

  const ts = new Date().toISOString();
  const sessionData = {
    timestamp: ts,
    projectTag,
    decisions,
    errors,
    reviews,
    threads,
  };

  const filename = `${timestamp()}-session.json`;
  const sessionFile = path.join(CONFIG.sessionsDir, filename);

  fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
  logSuccess(`Session saved to ${sessionFile}`);

  // Update latest.json symlink/copy
  const latestFile = path.join(CONFIG.sessionsDir, "latest.json");
  fs.writeFileSync(latestFile, JSON.stringify(sessionData, null, 2));
  logSuccess(`Latest session pointer updated`);

  return sessionFile;
}

function sessionRestore(options = {}) {
  const { sessionFile = null } = options;

  const latestFile = path.join(CONFIG.sessionsDir, "latest.json");

  if (!fs.existsSync(latestFile) && !sessionFile) {
    logWarn("No sessions found");
    return null;
  }

  try {
    const targetFile = sessionFile || latestFile;
    if (!fs.existsSync(targetFile)) {
      logError(`Session file not found: ${targetFile}`);
      return null;
    }

    const sessionData = JSON.parse(fs.readFileSync(targetFile, "utf8"));
    logSuccess(`Session restored from ${targetFile}`);
    return sessionData;
  } catch (err) {
    logError(`Failed to restore session: ${err.message}`);
    return null;
  }
}

function sessionList(options = {}) {
  const { limit = 10 } = options;

  if (!fs.existsSync(CONFIG.sessionsDir)) {
    logWarn("No sessions directory found");
    return [];
  }

  const files = fs.readdirSync(CONFIG.sessionsDir)
    .filter(f => f.endsWith("-session.json"))
    .sort()
    .reverse()
    .slice(0, limit);

  if (files.length === 0) {
    logWarn("No sessions found");
    return [];
  }

  logSection("Recent Sessions");

  const sessions = [];
  for (const file of files) {
    try {
      const filePath = path.join(CONFIG.sessionsDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const ts = new Date(data.timestamp);
      const projectLabel = data.projectTag ? ` (${data.projectTag})` : "";
      const decisionCount = (data.decisions || []).length;
      const errorCount = (data.errors || []).length;
      const reviewCount = (data.reviews || []).length;

      log(
        `${COLORS.blue}${file}${COLORS.reset}${projectLabel}`
      );
      log(
        `  ${ts.toLocaleString()} ??` +
        `${decisionCount} decisions, ${errorCount} errors, ${reviewCount} reviews`
      );

      sessions.push({
        file,
        timestamp: data.timestamp,
        projectTag: data.projectTag,
        decisionCount,
        errorCount,
        reviewCount,
      });
    } catch (err) {
      logError(`Failed to parse ${file}: ${err.message}`);
    }
  }

  return sessions;
}

function detectMode() {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasAnthropic && hasOpenAI) return "dual";
  if (hasAnthropic) return "solo";
  return "none";
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  try {
    if (command === "local-review") {
      const diffSource = args.includes("--branch")
        ? "branch"
        : args.includes("--file")
        ? "file"
        : "staged";

      const fileIdx = args.indexOf("--file");
      const target = fileIdx >= 0 ? args[fileIdx + 1] : null;

      const dryRun = args.includes("--dry-run");
      const outputFormat = args.includes("--json")
        ? "json"
        : args.includes("--markdown")
        ? "markdown"
        : "terminal";

      // Self cross-review override flags
      let crossCheck = null;
      if (args.includes("--cross-check")) crossCheck = true;
      if (args.includes("--no-cross-check")) crossCheck = false;

      await localReview({
        diffSource,
        target,
        dryRun,
        outputFormat,
        crossCheck,
      });
    } else if (command === "knowledge-capture") {
      const source = args.includes("--file")
        ? "file"
        : args.includes("--manual")
        ? "manual"
        : "session";

      const fileIdx = args.indexOf("--file");
      const inputIdx = args.indexOf("--input");
      const projectIdx = args.indexOf("--project");

      const input =
        fileIdx >= 0
          ? args[fileIdx + 1]
          : inputIdx >= 0
          ? args[inputIdx + 1]
          : null;
      const projectTag = projectIdx >= 0 ? args[projectIdx + 1] : null;

      await knowledgeCapture({ source, input, projectTag });
    } else if (command === "dual-review") {
      const diffSource = args.includes("--branch") ? "branch" : "staged";
      const target = null;

      await dualReview({ diffSource, target });
    } else if (command === "detect-mode") {
      const mode = detectMode();
      const tier = readTier();
      const skillMode = readMode();
      const liveSources = detectLiveSources();
      logInfo(`Agent: ${mode} | Tier: ${tier} | Mode: ${skillMode}`);
      log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "set" : "missing"}`);
      log(`  OPENAI_API_KEY:   ${process.env.OPENAI_API_KEY ? "set" : "missing"}`);
      log(`  Live MCP sources: ${liveSources.length ? liveSources.join(", ") : "none"}`);
    } else if (command === "personalization") {
      const sub = args[1] || "show";
      if (sub === "show") {
        const p = loadPersonalization();
        log(JSON.stringify(p, null, 2));
      } else if (sub === "reset") {
        if (fs.existsSync(CONFIG.personalizationFile)) {
          fs.unlinkSync(CONFIG.personalizationFile);
        }
        logSuccess("Personalization reset");
      } else if (sub === "context") {
        log(personalizationContext() || "(empty ??泥??ъ슜)");
      } else {
        logError(`Unknown personalization subcommand: ${sub}`);
        log(`Use: personalization show|reset|context`);
        process.exit(1);
      }
    } else if (command === "session") {
      const subcommand = args[1] || "list";

      if (subcommand === "save") {
        const projectIdx = args.indexOf("--project");
        const projectTag = projectIdx >= 0 ? args[projectIdx + 1] : null;
        sessionSave({ projectTag });
      } else if (subcommand === "restore") {
        const sessionIdx = args.indexOf("--session");
        const sessionFile = sessionIdx >= 0 ? args[sessionIdx + 1] : null;
        const data = sessionRestore({ sessionFile });
        if (data) {
          log(JSON.stringify(data, null, 2));
        }
      } else if (subcommand === "list") {
        const limitIdx = args.indexOf("--limit");
        const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 10;
        sessionList({ limit });
      } else {
        logError(`Unknown session subcommand: ${subcommand}`);
        log(`Use: session save|restore|list`);
        process.exit(1);
      }
    } else if (command === "help" || command === "-h" || command === "--help") {
      log(`
${COLORS.bold}cowork-engine.js ??Local Cowork Mode${COLORS.reset}

${COLORS.bold}Usage:${COLORS.reset}
  node bin/cowork-engine.js <command> [options]

${COLORS.bold}Commands:${COLORS.reset}
  local-review            Run Claude review (auto self cross-review for builder/cto)
  knowledge-capture       Extract session decisions into knowledge articles
  dual-review             Run Claude + OpenAI cross-review (Cowork+Codex)
  detect-mode             Show agent / tier / live MCP sources
  personalization show    Show accumulated user style/preference data
  personalization reset   Reset personalization data
  personalization context Show prompt-injection block built from accumulation
  session save            Save current session context
  session restore         Load most recent session context
  session list            List recent sessions
  help                    Show this message

${COLORS.bold}Options:${COLORS.reset}
  local-review:
    --staged           Review staged changes (default)
    --branch           Review changes on current branch vs main
    --file <path>      Review changes in specific file
    --dry-run          Show prompt without calling API
    --json             Output as JSON
    --markdown         Output raw markdown
    --cross-check      Force self cross-review ON (regardless of tier)
    --no-cross-check   Force self cross-review OFF

  knowledge-capture:
    --session        Extract from recent commits (default)
    --file <path>    Extract from file
    --manual         Extract from manual input
    --input <text>   Input text or file path
    --project <tag>  Project tag (e.g., tribo, pista)

  dual-review:
    --staged         Review staged changes (default)
    --branch         Review current branch

${COLORS.bold}Examples:${COLORS.reset}
  # Review staged changes with Claude
  node bin/cowork-engine.js local-review

  # Dry run to see prompt
  node bin/cowork-engine.js local-review --dry-run

  # Extract knowledge from recent commits
  node bin/cowork-engine.js knowledge-capture

  # Run dual review if both APIs configured
  node bin/cowork-engine.js dual-review

${COLORS.bold}Configuration:${COLORS.reset}
  Set environment variables:
    export ANTHROPIC_API_KEY="sk-ant-..."
    export OPENAI_API_KEY="sk-..."

${COLORS.bold}Mode Detection:${COLORS.reset}
  solo  ??Only ANTHROPIC_API_KEY set (Claude reviews)
  dual  ??Both keys set (Claude + OpenAI cross-review)
  none  ??No API keys configured
      `);
    } else {
      logError(`Unknown command: ${command}`);
      log(`Run: node bin/cowork-engine.js help`);
      process.exit(1);
    }
  } catch (err) {
    logError(`Fatal error: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err);
    }
    process.exit(1);
  }
}

// ============================================================================
// EXPORTS & EXECUTION
// ============================================================================

module.exports = {
  localReview,
  knowledgeCapture,
  dualReview,
  detectMode,
  sessionSave,
  sessionRestore,
  sessionList,
  // Cowork-specific layer (substantive upgrade)
  selfCrossReview,
  readTier,
  readMode,
  loadPersonalization,
  savePersonalization,
  updatePersonalizationFromReview,
  personalizationContext,
  recordFeedback,
  // External-signal / self-loop assessment
  assessExternalSignals,
  formatSelfLoopWarning,
  formatPartialSignalHint,
  detectLiveSources,
  liveSourceContext,
  buildIdentity,
  AGENT_IDENTITY_BY_TIER,
  // Utilities for testing
  parseReviewResponse,
  getDiff,
  readSkillContext,
  readFailureCatalog,
  _setSkillDirOverride,
};

// Run CLI if executed directly
if (require.main === module) {
  main();
}

