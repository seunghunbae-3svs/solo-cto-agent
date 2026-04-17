# Idea critique before commitment

Tier: Maker / Builder / CTO - Agent: Cowork - Mode: Semi-auto

## Input

You have been thinking about a feature addition for two days. You type it into Cowork before writing any spec:

```text
Project A: add a $29/mo seller subscription for premium exposure on the marketplace feed.
```

## Agent behavior

1. **`review` skill (idea-critique sub-mode)** loads portfolio context:
   - `businesses.md` -> Project A = marketplace group-buying, SEA focus, partner feed exposure.
   - `decision-patterns.md` -> core rule: protect existing partner contracts before new monetization.
   - Current `states/sample-store.md` -> Phase 3, 14 sellers live, partner contract active.
2. Agent applies the **3-axis decision filter** (from `skills/_shared/agent-spec.md`):

   | Axis | Check |
   |---|---|
   | Regulation + timeline | Does recurring seller billing trigger EMI/licensing in SEA markets? |
   | Existing-system protection | Does premium exposure conflict with current partner feed rights? |
   | Unit economics | At $29/mo and N sellers, does this cover ops + support? What is CAC -> payback? |
3. Agent writes the critique in the **risk-first -> strength -> modified proposal** shape:

   ```text
   RISK FIRST

   1. [CONFIRMED] Partner contract conflict. The current feed grants exclusive
      premium-slot visibility to the partner. A direct seller premium tier
      conflicts with that clause and would require renegotiation.

   2. [PROBABLE] Regulation risk. A recurring seller charge in PH/ID can cross
      EMI thresholds once volume grows. That is a new regulated surface for Project A.

   3. [UNKNOWN] Unit economics. At $29/mo and 100 sellers, gross is $2.9k/mo.
      That may not cover support + fraud risk if conversion is low.

   STRENGTH
   - Clear value prop for top sellers if partner conflict is resolved.

   MODIFIED PROPOSAL
   - Phase 1: pilot with partner approval and revenue share (no direct billing).
   - Phase 2: if pilot works, revisit direct billing after legal check.
   ```

## Output

A short, risk-first critique with a modified proposal. No cheerleading, no vague encouragement.

## Pain reduced

**Weeks lost on features that die at the contract or regulatory layer.** The critique forces the hidden blockers into view before you write a spec or build a prototype.
