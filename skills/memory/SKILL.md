---

name: memory
description: “Context and pattern memory skill for long-running work. Stores useful decisions, repeated failure patterns, and project context so sessions do not restart from zero. Activates on: remember, context, history, decision log, what did we decide, recurring issue, lesson learned.”
user-invocable: true
---

# Memory — Context and Pattern Retention

This skill is for one of the most annoying parts of working with agents:

having the same conversation twice.

Its job is to preserve:

* important project decisions
* repeated failure patterns
* useful assumptions
* unresolved risks
* context worth carrying into the next session

It is not there to remember everything.
It is there to remember what is expensive to rediscover.

---

## Principle 0 — Save what reduces future friction

Do not store everything.
Store what will matter again.

Good candidates:

* architecture decisions
* stack conventions
* deploy constraints
* naming rules
* repeated bugs or failure patterns
* user preferences that affect future execution
* things that caused avoidable re-explanation

Bad candidates:

* trivial one-off details
* noisy intermediate states
* temporary scraps with no future value

---

## What to remember

Four types of memories that matter:

1. **Decisions** — framework, deploy platform, auth provider, migration policy, etc. Should capture: what was decided, why, what tradeoff was accepted, when to revisit.

2. **Repeated failure patterns** — build breaks, deploy failures, package conflicts, framework incompatibilities. High-value because they reduce wasted loops.

3. **User preferences** — UI style, communication tone, approval requirements, fact-marking. These shape future agent behavior.

4. **Open threads** — known gaps not yet prioritized, deferred risks, intentional postponements. Prevents forgotten debt from turning into repeated rediscovery.

---

## Memory layers

**Layer 1 — session notes** (short-lived): what changed today, what broke, assumptions made, what needs attention next.

**Layer 2 — durable project memory** (longer-lived): stable decisions, repeated patterns, working conventions, high-value lessons.

**Layer 3 — compressed knowledge** (permanent): if something repeats 3+ times, condense it into a short reusable rule instead of keeping noisy logs.

---

## Memory record format

Fields: topic, type (decision / pattern / preference / open-thread), summary, why it matters, trigger, when to revisit.

> Full examples → [references/record-format.md](references/record-format.md)

---

## Storage and retrieval

Organized across three layers: CONTEXT_LOG.md (session decisions), LOGS/ (daily snapshots), and memory/knowledge/ (durable rules).

> Full details → [references/storage-structure.md](references/storage-structure.md)

---

## Compression rule

If the same thing comes up multiple times:

* stop storing raw repetition
* compress it into a general rule
* keep the shortest useful version

Memory should get sharper over time, not just larger.

---

## Retrieval rule

Before starting a related task, check whether relevant memory exists.

Especially for:

* deployment work
* auth changes
* environment setup
* repeated bug classes
* product or UX preferences
* strategic decisions already debated

The point is to reduce repeated questioning and repeated mistakes.

---

## Anti-patterns

```text id=”arhlji”
❌ storing everything
❌ storing vague summaries with no future use
❌ keeping raw noise instead of compressing lessons
❌ treating temporary confusion as durable memory
❌ remembering facts but not the reason behind them
❌ re-asking the user something that was already settled clearly
```

---

## Output expectations

When this skill is applied, the result should help answer:

* what should not be forgotten
* what should affect future behavior
* what should be reused automatically next time
* what is still unresolved but worth keeping visible

This skill should make the next session lighter, not just longer.

---

## Execution patterns

> Detailed usage workflows → [references/execution-guide.md](references/execution-guide.md)

Covers scenarios like:
- Capturing session decisions
- Recording error patterns
- Summarizing weekly changes
- Best practices for storing vs. discarding
- Memory hygiene and cleanup
