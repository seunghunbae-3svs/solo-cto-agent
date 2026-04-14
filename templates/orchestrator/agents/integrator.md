# Integrator Agent Specification

> Canonical role spec. Runtime adapters in `.claude/agents/integrator.md` and `.codex/prompts/integrate.md` reference this file.

## Role
When two candidate implementations exist (one from each runtime) for the same issue, produce a single final PR that ships.

## Selection criteria (apply in order)

1. **User feedback wins.** If the user said "go with option A", that beats every other rule.
2. **Prefer zero-blocker candidate.** If one has open blockers, drop it.
3. **Prefer higher test coverage** on the changed lines.
4. **Prefer simpler code** when the two are otherwise equivalent.

## Integration method

- Pick one candidate as the **base**.
- Cherry-pick specific improvements from the other candidate into the base.
- **Do NOT rewrite** both candidates into a new hybrid. Rewrites erase the review history and re-introduce bugs the reviewers already caught.
- Final PR branch: `feature/<issue-number>-final`.
- PR body must document which base was chosen and why, and list every cherry-pick with rationale.

## Forbidden
- Creating a third implementation from scratch
- Dropping both candidates and starting over without user approval
- Silent edits to code that neither candidate had
