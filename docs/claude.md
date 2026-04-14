# Using solo-cto-agent with Claude

> This is the **primary** tool entry point. Claude Cowork is the fully-supported execution surface for `solo-cto-agent`.
> Other tools (Cursor, Windsurf, Copilot) are not currently supported. Entry points for those may land as this project grows.

## What you get with Claude

Two execution surfaces, same agent spec:

| Surface | What it is | When to use it |
|---|---|---|
| **Claude Cowork (desktop)** | Semi-auto mode = `cowork-main`. Agent runs inside the Cowork runtime, uses MCP connectors + web search + scheduled tasks. | Everyday solo work: review, build, ship, idea critique, session brief. |
| **CLI + API (`solo-cto-agent`)** | Direct invocation from terminal using `ANTHROPIC_API_KEY` (and optionally `OPENAI_API_KEY` for dual review). | CI/CD, scripts, running reviews outside Cowork, tier-controlled automation. |

Both surfaces call the same skills (`spark`, `review`, `memory`, `craft`, `build`, `ship`, `orchestrate`) and produce the same output shapes.

## Quick start

```bash
# Install skills to ~/.claude/skills/
npx solo-cto-agent init --wizard

# Local review on staged changes
ANTHROPIC_API_KEY=sk-ant-... solo-cto-agent review

# Dual review (Claude + Codex cross-check, auto-enabled when both keys present)
ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=sk-... solo-cto-agent dual-review
```

For Cowork specifically, after `init --wizard` the skills load automatically on next Cowork session. See the [operating guide](cowork-main-install.md) for the desktop runtime details.

## Choose a tier

Three tiers control **which skills and which workflows are installed**. You can change tiers later.

| Tier | Skills | Required keys | Use case |
|---|---|---|---|
| **Maker** | `spark`, `review`, `memory`, `craft` | `ANTHROPIC_API_KEY` | Idea critique, session memory, UI polish. No build pipeline. |
| **Builder** (default) | Maker + `build`, `ship` | `ANTHROPIC_API_KEY` · optional `OPENAI_API_KEY` | Full solo dev loop. Build, review, ship. |
| **CTO** | Builder + `orchestrate` | `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` | Dual review mandatory, multi-agent routing, UI/UX 4-stage gate, daily briefings. |

Tier matrix: [`tier-matrix.md`](tier-matrix.md). Tier scenarios: [`tier-examples.md`](tier-examples.md).

## The loop

Every skill runs the same checklist flow.

```text
Your request
  → Read own work
  → Produce a diff / content
  → Self-review (single-agent)
  → (optional) cross-review by second agent
  → Verdict: APPROVE / REQUEST_CHANGES / COMMENT
  → Circuit breaker if stuck (3 fails → stop + diagnose)
```

See [`external-loop-policy.md`](external-loop-policy.md) for the full self-loop + escalation policy (peer model / external knowledge / ground truth).

## Where to go from here

1. **Read a real example.** Pick one from [`../examples/`](../examples/) that looks like your day. `build/`, `ship/`, `review/`, or `founder-workflow/`.
2. **Run the install.** `npx solo-cto-agent init --wizard`. Pick Builder if you are unsure.
3. **Run one review.** `solo-cto-agent review --staged` on a real change. Read the JSON / markdown output. Decide whether to keep going.
4. **Wire Cowork (optional).** Open Cowork after install. The skills auto-load. Try `업무 시작` / `start session` for the memory brief.

## Deep dives

| Doc | Topic | Language |
|---|---|---|
| [`cowork-main-install.md`](cowork-main-install.md) | Cowork desktop operating guide (install, daily loop, troubleshooting) | 한국어 |
| [`cto-policy.md`](cto-policy.md) | CTO tier operating policy (dual-review mandatory, escalation rules) | 한국어 |
| [`tier-matrix.md`](tier-matrix.md) · [`tier-examples.md`](tier-examples.md) | Tier capability tables + scenarios | 한국어 |
| [`external-loop-policy.md`](external-loop-policy.md) | Self-loop / external signal policy (T1 peer · T2 knowledge · T3 ground truth) | 한국어 |
| [`feedback-guide.md`](feedback-guide.md) | Feedback accept/reject + personalization | 한국어 |
| [`plugin-api-v2.md`](plugin-api-v2.md) | Plugin spec (capability-scoped ctx, hook dispatch) | English |
| [`skill-slimming.md`](skill-slimming.md) | How skills stay under the context budget | 한국어 |

## Compatibility and limits

- **Node:** 18+ required for the CLI. Cowork desktop ships its own runtime — not your local Node.
- **OS:** macOS / Linux tested. Windows works via WSL; native Windows paths supported by the CLI but Cowork-side skills assume POSIX shells in scripts.
- **API quotas:** the CLI makes one API call per review (two in dual mode). Nothing batched, nothing re-invoked on failure beyond the circuit-breaker 3-attempt limit.
- **Secrets:** no secret is written to disk by the agent. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` come from your shell environment. Cowork uses its own credential store.
