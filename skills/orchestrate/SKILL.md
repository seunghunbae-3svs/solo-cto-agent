---
name: orchestrate
description: "Dual-agent review orchestrator. Runs paired agents on the same codebase, manages routing, scoring, review dispatch, and rework loops. Activates on: cross-review, dual agent, orchestrator, agent scoring, review dispatch, agent failover."
user-invocable: true
---
# Dual-Agent Review Orchestrator

Run two AI agents (Claude + Codex, or any pair) on the same codebase. One writes code, the other reviews it. This skill manages the handoff, scoring, and failure recovery.

## When this activates

Any mention of: cross-review, dual agent, orchestrator, agent scoring, circuit breaker for agents, review dispatch, agent failover.

## Architecture

```
Product Repo (PR opened on -claude or -codex branch)
  |
  +-- cross-review-dispatch.yml -> fires repository_dispatch
  |
  v
Orchestrator Repo
  +-- route-issue.yml        -> label + assign agent on new issue
  +-- cross-review.yml       -> receive dispatch, trigger reviewer agent
  +-- rework-auto.yml        -> parse feedback, re-trigger author agent
  +-- agent-score-update.yml -> track build pass/fail per agent
  +-- webhook handler        -> forward events, check circuit breaker
```

## Setup

### 1. Create the orchestrator repo

```bash
gh repo create {{YOUR_ORG}}/dual-agent-review-orchestrator --private
```

### 2. Add dispatch workflow to each product repo

Copy `.github/workflows/cross-review-dispatch.yml` to every repo where agents open PRs. The workflow detects the agent from branch name (`-claude` or `-codex` suffix) and dispatches a `cross-review-request` event to the orchestrator.

### 3. Required secrets

| Secret | Where | Purpose |
|---|---|---|
| `ORCHESTRATOR_PAT` | Product repos | Token to dispatch events to orchestrator |
| `GH_PAT` | Orchestrator repo | Token to comment on product repo PRs |
| `TELEGRAM_BOT_TOKEN` | Orchestrator repo | Optional: deploy notifications |
| `TELEGRAM_CHAT_ID` | Orchestrator repo | Optional: notification target |

### 4. Configure agents

In the orchestrator repo, set up agent trigger workflows:

**claude-auto.yml** -- triggers Claude on issues labeled `agent:claude`
**codex-auto.yml** -- triggers Codex on issues labeled `agent:codex`

Each workflow should:
1. Check out the product repo
2. 2. Create a branch (`fix/{issue}-{agent}`)
   3. 3. Run the agent with the issue context
      4. 4. Open a PR back to the product repo
        
         5. ## Circuit Breaker
        
         6. Prevents an agent from spiraling on repeated failures.
        
         7. ```
            Thresholds:
              CB_CONSECUTIVE_FAILURES = 3    # trips after 3 consecutive build failures
              CB_COOLDOWN_MINUTES = 30       # auto-recovers after 30 min
              CB_SAME_ERROR = 5              # same error pattern 5 times -> hard stop
            ```

            When circuit breaks:
            1. Agent is paused for the cooldown period
            2. 2. The other agent takes over pending work
               3. 3. Telegram notification fires (if configured)
                  4. 4. After cooldown, agent retries with the accumulated context
                    
                     5. ## Agent Scoring
                    
                     6. Each agent gets a rolling score based on:
                    
                     7. | Metric | Weight |
                     8. |---|---|
                     9. | Build pass rate | 40% |
                     10. | Review approval rate | 30% |
                     11. | Time to resolution | 20% |
                     12. | Rework frequency | 10% |
                    
                     13. Scores determine default assignment: higher-scoring agent gets first crack at new issues. The other agent reviews.
                    
                     14. ## Cross-Review Flow
                    
                     15. ```
                         1. Agent A opens PR on product repo
                         2. cross-review-dispatch.yml fires -> orchestrator
                         3. Orchestrator assigns Agent B as reviewer
                         4. Agent B posts review comments
                         5. If rework needed -> rework-auto.yml triggers Agent A
                         6. Agent A pushes fixes -> cycle repeats until approved
                         7. On approval -> merge + deploy + telegram notify
                         ```

                         ## Rework Trigger

                         The `rework-auto.yml` workflow watches for review comments containing rework signals:
                         - Explicit: `REWORK`, `changes requested`
                         - - Pattern: feedback followed by specific issues
                           - - PR review state: `changes_requested`
                            
                             - On trigger, it extracts the feedback, creates a structured prompt, and re-invokes the original author agent with the review context.
                            
                             - ## Telegram Integration
                            
                             - Optional but recommended for solo founders. Sends notifications on:
                             - - PR opened by agent
                               - - Cross-review completed
                                 - - Build success/failure
                                   - - Circuit breaker trips
                                     - - Daily summary (configurable via cron)
                                      
                                       - ## Placeholder Reference
                                      
                                       - ```
                                         {{YOUR_ORG}}              ->  your GitHub org or username
                                         {{YOUR_ORCHESTRATOR}}     ->  dual-agent-review-orchestrator (or custom name)
                                         {{YOUR_PRODUCT_REPOS}}    ->  comma-separated list of repos to orchestrate
                                         {{YOUR_TELEGRAM_CHAT}}    ->  Telegram chat ID for notifications
                                         ```

                                         ## What this is NOT

                                         This is not a CI/CD system. It sits on top of your existing CI. It does not run tests or builds directly -- it coordinates which agent works on what, ensures cross-review happens, and handles failure recovery. Your existing GitHub Actions, Vercel, or whatever deployment pipeline stays exactly as-is.

## Execution Examples

- "Use orchestrate to run a dual-agent review for Issue #42."
- "Use orchestrate to compare Codex and Claude outputs and recommend a winner."
- "Use orchestrate to prepare a Telegram-ready decision summary."
