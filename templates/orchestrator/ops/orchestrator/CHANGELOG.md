# Orchestrator Changelog

All notable changes to the dual-agent review orchestrator are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [v1.5] — 2026-04-12
### Added
- Meta validation policy (T1/T2/T3 tier system) — Issue #11
- `meta-validation-policy.json` — trigger classification rules
- `CHANGELOG.md` — retroactive governance history
- `no-meta-recurse` recursion guard in route-issue.yml

## [v1.4] — 2026-04-12
### Changed
- CI hardening: YAML/JSON syntax → actual CI gate — Issue #10
- `validate-orchestrator.js` wired into `ci.yml`
- Fixed subshell variable scoping (B1) and ajv install path (B2)

## [v1.3] — 2026-04-12
### Changed
- Routing engine: mode standardization — Issue #9
- `single` → `single-agent`, `dual` → `dual-agent`, new `lead-reviewer`
- Score-based lead selection gated by `lead_min_gap` + `lead_eligible_accuracy`
- High-risk labels (security/auth/payments/migration/regression/bug) → forced dual

## [v1.2] — 2026-04-12
### Added
- Agent scoring automation — Issue #8
- `agent-score-update.yml` replaces `score-collector.yml`
- Event-driven score updates (PR, CI, review, hotfix events)
- Counter fields: ci_pass, ci_total, reviews_submitted, merges, hotfixes

## [v1.1] — 2026-04-12
### Added
- Telegram decision loop — Issue #7
- `decision-message.js` full rewrite with fingerprint dedup
- `telegram-webhook.js` decision response parser
- 3-tier messaging (decision/notify/silent)

## [v1.0] — 2026-04-12
### Added
- Initial orchestrator hardening — Issue #6
- Scoring pipeline, ops validation CI, Telegram templates
- Routing engine, routing policy, preview summary workflow
- P0 + P1 operational foundation
