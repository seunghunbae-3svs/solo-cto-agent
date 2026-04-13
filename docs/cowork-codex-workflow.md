# cowork + codex — Operator Workflow

How to run the dual-agent (Cowork Claude + GitHub Actions Codex) review workflow day-to-day. Assumes `skills/orchestrate/` is installed and at least one product repo is registered per `setup.md`.

---

## Mental model

Two agents. One reviewer. One operator (you).

```
Cowork session (you + Claude)          GitHub Actions (Codex worker)
─────────────────────────────          ──────────────────────────────
- Route new issues                     - Pick up labeled issues
- Read PR + review state               - Open PRs on feat/*-codex
- Synthesize decision cards            - Post review comments on opposite agent's PR
- Push buttons (MERGE / REWORK / REJECT) - Run rework when labeled
```

**The operator never writes code directly here.** You read, decide, and click. Claude narrates state and proposes actions. Codex executes in background. You stay in the loop only for the 3 decisions: merge, rework, reject.

---

## Daily cadence (10–15 min)

```
Morning (5 min)
└─ Open Cowork session
   └─ "Use orchestrate status"
       └─ Claude reads:
          · open PRs across all registered product repos
          · running workflows
          · circuit breaker state
          · agent scores (overnight change)
          · Telegram inbox (unclicked cards)
       └─ Output: a single table, one row per PR needing attention

Midday (3 min per decision)
└─ Telegram T1 card arrives
   └─ Option A: click MERGE / REWORK / REJECT on mobile
   └─ Option B: ask Claude in Cowork ("should I merge #17?")
                → Claude loads T2 detail + adds its own verdict
                → You decide with full context

End of day (5 min)
└─ "Use orchestrate: 오늘 agent-score 업데이트하고 요약 카드 쏴줘"
   └─ Claude runs score refresh + sends daily Telegram digest
```

---

## When to open Cowork vs stay on Telegram

| Situation | Where to handle |
|---|---|
| Simple merge, clean verdict | Telegram button |
| BLOCKER present | Cowork — ask Claude for second opinion |
| Reviewer and author disagree | Cowork — Claude synthesizes |
| Circuit breaker tripped | Cowork — needs diagnosis |
| Score suddenly drops | Cowork — root cause |
| New project onboarding | Cowork — step-by-step setup.md |
| Hotfix | Telegram only — don't context switch |

---

## Common commands (in Cowork session)

```
"Use orchestrate status"
  → Full dashboard: PRs · runs · scores · CB · Telegram inbox

"Use orchestrate route #42"
  → Decide agent for issue #42, apply label, invoke worker

"Use orchestrate review #17"
  → Load PR #17 diff + existing reviews, synthesize verdict card

"Use orchestrate rework #17 —reason 'null-guard missing'"
  → Label + trigger rework-auto with structured prompt

"Use orchestrate merge #17"
  → Pre-flight check (CI status, preview, CB state) → merge → score update

"Use orchestrate reject #17 —reason 'scope mismatch'"
  → Close PR, penalty on agent, update STATE.md

"Use orchestrate score refresh"
  → Recompute EMA from last 24h events

"Use orchestrate unblock #42"
  → Manually reset L1 CB for an issue

"Use orchestrate unhalt"
  → Lift L3 SYSTEM_HALT (requires confirmation)
```

---

## Reading a Decision Card

```
🤖 tribo-store #17
tax-policy refactor

⛔ REQUEST_CHANGES (수정요청)           ← verdict — the headline
author=codex · reviewer=claude          ← who did what

3개 함수 시그니처 변경. [확정] tests 8/8
통과하지만 null-guard 제거로 prod crash
가능성 [추정].                           ← one-line summary + fact tags

⚡ 1 BLOCKER · 1 SUG · 1 NIT           ← severity breakdown

[ MERGE ] [ REWORK ] [ REJECT ]         ← action buttons
[ Detail ] [ Preview ]                  ← drill-down
```

**Read order:** verdict → fact tags → severity count → click Detail if BLOCKER present → decide.

If `[확정]` outnumbers `[추정]` and verdict is APPROVE with 0 BLOCKER → safe to MERGE without opening Cowork.

---

## Rework loop hygiene

```
Click REWORK
  → agent gets structured prompt (review comments + diff)
  → produces new commits on same branch
  → cross-review re-fires
  → new T1 card arrives with updated verdict

Limits:
  - CB_SAME_ERROR = 5 reworks with same BLOCKER → auto REJECT
  - Don't manually click REWORK more than twice — if still failing, REJECT
  - Each rework ~2 min on Codex, ~4 min on Claude worker
```

Typical healthy PR sees 0–2 rework rounds. More than 3 means spec is wrong, not the agent.

---

## Score interpretation at a glance

```
0.85+     Excellent    — trust the agent's judgment
0.70–0.84 Healthy      — default routing
0.55–0.69 Watch        — avoid infra / schema work
0.40–0.54 Degraded     — docs / small-fix only
< 0.40    Broken       — 30 min cooldown, investigate
```

A score drop of 0.05+ in a day is worth investigating. 0.02–0.03 is noise.

---

## What to do when things break

| Symptom | Quick fix | Reference |
|---|---|---|
| Telegram card stuck without verdict | `orchestrate review <pr>` in Cowork | — |
| Card arrives but buttons do nothing | Check `api/telegram-webhook` health | `references/setup.md §7` |
| Workflow succeeded but no PR opened | CB +2 silent fail. `orchestrate route <issue>` to retry | `references/failure-recovery.md` |
| "credit balance too low" | Top up API key, then `orchestrate resume` | — |
| Same error 3 times in a row | CB is about to trip. Let it. Then swap. | `references/circuit-breaker.md` |
| Both agents cooling down | L3 escalation. `orchestrate status` shows cause. | `references/circuit-breaker.md §L3` |
| Codex deleted business logic again | REJECT (not rework). Add the prompt injection. | `references/routing-matrix.md §5` |

---

## Keeping the system healthy

Weekly (every Monday, 15 min):

- Review `agent-scores.json` — any component < 0.5?
- Check `failure-log.jsonl` — patterns repeating?
- Update `routing-policy.json` if new work types appeared
- Rotate PAT if close to expiry (Settings → Developer settings)

Monthly:

- Check OpenAI + Anthropic spending trend
- Review CB trip history — are thresholds right?
- Clean `ops/state/archive/` if > 500MB

---

## When NOT to use cowork+codex mode

Switch to cowork-main (Claude solo) for:

- Docs only work
- Personal experimentation (not in a product repo)
- One-off scripts
- Prototype phase where review overhead > review benefit
- Low-stakes repos without branch protection

The dual-agent setup costs ~30% more API tokens per issue. Only pays off when review catches real BLOCKERs.

---

## Sources / Related

- `skills/orchestrate/SKILL.md` — skill contract
- `skills/orchestrate/references/routing-matrix.md` — routing decision tree
- `skills/orchestrate/references/setup.md` — new repo onboarding
- `skills/_shared/agent-spec.md` — verdict / severity / fact tagging
- `ROADMAP.md` — tier evolution plan
