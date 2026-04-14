# Package validation before publish

Tier: Builder / CTO — Agent: Cowork — Mode: Semi-auto

## Input

Run the package validator from the repo root:

```bash
node scripts/validate-package.js
```

## Agent behavior

1. Scans the repo root for required files and directories.
2. Verifies `docs/claude.md` and `examples/README.md` exist.
3. Ensures `skills/` exists and is non-empty.
4. Confirms `failure-catalog.json` + schema are present.

## Output (real)

```
Validation passed.
```

## Pain reduced

**Shipping a broken toolkit.** This check prevents publishing a package that is missing the files users actually need to run the workflow.
