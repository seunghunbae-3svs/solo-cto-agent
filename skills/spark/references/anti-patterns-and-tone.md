# Anti-Patterns, Tone, and Final Tests

## Anti-Patterns to Avoid

```
❌ "Huge market" with no narrow entry point
   → You're pitching everyone, selling no one.
   → Fix: Name a specific vertical and customer persona. Prove traction there first.

❌ "People need this" with no buyer logic
   → Need ≠ demand. Demand ≠ ability to pay.
   → Fix: Who has budget? Who has authority to buy? Can you reach them?

❌ Jumping straight to PRD before the wedge is clear
   → You'll build the wrong thing, bigger, slower.
   → Fix: Finish stages 1–5. If stage 5 (scenarios) doesn't light up, narrow more.

❌ Treating TAM as proof of demand
   → "Global expense management is $100B, so we'll capture $10M." This is math, not strategy.
   → Fix: Name your Year 1 customer segment (not global). Who are the first 10 customers?

❌ Confusing founder excitement with user urgency
   → You're excited. That doesn't mean customers are desperate to buy.
   → Fix: Talk to 10 potential users. Do they have budget allocated? Or is it speculative?

❌ Adding features to fix a weak premise
   → "Our core product is vague, so let's add X, Y, Z to be safe."
   → Fix: A broad product with weak fundamentals is still weak. Narrow. Sharpen. Deepen.

❌ Making the product broad before it is sharp
   → "We'll be Figma, but for X." Figma spent years perfecting one interface.
   → Fix: Be exceptional at one thing before you broaden.
```

---

## Output Tone

Spark should sound like a founder thinking clearly, not a consultant trying to impress.

### Preferred

**Clear**
- Name specifics: "VP of Operations at $20M ARR SaaS companies" not "enterprise customers"
- Quantify: "Takes 15 hours/week" not "time-consuming"
- Use simple words: "We charge per feature" not "variable feature-attribution monetization model"

**Grounded**
- Base claims on research or customer interviews: "[confirmed: 3 companies pay $500/month for manual workarounds]"
- Acknowledge market maturity: "Figma exists and has 95% mindshare, so we're entering a known category with existing winners"
- Estimate conservatively: "We assume 4% churn [estimated, needs validation]"

**Honest about uncertainty**
- Use labels: [confirmed], [estimated], [unverified]
- Name weak spots: "Our biggest risk is that CAC might be 2x higher than assumed"
- Say when you don't know: "We haven't talked to enterprise customers yet; the pricing model is speculative"

**Specific about what to test next**
- Name the test: "Talk to 10 target customers about switching cost"
- Set a deadline: "Week 1 of development"
- Define success: "Success = 7+ of 10 say switching cost is <2 weeks"

### Avoid

**Hype**
- "Revolutionary", "disrupting", "game-changing"
- "This could be the next Stripe"
- "Huge opportunity"

**Abstract market-speak**
- "We're targeting the digital transformation space"
- "Leveraging AI to enable customer success"
- "Synergistic platform for enterprise enablement"

**Fake certainty**
- "We'll dominate this market"
- "Customers are begging for this"
- "This is obviously better than X"

**Giant strategy language before basic validation**
- "Our 5-year vision is to be the category leader"
- "We'll expand to 12 verticals by Year 3"
- "We're building a network effect moat"

Write small, prove traction, then scale vision.

---

## Final Test Checklist

At the end of a Spark session, ask these four questions:

### 1. Is the idea clearer than before?

Before: "An AI platform for customer service automation"
After: "We help mid-market e-commerce companies handle returns faster. Customers email a return request, our system generates a prepaid return label and refund confirmation in <5 minutes. Saves 4 hours/day per support person."

If the idea is still abstract, do another round on Seed or Market Framing.

### 2. Is the target user narrower than before?

Before: "Businesses with customer support"
After: "E-commerce companies with 50K–500K monthly orders, already using Shopify, with a dedicated returns manager"

If target is still broad ("managers", "companies", "anyone who does X"), narrow further.

### 3. Are the assumptions more visible than before?

Before: "We think this will work"
After:
```
[CRITICAL] Customers will pay $299/month vs. current $0 (internal team)
[CRITICAL] We can build the label generation in 3 weeks
[HIGH] Integration with Shopify + Klaviyo doesn't break our delivery time
[MEDIUM] Returns fraud rate is <2%
```

If you can't list 5+ assumptions clearly, you've been vague. Call it out.

### 4. Is the next action testable?

Before: "Validate the market"
After: "Talk to 15 Shopify returns managers about:
  - How long they spend on returns daily
  - What they'd pay to save 4 hours
  - Whether they'd try a 2-week free trial
Timeline: Week 1"

If the next action is vague ("learn more", "explore", "think about"), make it concrete and time-bound.

---

## Finishing

If all four questions pass, you're ready for development.

If any question fails:
- Return to the stage that's weak
- Spend 1–2 hours narrowing
- Come back to Spark
- Re-run the final test

Do not proceed to code without clear answers to all four.
