import { describe, test, expect, beforeEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const i18n = require("../bin/i18n.js");

describe("i18n module", () => {
  beforeEach(() => {
    // Reset to default before each test to avoid cross-test leakage.
    i18n.setLocale(i18n.DEFAULT_LOCALE);
  });

  test("supports en and ko", () => {
    expect(i18n.SUPPORTED).toContain("en");
    expect(i18n.SUPPORTED).toContain("ko");
  });

  test("defaults to ko (preserves historical behavior)", () => {
    expect(i18n.DEFAULT_LOCALE).toBe("ko");
    expect(i18n.getLocale()).toBe("ko");
  });

  test("setLocale switches active locale", () => {
    i18n.setLocale("en");
    expect(i18n.getLocale()).toBe("en");
  });

  test("setLocale rejects unsupported locales silently", () => {
    i18n.setLocale("en");
    i18n.setLocale("fr"); // should not change
    expect(i18n.getLocale()).toBe("en");
  });

  test("t() returns Korean string when locale is ko", () => {
    i18n.setLocale("ko");
    expect(i18n.t("common.error")).toBe("오류");
  });

  test("t() returns English string when locale is en", () => {
    i18n.setLocale("en");
    expect(i18n.t("common.error")).toBe("ERROR");
  });

  test("t() interpolates template parameters", () => {
    i18n.setLocale("en");
    expect(i18n.t("doctor.api_key_missing", { name: "Anthropic", feature: "review" }))
      .toBe("Anthropic API key not set — review features unavailable");
  });

  test("t() falls back to English if key missing in active locale", () => {
    // Inject a key that only exists in en
    i18n._bundles.en["__test_only_en"] = "english-only";
    i18n.setLocale("ko");
    expect(i18n.t("__test_only_en")).toBe("english-only");
    delete i18n._bundles.en["__test_only_en"];
  });

  test("t() returns the key itself if missing everywhere", () => {
    i18n.setLocale("en");
    expect(i18n.t("completely.missing.key")).toBe("completely.missing.key");
  });

  test("parseLangFlag picks up --lang en from argv", () => {
    expect(i18n.parseLangFlag(["--lang", "en", "doctor"])).toBe("en");
  });

  test("parseLangFlag picks up --lang ko from argv", () => {
    expect(i18n.parseLangFlag(["--lang", "ko"])).toBe("ko");
  });

  test("parseLangFlag falls back to default on unknown value", () => {
    // Unknown value triggers a warn but returns default/env
    const origLang = process.env.LANG;
    const origSoloLang = process.env.SOLO_CTO_LANG;
    delete process.env.LANG;
    delete process.env.SOLO_CTO_LANG;
    expect(i18n.parseLangFlag(["--lang", "fr"])).toBe(i18n.DEFAULT_LOCALE);
    if (origLang !== undefined) process.env.LANG = origLang;
    if (origSoloLang !== undefined) process.env.SOLO_CTO_LANG = origSoloLang;
  });

  test("parseLangFlag respects SOLO_CTO_LANG env when no flag", () => {
    const orig = process.env.SOLO_CTO_LANG;
    process.env.SOLO_CTO_LANG = "en";
    expect(i18n.parseLangFlag(["doctor"])).toBe("en");
    if (orig === undefined) delete process.env.SOLO_CTO_LANG;
    else process.env.SOLO_CTO_LANG = orig;
  });

  test("parseLangFlag derives locale from LANG env (en_US.UTF-8 → en)", () => {
    const orig = process.env.LANG;
    const origSolo = process.env.SOLO_CTO_LANG;
    delete process.env.SOLO_CTO_LANG;
    process.env.LANG = "en_US.UTF-8";
    expect(i18n.parseLangFlag(["doctor"])).toBe("en");
    if (orig === undefined) delete process.env.LANG;
    else process.env.LANG = orig;
    if (origSolo !== undefined) process.env.SOLO_CTO_LANG = origSolo;
  });

  test("parity: all en keys exist in ko bundle", () => {
    const enKeys = i18n.listKeys("en");
    const koKeys = new Set(i18n.listKeys("ko"));
    const missing = enKeys.filter((k) => !koKeys.has(k));
    expect(missing).toEqual([]);
  });

  test("parity: all ko keys exist in en bundle", () => {
    const koKeys = i18n.listKeys("ko");
    const enKeys = new Set(i18n.listKeys("en"));
    const missing = koKeys.filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  test("isSupported accepts en and ko, rejects others", () => {
    expect(i18n.isSupported("en")).toBe(true);
    expect(i18n.isSupported("ko")).toBe(true);
    expect(i18n.isSupported("fr")).toBe(false);
    expect(i18n.isSupported("")).toBe(false);
  });

  // PR-G10 — telegram wizard bundle (spec §6). These guard against
  // accidental drift between the wizard code and the bundles.
  test("telegram wizard keys exist in both bundles", () => {
    const keys = [
      "telegram.wizard.not_experimental",
      "telegram.wizard.step1.header",
      "telegram.wizard.step1.hint",
      "telegram.wizard.step1.verified",
      "telegram.wizard.step2.send_message",
      "telegram.wizard.step2.captured",
      "telegram.wizard.step3.header",
      "telegram.wizard.step4.sending",
      "telegram.wizard.step4.delivered",
      "telegram.wizard.step5.wrote_config",
      "telegram.wizard.done",
    ];
    for (const k of keys) {
      i18n.setLocale("en");
      expect(i18n.t(k)).not.toBe(k);
      i18n.setLocale("ko");
      expect(i18n.t(k)).not.toBe(k);
    }
  });

  test("telegram wizard ko bundle is actually different from en", () => {
    i18n.setLocale("en");
    const en = i18n.t("telegram.wizard.step1.header");
    i18n.setLocale("ko");
    const ko = i18n.t("telegram.wizard.step1.header");
    expect(en).not.toBe(ko);
    expect(ko).toContain("봇 토큰");
  });

  test("telegram wizard interpolation works in both locales", () => {
    i18n.setLocale("en");
    expect(i18n.t("telegram.wizard.step1.verified", { username: "mybot" }))
      .toContain("@mybot");
    i18n.setLocale("ko");
    expect(i18n.t("telegram.wizard.step1.verified", { username: "mybot" }))
      .toContain("@mybot");
  });
});
