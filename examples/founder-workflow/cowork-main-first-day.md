# cowork-main first day (real install path)

Tier: Builder - Agent: Cowork - Mode: Semi-auto

## Input

Install the CLI, initialize it, and try the first three commands that matter:

```powershell
npm install -g solo-cto-agent
solo-cto-agent init --wizard
solo-cto-agent doctor
solo-cto-agent review --staged
solo-cto-agent sync --org seunghunbae-3svs
```

## Agent behavior

1. Refuses `init --wizard` cleanly if the shell is not interactive.
2. Uses `doctor` to tell the user what is missing and where to get it.
3. Refuses local review until `ANTHROPIC_API_KEY` exists.
4. Reuses GitHub CLI auth for `sync` if the user is already logged in with `gh`.

## Output (real)

Observed outputs from the packaged CLI run:

```text
--wizard requires an interactive terminal (TTY).

ANTHROPIC_API_KEY not set (required)
Get your key: https://console.anthropic.com/settings/keys
Then run: $env:ANTHROPIC_API_KEY="sk-ant-..."

ANTHROPIC_API_KEY required for local review.
$env:ANTHROPIC_API_KEY="sk-ant-..."

Org: seunghunbae-3svs
Orchestrator: dual-agent-review-orchestrator
Agent scores: 2 agents
Workflow runs: 10 recent
Error patterns: 8 patterns
```

## Pain reduced

**Failing at the first setup step without knowing what to do next.** The CLI now fails in a directed way: it tells the user what is missing, where to get it, and which command to run next.
