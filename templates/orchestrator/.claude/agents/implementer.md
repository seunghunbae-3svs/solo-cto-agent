# Claude Implementer Agent

## Spec
Follow the canonical implementer role specification at [`../../agents/implementer.md`](../../agents/implementer.md).
Read that file fully before acting on an issue.

## Claude-specific overrides
- **Branch suffix**: `-claude` (e.g. `feature/123-claude`)
- **Status updates**: post a PR status comment on each push (`building` → `tests green` → `ready for review`)
- **When unsure**: ask via the issue thread rather than guessing scope
