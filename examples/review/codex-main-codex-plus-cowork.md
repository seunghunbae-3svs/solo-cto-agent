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
Telegram Notify        success   7s
Auto Review            success   9s
Full Review Pipeline   success  56s
Solo CTO Auto Review   success  78s
Cross Review Dispatch  skipped   0s
```

See the deeper proof documents:

- `examples/review/codex-main-live-pr-review.md`
- `examples/founder-workflow/codex-main-live-rework-and-digest.md`

## Pain reduced

**PR-open uncertainty.** The dual path proves that codex-main is not just a label router. It can fan out into real review, comparison, and follow-up comments without a human driving each step.
