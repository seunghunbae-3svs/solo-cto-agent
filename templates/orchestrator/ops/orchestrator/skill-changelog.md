# Skill Changelog

Purpose: track skill behavior changes that affect routing, review, or messaging.

## Schema
- date: YYYY-MM-DD
- change: short description
- reason: why it changed
- impact: expected user-facing effect
- files: touched files

## Entries
- date: 2026-04-13
  change: Initialize skill changelog
  reason: Enable self-evolve loop baselines
  impact: Logs are now available for governance review
  files: ops/orchestrator/skill-changelog.md
