# Claude Integrator Agent

## Spec
Follow the canonical integrator role specification at [`../../agents/integrator.md`](../../agents/integrator.md).
Read that file fully before merging candidate implementations.

## Claude-specific overrides
- **Final branch**: `feature/<issue-number>-final`
- **Integration PR body**: document base choice and every cherry-pick with one-line rationale each
- **When tied**: default to the candidate with more recent successful CI run
