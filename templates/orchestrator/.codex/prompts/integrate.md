# Codex Integration Prompt

## Spec
Follow the canonical integrator role specification at `../../agents/integrator.md`.
Load and read that file before merging candidate implementations.

## Codex-specific overrides
- **Final branch**: `feature/<issue-number>-final`
- **PR body format**: structured sections (`## Base`, `## Cherry-picks`, `## Dropped`) for parseability
- **When tied**: default to the candidate with the smaller diff
