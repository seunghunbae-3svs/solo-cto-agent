# Migration Guide: v1.2 → v1.3

## Breaking Changes

### None (backward compatible)

All `require("./bin/cowork-engine")` exports remain unchanged.
The module facade re-exports every function from the split engine modules.

## What Changed

### P0: Security Layer

Two new modules handle secret protection:

| Module | Purpose |
|---|---|
| `bin/safe-log.js` | Masks API keys in all `console.*` output. Called as first `require` in `cli.js`. |
| `bin/diff-guard.js` | Scans git diffs for secrets before sending to AI APIs. Supports `--redact` and `--force` flags. |

**Action required: none.** Both activate automatically via `cli.js`.

If you call `cowork-engine.js` directly (not via CLI), add this at the top of your entry point:

```js
require("./bin/safe-log").wrapConsole();
```

### P1: Engine Split

`cowork-engine.js` was refactored from 2763 lines to a 1335-line facade that imports from four focused modules:

| Module | Responsibility |
|---|---|
| `bin/engine/core.js` | CONFIG, logging, utilities, model resolution, diff helpers |
| `bin/engine/review.js` | Anthropic/OpenAI API calls, chunk splitting/merging, self-cross-review |
| `bin/engine/session.js` | Session save/restore/list, context checkpoint/restore, rework refresh |
| `bin/engine/routine.js` | fireRoutine, buildRoutineSchedules, managedAgentReview |

**Action required: none** if you use the public API via `require("./bin/cowork-engine")`.

If your tests read `cowork-engine.js` source code directly (e.g., checking for specific strings), update file paths:

```js
// Before (v1.2)
const src = fs.readFileSync("bin/cowork-engine.js", "utf8");
expect(src).toMatch(/process\.env\.SOLO_CTO_CONFIG/);

// After (v1.3)
const src = fs.readFileSync("bin/engine/core.js", "utf8");
expect(src).toMatch(/process\.env\.SOLO_CTO_CONFIG/);
```

### P1: Plugin Install

New CLI command:

```bash
solo-cto-agent plugin install <package-name>    # from npm
solo-cto-agent plugin install ./local-plugin     # from local path
```

API additions in `bin/plugin-manager.js`:
- `installFromRegistry(name, opts)` — searches npm, validates, registers
- `installFromPath(localPath, opts)` — reads local package.json, validates, registers

### P1: Template Audit Auto-Fix

New CLI flags:

```bash
solo-cto-agent template-audit --apply             # fix drifted/missing templates
solo-cto-agent template-audit --apply --dry-run    # preview changes only
solo-cto-agent template-audit --apply --exclude="*.md,codex-*"  # skip patterns
```

API addition in `bin/template-audit.js`:
- `applyFixes(auditResults, packageRoot, opts)` → `{ fixed, skipped, errors, details }`

### P2: Type Definitions

`index.d.ts` now covers all P0/P1 exports:
- `DiffFinding`, `DiffScanResult` — diff-guard types
- `PluginInstallResult` — plugin install result
- `ApplyFixResult` — template fix result
- All `cowork-engine.js` public exports (38 functions previously missing)

### P2: Template Validation CI

New GitHub Actions workflow `.github/workflows/template-validate.yml`:
- Validates all `{{PLACEHOLDER}}` patterns against known list
- Scans for hardcoded secrets in template files
- Runs on PRs and pushes that touch `templates/`

## New Files

```
bin/safe-log.js                              # P0
bin/diff-guard.js                            # P0
bin/engine/core.js                           # P1
bin/engine/review.js                         # P1
bin/engine/session.js                        # P1
bin/engine/routine.js                        # P1
tests/safe-log.test.mjs                      # P0
tests/diff-guard.test.mjs                    # P0
tests/template-audit-apply.test.mjs          # P1
tests/type-sync.test.mjs                     # P2
.github/workflows/template-validate.yml      # P2
docs/migration-v1.3.md                       # P2
```

## Upgrade Steps

1. `git pull origin main`
2. `npm install` (no new dependencies)
3. Run `npm test` to verify
4. Done — no config changes needed
