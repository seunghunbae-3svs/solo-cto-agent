# Feedback Collection Guide

How the solo-cto-agent system learns from your usage and how you can actively improve it.

Feedback works differently in the two modes:

- **Semi-auto mode (cowork-main)** — Local `feedback accept|reject` CLI writes directly to personalization. No GitHub required. See §1.
- **Full-auto mode (codex-main)** — CI events + `repository_dispatch` feed `agent-scores.json` in your orchestrator repo. See §2.

---

## 1. Semi-auto mode — `feedback` CLI (cowork-main)

The primary feedback channel for cowork-main users. Every review has issues; you tell the agent which ones were accurate and which were wrong. The next review uses those patterns as personalization weights.

### Basic usage

```bash
# Agent flagged a real bug → accept (reinforce this pattern)
solo-cto-agent feedback accept --location src/Btn.tsx:42 --severity BLOCKER

# Agent was wrong / over-flagged → reject (down-weight this pattern)
solo-cto-agent feedback reject --location src/Nav.tsx:12 --severity SUGGESTION \
  --note "already memoized — false positive"

# Review accumulated patterns
solo-cto-agent feedback show
```

### What happens under the hood

Each verdict writes to `~/.claude/skills/solo-cto-agent/personalization.json` into one of two buckets:

| Bucket | Meaning | Effect on next review |
|---|---|---|
| `acceptedPatterns` | Locations where you confirmed the issue was real | Agent trusts similar findings more |
| `rejectedPatterns` | Locations where you disputed the issue | Agent down-weights similar findings, flags them as "possible false positive" |

Entries merge on `path + severity` (so repeated accepts on the same line increment a count rather than duplicating). Each bucket is capped at 100 entries sorted by frequency.

### Anti-bias rotation (80/20)

`personalizationContext()` — the function that injects accumulated patterns into the review prompt — is **not** always on. It rotates:

- **80% of calls** → full exploit mode: hotspots, accept/reject lists, style hints injected
- **20% of calls** → explore mode: minimal context, explicit "fresh look — don't over-rely on past patterns" hint

This prevents the agent from locking into past decisions and missing new issues. You can force either mode deterministically (useful in tests or when you explicitly want a fresh perspective):

```js
personalizationContext({ exploration: true })   // force explore
personalizationContext({ exploration: false })  // force exploit
```

### When to use which

| Situation | Action |
|---|---|
| Review flagged a real bug you fixed | `feedback accept` on that location |
| Review flagged something that was fine | `feedback reject` with `--note` explaining why |
| You want to audit what the agent has learned | `feedback show` |
| You want a fresh review (ignore past patterns) | Just run `review` again — 20% chance of explore mode; or for CI, seed the env so exploration triggers |

### Notification hook (optional)

Pair `feedback` with `notify` to log verdicts to a channel:

```bash
solo-cto-agent feedback reject --location src/Nav.tsx:12 --severity SUGGESTION \
  --note "false positive"
solo-cto-agent notify --title "Feedback logged" --severity info \
  --body "rejected src/Nav.tsx:12 SUGGESTION" --channels file
```

---

## 2. Full-auto mode — CI events + `repository_dispatch` (codex-main)

### How feedback works

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
