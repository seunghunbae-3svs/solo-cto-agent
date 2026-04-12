---
name: spark
description: "Idea development engine. Takes raw concepts through structured refinement: market scan, competitor analysis, unit economics, scenario modeling, and PRD output. Activates on: idea, concept, what if, how about, business model, revenue model, PRD, market research, competitor analysis, design, plan, structure."
user-invocable: true
---

# Spark — Idea to Design to PRD Pipeline

Systematically develops a raw idea into a validated, structured plan.
Not a brainstorming tool — a refinement engine.

---

## 6-Stage Pipeline

### Stage 1: Seed Capture
```
Input: User's raw idea (even a single sentence)
Output:
  - Core hypothesis: "If [action], then [outcome], because [reason]"
  - Target user: Who specifically?
  - Problem statement: What pain does this solve?
  - Existing alternatives: What do people use today?
```
Don't ask 20 questions. Extract what you can, assume the rest, mark assumptions with [assumed].

### Stage 2: Market Scan
```
Research:
  - Market size (TAM/SAM/SOM) with sources
  - Growth rate and trajectory
  - Regulatory landscape (blockers? enablers?)
  - Timing: Why now? What changed?

Output format:
  | Metric | Value | Source | Confidence |
  |--------|-------|--------|------------|
  | TAM    | $XXB  | [src]  | [high/med/low] |
```
Mark every number: [confirmed] / [estimated] / [unverified]

### Stage 3: Competitor Landscape
```
Map:
  - Direct competitors (same problem, same solution)
  - Indirect competitors (same problem, different solution)
  - Adjacent players (different problem, could pivot)

For each:
  | Name | Model | Funding | Users | Weakness |

Identify the gap: What do ALL competitors miss?
```

### Stage 4: Unit Economics
```
Calculate:
  - Revenue per user (ARPU)
  - Cost to acquire (CAC)
  - Lifetime value (LTV)
  - LTV:CAC ratio (target: >3:1)
  - Contribution margin
  - Breakeven point

Three scenarios:
  D1 (Conservative): Pessimistic assumptions
  D2 (Base):         Realistic assumptions
  D3 (Optimistic):   Best-case with justification

Every number needs a formula or source. No magic numbers.
```

### Stage 5: Scenario Design
```
For each major decision point, design 2-3 paths:

Path A: [description]
  - Pros: ...
  - Cons: ...
  - Required: [resources, time, skills]
  - Risk: [what could go wrong]

Path B: [description]
  - (same structure)

Recommendation: Path [X] because [data-driven reason]
But present both — user decides.
```

### Stage 6: PRD Output
```
Structure:
  1. Problem Statement
  2. Target Users (persona-level)
  3. Core Value Proposition
  4. Key Features (prioritized: must/should/could)
  5. Success Metrics (measurable, time-bound)
  6. Technical Requirements (high-level)
  7. Go-to-Market (Phase 0 → 1 → 2)
  8. Risks & Mitigations
  9. Unit Economics Summary
  10. Open Questions
```

---

## 3-Axis Validation Filter

Every idea passes through this filter at each stage:

| Axis | Question |
|------|----------|
| **Regulation + Timeline** | Can this launch without licenses? How long to market? |
| **Existing System Protection** | Does this break anything already built (code/contracts/relationships)? |
| **Unit Economics** | What's the real margin? Where does money come from? |

If any axis fails, flag it immediately. Don't bury it.

---

## Progressive Refinement Rules

```
1. Start rough, refine iteratively. Don't aim for perfect on first pass.
2. Each stage adds precision. Stage 1 = 30% confidence. Stage 6 = 80%.
3. User can jump between stages. "Go back to unit economics" is valid.
4. Unknown != bad. Mark unknowns, don't hide them.
5. Always separate fact from assumption: [confirmed] / [estimated] / [unverified]
```

---

## YAGNI Principle

```
- Don't design features for Phase 3 when Phase 0 isn't validated
- "Can we add X later?" → Yes, note it in Open Questions, move on
- Simplest viable version first. Complexity is earned by traction.
- If user says "let's go back to basics" → respect it. No expansion pressure.
```

---

## Output Formats

Depending on the stage and need:
- **Quick validation**: Markdown summary, 1-2 pages
- **Pitch prep**: Feed into pitch-writing skill
- **Technical handoff**: Feed into build skill
- **Financial model**: Feed into spreadsheet creation
- **Full PRD**: Structured document with all 10 sections

---

## Anti-Patterns

```
❌ "This is a great idea!" — Evaluate, don't cheerleader
❌ Skipping unit economics because "it's early stage"
❌ Presenting only the optimistic scenario
❌ Vague market sizes without sources ("the market is huge")
❌ Listing features without prioritization
❌ Ignoring regulatory risk because it's inconvenient
❌ Building detailed technical specs before validating demand
```
