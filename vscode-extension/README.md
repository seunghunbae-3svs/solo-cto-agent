# Solo CTO Agent — VS Code Extension

CTO-level AI code review directly in VS Code.

## Features

- **Review Current File** — AI review of the active file
- **Review Staged Changes** — Review `git add`-ed changes before commit
- **Review Branch Diff** — Review all changes vs base branch
- **Dual-Agent Review** — Claude + OpenAI cross-check for higher accuracy
- **Deep Review** — CTO-tier comprehensive analysis (architecture, security, performance)
- **Template Audit** — Check managed repos for template drift
- **Diagnostics** — Review issues appear as VS Code warnings/errors in the Problems panel

## Requirements

- [solo-cto-agent](https://www.npmjs.com/package/solo-cto-agent) CLI installed globally: `npm i -g solo-cto-agent`
- `ANTHROPIC_API_KEY` environment variable set
- Optional: `OPENAI_API_KEY` for dual-agent mode

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Solo CTO":

| Command | Description |
|---|---|
| Solo CTO: Review Current File | Review the active editor file |
| Solo CTO: Review Staged Changes | Review staged git changes |
| Solo CTO: Review Branch Diff | Review full branch diff vs base |
| Solo CTO: Dual-Agent Review | Cross-check with Claude + OpenAI |
| Solo CTO: Deep Review | CTO-tier deep analysis |
| Solo CTO: Template Audit | Check template drift |
| Solo CTO: Set Agent Tier | Switch between Maker/Builder/CTO |

## Settings

| Setting | Default | Description |
|---|---|---|
| `soloCtoAgent.tier` | `builder` | Agent tier: maker, builder, cto |
| `soloCtoAgent.redact` | `true` | Redact secrets from diffs |
| `soloCtoAgent.targetBranch` | `main` | Base branch for diff comparison |
| `soloCtoAgent.autoReviewOnSave` | `false` | Auto-review on file save |

## Publishing

```bash
cd vscode-extension
npx vsce package    # creates .vsix
npx vsce publish    # publishes to VS Code Marketplace
```
