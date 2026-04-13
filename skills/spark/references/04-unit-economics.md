# Unit Economics and Operating Logic

At this stage, you need honest assumptions, not perfect numbers.

The goal is to make sure the business model works. If the math is broken, no amount of growth fixes it.

## Core Questions

```
- Who pays?
- How much could they plausibly pay?
- What has to be true for this to work economically?
- What is expensive about serving the product?
- Is the revenue model simple enough to explain clearly?
```

## The Five-Number Rule

Every business model rests on five numbers. Nail these first; everything else flows from them.

### 1. Price (or Revenue Per User/Account)

What does the customer pay you?

Options:
- **Subscription**: $29/month, $500/year
- **Usage-based**: $0.10 per API call, 10% of transaction value
- **One-time**: $5K implementation fee
- **Freemium**: Free + $99 premium tier

**Reality check:**
- Is this price reasonable vs. the cost of the problem?
- If the customer's cost to live with the problem is $1K/month, can you charge $100/month? Yes.
- If the customer's cost is $50, can you charge $100/month? No.

Price floor = cost the customer is already paying (manually, outsourced, etc.)
Price ceiling = what the improvement is worth to them

### 2. Customer Acquisition Cost (CAC)

What does it cost you to acquire one paying customer?

Formula: (Sales + Marketing spend) / (New customers acquired)

Examples:
- B2B SaaS SMB: $2K–$5K per customer
- B2B SaaS Enterprise: $50K–$200K per customer
- B2C freemium: $5–$20 per customer
- Marketplace: $10–$50 per seller

**Reality check:**
Does CAC < Lifetime Value?

If CAC = $10K and customer lifetime value = $12K, you're barely profitable.
If CAC = $10K and customer LTV = $100K, you have margin to grow.

### 3. Customer Lifetime Value (LTV)

How much money does a customer generate over their lifetime?

Formula: (ARPU × Gross Margin %) × (1 / Monthly Churn Rate) × 12 months

Or simpler:
```
Annual Revenue Per User × (Years as Customer) × Gross Margin %
```

Example:
- Price: $100/month
- Gross margin: 70% (server costs, payment processor = 30% of revenue)
- Expected retention: 3 years before churn
- LTV = $100 × 12 × 3 × 0.7 = $2,520

**Reality check:**
Is LTV at least 3–5x CAC?

LTV:CAC < 3x = Company burns cash. Needs to reduce CAC or increase LTV.
LTV:CAC = 3–5x = Healthy, can spend on growth.
LTV:CAC > 5x = Very healthy, can invest aggressively.

### 4. Monthly Churn Rate

What percentage of customers leave each month?

Formula: (Customers lost in month / Customers at start of month) × 100

Examples:
- B2B SaaS: 3–10% monthly churn (36–71% annual churn) — typical range
- B2C apps: 5–20% monthly (typical for mobile)
- Enterprise: <2% monthly churn (strong stickiness)

**Reality check:**
- 10% monthly churn = 66% annual. That's losing 2/3 of customers per year. Unsustainable.
- 3% monthly churn = 30% annual. More sustainable.
- What retention are you assuming? Back it with evidence or customer interviews.

### 5. Gross Margin %

What percentage of revenue remains after serving the product (COGS)?

Formula: (Revenue – COGS) / Revenue × 100

COGS includes:
- Cloud infrastructure
- Payment processor fees (2–3.5% of payment volume)
- Hosting, bandwidth
- Outsourced labor (customer support, operations)

Does NOT include:
- Sales/marketing (covered by CAC calculation)
- R&D (amortized into product roadmap)
- G&A (rent, HR, etc.)

Examples:
- SaaS: 60–80% gross margin (low COGS if you've optimized infrastructure)
- Marketplace: 15–50% (depends on transaction size)
- Agency/services: 40–60% (labor-heavy)

**Reality check:**
If gross margin is <30%, the unit economics break. You're paying too much to serve.

## Building a Unit Economics Model

### Step 1: Fill in the Five Numbers

| Metric | Assumption | Label |
|--------|-----------|-------|
| Price (monthly) | $99 | [estimated] |
| CAC | $3,000 | [estimated] |
| Churn (monthly) | 4% | [unverified] |
| LTV | $20,900 | [calculated] |
| Gross margin | 70% | [estimated] |

### Step 2: Validate the Ratio

LTV:CAC = $20,900 / $3,000 = 6.97x ✓

Safe ratio. You can profitably acquire customers.

### Step 3: Test Sensitivity

What breaks the model?

```
Churn goes to 8%?         → LTV drops to $10,450, LTV:CAC = 3.48x. Still viable but tight.
CAC goes to $5K?          → LTV:CAC = 4.18x. Still OK.
Price drops to $79?       → LTV:CAC = 4.85x. Still OK.
Churn goes to 10%?        → LTV:CAC = 2.62x. BROKEN. Model doesn't work.
```

The metric that breaks your model first = **your biggest risk.**

### Step 4: Identify What's Unverified

Label every number:

```
[confirmed]   — You have customer data or contracts proving this
[estimated]   — You've researched similar products and made informed assumptions
[unverified]  — Educated guess. Needs customer conversations or pilot data.
```

Your top 3 unverified numbers = your first validation targets.

## The Operating Logic Question

Beyond unit economics: **How do you actually serve a customer?**

Ask:

1. **Onboarding:** How long does it take to get a customer live? Is it self-service or hands-on?
2. **Support:** How much support do they need? Is it self-service FAQs or live humans?
3. **Infrastructure:** Do you need to build something custom for each customer, or is it standardized?
4. **Revenue timing:** Do they pay upfront, monthly, on usage? How long before you see cash?
5. **Expansion:** Can you upsell within the account, or is growth only new customers?

Examples:

**Self-serve SaaS:**
```
Onboarding: 15 minutes (sign up → credit card → live)
Support: Mostly self-service (knowledge base, Intercom)
Infrastructure: Standardized (every customer on same code)
Revenue: Monthly subscription, charged on day 1
Expansion: Upsell premium tiers, higher usage
```

**Enterprise SaaS:**
```
Onboarding: 8 weeks (sales → implementation → training)
Support: Dedicated CSM (customer success manager)
Infrastructure: Customized for each customer
Revenue: Annual contract, 50% upfront, 50% on implementation
Expansion: Strong (product consolidation, seat growth, usage growth)
```

The enterprise model is capital-efficient in LTV but capital-intensive in CAC.
The self-serve model is fast to acquire but sensitive to churn.

## Revenue Model Clarity Test

Can you explain your revenue model in one sentence?

✓ "We charge $99/month per team member."
✓ "We take 5% of every transaction processed."
✓ "Freemium: free for up to 100 items, $49/month for unlimited."

✗ "We're exploring monetization options." (Fuzzy.)
✗ "Enterprise deals are case-by-case." (Unclear if it scales.)
✗ "We're not sure yet." (Premature. Come back when you do.)

## Common Unit Economics Traps

| Trap | What Goes Wrong | Example | Fix |
|------|-----------------|---------|-----|
| **Ignoring churn** | LTV calculation is wildly optimistic | Assume 2% churn, actually 8%. LTV is 4x too high. | Talk to customers. What's realistic for your category? |
| **Underestimating CAC** | Assume marketing spend but not time. | "We'll do sales ourselves (time = salary)." | Include full-loaded cost of customer acquisition. |
| **Confusing revenue and margin** | $100/month ≠ $100/month profit. | "We'll make $1M revenue at 100 customers × $10K annual." But COGS is $6K/customer. | Always calculate margin. Revenue ≠ profit. |
| **Assuming usage is evenly distributed** | Some customers use 10x more. | Small customer pays $99. Large customer should pay $990 but pays $99. | Usage-based or tiered pricing, not flat. |
| **Lock-in as a growth strategy** | Churn is low because exit is hard, not because product is good. | Competitors enter with lower switching costs. Your customers leave en masse. | Make a good product. Lock-in is a bonus, not the strategy. |

## Red Flags

- CAC > LTV (Company is unprofitable by design)
- No pricing model stated (You haven't thought about it)
- "Enterprise deals are custom" with <$2M revenue (Can't scale sales ops yet)
- Churn assumption >8% for B2B SaaS (Unlikely to be sustainable)
- Gross margin <25% for software (You're not software, you're a service)
