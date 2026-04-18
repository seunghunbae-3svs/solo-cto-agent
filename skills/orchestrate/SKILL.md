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
Product Repo (any PR — human or agent branch)
  |
  +-- solo-cto-pipeline.yml -> unified dispatcher with 7-layer
  |                            anti-loop guards. Dispatches
  |                            cross-review, rework-request,
  |                            or route-issue depending on event.
  v
Orchestrator Repo
  +-- route-issue.yml         -> label + assign agent on new issue
  +-- cross-review-dispatch.yml -> receive cross-review dispatch,
  |                                run 3-round consensus debate
  |                                (concurrency-gated per PR)
  +-- rework-auto.yml         -> receive rework-request, push fixes
  |                              to PR branch (concurrency-gated)
  +-- visual-report.yml       -> after successful rework, post
  |                              before/after screenshots
  +-- nl-processor.yml        -> receive nl-order-process, turn
  |                              natural-language orders into
  |                              labeled issues on product repos
  +-- agent-score-update.yml  -> track build pass/fail per agent
  +-- webhook handler (api/)  -> Telegram callbacks, circuit breaker
```

## Setup

### 1. Create the orchestrator repo

```bash
gh repo create {{YOUR_ORG}}/{{ORCHESTRATOR_REPO}} --private
```

### 2. Install product-repo workflows via setup-pipeline

`setup-pipeline` installs `solo-cto-pipeline.yml` into every product repo. That single workflow replaces the legacy per-event dispatchers (`cross-review-dispatch.yml`, `rework-dispatch.yml`) and routes PR events, reviews, and comments to the orchestrator through a unified `cross-review` / `rework-request` / `nl-order-process` event vocabulary with 7-layer anti-loop protection.

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
                         2. solo-cto-pipeline.yml fires -> dispatches cross-review
                         3. Orchestrator cross-review-dispatch.yml -> cross-reviewer.js
                            runs 3-round A/B consensus debate (early-exits on agreement)
                         4. Consensus PR comment posted + Telegram action buttons
                         5. If blockers -> auto-dispatches rework-request
                            -> rework-auto.yml -> rework-agent.js pushes fix commits
                         6. visual-report.yml fires after successful rework,
                            posts before/after screenshots
                         7. If label `auto-merge-when-ready` set: GitHub native
                            auto-merge kicks in once all required checks pass
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
                                         {{YOUR_ORCHESTRATOR}}     ->  {{ORCHESTRATOR_REPO}} (or custom name)
                                         {{YOUR_PRODUCT_REPOS}}    ->  comma-separated list of repos to orchestrate
                                         {{YOUR_TELEGRAM_CHAT}}    ->  Telegram chat ID for notifications
                                         ```

                                         ## What this is NOT

                                         This is not a CI/CD system. It sits on top of your existing CI. It does not run tests or builds directly -- it coordinates which agent works on what, ensures cross-review happens, and handles failure recovery. Your existing GitHub Actions, Vercel, or whatever deployment pipeline stays exactly as-is.

## Execution Examples

- "Use orchestrate to run a dual-agent review for Issue #42."
- "Use orchestrate to compare Codex and Claude outputs and recommend a winner."
- "Use orchestrate to prepare a Telegram-ready decision summary."

---

## CLI Hooks — Semi-auto 오케스트레이션 (cowork-main)

```bash
solo-cto-agent watch                                         # manual signal mode
solo-cto-agent watch --auto                                  # CTO tier + cowork+codex 만 자동 허용
solo-cto-agent watch --auto --force                          # gate 우회 (사용자 책임)
solo-cto-agent watch --dry-run                               # gate 결정만 리턴
solo-cto-agent notify --title "..." --severity error \
  --channels slack,telegram --meta project=myapp
```

**Tier Gate (비용 가드레일, 2026-04-14 정책)**
- `maker` / `builder` → `--auto` 거부 (manual only)
- `cto` + `cowork` (single-agent) → `--force` 필요
- `cto` + `cowork+codex` (dual) → 기본 허용

Watch 는 `~/.claude/skills/solo-cto-agent/scheduled-tasks.yaml` 을 자동 emit. Cowork 의 scheduled-tasks MCP 가 등록하면 interval 실행도 가능.
