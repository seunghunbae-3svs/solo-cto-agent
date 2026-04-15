# Using solo-cto-agent with Claude

> This is the primary entry point for the toolkit. The supported core operating surfaces are **Cowork** and **Codex**.

`solo-cto-agent` has two runtime modes:

| Mode | What it means | Best for |
|---|---|---|
| `cowork-main` | Semi-auto. Local-first loop inside Claude Cowork and the CLI. | Solo work, manual sync, lower infra overhead. |
| `codex-main` | Full-auto. GitHub Actions + orchestrator + automatic review/rework flow. | Multi-repo CI/CD, always-on review and routing. |

## Core position

This repo is a **CTO toolkit**, not a generic prompt pack.

What is core:
- Cowork
- Codex
- review / build / ship / orchestrate loops
- install, verify, and operate from the CLI

What is not core:
- Gamma as a runtime
- editor-specific wrappers outside Cowork/Codex
- one-off presentation tooling

Gamma users can still use the toolkit. The recommended pattern is to build and review the content here, then move the final narrative or deck into Gamma for publishing.

## Quick start

### macOS / Linux

```bash
npm install -g solo-cto-agent
npx solo-cto-agent init --wizard

# Get your keys first:
# Anthropic: https://console.anthropic.com/settings/keys
# OpenAI: https://platform.openai.com/api-keys

export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."   # optional for cowork-main, required for codex-main

solo-cto-agent doctor
```

### Windows PowerShell

```powershell
npm install -g solo-cto-agent
npx solo-cto-agent init --wizard

# Get your keys first:
# Anthropic: https://console.anthropic.com/settings/keys
# OpenAI: https://platform.openai.com/api-keys

$env:ANTHROPIC_API_KEY="sk-ant-..."
$env:OPENAI_API_KEY="sk-..."   # optional for cowork-main, required for codex-main

solo-cto-agent doctor
```

## What to choose in the wizard

If you are unsure, use this rule:
- choose `cowork-main` if you want a local-first loop and manual control
- choose `codex-main` if you want full CI/CD automation and GitHub-driven review/rework

If you choose `codex-main`, also install:
- GitHub CLI: [cli.github.com](https://cli.github.com/)
- GitHub PAT for cross-repo dispatch: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)

Then continue with:

```bash
solo-cto-agent setup-pipeline --org <github-org> --repos <repo1,repo2>
```

## First commands that matter

```bash
# Check install + missing setup
solo-cto-agent doctor

# Run a local review in a git repo
solo-cto-agent review

# Run dual review when both keys are set
solo-cto-agent dual-review
```

## Tier summary

| Tier | Includes | Use when |
|---|---|---|
| Maker | `spark`, `review`, `memory`, `craft` | idea validation and lightweight review loops |
| Builder | Maker + `build`, `ship` | you are shipping real code |
| CTO | Builder + `orchestrate` | you want routing, dual-agent review, and full operating policy |

Default recommendation:
- most solo builders: `Builder`
- fully automated GitHub workflow: `CTO` + `codex-main`

## Compatibility

- **macOS:** supported directly. Best first-class shell path today.
- **Windows:** supported for the CLI. Use PowerShell environment variables during setup.
- **Linux:** supported.
- **Gamma:** supported only as a downstream publishing surface. Not a runtime target.

## Where to go next

- Main overview: [README.md](../README.md)
- Cowork operating guide: [cowork-main-install.md](./cowork-main-install.md)
- Tier matrix: [tier-matrix.md](./tier-matrix.md)
- Tier examples: [tier-examples.md](./tier-examples.md)
- CTO policy: [cto-policy.md](./cto-policy.md)
- External loop policy: [external-loop-policy.md](./external-loop-policy.md)
