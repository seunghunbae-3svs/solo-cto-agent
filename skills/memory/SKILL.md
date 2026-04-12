---

name: memory
description: "Context and pattern memory skill for long-running work. Stores useful decisions, repeated failure patterns, and project context so sessions do not restart from zero. Activates on: remember, context, history, decision log, what did we decide, recurring issue, lesson learned."
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

### 1) Decisions

Examples:

* framework choice
* ORM choice
* deploy platform
* auth provider
* UI library
* migration policy
* branch/release policy

A useful memory entry says:

* what was decided
* why it was decided
* what tradeoff was accepted
* when to revisit it

---

### 2) Repeated failure patterns

Examples:

* build breaks when `prisma generate` is skipped
* deploy fails if callback URLs still point to localhost
* package X and version Y conflict
* a specific route pattern breaks under framework version Z

These are high-value memories because they reduce wasted loops later.

---

### 3) User preferences

Examples:

* prefers minimal UI over decorative UI
* wants blunt critique, not reassurance
* prefers production changes to require approval
* wants grouped setup requests instead of repeated questions
* wants facts clearly marked when uncertain

These matter because they shape how the agent should behave next time.

---

### 4) Open threads

Not everything should be resolved immediately.

Useful open-thread memory:

* known gap not yet prioritized
* risk acknowledged but deferred
* infrastructure cleanup to revisit later
* feature intentionally postponed

This prevents “forgotten debt” from turning into repeated rediscovery.

---

## Memory layers

### Layer 1 — session notes

Short-lived and practical.

Use for:

* what changed today
* what broke today
* what assumption was made
* what still needs attention

### Layer 2 — durable project memory

Longer-lived.

Use for:

* stable decisions
* repeated patterns
* working conventions
* high-value lessons

### Layer 3 — compressed knowledge

If something keeps repeating over time, condense it into a short reusable rule.

Example:

> “In this project, deploy failures after auth changes usually come from callback mismatch before code bugs.”

That is more useful than keeping five noisy logs forever.

---

## Suggested structure

A useful memory record should usually contain:

```text id="aq56ax"
- topic
- type: decision / pattern / preference / open-thread
- summary
- why it matters
- evidence or trigger
- when to revisit
```

Example:

```text id="ef5cnb"
Topic: deploy auth callback mismatch
Type: pattern
Summary: auth-related preview failures are often callback URL mismatches, not code issues
Why it matters: saves debug time
Trigger: appears after domain or auth provider changes
Revisit: if auth provider or deploy platform changes
```

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

```text id="arhlji"
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
