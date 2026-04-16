# ROADMAP

## Completed (v0.3.0)
- setup.sh fix
- frontmatter normalization
- CONTRIBUTING
- Examples
- demos/ removal
- package validator
- changelog updater
- Agent configs (Claude/Codex)
- README normalization

## Completed (v0.4.0)
- unit tests + vitest
- CI pipeline (package-validate, test, changelog)
- failure-catalog.json + JSON schema
- workflow integration tests

## Completed (v0.5.0)
- npm package distribution (bin/cli.js)
- `npx solo-cto-agent init` / `status` commands
- skill slimming docs (references/ pattern)
- PR/issue templates
- CONTRIBUTING enhancements
- README cleanup (FAQ, post-install, sample output)

## Completed (v0.6.0)
- `solo-cto-agent lint` command
- CLI test suite (8 cases)
- npm pack validation test
- failure-catalog expanded to 15 patterns
- SECURITY.md
- references/ applied to build and ship skills
- README architecture diagram (full system)

## Completed (v0.7.0)
- references/ applied to all remaining skills (craft, memory, review, spark)
- `solo-cto-agent doctor` (lint + status + CI in one pass)
- cowork-main Phase 1 — `session save/restore/list`, mode-aware guards, dry-run sync

## Completed (v1.0.0)
- npm publish automation (release.yml + npm token)
- Toolkit upgrade: per-tool entry points + examples/
- `docs/claude.md` as primary tool entry point
- `examples/` directory with real-world flows (build, ship, review, founder-workflow)
- validate-package tracks `examples/README.md` + `docs/claude.md`
- wizard default editor updated to Claude Cowork

## Completed (v1.1.0)
- self-evolve module (9 components: error-collector, quality-analyzer, rework-learner, skill-improver, skill-scout, feedback-collector, external-trends, weekly-report, orchestrator)
- Telegram wizard + subcommands (test, verify, status, disable, config)
- notify-config with event filtering
- 3-pass auto-review workflow (solo-cto-review.yml)
- deep-review with Managed Agent sandbox
- routine fire/schedules for Claude Code Routines
- provider abstraction (Ollama, LM Studio, Groq, etc.)
- shell completions (bash + zsh)
- i18n (en/ko) for CLI
- cowork-engine parser + personalization
- 894 tests across 48 files
- Live validation on 3 production repos

## Completed (v1.2.0)
- terminal demo SVG with animated CLI walkthrough (init, doctor, review, status)
- cowork-main Phase 2 — orchestrator repo auto-commits agent-scores + error-patterns post CI run
- cowork-main Phase 3 — `session sync` / `session auto-sync` fetches orchestrator data at session start
- dual-agent metrics population (cross-review rate, decision tracking, rework cycles, cross-repo aggregate)
- collect-metrics.js: orchestrator repo name fix, array-aware project-config parsing, rework + cross-repo metrics
- changelog.yml CI fix (PAT token, null-safe condition, skip-ci loop prevention)

## v1.3.0 Plan
- plugin marketplace listing
- benchmark dashboard with historical trends
- `docs/cursor.md` / `docs/windsurf.md` when those surfaces land with compatible execution adapters
