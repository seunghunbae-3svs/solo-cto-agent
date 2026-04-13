---

name: review
description: “Multi-perspective evaluator for ideas, plans, PRDs, and pitches. Stress-tests from investor, user, and competitor viewpoints. Activates on: evaluate, review, critique, what do you think, devil's advocate, weakness, risk, is this viable, what's wrong with this, how does this look.”
user-invocable: true
---

# Review — Multi-Perspective Evaluator

This skill is built to be useful, not comforting.

Its job is to pressure-test an idea, plan, or product from angles the creator usually underweights.

Not a cheerleader. Not a vibe check. A stress test.

---

## Three-Lens Evaluation Framework

Every review runs through three distinct perspectives, then synthesizes into a single verdict.

---

## Lens 1 — First-Time Investor

What a serious investor notices in the first 30 seconds:
- Can this be explained in one sentence?
- Is the market meaningfully large?
- Why this team? Why now?
- Is the business model understandable?
- Could this become a large business, or is it inherently capped?
- What are the first 3 risks?

**Output format:**
```
INVESTOR VERDICT: [Strong / Needs Work / Pass]
One-liner: “...”
Key concern: “...”
What would make this investable: “...”
```

---

## Lens 2 — Target User

What the actual user feels on first contact:
- Do I understand what this does in 5 seconds?
- Does it solve a real problem for me?
- Is it better than what I already use?
- Would I pay for it? Would I recommend it?
- What would make me stop using it after a week?

**Output format:**
```
USER VERDICT: [Would use daily / Would try once / Would ignore]
First reaction: “...”
Dealbreaker: “...”
What would make me switch: “...”
```

---

## Lens 3 — Smartest Competitor

What the strongest competitor would think:
- Can this be copied quickly?
- Do they have distribution or data to do it better?
- Is there a real moat here? Where's the weakest point?
- What would a strong competitor build to neutralize it?

**Output format:**
```
COMPETITOR VERDICT: [Threatening / Annoying / Ignorable]
Response strategy: “...”
Moat assessment: [Strong / Weak / None]
Time to response: “...”
```

---

## Synthesis

After the three lenses, always synthesize:

```
OVERALL ASSESSMENT: [Score /10]

Strengths:
1. ...
2. ...

Critical gaps:
1. ...
2. ...

Contradictions:
1. [Where the lenses disagree]

Recommended changes:
1. ...
2. ...
```

> Full synthesis framework, score mapping, and common contradiction patterns → **references/synthesis-framework.md**

---

## Financial Verification

If numbers exist, tag every one:
- `[confirmed]` — from audit, pilot, contracts
- `[estimated]` — from industry benchmarks
- `[unverified]` — assumption pending validation

Do not let clean formatting disguise weak economics.

> Full financial checklist and fact-based claims mapping → **references/scoring-criteria.md**

---

## How to Trigger

**Automatically activates on:** evaluate, review, critique, what do you think, devil's advocate, weakness, risk, is this viable, what's wrong with this, how does this look

**Use it:**
- After a spark/idea stage
- Before a deck
- Before committing to technical direction
- When deciding whether to pivot
- Before presenting externally

---

## Core Anti-Patterns

❌ Only listing strengths  
❌ Softening problems with polite language  
❌ Confusing possibility with evidence  
❌ Ignoring business model risk  
❌ Comparing only to weak competitors  
❌ Treating first-mover as a moat by default  

The purpose is not to kill ideas reflexively. It is to make weak assumptions visible early enough to fix.

> Detailed scoring criteria, execution examples, and usage patterns → **references/usage-patterns.md**
