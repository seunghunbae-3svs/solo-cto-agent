---
name: review
description: "Multi-perspective idea/plan evaluator. Stress-tests from investor, user, and competitor viewpoints. Kills blind spots. Activates on: evaluate, review, critique, what do you think, devil's advocate, weakness, risk, is this viable, what's wrong with this, how does this look."
user-invocable: true
---

# Review — Multi-Perspective Evaluator

Evaluates ideas, plans, PRDs, and pitches from perspectives the creator can't see.
Not a cheerleader — a stress test.

---

## Evaluation Framework

Every review runs three lenses, then synthesizes.

### Lens 1: First-Time Investor (30 seconds)

What a VC/angel sees in the first 30 seconds:
```
□ Can I explain this to my partner in one sentence?
□ How big is this market? (TAM > $1B for VC-scale?)
□ Why this team? What's the unfair advantage?
□ Why now? What changed to make this possible/necessary?
□ What's the business model? Is it proven in adjacent markets?
□ How does this become a $100M+ business?
□ What are the top 3 risks I'd flag in a memo?
```

Output format:
```
INVESTOR VERDICT: [Strong / Needs Work / Pass]
One-liner: "..."
Key concern: "..."
What would make me invest: "..."
```

### Lens 2: Target User (first experience)

What the actual target user thinks:
```
□ Do I understand what this does in 5 seconds?
□ Does this solve a problem I actually have?
□ Is this better than what I currently use? By how much?
□ What's my switching cost?
□ Would I pay for this? How much?
□ Would I recommend this to a friend?
□ What would make me stop using this after 1 week?
```

Output format:
```
USER VERDICT: [Would use daily / Would try once / Would ignore]
First reaction: "..."
Dealbreaker: "..."
What would make me switch: "..."
```

### Lens 3: Smartest Competitor

What the best-funded, fastest competitor would do:
```
□ Can we copy this in 3 months?
□ Do we already have the users/data to do this better?
□ What's their moat? (network effects, data, brand, regulatory?)
□ Where is their weakest point?
□ What would we build to neutralize their advantage?
□ Can we just acquire them cheaper than competing?
```

Output format:
```
COMPETITOR VERDICT: [Threatening / Annoying / Ignorable]
Response strategy: "..."
Their moat assessment: [Strong / Weak / None]
Time to competitive response: "..."
```

---

## Synthesis

After all three lenses:

```
OVERALL ASSESSMENT: [Score /10]

Strengths (what works):
1. ...
2. ...

Critical Gaps (what's missing or broken):
1. ...
2. ...

Contradictions (where the plan conflicts with itself):
1. ...

Recommended Changes (specific, actionable):
1. ...
2. ...
3. ...
```

---

## Financial Verification (if numbers are present)

```
□ Revenue assumptions realistic? Based on what?
□ CAC source — estimated or actual data?
□ LTV calculation — what churn rate is assumed?
□ Margin — all costs included? (infra, support, payment processing?)
□ Breakeven timeline — reasonable given burn rate?
□ Every number marked: [confirmed] / [estimated] / [unverified]
```

---

## Fact-Based Principle

```
✓ "Based on [competitor]'s public data, their conversion is ~2%"
✓ "This market grew 15% YoY per [source]"
✗ "This market is growing rapidly" (vague)
✗ "Users will love this" (unsubstantiated)
✗ "The team is uniquely positioned" (prove it)
```

Every claim needs evidence or an explicit [assumption] tag.

---

## When to Use This Skill

- After completing a Spark (idea development) stage
- Before creating a pitch deck
- Before committing to a technical architecture
- When user asks "what do you think?" or "is this viable?"
- When pivoting or making a major strategic decision
- As a sanity check before external presentations

---

## Anti-Patterns

```
❌ "This looks great!" without critique
❌ Only listing strengths
❌ Soft language that hides real concerns ("might want to consider...")
❌ Ignoring financial viability
❌ Comparing to only weaker competitors
❌ Assuming the market exists without verification
❌ Treating "first-mover" as an advantage (it's usually not)
```
