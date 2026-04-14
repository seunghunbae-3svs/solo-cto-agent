---
name: cowork-ship
description: "Release readiness and deployment safety checks for public use."
user-invocable: true
---

# Purpose
Reduce deployment risk with a short, practical release checklist and rollback plan.

# Use When
- You are about to deploy or merge a risky change
- You want to confirm env vars, migrations, and rollback steps
- You need a clear "go / no-go" recommendation

# Output Contract
- Release checklist (pass/fail)
- Rollback steps (safe and minimal)
- One-line recommendation (GO / HOLD)

# Guardrails
- Do not assume production access or credentials
- If critical inputs are missing, return HOLD with missing items
- Keep the checklist short and actionable
