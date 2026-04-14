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

    // Telegram wizard (PR-G10 — spec §6)
    "telegram.wizard.not_experimental": "telegram-wizard is experimental. Re-run with SOLO_CTO_EXPERIMENTAL=1 to continue.",
    "telegram.wizard.step1.header": "[1/5] Bot token",
    "telegram.wizard.step1.hint": "      Open https://t.me/BotFather, run /newbot (or /mybots), then paste the token.",
    "telegram.wizard.step1.empty": "      (empty — try again)",
    "telegram.wizard.step1.bad_shape": "      token format looks off (expected 123:ABC...). Try again.",
    "telegram.wizard.step1.verified": "      ✓ Verified with Telegram (getMe): @{username}",
    "telegram.wizard.step1.missing_token": "--token required in non-interactive mode",
    "telegram.wizard.step2.using_provided": "[2/5] Using provided chat id {chatId}",
    "telegram.wizard.step2.send_message": "[2/5] Send ANY message to @{username} now.",
    "telegram.wizard.step2.waiting": "      (waiting up to 60 s — Ctrl-C cancels)",
    "telegram.wizard.step2.captured": "      ✓ Got message{namePart} in chat {chatId} ({kind})",
    "telegram.wizard.step2.missing_chat": "--chat required in non-interactive mode",
    "telegram.wizard.step3.header": "[3/5] Where to save credentials?",
    "telegram.wizard.step3.opt1": "      (1) .env (repo-local)",
    "telegram.wizard.step3.opt2": "      (2) shell profile (~/.zshrc or ~/.bashrc)",
    "telegram.wizard.step3.opt3": "      (3) GitHub repo secrets (gh)",
    "telegram.wizard.step3.opt4": "      (4) all of the above",
    "telegram.wizard.step3.missing_storage": "--storage required in non-interactive mode",
    "telegram.wizard.step4.sending": "[4/5] Sending test notification…",
    "telegram.wizard.step4.delivered": "      ✓ Delivered to chat {chatId} (message_id={messageId})",
    "telegram.wizard.step5.wrote_config": "[5/5] Wrote default notify config → {path}",
    "telegram.wizard.step5.customize_hint": "      Customize: solo-cto-agent telegram config",
    "telegram.wizard.step5.already_present": "[5/5] Notify config already present → {path}",
    "telegram.wizard.step5.write_failed": "[5/5] Could not write notify config: {detail}",
    "telegram.wizard.done": "      All set. Turn off anytime with: solo-cto-agent telegram disable",
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

    // Telegram wizard (PR-G10 — spec §6)
    "telegram.wizard.not_experimental": "telegram-wizard 는 아직 실험 단계입니다. SOLO_CTO_EXPERIMENTAL=1 로 다시 실행하세요.",
    "telegram.wizard.step1.header": "[1/5] 봇 토큰",
    "telegram.wizard.step1.hint": "      https://t.me/BotFather 를 열어 /newbot (또는 /mybots) 을 실행하고 토큰을 붙여넣으세요.",
    "telegram.wizard.step1.empty": "      (입력이 비어있습니다 — 다시 시도)",
    "telegram.wizard.step1.bad_shape": "      토큰 형식이 올바르지 않습니다 (예상 형식: 123:ABC...). 다시 시도하세요.",
    "telegram.wizard.step1.verified": "      ✓ Telegram 에서 확인됨 (getMe): @{username}",
    "telegram.wizard.step1.missing_token": "non-interactive 모드에서는 --token 이 필요합니다",
    "telegram.wizard.step2.using_provided": "[2/5] 전달된 chat id 를 사용합니다: {chatId}",
    "telegram.wizard.step2.send_message": "[2/5] 지금 @{username} 에게 아무 메시지나 보내세요.",
    "telegram.wizard.step2.waiting": "      (최대 60초 대기 — Ctrl-C 로 취소)",
    "telegram.wizard.step2.captured": "      ✓ chat {chatId} ({kind}){namePart} 에서 메시지 수신",
    "telegram.wizard.step2.missing_chat": "non-interactive 모드에서는 --chat 이 필요합니다",
    "telegram.wizard.step3.header": "[3/5] 자격 증명을 어디에 저장할까요?",
    "telegram.wizard.step3.opt1": "      (1) .env (현재 레포)",
    "telegram.wizard.step3.opt2": "      (2) 쉘 프로필 (~/.zshrc 또는 ~/.bashrc)",
    "telegram.wizard.step3.opt3": "      (3) GitHub 레포 시크릿 (gh)",
    "telegram.wizard.step3.opt4": "      (4) 위 전체",
    "telegram.wizard.step3.missing_storage": "non-interactive 모드에서는 --storage 가 필요합니다",
    "telegram.wizard.step4.sending": "[4/5] 테스트 알림 전송 중…",
    "telegram.wizard.step4.delivered": "      ✓ chat {chatId} 에 전달됨 (message_id={messageId})",
    "telegram.wizard.step5.wrote_config": "[5/5] 기본 notify 설정 파일 작성 → {path}",
    "telegram.wizard.step5.customize_hint": "      커스터마이즈: solo-cto-agent telegram config",
    "telegram.wizard.step5.already_present": "[5/5] notify 설정 파일이 이미 존재 → {path}",
    "telegram.wizard.step5.write_failed": "[5/5] notify 설정 작성 실패: {detail}",
    "telegram.wizard.done": "      완료. 언제든 끄려면: solo-cto-agent telegram disable",
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
