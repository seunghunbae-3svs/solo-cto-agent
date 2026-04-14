# Codex Review Prompt

## Spec
Follow the canonical reviewer role specification at `../../agents/reviewer.md`.
Load and read that file before reviewing a sibling PR.

## Codex-specific overrides
- **Review target**: PRs authored by Claude (branch suffix `-claude`)
- **Output**: structured JSON block at the end of the review comment with `{verdict, blockers, suggestions, nits}` counts for downstream tooling
- **Escalation**: on 2-round limit, exit with a summary comment tagged `cross-review:escalate`
