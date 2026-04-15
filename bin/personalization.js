/**
 * personalization.js — Tier, mode detection, and personalization layer.
 * Extracted from cowork-engine.js (PR-G30).
 *
 * Manages:
 *   - readTier() / readMode() from SKILL.md frontmatter
 *   - loadPersonalization() / savePersonalization() — JSON persistence
 *   - recordFeedback() — explicit accept/reject training data
 *   - updatePersonalizationFromReview() — automatic learning from reviews
 *   - personalizationContext() — prompt injection with anti-bias rotation
 */

const fs = require("fs");
const path = require("path");

// Dependencies injected by init()
let _CONFIG = null;
let _skillDir = null;

/**
 * Initialize personalization layer with runtime dependencies.
 * @param {Object} CONFIG - Runtime config object (has skillDir, personalizationFile, tierLimits)
 * @param {Function} skillDirFn - Lazy getter for skill directory path
 */
function init(CONFIG, skillDirFn) {
  _CONFIG = CONFIG;
  _skillDir = skillDirFn;
}

/**
 * SKILL.md 에서 tier 추출. 없으면 builder (안전한 기본).
 * tier: 또는 mode 필드를 frontmatter 또는 본문에서 스캔.
 */
function readTier() {
  const skillPath = path.join(_skillDir(), "SKILL.md");
  try {
    const text = fs.readFileSync(skillPath, "utf8");
    const m = text.match(/^tier:\s*(maker|builder|cto)/im);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return "builder";
}

/**
 * SKILL.md 의 mode 필드 (cowork-main / codex-main). 없으면 cowork-main.
 */
function readMode() {
  const skillPath = path.join(_skillDir(), "SKILL.md");
  try {
    const text = fs.readFileSync(skillPath, "utf8");
    const m = text.match(/^mode:\s*(cowork-main|codex-main)/im);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  return "cowork-main";
}

/**
 * 개인화 누적 데이터 로드. 누적 항목:
 * - acceptedPatterns: 사용자가 수락한 제안 패턴 (location 또는 keyword)
 * - rejectedPatterns: 사용자가 거부/무시한 제안 패턴
 * - repeatErrors: 반복 발생 에러 (failure-catalog 보강용)
 * - stylePrefs: { verbosity, commentDensity, naming } — 누적 휴리스틱
 * - lastUpdated: ISO timestamp
 */
function loadPersonalization() {
  try {
    return JSON.parse(fs.readFileSync(_CONFIG.personalizationFile, "utf8"));
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

/**
 * Persist personalization data to disk.
 * @param {Object} p - Personalization object
 */
function savePersonalization(p) {
  const skillDir = _skillDir();
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }
  p.lastUpdated = new Date().toISOString();
  fs.writeFileSync(_CONFIG.personalizationFile, JSON.stringify(p, null, 2));
}

/**
 * 리뷰 결과를 personalization 에 반영.
 * - 새 reviewCount + 1
 * - 새 BLOCKER/SUGGESTION 타입의 location keyword → 후속 추적용
 * - 동일 location 이 N회 이상 반복 → repeatErrors 등록
 */
function updatePersonalizationFromReview(review) {
  const p = loadPersonalization();
  p.reviewCount = (p.reviewCount || 0) + 1;

  // 각 issue 의 location 을 키워드 형태로 누적
  for (const issue of review.issues || []) {
    const key = (issue.location || "").split(":")[0]; // path 부분만
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

  // 상위 50개만 유지
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
 *
 * @param {Object} opts - { verdict, location, severity, note }
 * @returns {Object} Summary of recorded feedback
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
 * 개인화 누적 데이터를 프롬프트 주입용 텍스트 블록으로 변환.
 * 빈 상태 (첫 사용) 면 빈 문자열 반환.
 *
 * Anti-bias rotation:
 *   - 80% of calls: full personalization context (exploit accumulated knowledge)
 *   - 20% of calls: minimal context with explicit "fresh look" hint (explore)
 *   This prevents over-fitting to past patterns and false-positive lock-in.
 *   Override deterministically via opts.exploration = true | false.
 *
 * @param {Object} opts - { exploration }
 * @returns {string} Prompt context block (may be empty)
 */
function personalizationContext(opts = {}) {
  const p = loadPersonalization();
  if (!p.reviewCount) return "";

  // Decide rotation slot
  const explore = opts.exploration === true
    || (opts.exploration !== false && Math.random() < 0.20);

  if (explore) {
    return `\n## 개인화 컨텍스트 (탐색 모드 — 과거 패턴 의존도 낮춤)
사용자 히스토리 ${p.reviewCount}회 누적되어 있으나 이번 리뷰는 새 시각으로 본다.
과거 핫스팟/거부 패턴은 참조만, 단정 근거로는 사용 금지.
`;
  }

  const top = (p.repeatErrors || [])
    .filter((e) => (e.count || 0) >= 2)
    .slice(0, 8)
    .map((e) => `- ${e.location} (${e.severity}, ${e.count}회)`)
    .join("\n");

  const accepted = (p.acceptedPatterns || [])
    .slice(0, 5)
    .map((x) => `- ${x.location} (${x.severity}, accept ×${x.count})`)
    .join("\n");

  const rejected = (p.rejectedPatterns || [])
    .slice(0, 5)
    .map((x) => `- ${x.location} (${x.severity}, reject ×${x.count})${x.note ? ` — ${x.note}` : ""}`)
    .join("\n");

  const styleLines = Object.entries(p.stylePrefs || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  let out = `\n## 누적 개인화 컨텍스트 (사용자 히스토리 ${p.reviewCount}회 리뷰 기준)\n`;
  if (top) out += `\n반복 발생 핫스팟 (우선 점검):\n${top}\n`;
  if (accepted) out += `\n사용자가 이전에 동의한 패턴 (가중치 ↑):\n${accepted}\n`;
  if (rejected) out += `\n사용자가 이전에 거부한 패턴 (false positive 가능 — 가중치 ↓):\n${rejected}\n`;
  if (styleLines) out += `\n사용자 스타일 선호:\n${styleLines}\n`;
  if (!top && !accepted && !rejected && !styleLines) return "";
  return out;
}

module.exports = {
  init,
  readTier,
  readMode,
  loadPersonalization,
  savePersonalization,
  updatePersonalizationFromReview,
  recordFeedback,
  personalizationContext,
};
