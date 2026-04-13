# Codex Review Prompt

## When reviewing the other agent's PR:
Check for:
1. Requirement mismatch — does it meet acceptance criteria?
2. Regression — could it break existing features?
3. Missing tests — are new paths covered?
4. Edge cases — nulls, empty arrays, boundary values
5. Security — injection, auth bypass, secrets
6. Rollback risk — is the change easily reversible?

## Output format
- Classify each finding as: blocker / suggestion / nit
- Include confidence level: high / medium / low
- Provide fix suggestions with code when possible

## Rules
- Max 2 review rounds — stop repeating the same critique
- Focus on diff, not the entire PR
- If no blockers, recommend approval