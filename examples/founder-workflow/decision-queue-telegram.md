# Decision queue via Telegram (approve/revise/hold)

Tier: Builder / CTO - Agent: Cowork + Codex - Mode: Full-auto (CI) or Semi-auto (manual trigger)

## Input

You have 8 open PRs across multiple repos. You do not want to open GitHub.

You send:

```
/pending
```

Or you tap the **Decision queue** button in Telegram.

## Agent behavior

1. **Decision queue workflow** aggregates open PRs from the configured project list.
2. For each PR, the agent collects:
   - latest review state (APPROVED / CHANGES_REQUESTED / PENDING)
   - preview URL (from PR comments or deployment statuses)
   - age and urgency (blocker or stale)
3. Telegram sends a single decision queue card with inline buttons:
   - Open PR
   - Open preview
   - Blocker detail
   - Approve / Revise / Hold
4. When you tap **Blocker detail**, the bot pulls the latest blocker summary and shows:
   - reviewer summary
   - preview URL
   - next action hint
5. When you tap **Approve**:
   - it records `[APPROVED via Telegram]` on the PR
   - checks CI/labels for the auto-merge gate
   - auto-merges if the gate passes, otherwise reports why it held

## Output

Telegram message (trimmed):

```
Decision queue

- tribo-store PR #42 (codex, 3h) BLOCKER
  "Fix seller auth redirect"
  https://preview-tribo-42.vercel.app

- eventbadge PR #7 (claude, 18h) PENDING
  "Refine login layout"
  Preview pending

[Open PR] [Preview] [Blocker detail]
[Approve] [Revise] [Hold]
```

After you tap **Approve**:

```
tribo-store PR #42 approval recorded
Auto-merge skipped: CI pending
https://github.com/.../pull/42
```

## Pain reduced

**The decision-scattering tax.** Without a decision queue, approvals are spread across GitHub tabs, Slack pings, and comment threads. You end up skimming 6 PRs just to decide on 1. The queue compresses the decision surface into a single message and turns the action into one tap.

Secondary pain: **missing preview links.** The bot surfaces the preview URL (or a clear "pending" state) so you never have to search the PR timeline.

Tertiary pain: **approve-but-don't-merge surprises.** The auto-merge gate checks CI/labels and tells you exactly why merge was skipped if it could not proceed.
