# CLAUDE.md

## 1. Autonomy Levels (Summary)
- L1: Read-only analysis and reporting.
- L2: Code changes and PRs within repo scope.
- L3: Requires explicit human approval (production deploy, DB schema changes, secret rotation).

## 2. Session End Condition (Proposal-Based)
At the end of every session, always propose the next 1-3 actions and ask whether to log the session.
Do not rely on automatic detection to decide if a log should be created.

## 3. Logging Expectations
- If the user approves, append to the relevant operational log.
- Logs should be short, factual, and actionable.
