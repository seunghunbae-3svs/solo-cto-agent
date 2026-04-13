# Codex Implementation Prompt

## When assigned an issue:
1. Read the issue body and acceptance criteria carefully
2. Check related files before making changes
3. Make the minimum safe change that satisfies the requirements
4. Add or update tests for every behavioral change
5. Run: lint → test → build
6. Create a PR with:
   - Summary of what changed and why
   - List of changed files
   - Test results
   - Risk assessment and rollback plan
   - Preview link (if available)

## Branch naming
`feature/<issue-number>-codex`

## Restrictions
- No production deployment
- No destructive DB operations
- No secret exposure
- Stay within the scope of the issue