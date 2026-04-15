# Template drift detection on an older repo

## Input

```bash
solo-cto-agent template-audit
```

Context:
- the repo was wired months ago with `setup-pipeline`
- current package templates have moved on
- you want to detect stale copied workflows before CI starts failing for unclear reasons

## Agent behavior

1. Load `~/.claude/skills/solo-cto-agent/managed-repos.json`
2. Read every managed workflow/config target registered during `setup-pipeline` or `setup-repo`
3. Compare the current repo file hash against:
   - the current package template hash
   - the originally installed hash
4. Classify each file as:
   - `OK`
   - `DRIFT`
   - `CUSTOM`
   - `MISSING`
5. Report only. No file is overwritten automatically.

## Output

```text
solo-cto-agent template-audit
----------------------------------------
   INFO Managed repos: 3
   WARN owner/app-one: drift 2, missing 1
   WARN owner/app-two: custom 1
   OK owner/app-three: ok 7

Summary
  Repos:            3
  Drifted files:    2
  Customized files: 1
  Missing files:    1
  Optional missing: 0
  OK files:         19

Default policy
  Audit:   enabled
  Mode:    report-only
  When:    daily
```

## Pain reduced

You find stale copied workflows before they fail as “mystery CI problems,” and you do it without auto-overwriting repo-specific customizations.
