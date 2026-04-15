# codex-main first setup (real generated scaffold)

Tier: CTO - Agent: Cowork + Codex - Mode: Full-auto

## Input

Generate the automation scaffold for one orchestrator repo and two product repos:

```powershell
solo-cto-agent setup-pipeline --org seunghunbae-3svs --tier cto --repos app1,app2 --orchestrator-name dual-agent-review-orchestrator
```

## Agent behavior

1. Creates the orchestrator scaffold locally.
2. Copies orchestrator workflows, agent scripts, and ops scripts.
3. Installs product-repo workflows into each target repo.
4. Writes an environment setup guide for the operator.

## Output (real)

Observed output summary from the packaged CLI run:

```text
Tier: CTO (Lv5+6)
Org: seunghunbae-3svs

Created: ...\dual-agent-review-orchestrator
Orchestrator: 95 files deployed
app1 -> 8 workflows
app2 -> 8 workflows
Setup guide: ...\dual-agent-review-orchestrator\.env.setup-guide

Pipeline setup complete
Workflows: 24
Product repos: 2
```

Generated product-repo workflows:

```text
claude-auto.yml
codex-auto.yml
comparison-dispatch.yml
cross-review.yml
cross-review-dispatch.yml
preview-summary.yml
rework-dispatch.yml
telegram-notify.yml
```

## Pain reduced

**Manually wiring multi-repo automation from scratch.** The first codex-main run produces the real workflow surface in one command, so the user starts from a working scaffold rather than a blank GitHub Actions setup.
