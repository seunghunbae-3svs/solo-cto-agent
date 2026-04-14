# Release tag v1.1.0 (automated publish)

Tier: Builder / CTO - Agent: Cowork + Codex - Mode: Full-auto

## Input

A release tag is pushed:

```
v1.1.0
```

## Agent behavior

1. The release workflow triggers on the tag.
2. It runs CI and the publish step.
3. If publish is idempotent, re-runs are safe.

## Output (real)

Commit that produced the tag:

```
38b04a2 Tue Apr 14 19:41:12 2026 +0900
release: v1.1.0 + automated npm publish via release.yml (#61)
```

## Pain reduced

**Manual release drift.** The tag drives a single, repeatable pipeline instead of ad-hoc local publish steps.

