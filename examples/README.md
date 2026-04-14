# examples/

Real-world usage flows for `solo-cto-agent`. Every example follows the same four-part shape:

1. **Input** — what you type / what happens
2. **Agent behavior** — the concrete steps the agent runs
3. **Output** — what you get back (files, commits, review verdicts, notifications)
4. **Pain reduced** — the specific problem that this replaces

These are not feature tours. They describe the moment where the agent changes your day-to-day work.

## Index

### `build/` — Writing and fixing code

- [Add Google OAuth to a Next.js app](build/add-google-oauth.md) — scope confirmation → code gen → env precheck → review, no mid-deploy surprise
- [Break out of a recurring build error](build/fix-recurring-build-error.md) — circuit breaker stops a 3x retry loop and summarizes the root cause

### `ship/` — Releasing and deploying

- [Pre-deploy env var lint](ship/pre-deploy-env-lint.md) — service scan + paste-ready `gh secret set` commands before the deploy breaks
- [Release with idempotent npm publish](ship/release-with-npm-publish.md) — version bump + changelog + tag + CI publish that is safe to re-run

### `review/` — Cross-checking before merge

- [Dual-review catches a race condition](review/dual-review-blocker.md) — Claude + Codex disagree, cross-review produces a decision
- [UI/UX vision check on a preview URL](review/uiux-vision-check.md) — 6-axis scoring catches AI-slop gradient UI before it ships

### `founder-workflow/` — Non-code loops

- [Session start briefing](founder-workflow/session-start-briefing.md) — 7-line brief instead of 15 minutes of re-explaining
- [Idea critique before commitment](founder-workflow/idea-critique.md) — risk-first analysis surfaces a blocker in 2 minutes instead of 2 weeks
- [Decision queue via Telegram](founder-workflow/decision-queue-telegram.md) — one-tap approve/revise/hold without hunting PRs

## How to read an example

Each example file shows the real CLI command, the real config / prompt shape, and the real output format the agent produces (command-line text, JSON review record, PR comment, etc.). The "pain reduced" section at the end is deliberately one sentence — if you recognise that sentence as something that has cost you real time, the example applies to you.

## How these map to skills

The `build/` examples exercise the [`build`](../skills/build/SKILL.md) skill. `ship/` exercises [`ship`](../skills/ship/SKILL.md). `review/` exercises [`review`](../skills/review/SKILL.md) and UI/UX vision in [`craft`](../skills/craft/SKILL.md). `founder-workflow/` is the meta-loop — it usually starts in [`spark`](../skills/spark/SKILL.md) or [`memory`](../skills/memory/SKILL.md) before fanning out.

Skill definitions live under [`../skills/`](../skills/). The CLI surface that invokes them is [`../bin/cli.js`](../bin/cli.js) — every command referenced in the examples is a real sub-command you can run today.
