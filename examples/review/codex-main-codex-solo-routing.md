# codex-main codex-solo routing

Tier: CTO - Agent: Codex solo - Mode: Full-auto

> Repo and issue identifiers are anonymized. This example is based on the exact routing engine and workflow files shipped in the template.

## Input

An issue is labeled `agent-codex` in a product repo that already has the codex-main pipeline installed.

```text
Issue #17
Labels: agent-codex, enhancement
```

## Agent behavior

1. `templates/product-repo/.github/workflows/codex-auto.yml` fires on the `agent-codex` label.
2. The product repo dispatches the task to the orchestrator.
3. `templates/orchestrator/.github/workflows/route-issue.yml` calls the routing engine.
4. The routing engine resolves the task to single-agent Codex execution.

## Output

Local routing verification:

```json
{
  "mode": "single-agent",
  "implementer": "codex",
  "reviewer": "claude",
  "lead": null,
  "telegram_tier": "notify",
  "max_rounds": 2,
  "auto_merge_after_hours": 24,
  "reasoning": [
    "label rule matched: [agent-codex]"
  ],
  "issue": "17",
  "repo": "masked-org/project-alpha",
  "labels": "agent-codex,enhancement"
}
```

Live validation on a real private commerce repo:

```text
Product repo run:      Codex Auto          success   10s
Orchestrator run:      Route Issue         success   14s
Orchestrator run:      Codex Worker        success   46s
GitHub result:         new fix PR created
Preview result:        preview deployment attached to the new PR
```

What this proved:

- `agent-codex` stayed on the single-agent path
- the product repo dispatch reached the orchestrator successfully
- the orchestrator worker executed against the real target repo
- the worker created a real PR instead of stopping at a label/comment handoff

Related template files:

```text
templates/product-repo/.github/workflows/codex-auto.yml
templates/orchestrator/.github/workflows/route-issue.yml
templates/orchestrator/ops/orchestrator/routing-policy.json
templates/orchestrator/ops/orchestrator/routing-engine.js
```

## Pain reduced

**Manual assignment ambiguity.** Without this route, "let Codex handle this one" is a human convention. With codex-main installed, the label is enough to force a deterministic Codex-only path.
