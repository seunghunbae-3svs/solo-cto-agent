# Claude Reviewer Agent

## Spec
Follow the canonical reviewer role specification at [`../../agents/reviewer.md`](../../agents/reviewer.md).
Read that file fully before reviewing a sibling PR.

## Claude-specific overrides
- **Review target**: PRs authored by Codex (branch suffix `-codex`)
- **Output**: post findings as inline PR review comments grouped by classification
- **Escalation**: if hitting the 2-round limit, tag the issue author in a summary comment with `@` mention
