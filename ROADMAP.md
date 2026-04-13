# ROADMAP

## Completed (v0.3.0)
- setup.sh fix
- frontmatter normalization
- CONTRIBUTING
- Examples
- demos/ removal
- package validator
- changelog updater
- IDE configs (Cursor, Windsurf, Copilot)
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

## v0.7.0 Plan
- apply references/ to remaining skills (craft, memory, review, spark)
- npm publish automation (release.yml + npm token)
- terminal GIF demo (replace SVG)
- ✅ `solo-cto-agent doctor` (lint + status + CI in one pass)
- ✅ cowork-main Phase 1 — `session save/restore/list`, mode-aware guards, dry-run sync
- plugin marketplace listing

## cowork-main Phases
- ✅ **Phase 1** — manual pull (sync dry-run default), local-cache status, doctor, session context
- **Phase 2** — orchestrator repo auto-commits agent-scores + error-patterns post CI run
- **Phase 3** — opt-in `auto_sync: true` at session start (power users)
