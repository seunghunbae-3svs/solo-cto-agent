# codex-main live rework loop and digest

Tier: CTO - Agent: Cowork + Codex - Mode: Full-auto

> Repo and issue identifiers are anonymized. The timings below come from a real private project with live GitHub Actions runs.

## Input (real, anonymized)

An open PR on "Project Alpha" already had review feedback. The test was to confirm two background behaviors:

1. comment-driven rework dispatch
2. scheduled project digest delivery

## Agent behavior

1. A review-related issue comment triggers repository dispatch.
2. The product repo fires:
   - `Comparison Dispatch`
   - `Rework Dispatch`
3. The orchestrator records the next round in PR comments.
4. Separately, the scheduled digest workflow scans the repo every 30 minutes and sends a project summary to Telegram.

## Output (real)

Repository-dispatch runs on the live repo:

```text
Comparison Dispatch   success   7-11s
Rework Dispatch       success    7-10s
```

The PR thread was updated automatically:

```text
## [rework-round]
Cycle: 1
Round: 1/3
Trigger: revise

## [rework-round]
Cycle: 1
Round: 2/3
Trigger: revise

## [compare-hold]
Reason: Preview not available
```

The scheduled digest also ran successfully on the same private repo:

```text
Workflow: Telegram Digest Report
Trigger: schedule
Result: success
Duration: 6s
```

Digest shape (trimmed):

```text
Project report
- open PR count
- recently merged count
- active agent issue count
```

## Pain reduced

**Owner-side context switching.** The background system kept the PR moving, tracked rework rounds, and pushed periodic status outward. The human did not need to poll GitHub manually to know whether work was still active.
