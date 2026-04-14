---
name: cowork-self-evolve
description: "Public self-improvement loop: capture recurring failures and update patterns."
user-invocable: true
---

# Purpose
Turn repeated failures into a reusable failure catalog and prevention checklist.

# Use When
- The same build or runtime error repeats
- You want to update failure-catalog.json with a new pattern
- You want a short post-mortem summary

# Output Contract
- New or updated failure pattern (id, regex, severity, fix)
- Prevention checklist (3-5 bullets)
- Optional "next watch" signal to detect recurrence

# Guardrails
- Only add patterns with clear, falsifiable signals
- Avoid over-broad regex rules
- Do not store private repo details or secrets
