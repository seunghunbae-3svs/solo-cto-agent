# codex-main codex + cowork dual review

Tier: CTO - Agent: Codex + Cowork - Mode: Full-auto

> Repo, org, branch, and PR identifiers are anonymized. Timings below are from a real private project run plus the shipped routing template.

## Input

A pull request opens on a private Next.js commerce app. The goal is to let Cowork and Codex both review automatically and keep the result inside GitHub.

```text
PR open on "Project Alpha"
Labels: dual-review, auth
```

## Agent behavior

1. Product-repo PR workflows fire automatically.
2. The orchestrator receives the cross-review dispatch.
3. The routing engine resolves the task to `dual-agent`.
4. Claude review, Codex review, comparison, and rework signals are posted back into the PR thread.

## Output

Routing verification command:

```bash
node templates/orchestrator/ops/orchestrator/routing-engine.js \
  --labels "dual-review,auth" \
  --repo "masked-org/project-alpha" \
  --issue 42
```

Routing output:

```json
{
  "mode": "dual-agent",
  "implementer": null,
  "reviewer": null,
  "lead": null,
  "telegram_tier": "decision",
  "max_rounds": 2,
  "auto_merge_after_hours": 24,
  "reasoning": [
    "label rule matched: [dual-review]"
  ],
  "issue": "42",
  "repo": "masked-org/project-alpha",
  "labels": "dual-review,auth"
}
```

Live PR-open timings from the private validation run:

```text
Telegram Notify        success    9s
Auto Review            success    9s
Full Review Pipeline   success   57s
Comparison Dispatch    success    7s
Rework Dispatch        success   11s
Vercel Preview         success   deploy completed
```

Latest live re-check findings on the same repo:

```text
Core dual path:        still alive
Claude/Codex comments: returned to the PR thread
Comparison report:     returned to the PR thread
Rework loop:           emitted follow-up rounds
Residual blocker:      legacy copied workflow files in the product repo
```

Residual blocker detail:

- the repo's copied `solo-cto-review.yml` was stale and carried invalid encoding
- the repo's copied `preview-summary.yml` was stale and carried invalid YAML
- this did not stop the main dual-review path, but it did poison one secondary review lane
- result: codex-main itself validated, but older product repos still need workflow refresh

See the deeper proof documents:

- `examples/review/codex-main-live-pr-review.md`
- `examples/founder-workflow/codex-main-live-rework-and-digest.md`

## Pain reduced

**PR-open uncertainty.** The dual path proves that codex-main is not just a label router. It can fan out into real review, comparison, and follow-up comments without a human driving each step.
