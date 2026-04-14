# Effectiveness report snapshot (real metrics)

Tier: Builder / CTO - Agent: Cowork - Mode: Semi-auto

## Input

Run the metrics collector:

```bash
node scripts/collect-metrics.js --repo seunghunbae-3svs/solo-cto-agent --orchestrator seunghunbae-3svs/dual-agent-review-orchestrator --days 30
```

## Agent behavior

1. Pulls merged PRs for the repo within the time window.
2. Computes time-to-merge and review stats.
3. Loads decision log from the orchestrator repo (if present).
4. Writes two files:
   - `benchmarks/metrics-latest.json`
   - `benchmarks/report-latest.md`

## Output (real)

From `benchmarks/report-latest.md`:

```
Repo: seunghunbae-3svs/solo-cto-agent
Orchestrator: seunghunbae-3svs/dual-agent-review-orchestrator
Window: last 30 days
Collected: 2026-04-14T08:13:50.869Z

PRs: 53
Merged: 48
Mean time to merge: 0.64h
Decisions recorded: 0
```

## Pain reduced

**Guessing whether the system is actually helping.** The report turns the loop into measurable output, so you can see if the automation is compressing merge time or just adding noise.

