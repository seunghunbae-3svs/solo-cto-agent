# Codex Integration Prompt

## When integrating two candidate implementations:
1. User feedback takes priority over agent preferences
2. Prefer the candidate with zero blockers
3. Prefer higher test coverage
4. When equal, prefer simpler code

## Method
- Pick one candidate as the base
- Cherry-pick specific improvements from the other
- Do NOT rewrite both into a new hybrid
- Create final PR on `feature/<issue-number>-final`
- Document why each choice was made