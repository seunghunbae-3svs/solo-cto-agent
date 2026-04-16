# Effectiveness Report (Latest)

Repo: seunghunbae-3svs/solo-cto-agent
Orchestrator: seunghunbae-3svs/dual-agent-review-orchestrator
Window: last 30 days
Collected: 2026-04-14T08:13:50.869Z

## Core metrics
- PRs: 53
- Merged: 48
- Mean time to merge: 0.64h
- Mean time to first review: n/a
- Avg review count per PR: 0
- Changes requested rate: 0
- Cross-review rate: 0

## Decision metrics
- Decisions recorded: 0
- Approve rate: n/a
- Revise rate: n/a
- Hold rate: n/a
- Mean decision latency: n/a

## Comparison reports
- CTO comparison reports: 0

## Notes
- Cross-review rate is based on >=2 unique reviewers (excluding author).
- Only the most recent 100 PRs are sampled.

## Data gaps
- Rework cycle count per PR (explicit) — wired, not yet populated
- Visual regression count — requires Playwright baseline images
- Deployment failure rate — available in Vercel logs, not yet piped to metrics
- Cross-review rate — dual-agent scoring pipeline deployed recently, accumulating
- Decision queue metrics — wired in orchestrator, awaiting sufficient volume
