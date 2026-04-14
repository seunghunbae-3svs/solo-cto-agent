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

## Toolkit upgrade (v1.2.0)
- ✅ tool-agnostic core + per-tool entry-point convention (`docs/claude.md` live)
- ✅ `examples/` directory with build / ship / review / founder-workflow scenarios (input → agent → output → pain reduced format)
- ✅ validate-package drops removed legacy-editor files; tracks `examples/README.md` + `docs/claude.md` instead
- ✅ wizard default editor updated to Claude Cowork
- future: `docs/cursor.md` / `docs/windsurf.md` / `docs/copilot.md` when those surfaces land with compatible execution adapters
