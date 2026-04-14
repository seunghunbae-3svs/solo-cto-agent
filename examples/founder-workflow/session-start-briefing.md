# Session start briefing

Tier: Maker / Builder / CTO - Agent: Cowork - Mode: Semi-auto

## Input

You open Cowork in the morning. You say nothing yet ->just open the workspace.

Alternatively:

```text
start session
```

(or: "what's on my plate", "start session", etc.)

## Agent behavior

1. **`memory` skill** auto-fires on first message:
   - Loads `references/businesses.md` (portfolio state)
   - Loads `references/decision-patterns.md` (past decisions)
   - Loads `CONTEXT_LOG.md` last 5 session summaries
   - Loads today's date ->reads `LOGS/YYYY-MM-DD.md` if present
   - Scans `states/*.md` for `status: active` projects
   - Reads `memory/index.md` ->skims last 14 days of episodes
2. **`spark` skill** reconciles:
   - Which projects moved yesterday?
   - Which action items are past due?
   - Which open questions were escalated but not resolved?
3. Agent produces a **7-line brief** (hard cap ->if it is longer, something is wrong):

   ```text
   Brief ->2026-04-14 (Tue)

   In-progress
     ->Tribo        seller page DB migration (Phase 3, 2 of 5 steps done)
     ->3Stripe      voucher proposal draft ->need legal review before send
     ->solo-cto-agent  PR-G7 telegram wizard subcommands in progress

   Due today
     ->3Stripe voucher proposal to Konvy ->waiting on Bae confirm
     ->Tribo Supabase RLS policy review ->blocker for step 3

   Unresolved (carry-over)
     ->PISTA  EMI licence check ->still pending lawyer reply from last Thursday
   ```
4. Stops. Does not start working on anything yet. Waits for your direction.
5. If you then say "start on 3Stripe voucher", the agent jumps to the 3Stripe state, loads the draft, and starts from where yesterday ended. No re-explanation of what 3Stripe is.

## Output

Seven lines in chat. No bullet-point cascades, no table walls, no "good morning Bae".

## Pain reduced

**The 15-minute context-reload tax at the start of every session.** With a blank-slate AI, you spend the first messages re-explaining which projects exist, what was decided yesterday, which third party you are waiting on. By the time you can actually work, you have lost a quarter of an hour and the agent still has a weaker model of the state than you do.

Secondary pain: **forgotten blockers.** The PISTA EMI licence pending since last Thursday is the kind of item that silently slips off the mental list for a week. The brief surfaces it every morning until it is resolved. You do not have to remember to remember.

Tertiary pain: **agent over-eagerness.** A common failure mode is the agent reading the brief and then launching into work on whatever it saw most recently. Hard rule: brief, then stop. The founder picks the next move.

## Data sources (for audit)

Everything in the brief traces back to a file. If the brief says "blocker for step 3" you can ask the agent for the line in `states/tribo.md` it came from and it will quote the row. Nothing hallucinates.

```text
states/tribo.md#L18  ->"blocker for step 3: Supabase RLS policy review"
states/3stripe.md#L11 ->"Konvy proposal ready ->needs Bae confirm"
memory/index.md#L47  ->"2026-04-10: PISTA EMI licence ->await lawyer reply"
```

