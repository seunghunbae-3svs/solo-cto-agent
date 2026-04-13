# Error Patterns

Purpose: capture recurring failures so the self-evolve loop has concrete input.

## Schema (one entry per error)
- id: ERR-XXX
- category: build | deploy | runtime | workflow
- signal: exact error text or symptom
- root_cause: short root cause
- fix: what resolved it
- prevention: how to avoid recurrence
- first_seen: YYYY-MM-DD
- last_seen: YYYY-MM-DD
- repos: comma-separated repo names

## Entries
- ERR-000 | workflow | "missing secret" | bootstrap gap | set repo secret | add setup checklist | 2026-04-13 | 2026-04-13 | dual-agent-review-orchestrator
