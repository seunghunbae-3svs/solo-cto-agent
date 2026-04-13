# Review — Usage Patterns & Examples

## When to Use This Skill

Use it:

* **After a spark/idea stage** — Before you've written a full plan
* **Before a deck** — Before presenting to investors or partners
* **Before committing to a technical direction** — Before burning engineering cycles
* **When asking "is this actually viable?"** — Decision point
* **When deciding whether to pivot** — Is the new direction better than the old?
* **Before presenting externally** — To anyone not on your team

### Activation Keywords

Automatically trigger on:
- evaluate, review, critique
- what do you think, how does this look
- devil's advocate, weakness, risk
- is this viable, what's wrong with this
- what could go wrong, pressure test

---

## Execution Examples

### Example 1: Code Review
```
Request: "Use review to critique this PR for missing tests and regression risk."

Output focus:
- Investor lens: Does the change scale? Is there debt?
- User lens: Does this break existing workflows?
- Competitor lens: Is this easy for someone to copy or does it create lock-in?

Synthesis: Risk score, regressions to watch, test gaps.
```

### Example 2: Plan Evaluation
```
Request: "Use review to evaluate this plan as an investor and competitor."

Output focus:
- Investor: Is the bet sized right? What's the TAM?
- Competitor: Can they do it faster or cheaper?
- User: Is the solution actually solving the stated problem?

Synthesis: Go/no-go recommendation, what needs to change.
```

### Example 3: Blocker Identification
```
Request: "Use review to list blockers before approval."

Output focus:
- Investor: Can we raise money on this?
- User: Will they actually use it?
- Competitor: Are we defensible?

Synthesis: Top 3 blockers ranked by impact, remediation steps.
```

---

## Review Output Format Summary

Every review output follows this standard shape:

```
[LENS 1 — INVESTOR]
VERDICT: [Strong / Needs Work / Pass]
One-liner: "..."
Key concern: "..."
What would make this investable: "..."

[LENS 2 — USER]
VERDICT: [Would use daily / Would try once / Would ignore]
First reaction: "..."
Dealbreaker: "..."
What would make me switch: "..."

[LENS 3 — COMPETITOR]
VERDICT: [Threatening / Annoying / Ignorable]
Response strategy: "..."
Moat assessment: [Strong / Weak / None]
Time to response: "..."

[SYNTHESIS]
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

## Tone & Voice

This skill is built to be useful, not comforting.

- Not a cheerleader. Not a vibe check. A stress test.
- Name problems directly. Don't soften weak assumptions with polite language.
- Ground everything in facts. If you don't know, say "unverified."
- Contradictions are features, not bugs. Highlight them.
- Assume you're talking to someone who would rather hear "this is broken" early than have it fail in market.
