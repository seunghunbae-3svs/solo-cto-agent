/* eslint-disable no-console */
/**
 * Lightweight i18n for solo-cto-agent CLI.
 *
 * Why not an off-the-shelf lib: we want zero new dependencies and a
 * string table small enough that contributors can translate without
 * tooling. Each bundle is a flat key→string map.
 *
 * Resolution order:
 *   1. --lang CLI flag (parsed in cli.js main())
 *   2. SOLO_CTO_LANG env var
 *   3. LANG env var prefix (e.g. "en_US.UTF-8" → "en")
 *   4. Default: "ko" (preserves historical behavior)
 *
 * Fallback: if a key is missing in the active locale, fall back to "en",
 * then to the key itself. Never throws.
 */

const SUPPORTED = ["en", "ko"];
const DEFAULT_LOCALE = "ko";

const bundles = {
  en: {
    // CLI meta
    "cli.tagline": "Dual-Agent CI/CD Orchestrator",
    "cli.unknown_lang": "Unknown --lang value: {value}. Supported: en, ko. Falling back to default.",
    "cli.lang_active": "Locale: {lang}",

    // Common verbs / prefixes
    "common.error": "ERROR",
    "common.warn": "WARN",
    "common.info": "INFO",
    "common.ok": "OK",
    "common.done": "Done",
    "common.skipped": "Skipped",
    "common.failed": "Failed",

    // Doctor / status
    "doctor.header": "System health check",
    "doctor.skills_ok": "Skills directory looks healthy",
    "doctor.skills_missing": "Skills directory not found at {path}",
    "doctor.api_key_missing": "{name} API key not set — {feature} features unavailable",
    "doctor.api_key_ok": "{name} API key detected",

    // Init / wizard
    "init.installing": "Installing skills to {path}",
    "init.preset_applied": "Preset applied: {preset}",
    "wizard.welcome": "Welcome to the solo-cto-agent setup wizard.",
    "wizard.canceled": "Setup canceled.",

    // Review
    "review.no_diff": "No diff to review. Stage changes or use --branch.",
    "review.blockers_found": "{count} blocker(s) found — merge blocked",
    "review.approve": "No blockers — approve recommended",

    // Errors
    "error.missing_flag": "Required flag --{flag} is missing",
    "error.file_not_found": "File not found: {path}",
    "error.network": "Network error: {detail}",
  },

  ko: {
    "cli.tagline": "Dual-Agent CI/CD 오케스트레이터",
    "cli.unknown_lang": "알 수 없는 --lang 값: {value}. 지원: en, ko. 기본값으로 폴백합니다.",
    "cli.lang_active": "언어: {lang}",

    "common.error": "오류",
    "common.warn": "경고",
    "common.info": "정보",
    "common.ok": "정상",
    "common.done": "완료",
    "common.skipped": "건너뜀",
    "common.failed": "실패",

    "doctor.header": "시스템 헬스 체크",
    "doctor.skills_ok": "스킬 디렉터리 정상",
    "doctor.skills_missing": "스킬 디렉터리 없음: {path}",
    "doctor.api_key_missing": "{name} API 키 미설정 — {feature} 기능 사용 불가",
    "doctor.api_key_ok": "{name} API 키 감지됨",

    "init.installing": "스킬을 설치합니다: {path}",
    "init.preset_applied": "프리셋 적용: {preset}",
    "wizard.welcome": "solo-cto-agent 셋업 위자드입니다.",
    "wizard.canceled": "셋업이 취소되었습니다.",

    "review.no_diff": "리뷰할 diff가 없습니다. 변경을 stage 하거나 --branch 를 사용하세요.",
    "review.blockers_found": "BLOCKER {count}건 — 머지 차단",
    "review.approve": "BLOCKER 없음 — 승인 권고",

    "error.missing_flag": "필수 플래그 --{flag} 가 누락되었습니다",
    "error.file_not_found": "파일을 찾을 수 없습니다: {path}",
    "error.network": "네트워크 오류: {detail}",
  },
};

let activeLocale = DEFAULT_LOCALE;

function detectFromEnv() {
  const solo = (process.env.SOLO_CTO_LANG || "").trim().toLowerCase();
  if (solo && SUPPORTED.includes(solo)) return solo;

  const raw = (process.env.LANG || "").trim().toLowerCase();
  if (!raw) return null;
  const prefix = raw.split(/[_.]/)[0];
  if (SUPPORTED.includes(prefix)) return prefix;
  return null;
}

/**
 * Parse --lang from argv. Returns the chosen locale (never throws).
 * If --lang is unknown, prints a warn and returns the env/default fallback.
 */
function parseLangFlag(argv) {
  const idx = argv.indexOf("--lang");
  if (idx < 0) return detectFromEnv() || DEFAULT_LOCALE;
  const val = (argv[idx + 1] || "").trim().toLowerCase();
  if (!val) return detectFromEnv() || DEFAULT_LOCALE;
  if (!SUPPORTED.includes(val)) {
    // eslint-disable-next-line no-console
    console.warn(formatTemplate(bundles.en["cli.unknown_lang"], { value: val }));
    return detectFromEnv() || DEFAULT_LOCALE;
  }
  return val;
}

function formatTemplate(template, params) {
  if (!template) return "";
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    params[k] === undefined ? `{${k}}` : String(params[k])
  );
}

function setLocale(lang) {
  if (SUPPORTED.includes(lang)) activeLocale = lang;
}

function getLocale() {
  return activeLocale;
}

/**
 * Translate a key. Fallback chain: active → en → key.
 * Never throws; always returns a string.
 */
function t(key, params) {
  const active = bundles[activeLocale] || bundles[DEFAULT_LOCALE];
  const en = bundles.en;
  const template = active[key] || en[key] || key;
  return formatTemplate(template, params);
}

/**
 * Return raw bundle keys for tests / introspection.
 */
function listKeys(lang) {
  return Object.keys(bundles[lang] || bundles[DEFAULT_LOCALE]);
}

function isSupported(lang) {
  return SUPPORTED.includes(lang);
}

module.exports = {
  SUPPORTED,
  DEFAULT_LOCALE,
  parseLangFlag,
  setLocale,
  getLocale,
  t,
  listKeys,
  isSupported,
  // exposed for tests only
  _bundles: bundles,
};
