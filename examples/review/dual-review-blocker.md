# Dual-review catches a race condition

Tier: CTO - Agent: Cowork + Codex - Mode: Semi-auto (local) or Full-auto (CI)

## Input

A PR modifies the Stripe webhook handler to persist `Order.status`:

```diff
  // app/api/webhooks/stripe/route.ts
  export async function POST(req: Request) {
    const event = stripe.webhooks.constructEvent(body, sig, secret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
-     await markOrderPaid(session.id);
+     const order = await db.order.findUnique({ where: { stripeSessionId: session.id } });
+     if (order && order.status === "pending") {
+       await db.order.update({
+         where: { id: order.id },
+         data: { status: "paid", paidAt: new Date() },
+       });
+     }
    }
    return new Response(null, { status: 200 });
  }
```

Both `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are set. You run:

```bash
solo-cto-agent dual-review --staged --json
```

## Agent behavior

1. **`review` skill** runs two concurrent passes on the staged diff.
2. **Claude pass** (primary reviewer):
   - 10-checklist scan ->flags Stripe webhook path.
   - Pattern recognised: *"read-modify-write without a transaction, in a handler that can fire multiple times."*
   - Verdict: `REQUEST_CHANGES`  -  `[BLOCKER]` race condition.
3. **Codex pass** (cross-checker):
   - Notes the same read-modify-write pattern but classifies it as `[SUGGESTION]` ->worth fixing but not a blocker.
   - Also flags an unrelated `[NIT]`: the handler returns 200 even when the body signature verification fails earlier (it does not, but the reviewer misreads `constructEvent`'s throw behavior).
4. **Cross-review** (Claude reviews Codex's review, Codex reviews Claude's):
   - Claude flags Codex's NIT as incorrect (`constructEvent` throws ->400 is the actual path).
   - Codex agrees with Claude that the race is real but does not escalate it to BLOCKER.
5. **Comparison report** (agent-scoring path):
   - Disagreement on severity ->routing-engine selects higher severity by default on payment-path patterns.
   - Final verdict: `REQUEST_CHANGES` with one `[BLOCKER]`.
6. Agent emits a concrete fix suggestion, not a vague "add a transaction":

   ```ts
   // replace read-modify-write with a conditional update
   const updated = await db.order.updateMany({
     where: { stripeSessionId: session.id, status: "pending" },
     data: { status: "paid", paidAt: new Date() },
   });
   // updated.count === 0 means: either not found, or already paid (idempotent skip)
   ```

## Output

`review.json` (trimmed):

```json
{
  "verdict": "REQUEST_CHANGES",
  "reviewers": {
    "claude": { "verdict": "REQUEST_CHANGES", "blockers": 1, "suggestions": 0, "nits": 0 },
    "codex":  { "verdict": "COMMENT",         "blockers": 0, "suggestions": 1, "nits": 1 }
  },
  "disagreements": [
    { "topic": "race severity", "claude": "BLOCKER", "codex": "SUGGESTION", "resolution": "BLOCKER (payment-path rule)" },
    { "topic": "400 on bad sig", "claude": "not-an-issue", "codex": "NIT", "resolution": "not-an-issue (constructEvent throws)" }
  ],
  "issues": [
    {
      "severity": "BLOCKER",
      "file": "app/api/webhooks/stripe/route.ts",
      "line": 12,
      "title": "Read-modify-write race on order status",
      "rationale": "Stripe can deliver the same webhook event multiple times within milliseconds. The findUnique + update sequence can interleave, causing duplicate side effects (paid twice, duplicate fulfillment). Use a conditional update (updateMany with status=pending in WHERE) so the database enforces the state transition atomically.",
      "fix": "// see suggested patch in review output"
    }
  ],
  "next_action": "apply suggested patch; re-run dual-review; merge on APPROVE."
}
```

On the PR (if wired via CI), the same content posts as a comment with the fix block in a code fence.

## Pain reduced

**The "looks good to me" rubber stamp.** A single reviewer (human or AI) misses race conditions constantly because the code reads linearly and looks correct. The failure mode only appears under retry + concurrency, neither of which are visible in the diff. The dual path with disagreement resolution is specifically designed so one reviewer's blind spot cannot silently pass.

Secondary pain: **vague review comments.** "Consider using a transaction" is a comment that requires 10 more minutes of thought to act on. The review here ends with a ready-to-apply patch ->the reviewer did the work of deciding *which* atomicity primitive applies to *this* codebase's Prisma version.

Tertiary pain: **incorrect review comments going unchecked.** Codex's NIT about the 400 path was wrong. Without the cross-review, it would have been noise you had to either implement or dismiss. The cross-review pass caught and rejected it.

