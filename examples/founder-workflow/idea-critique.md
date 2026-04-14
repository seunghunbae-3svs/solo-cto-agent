# Idea critique before commitment

Tier: Maker / Builder / CTO · Agent: Cowork · Mode: Semi-auto

## Input

You have been thinking about a feature addition for two days. You type it into Cowork before writing any spec:

```text
Tribo에 구독 모델 추가하는 거 어때. 셀러가 월 29달러 내고 프리미엄 노출 받는 구조.
```

## Agent behavior

1. **`review` skill (idea-critique sub-mode)** loads portfolio context:
   - `businesses.md` → Tribo = K-beauty group-buying, SEA focus, partners include Konvy.
   - `decision-patterns.md` → "도와준 곳은 버리지 않는다" (core rule), "유닛 이코노믹스 먼저" (rule).
   - Current `states/tribo.md` → Phase 3, 14 sellers live, Konvy partnership active.
2. Agent applies the **3-axis decision filter** (from `skills/_shared/agent-spec.md`):

   | Axis | Check |
   |---|---|
   | Regulation + timeline | Does subscription billing trigger EMI / licence issues in SEA markets? |
   | Existing-system protection | Does premium exposure break the current Konvy feed contract? |
   | Unit economics | At $29/mo × N sellers, does this actually fund the ops? What is CAC → payback? |
3. Agent writes the critique in the **risk-first → strength → modified proposal** shape required by the house style. No preamble, no "great idea Bae":

   ```text
   RISK FIRST

   1. [확정] Konvy contract — current feed gives Konvy exclusive premium-slot
      visibility for featured SKUs. A "premium exposure" tier sold to sellers
      directly conflicts with Konvy's slot allocation and will trigger a contract
      renegotiation. Estimated 3-6 weeks, and Konvy can reasonably request
      compensation.

   2. [추정] Payment regulation — $29/mo recurring charge to SEA sellers
      crosses the EMI line in PH and ID when aggregated. Currently Tribo
      handles seller payouts, not seller inflows. Adding seller→Tribo
      recurring billing is a new regulated surface that the existing PH
      banking partner does not cover.

   3. [미검증] Unit economics — $29 × 14 sellers = $406 / mo gross.
      If CAC to acquire a new seller is currently ~$180 (no channel spend,
      just founder time), payback is 6 months at best. Underneath the
      existing take-rate, subscription is a strictly inferior revenue path
      at this seller count.

   STRENGTH

   - Signal test for seller willingness-to-pay is legitimate useful data.
   - Could differentiate onboarding priority without charging money — e.g.,
     verified-seller badge, early access to new campaigns.

   MODIFIED PROPOSAL

   Do NOT ship paid subscription in Phase 3. Instead:
     a) Add a "verified seller" tier — free, earned by meeting GMV / review
        thresholds. This surfaces the same premium-exposure behaviour
        without touching Konvy contract or payment regulation.
     b) If verified-seller tier is desired by 30%+ of sellers by Phase 4,
        run a 2-week willingness-to-pay signal test (landing page + waitlist,
        NO payments), then re-evaluate.
     c) Only revisit paid subscription AFTER Konvy contract review and
        licence review for PH/ID aggregated recurring billing.

   Revised timeline: signal test in Phase 4 (~6 weeks), not Phase 3.
   ```
4. Stops. Does not start building anything. Does not pivot to a different skill.

## Output

One chat response in the shape above. No PR opened, no files touched, no decision logged yet. Decision logging happens only after you confirm a direction.

If you do confirm ("alright, verified-seller tier, skip subscription for now"), the agent will append to `decision-patterns.md`:

```text
2026-04-14 — Tribo subscription model deferred.
  Reason: Konvy contract conflict + PH/ID EMI surface + unit economics at
  14 sellers does not fund ops vs. existing take-rate.
  Alternative adopted: verified-seller tier (free, earned) + willingness-
  to-pay signal test in Phase 4.
  Revisit: Phase 4, after Konvy review and licence review.
```

## Pain reduced

**Two weeks of building something that breaks an existing partnership.** The Konvy contract clash is the kind of issue that only surfaces in the first conversation with Konvy's account manager — usually after the feature has shipped and you are trying to explain why seller-paid premium slots are showing up next to Konvy's exclusive slots. Surfacing it in the first two minutes of critique means you never build the wrong thing.

Secondary pain: **yes-man mode.** A compliant AI will produce a roadmap, a pricing matrix, and a go-to-market plan for the idea within 60 seconds — all of which is expensive distraction if the core idea is blocked by a contract you forgot about. The risk-first ordering is a structural cure for that, not a stylistic preference.

Tertiary pain: **reversal friction.** When the founder has already written a spec, gathered team opinions, and published a dev ticket, pulling out of the idea is socially expensive even if the analysis now says stop. The earlier the critique runs, the cheaper the reversal.

## How this differs from `bae-advisor`

`bae-advisor` is the full strategy partner that handles multi-session portfolio moves. This example is the single-shot critique loop — 3 minutes in, 3 minutes out, one decision. Both draw on the same `references/` files, so the memory is shared.
