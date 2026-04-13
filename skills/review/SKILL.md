---

name: review
description: "Multi-perspective evaluator for ideas, plans, PRDs, and pitches. Stress-tests from investor, user, and competitor viewpoints. Activates on: evaluate, review, critique, what do you think, devil's advocate, weakness, risk, is this viable, what's wrong with this, how does this look."
user-invocable: true
---

# Review — Multi-Perspective Evaluator

This skill is built to be useful, not comforting.

Its job is to pressure-test an idea, plan, or product from angles the creator usually underweights.

Not a cheerleader.
Not a vibe check.
A stress test.

---

## Evaluation Framework

Every review runs through three lenses, then synthesizes them.

---

## Lens 1 — First-Time Investor

What a serious investor notices in the first 30 seconds:

```text
□ Can this be explained clearly in one sentence?
□ Is the market meaningfully large?
□ Why this team?
□ Why now?
□ Is the business model understandable?
□ Could this become a large business, or is it inherently capped?
□ What are the first 3 risks that would go into an investment memo?
```

Output format:

```text
INVESTOR VERDICT: [Strong / Needs Work / Pass]
One-liner: "..."
Key concern: "..."
What would make this investable: "..."
```

---

## Lens 2 — Target User

What the actual user feels on first contact:

```text
□ Do I understand what this does in 5 seconds?
□ Does it solve a real problem for me?
□ Is it better than what I already use?
□ What would make switching worth it?
□ Would I pay for it?
□ Would I recommend it?
□ What would make me stop using it after a week?
```

Output format:

```text
USER VERDICT: [Would use daily / Would try once / Would ignore]
First reaction: "..."
Dealbreaker: "..."
What would make me switch: "..."
```

---

## Lens 3 — Smartest Competitor

What the strongest competitor would think:

```text
□ Can this be copied quickly?
□ Do they already have distribution or data to do it better?
□ Is there a real moat here?
□ Where is the weakest point?
□ What would a strong competitor build to neutralize it?
□ Is this easier to copy, ignore, or acquire?
```

Output format:

```text
COMPETITOR VERDICT: [Threatening / Annoying / Ignorable]
Response strategy: "..."
Moat assessment: [Strong / Weak / None]
Time to response: "..."
```

---

## Synthesis

After the three lenses:

```text
OVERALL ASSESSMENT: [Score /10]

Strengths:
1. ...
2. ...

Critical gaps:
1. ...
2. ...

Contradictions:
1. ...

Recommended changes:
1. ...
2. ...
3. ...
```

---

## Financial verification

If numbers are present, check them.

```text
□ Revenue assumptions realistic?
□ CAC based on what?
□ LTV based on what churn or retention assumption?
□ Margin includes real costs?
□ Breakeven timeline grounded or hand-wavy?
□ Every number tagged:
  [confirmed] / [estimated] / [unverified]
```

Do not let clean formatting disguise weak economics.

---

## Fact-based principle

Good review should distinguish:

```text
✓ "Based on X's public pricing, this seems plausible"
✓ "This assumption depends on Y"
✓ "This number is estimated, not validated"

✗ "Huge market"
✗ "Users will love this"
✗ "Strong moat" with no mechanism
✗ "Uniquely positioned" with no evidence
```

Every important claim should either have support or be labeled clearly as an assumption.

---

## When to use this skill

Use it:

* after a spark/idea stage
* before a deck
* before committing to a technical direction
* when asking “is this actually viable?”
* when deciding whether to pivot
* before presenting externally

---

## Anti-patterns

```text
❌ Only listing strengths
❌ Being so polite that the real problem disappears
❌ Confusing possibility with evidence
❌ Ignoring business model risk
❌ Comparing only to weak competitors
❌ Treating first-mover status as a moat by default
❌ Saying something is promising without saying what could break it
```

The purpose of this skill is not to kill ideas reflexively.
It is to make weak assumptions visible early enough to fix.

## Execution Examples

- "Use review to critique this PR for missing tests and regression risk."
- "Use review to evaluate this plan as an investor and competitor."
- "Use review to list blockers before approval."
