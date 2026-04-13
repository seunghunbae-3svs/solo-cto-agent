# PRD Direction — Define Phase 1, Not Phase 3

Only move to PRD after stages 1–5 are legible.

The PRD direction is not a full product specification. It's a boundary: what you build first, what you explicitly do not build, what you'll measure.

## Core Elements

### 1. Target User

Be specific. Not "managers." Not "companies."

Example:
✓ "VP of Operations at mid-market e-commerce retailers ($10M–$100M revenue)"
✓ "Freelance graphic designers using Adobe Creative Suite + Stripe"
✗ "Anyone who needs to manage data"
✗ "Businesses of all sizes"

### 2. Core Use Case

The one job this product does.

Example:
✓ "Automatically sync product listings across Amazon, Shopify, and marketplace X without manual copy-paste"
✓ "Collect expense receipts, auto-categorize, and submit for approval in under 5 minutes"
✗ "Improve business operations"
✗ "Make finance easier"

One use case. That's it.

### 3. Primary Workflow

The happy path. What does a user do on day one?

Step-by-step:
```
Day 1:
1. Sign up via email
2. Connect Shopify account (OAuth)
3. Select which marketplaces to sync
4. Review auto-mapped fields (title, price, description)
5. Click "sync" and see inventory updated across all channels in real-time

Day 2:
Price a product on Shopify, see it update across Amazon within 5 minutes.
```

Not the full feature roadmap. Not every workflow. The **core** workflow that delivers the promised outcome.

### 4. Top 3 Assumptions to Validate

These are your riskiest unknowns. Rank them by damage if wrong:

Example:
```
1. [CRITICAL] Marketplace APIs actually allow bulk listing sync without rate limits.
   Test: API audit with Shopify, Amazon, Lazada technical teams (week 1).

2. [CRITICAL] Mid-market retailers will pay $299/month when they're already using free manual tools.
   Test: 10 customer conversations about willingness to pay (week 1–2).

3. [HIGH] Switching from manual copy-paste to automated sync has <4 weeks onboarding friction.
   Test: First 5 customers, measure time-to-first-sync (weeks 3–4).
```

Testable. Time-bounded. Ranked by impact.

### 5. What NOT to Build Yet

Explicitly name features that are **off limits** for Phase 1.

Example:
```
❌ Multi-channel order management (out of scope, belongs in Phase 2)
❌ Custom price rules by marketplace (belongs in Phase 2)
❌ Inventory forecasting or demand planning (belongs in Phase 3)
❌ API access for third-party integrations (belongs in Phase 2)
```

Why? Scope creep kills startups. You'll be tempted to add features to close deals. Don't.

If a customer insists on a Phase 2 feature to buy, either:
- Build it and slip timeline, or
- Walk away and find a customer who values Phase 1

### 6. MVP Boundary

What is the absolute minimum set of features needed to test the core hypothesis?

Example:
```
MVP includes:
✓ Shopify connection
✓ Amazon connection (first marketplace only)
✓ Real-time sync on price + inventory changes
✓ Dashboard showing sync status
✓ Email support

MVP does NOT include:
✗ Lazada, Tokopedia, other marketplaces
✗ Custom field mapping (auto-mapping only)
✗ Bulk upload from CSV
✗ Mobile app
✗ Analytics dashboard
✗ SSO / advanced permissions
```

This should be buildable in 4–8 weeks with 1–2 engineers.

If it takes longer, your MVP is too big.

### 7. First Success Metric

One number that tells you Phase 1 worked.

Not: "User engagement" or "Retention."

Be specific:
```
✓ "80% of paying customers have synced >100 listings within 30 days."
✓ "Average time from signup to first marketplace connection is <10 minutes."
✓ "Monthly churn is <5% after month 3."
```

This metric is testable and indicates that the core value prop is working.

---

## PRD Direction Template

```markdown
# {Product Name} — PRD Direction (Phase 1)

## Target User
{Specific role, company size, use case}

## Core Use Case
{One sentence: the job this product does}

## Primary Workflow
{Step-by-step happy path, day 1}

## Top 3 Assumptions to Validate
1. [CRITICAL] {Assumption}
   Test: {How and when}
2. [HIGH] {Assumption}
   Test: {How and when}
3. [MEDIUM] {Assumption}
   Test: {How and when}

## What NOT to Build Yet
{Explicit features out of scope for Phase 1}

## MVP Boundary
**Includes:**
- {Feature}
- {Feature}

**Does not include:**
- {Feature}
- {Feature}

## First Success Metric
{One metric that indicates Phase 1 worked}

## Timeline
{Estimated weeks to ship MVP}

## Next Test After MVP
{What are you validating in Phase 2?}
```

---

## Common PRD Direction Mistakes

### Mistake 1: PRD Is Too Big

❌ "The PRD includes 12 major features and 3 integrations."
✓ "The MVP has 3 core features. 2 integrations planned for Phase 2."

If your MVP timeline is >12 weeks, it's too big.

### Mistake 2: Assumptions Are Too Vague

❌ "Our main assumption is that users will like it."
✓ "Our main assumption is that mid-market retailers will pay $299/month vs. continuing with manual copy-paste; measured by close rate from trial."

Vague assumptions don't lead to tests. Specific ones do.

### Mistake 3: "What NOT to Build" Is Missing

❌ You don't explicitly say what's out of scope. By month 2, you're in 5 feature debates.
✓ You list 10 features that are explicitly Phase 2, so you have a clear answer to scope creep.

### Mistake 4: Success Metric Is Unmeasurable

❌ "Success = users love the product."
✓ "Success = 80% of customers have 10+ active integrations within 30 days."

Measurable = you can track it. Then you'll know if Phase 1 worked.

### Mistake 5: PRD Is Detailed Design

❌ You're writing wireframes, color palettes, database schemas.
✓ You're writing: "Dashboard shows sync status, last sync time, error count. That's all."

PRD direction is strategy, not design. Let the team execute.

---

## When to Say "Not Yet"

If you're writing PRD direction and realize:

- Target user is still fuzzy → Go back to Seed stage
- Core use case doesn't fit any of your customer interviews → Go back to Market Framing
- Assumptions feel certain (no [unverified] labels) → You might be underestimating risk; stress-test them
- MVP is >12 weeks → Narrow further

Don't push forward. Narrow the idea until PRD direction becomes obvious.
