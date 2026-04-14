# Codex Implementation Prompt

## Spec
Follow the canonical implementer role specification at `../../agents/implementer.md`.
Load and read that file before starting any work on an issue.

## Codex-specific overrides
- **Branch suffix**: `-codex` (e.g. `feature/123-codex`)
- **Status**: emit a structured progress line to stdout at each phase (`PHASE: build|test|pr`)
- **When unsure**: comment on the issue; do not widen scope silently
