# Changelog

## v1.3.0 (2026-04-17)

**Theme**: Tier 3 deep integration features — plugin registry search, setup automation, type system enhancements.

### Highlights
* `solo-cto-agent plugin search <query>` — search npm registry for plugins with "solo-cto-agent-plugin" keyword
* setup.sh enhancements: `--include-benchmarks` flag to deploy dashboard.html, auto-detection of Cursor/Windsurf editors
* Auto-copy of editor-specific docs (docs/cursor.md, docs/windsurf.md) based on detected environment
* Enhanced TypeScript definitions: BenchmarkMetrics, BenchmarkDiffResult, PluginSearchResult, HistoryEntry
* Full test coverage for plugin search, CLI subcommands, and new features

### New: Plugin Search
* `solo-cto-agent plugin search <query>` fetches from npm registry with fallback to helpful error messages
* `--json` flag for programmatic consumption
* Graceful handling of network failures with user-friendly messages
* Integration with plugin-manager.js for unified plugin experience

### New: Setup.sh Enhancements
* `--include-benchmarks` flag copies benchmarks/dashboard.html to orchestrator directory
* Auto-detection of Cursor editor (checks ~/.cursor/ directory)
* Auto-detection of Windsurf editor (checks ~/.windsurf/ directory)
* Automatic copy of editor-specific documentation to CLAUDE_DIR/docs/
* Enhanced summary output showing detected editor and installed features

### Enhanced Types
* `BenchmarkMetrics`: Matches metrics-latest.json shape (name, description, value, unit, timestamp)
* `BenchmarkDiffResult`: For --diff output (baseline, current, delta, percentChange)
* `PluginSearchResult`: npm registry search results (name, version, description, author, links)
* `HistoryEntry`: For benchmarks/history/*.json (timestamp, metrics[], changes[])

### Tests
* `tests/plugin-search.test.mjs` — 10 new tests for registry search with HTTP mocking
* Updated CLI tests for `plugin search` and `plugin list` subcommands
* All existing tests pass with version bump

---

## v1.2.0 (2026-04-17)

**Theme**: Public release polish + cowork-main Phase 2/3 + dual-agent metrics.

### Highlights
* Terminal demo SVG with animated CLI walkthrough
* cowork-main Phase 2 — orchestrator auto-commits agent-scores + error-patterns post CI
* cowork-main Phase 3 — `session sync` fetches orchestrator data at session start
* Dual-agent metrics population (cross-review rate, decision tracking, rework cycles)
* `collect-metrics.js` fixes: orchestrator repo name, array-aware parsing, rework + cross-repo metrics
* `changelog.yml` CI fix (PAT token, null-safe condition, skip-ci loop prevention)
* npm keywords expanded for better discoverability
* README hero section rewritten for public audience

### Previous (detailed)
* feat: v1.2.0 — metrics fix, Phase 2/3 cowork, terminal demo, changelog CI — PR-G7-subcommands: telegram test/config/status/disable/verify + event filter

**Theme**: closing the telegram wizard loop. The wizard (PR-G7-impl)
gets you wired up; this PR adds the day-2 surface — toggle which event
classes notify you, mute the whole channel without losing creds, run a
non-interactive verify in CI, and tear it all down with one command.

### New: `bin/notify-config.js`
* Persistent event filter at `~/.solo-cto-agent/notify.json` (override
  via `$SOLO_CTO_NOTIFY_CONFIG`).
* Schema matches `docs/telegram-wizard-spec.md` §5: `channels`,
  `events` (review.blocker / review.dual-disagree / ci.failure /
  ci.success / deploy.ready / deploy.error), `format`.
* Fail-open semantics: missing file → defaults; unknown event id →
  enabled; corrupt JSON → defaults + `_error` marker.
* Atomic disk writes via tmp-file rename. `0600` perms.
* Empty `channels[]` is honored verbatim (so `telegram disable` can
  truly mute the channel without the writer re-adding 'telegram').

### New telegram subcommands
* `solo-cto-agent telegram test` — one-shot send with current creds.
  Bypasses the event filter (the whole point is to confirm the pipe).
* `solo-cto-agent telegram verify` — non-interactive `getMe` +
  optional `sendMessage` round-trip. Returns structured exit code for
  CI scripts.
* `solo-cto-agent telegram status` — dump cred sources (env vs `.env`
  block vs shell profile), mask token, list active events.
* `solo-cto-agent telegram disable` — strip `.env` block + shell
  profile block + GitHub secrets (best-effort) + drop 'telegram' from
  notify-config channels. Idempotent.
* `solo-cto-agent telegram config` — toggle events / format. Three
  modes: `--list`, `--event X --on|--off`, `--format compact|detailed`,
  plus an interactive numbered menu when no flags + TTY.

### Wizard updates
* Step 5 now writes the default `notify.json` on first run so users
  don't have to discover `telegram config` separately. Idempotent —
  re-running the wizard never clobbers an existing config.

### `bin/notify.js`
* `sendTelegram` consults notify-config at emit time. If the envelope
  carries `meta.event` and that event is disabled, the send is
  short-circuited (returned as `{ok:true, filtered:true, reason}`).
* `notifyReviewResult` and `notifyApplyResult` now tag envelopes with
  the appropriate event id (`review.blocker` / `review.dual-disagree`
  / `ci.failure` / `ci.success`).
* Lazy-require of notify-config keeps the module usable in
  stripped-down installs that don't ship the new file.

### Tests
* `tests/notify-config.test.mjs` — 14 tests. Defaults, partial-merge,
  corrupt-recovery, format normalization, channel + event toggles.
* `tests/telegram-subcommands.test.mjs` — 18 tests covering
  `resolveCreds` / `telegramTest` / `telegramVerify` /
  `telegramStatus` (with token masking assertion) / `telegramDisable`
  / `telegramConfig`. All network calls stubbed via injected
  `httpGetJson` / `httpPostJson`.
* `tests/telegram-wizard.test.mjs` — `runWizard` tests now isolate
  step-5 notify-config writes via `SOLO_CTO_NOTIFY_CONFIG` so the
  suite never touches the real `~/.solo-cto-agent/`.
* Total: 441 tests (up from 399 in PR #64).

### Docs
* `docs/telegram-wizard-spec.md` — status flipped from DRAFT → SHIPPED.

---

## Unreleased

* feat: P2 — type sync, template validation CI, migration guide

* feat: P1 — cowork-engine split, plugin install, template-audit --apply

* security: add API key masking + diff secret detection (P0)

* feat: add `setup --central` for centralized workflow architecture

* feat(tier3): plugin registry search, setup.sh enhancement, v1.3.0 (#100)

* feat: Tier 2 — metrics history, benchmark diff/trend, enhanced validation (#99)

* feat: Tier 1 — benchmark CLI, docs, expanded error catalog (#98)

* feat: /prs, /dashboard commands + natural language (T3) (#104)

* fix: align HTTP timeout with Telegram long-poll timeout (#103)

* fix: delete webhook before getUpdates polling (#102)

* feat: telegram-bot callback handler + remove experimental gate (#101)

* fix: create local ref for base branch in solo-cto-review template

* chore: anonymize personal info and internal project names

* release: v1.2.0 — public release polish — Toolkit upgrade: per-tool entry points + examples/

**Theme**: repositioning from "skill pack" to "toolkit" by splitting the
docs surface along tool boundaries and filling `examples/` with real
usage flows — not feature tours. Each example shows input → agent
behavior → output → pain reduced, so you can recognise which failure
mode an example applies to without reading the skill definitions.

### Docs structure
* **`docs/claude.md`** — primary tool entry point (English, slim).
  Links deeper into `cowork-main-install.md` for install detail.
  Landing for: install, keys, tier choice, loop overview.
* **Per-tool entry-point convention** — README now lists tool entry
  points as a table. Claude is supported today; Cursor / Windsurf /
  Copilot rows are marked "Not yet" and will gain their own docs
  pages when their execution adapters land. The core skills
  (`review`, `build`, `ship`, `memory`, `craft`, `spark`) stay
  tool-agnostic.
* Removed the single-file top-level `Examples` file; replaced with a
  full `examples/` tree.

### examples/ (new)
* `examples/build/add-google-oauth.md` — NextAuth + Supabase wiring
  with env precheck before code gen.
* `examples/build/fix-recurring-build-error.md` — circuit-breaker halt
  on 3rd repeat error + root-cause patch instead of 4th band-aid.
* `examples/ship/pre-deploy-env-lint.md` — service-scan + paste-ready
  `vercel env add` commands before the deploy breaks.
* `examples/ship/release-with-npm-publish.md` — version bump, tag,
  idempotent publish, safe to re-run via workflow_dispatch.
* `examples/review/dual-review-blocker.md` — Claude + Codex disagree
  on a Stripe webhook race; cross-review resolves severity.
* `examples/review/uiux-vision-check.md` — six-axis vision scorecard
  on a preview URL surfaces AI-slop gradients and mobile tap targets.
* `examples/founder-workflow/session-start-briefing.md` — 7-line brief
  on session start instead of 15-minute context reload.
* `examples/founder-workflow/idea-critique.md` — risk-first critique
  surfaces a partnership conflict in 2 minutes.

### Consistency
* `scripts/validate-package.js` — required-file list no longer references
  the removed `.cursorrules` / `.windsurfrules` /
  `.github/copilot-instructions.md`. Now tracks `examples/README.md`
  and `docs/claude.md`.
* `bin/wizard.js` — default editor changed from `Cursor` to
  `Claude Cowork` to match the supported primary surface.
* README — new "Tool entry points" + "Examples" sections; document
  bullet list cleaned up with proper UTF-8 Korean (the block that was
  previously cp949-mojibake). Remaining Korean mojibake elsewhere in
  the README is tracked as a separate encoding-repair pass.

### No behavior change
* No CLI commands changed. No skill specs changed. No API. Anyone who
  had the previous version installed continues to work identically —
  this is a documentation + examples release.

---

## 1.1.0 — Tier-aware reviews, security signals, plugins & telegram

**Theme**: closing the last gaps around signal quality and agent
extensibility. The review loop now reasons about Haiku/Sonnet/Opus
tier-appropriately, surfaces live CVE/GHSA advisories via OSV.dev,
captures screenshots without Playwright, and gains a first-cut
plugin system + experimental telegram setup wizard.

### External signals (PR-G4)
* **T2 Security Advisories (OSV.dev)** — CVE + GHSA scan across
  `dependencies` + `devDependencies`. Severity normalized (DB-specific
  > CVSS numeric > UNKNOWN) and merged into the external-knowledge
  context block. Gate: `COWORK_EXTERNAL_KNOWLEDGE_SECURITY=0` to skip.

### Review tiering (PR-G2)
* **Per-tier Claude model resolution** — Haiku (cheap triage) / Sonnet
  (default) / Opus (deep review) selected automatically based on watch
  tier. Overridable via `ANTHROPIC_MODEL_HAIKU|SONNET|OPUS`.

### UI/UX loop (PR-G5)
* **Playwright-free screenshot capture** — `uiux vision-review --url`
  and `uiux capture --url` now fall back to thum.io when Playwright is
  unavailable. Viewports: mobile 375x812 / tablet 768x1024 / desktop
  1280x800.

### Plugins & integrations (PR-G6 / G7)
* **`docs/plugin-api-v2.md`** — capability manifest spec
  (env/net/fs/cli/hook/schedule prefixes), contribution points, agent
  targeting (`claude` / `codex` / `cowork` / `headless`).
* **`plugin` subcommand** — filesystem-only manager:
  `solo-cto-agent plugin list|show|add --path <dir>|remove`. Records
  metadata only; does NOT execute plugin code. Runtime loader lands
  in a follow-up behind the capability gate.
* **`telegram wizard`** (experimental — `SOLO_CTO_EXPERIMENTAL=1`)
  — one-command bot token + chat_id capture + `.env` / shell profile
  / GitHub secret writeback + live sendMessage verification.
* **`docs/telegram-wizard-spec.md`** — full spec including failure
  modes and i18n hooks.

### Developer experience
* **375 tests** (up from 247 in 1.0.0) across 28 files — all offline,
  all network calls stubbed via injected `fetchImpl`.
* **Shared `prompt-utils.js`** — `ask` / `askYesNo` / `askChoice` /
  `isTTY` / `createRl` extracted from `wizard.js` for future wizards.
* **npm publish automation** — tag `v*` now triggers full CI +
  `npm publish` + GitHub Release in one workflow.

### Upgrade notes
* No breaking changes. All new features are additive and gated on
  env vars (`COWORK_EXTERNAL_KNOWLEDGE_SECURITY`,
  `SOLO_CTO_EXPERIMENTAL`).
* `solo-cto-agent plugin` and `solo-cto-agent telegram` are new
  commands — existing commands are unchanged.

## 1.0.0 — First stable release

**Why 1.0**: the loop is now closable end-to-end. Previous 0.x releases were
the skill pack alone. 1.0 adds the three-tier external-signal framework,
self-cross-review, inbound feedback, and honest signal reporting — the pieces
needed to trust a single-agent loop for production work.

### External-loop framework (PR-E1 through E5)
* T1 Peer Model — OpenAI Codex cross-check via `dual-review`
* T2 External Knowledge — npm registry package-currency scan surfaces major/minor/deprecated deltas
* T3 Ground Truth — Vercel deployment + Supabase log signals injected into the review prompt
* Self-loop warning — boxed notice when no external signals are active (single-model blind-spot alert)
* Inbound feedback channel — `feedback record` + Slack/GitHub dispatch

### Dogfood-driven fixes (PR-F1, F2)
* default-branch auto-detection (B1) — no more hardcoded `main`, works on `master` / `develop` repos
* `--target <base>` override (B2) — diff against any ref
* `--dry-run` now surfaces the self-loop warning without API spend (B3)
* README flags match reality (B4) — dead examples removed
* `--json | jq` pipe-safety (B5) — `setLogChannel("stderr")` keeps stdout pure JSON
* **honest signal reporting (F2)** — `activeCount` now reflects actual fetch outcome, not just env flags. A tier set-but-silent no longer gets counted as "active", and hints surface `enabled-but-silent: T2 (env set, no data)` for debugging.

### Developer experience
* 247 tests (up from ~180 in 0.6.x) covering CLI, engine parser, watch gating, self-loop warning, and new drive-run regressions
* Package-validate + Changelog + Test CI workflows all green

## 0.6.0

* added `solo-cto-agent lint` command — flags skills over 150 lines, missing frontmatter, large code blocks
* added CLI tests (init, status, lint, --force, MISSING state) — 8 new test cases
* added npm pack dry-run test — verifies tarball includes required files and excludes tests/CI
* expanded failure-catalog from 8 to 15 patterns (Next.js types, edge runtime, JWT, peer deps, DB migrations, deploy timeouts)
* added SECURITY.md
* applied references/ pattern to build skill (377→197 lines) and ship skill (283→124 lines)
* improved README architecture diagram (full skill system, not just error flow)

## 0.5.1

* added skill slimming docs (references/ pattern with measured results)
* fixed BOM encoding in CONTRIBUTING
* fixed corrupted FAQ section in README
* cleaned up README: removed duplicate sections, consolidated post-install guide
* updated ROADMAP with v0.5.0 completion and v0.6.0 plan

## 0.5.0

* added CLI init/status commands for npm distribution
* added demo asset, architecture diagram, and updated Quick Start
* expanded CONTRIBUTING and templates

## 0.4.0

* added package.json and basic test tooling
* added failure-catalog.json and schema validation
* added CI test workflow for PRs
* added ROADMAP.md

## 0.3.0

* added .cursorrules for Cursor IDE support
* added .windsurfrules for Windsurf (Cascade) support
* added .github/copilot-instructions.md for GitHub Copilot support
* all three rule files share the same CTO philosophy, adapted to each tool's format

## 0.2.0

* rewrote README to sound more human and less sales-heavy
* improved `setup.sh` toward safer repeat installs and updates
* softened over-strong automation claims in `build`
* clarified `craft` as intentionally opinionated
* tightened `review` wording
* added contribution guidance
* added example files for practical usage

## 0.1.0

* initial public release
* added build, ship, craft, spark, review, and memory skills
* added setup script
* added templates for context and project state
