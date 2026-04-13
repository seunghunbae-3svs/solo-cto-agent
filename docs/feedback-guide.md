# Feedback Collection Guide

How the solo-cto-agent system learns from your usage and how you can actively improve it.

## How feedback works

The system collects feedback through three channels, ranked by effort required:

**Passive (zero effort):** Every PR event, CI run, and review automatically updates `agent-scores.json` in your orchestrator repo. The routing engine uses these scores to improve agent selection over time. No action needed from you.

**Semi-passive (minimal effort):** The `sync` command pulls remote CI/CD data into your local skill files. Running it periodically keeps your local error patterns and agent scores up to date:

```bash
solo-cto-agent sync --org myorg --repos app1,app2
```

**Active (when you notice something):** You can dispatch explicit feedback events to the orchestrator via the GitHub API. This is useful when the automated scores miss something qualitative — like a review that was technically correct but missed the real issue, or an agent that keeps suggesting unnecessary refactors.

## Sending explicit feedback

Use `repository_dispatch` to send feedback to your orchestrator repo:

```bash
curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/YOUR_ORG/YOUR_ORCHESTRATOR/dispatches \
  -d '{
    "event_type": "feedback",
    "client_payload": {
      "type": "feedback",
      "category": "review-quality",
      "detail": "Claude review missed RLS policy gap on PR #42",
      "agent": "claude",
      "repo": "my-product-repo"
    }
  }'
```

Feedback categories:

| Category | When to use |
|---|---|
| `review-quality` | Review missed a real issue or flagged a non-issue |
| `ci-reliability` | CI passed but deploy still broke, or CI failed on a flaky test |
| `routing-preference` | You want a specific agent on a specific repo |
| `general` | Anything else worth recording |

## What happens with feedback

Feedback entries are stored in `agent-scores.json` under the `feedback.patterns` array (last 100 entries kept). Every 5 events, the system runs `detectFeedbackPatterns()` which analyzes recent history and adjusts per-repo accuracy scores using a weighted formula: 70% existing score + 30% recent performance.

Over time this means:

- An agent that consistently gets good reviews on a specific repo will be preferred for that repo
- An agent that keeps triggering rework cycles will get lower scores
- Your explicit feedback accelerates the learning beyond what automated events capture

## Viewing feedback data

After syncing, check your local agent scores:

```bash
cat ~/.claude/skills/solo-cto-agent/agent-scores-local.json | jq '.feedback'
```

Or check the sync status:

```bash
solo-cto-agent status
```

## Alternative: GitHub Issues as feedback

If `repository_dispatch` feels too manual, you can also use GitHub Issues on your orchestrator repo with the label `feedback`. While the system does not auto-process these today, they serve as a structured log that can be batch-processed later. Tag issues with the agent name and repo for easier filtering.

## Improving the failure catalog

The `failure-catalog.json` grows automatically as CI failures are encountered. But you can also add patterns manually:

```json
{
  "id": "prisma-migration-drift",
  "pattern": "P3009.*migration.*drift",
  "fix": "Run prisma migrate reset on dev, then prisma migrate deploy",
  "severity": "high",
  "added": "2026-04-13",
  "source": "manual"
}
```

Add entries to `~/.claude/skills/solo-cto-agent/failure-catalog.json`. On next `sync`, local-only patterns are flagged (future versions will auto-push them to remote).
