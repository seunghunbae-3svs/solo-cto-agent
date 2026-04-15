# codex-main live PR review on a private app

Tier: CTO - Agent: Cowork + Codex - Mode: Full-auto

> Repo, org, branch, and PR identifiers are anonymized. Timings below come from a real private project run.

## Input (real, anonymized)

On a private Next.js commerce app ("Project Alpha"), a small docs-only pull request was opened to verify that codex-main really fires end to end on PR open.

## Agent behavior

1. GitHub receives the PR open event.
2. Product-repo workflows fan out automatically:
   - `Telegram Notify`
   - `Auto Review`
   - `Full Review Pipeline`
   - `Solo CTO Auto Review`
3. The pipeline posts review comments back onto the PR.
4. Vercel preview checks also attach to the PR if deployment is allowed.

## Output (real)

Measured check-run timeline on the live repo:

```text
Telegram Notify        success   7s
Auto Review            success   9s
Full Review Pipeline   success  56s
Solo CTO Auto Review   success  78s
Cross Review Dispatch  skipped   0s
```

The PR received multiple automated comments without any manual command:

```text
1. Dual-Agent Review Pipeline
   - Consensus: APPROVE
   - Agreement: 90%
   - Confirmed issue: 1
   - Dropped false positive: 1
   - Fix plan: 1 task

2. Solo CTO 3-Pass Review
   - Final review state: REQUEST_CHANGES
   - Comment body included Pass 1 / Pass 2 / Pass 3 output
   - Self-loop warning included

3. Cross-review note
   - Separate Codex opinion posted to the PR thread
```

One real caveat surfaced during the same run:

```text
Vercel deployment was refused because the commit author email
was not linked to a GitHub account that Vercel could match.
```

That was not a `solo-cto-agent` review failure. It was a real deployment precondition surfaced by the live system.

## Pain reduced

**"Did the automation actually fire?" uncertainty.** On a real private repo, PR-open automation did not require a human to remember five separate commands. The review chain, Telegram notify, PR comments, and merge-decision surface all appeared automatically.
