# External Loop Policy — `solo-cto-agent`

> Why Cowork mode needs external signals, what counts as external, and how the CLI surfaces the gap.
> Related: [`docs/cowork-main-install.md`](cowork-main-install.md) · [`docs/feedback-guide.md`](feedback-guide.md)

---

## 1. The self-loop problem

The local Cowork loop (`review` → `apply-fixes` → `feedback` → personalization → `review`) is **structurally closed**. Every stage is driven by the same model family, the same diff, and the same user. Without external signals this compounds two biases:

- **Blind spot persistence** — what the model misses in pass 1 it will likely miss in pass 2, even with a devil's-advocate prompt. `selfCrossReview` helps at the margin but does not close the gap.
- **Taste entrenchment** — personalization weights accumulate the user's accepts/rejects. This is good for personal fit but bad for quality ceiling: the user cannot reject what they never saw.

The local loop is not useless — it catches obvious errors, maintains a review habit, and accumulates session memory. But **its quality ceiling is bounded by the single model's knowledge and the user's taste**. To break past that ceiling, external signals must enter the loop.

---

## 2. Three tiers of external signal

Not all "external" signals are equal. We rank them by how strongly they push back against the model's own opinion.

| Tier | Definition | Example signal | Strength |
|---|---|---|---|
| **T1 — Peer Model** | Another AI family reviewing the same diff | `dual-review` (Claude + OpenAI) | Weakest. Different model, same category of reasoning. Catches family-specific blind spots. |
| **T2 — External Knowledge** | Live information about stack / ecosystem | Web search, npm registry, security advisories | Medium. Tells the model "your training data is old" or "this package has a known issue". |
| **T3 — Ground Truth** | Actual runtime behavior of the shipped code | Vercel deploy status, runtime logs, Supabase query logs, error rates | Strongest. Not an opinion — a fact. "This endpoint 500'd 12 times yesterday." |

A review with zero of these tiers active is a **self-loop**. A review with all three is "externally grounded".

---

## 3. How the CLI surfaces the tier state

Every `review` and `dual-review` call records an `externalSignals` object in the saved review JSON and shows it in terminal output.

```json
{
  "externalSignals": {
    "t1PeerModel": false,
    "t2ExternalKnowledge": false,
    "t3GroundTruth": false,
    "activeCount": 0,
    "isSelfLoop": true
  }
}
```

### Terminal output cases

**Self-loop (0/3 active):**
```
⚠️  [SELF-LOOP NOTICE]
This review was produced by a single model family with no external signals.
Missing: T1 peer model · T2 external knowledge · T3 ground truth.
Why it matters: opinions reinforce themselves — blind spots persist.
To close the loop, enable any of:
  • T1 — set OPENAI_API_KEY and use 'solo-cto-agent dual-review'
  • T2 — set COWORK_EXTERNAL_KNOWLEDGE=1 (trend + package checks)
  • T3 — set VERCEL_TOKEN or SUPABASE_ACCESS_TOKEN (runtime signals)
```

**Partial (1/3 or 2/3 active):**
```
ℹ️  Active external signals: 2/3. Missing: T2 external knowledge.
```

**Fully grounded (3/3 active):** no notice.

### Detection rules

| Tier | Trigger |
|---|---|
| T1 | `OPENAI_API_KEY` is set (dual-review is available) |
| T2 | `COWORK_EXTERNAL_KNOWLEDGE=1` or `COWORK_WEB_SEARCH` / `COWORK_PACKAGE_REGISTRY` set |
| T3 | `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, or `COWORK_GROUND_TRUTH=1` set |

> Note: the current release of `solo-cto-agent` implements only T1 fully. T2 and T3 integrations land in subsequent PRs (PR-E1, PR-E2). The env-var flags already gate the UI so users can opt in as those integrations ship.

---

## 4. Why this is a warning, not a block

The self-loop review is **still produced and saved**. We do not gate on external signals because:

- First-time users may not have any external tokens — forcing them to set up tokens before getting any review is an onboarding disaster.
- Offline / air-gapped environments may intentionally run self-loop.
- The self-loop still catches plenty of real bugs; it just has a lower ceiling.

The warning exists so the user **understands what they're getting**. This is an honesty feature, not a safety gate.

---

## 5. Recommended operating policies

### Builder tier, Cowork only (no Codex key)

This is the most common open-source user profile. They have a pure self-loop by default.

- **Minimum**: enable T2 (set `COWORK_EXTERNAL_KNOWLEDGE=1`) once PR-E2 ships so package-registry and trend checks land in reviews.
- **Recommended**: wire up T3 via `VERCEL_TOKEN` for runtime signal. This is the single highest-ROI external signal because it's ground truth, not opinion.

### Builder / CTO tier, Cowork + Codex

- T1 is automatic when both keys are set.
- Still add T3 (Vercel/Supabase) — peer models disagree about opinions, but neither has access to the actual production error rate.

### CTO tier, Full-auto

- All three tiers are expected. The CI pipeline already collects T3 implicitly (CI result / preview deploy status) and feeds it back into `agent-scores`.

---

## 6. What does NOT count as external

We classify these as **still self-loop**:

- `selfCrossReview` (Claude's second pass with a devil's-advocate prompt) — same model, same training data.
- User feedback (`feedback accept/reject`) — the user's own past decisions.
- `knowledge` articles synthesized from prior sessions — same loop, just rolled up.
- `sync --apply` from your own orchestrator repo — your own CI, your own agent, still your closed loop.

These layers are useful for personalization and continuity, but they do not add external reality to the review.

---

## 7. Roadmap

| PR | Scope | Status |
|---|---|---|
| **PR-E3** | Self-loop warning label (this doc's subject) | ✅ shipped |
| **PR-E1** | T3 injection — Vercel deploy status + runtime logs | planned |
| **PR-E2** | T2 injection — package-registry + web-search for stack |  planned |
| **PR-E5** | `watch` schedules periodic dual-review + T2 refresh | planned |
| **PR-E4** | Inbound feedback channel (Slack button → `feedback`) | planned |

After PR-E1+E2, "fully externally grounded" becomes achievable for any user with tokens. Before that, T1 via dual-review is the main escape hatch from the self-loop.
