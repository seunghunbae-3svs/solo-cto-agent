# Codex-Main Install Guide

`codex-main` is the full-auto mode of `solo-cto-agent`.

It is designed for users who want GitHub Actions to run the review loop automatically:
- PRs are detected from connected product repositories
- review results are posted back to GitHub
- Telegram sends decision prompts and preview links
- approval can trigger the next step without going back to the terminal

`cowork-main` is the local/semi-auto mode. This document covers `codex-main` only.

## What this mode does

After setup is complete:
1. the orchestrator repo is created from the package template
2. product repos get the required workflow files
3. you add the listed secrets once
4. you deploy the orchestrator to Vercel
5. Telegram sends a setup-complete message asking whether to start the first baseline review
6. if you approve, the orchestrator scans open PRs and posts the first review summaries

## Prerequisites

You need these installed locally:
- Node.js 18+: [https://nodejs.org/](https://nodejs.org/)
- Git: [https://git-scm.com/](https://git-scm.com/)
- GitHub CLI: [https://cli.github.com/](https://cli.github.com/)
- Vercel CLI: [https://vercel.com/docs/cli](https://vercel.com/docs/cli)

You also need these accounts/tokens:
- Anthropic API key: [https://console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
- OpenAI API key: [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- GitHub PAT with `repo` + `workflow`: [https://github.com/settings/tokens](https://github.com/settings/tokens)
- Telegram bot token: create one with [https://t.me/BotFather](https://t.me/BotFather)
- Telegram chat id: can be captured by `solo-cto-agent telegram wizard`

## Step 1. Install the package

```bash
npm install -g solo-cto-agent
solo-cto-agent init --wizard
```

Choose `codex-main` when the wizard asks for the mode.

The wizard creates `~/.claude/skills/solo-cto-agent/SKILL.md` and then runs `solo-cto-agent doctor`.

## Step 2. Generate the orchestrator and repo workflows

```bash
solo-cto-agent setup-pipeline --org <github-owner> --tier cto --repos <repo1,repo2>
```

Example:

```bash
solo-cto-agent setup-pipeline --org acme --tier cto --repos storefront,admin-app
```

This creates:
- `dual-agent-review-orchestrator/`
- `dual-agent-review-orchestrator/ops/config/projects.json`
- product repo workflow files under each connected repository

The generated `projects.json` is the source of truth for:
- connected repositories
- Telegram repo aliases
- baseline review bootstrap
- status and decision queue messages

## Step 3. Create the orchestrator repository

```bash
cd dual-agent-review-orchestrator
git init
git add -A
git commit -m "init codex-main orchestrator"
gh repo create dual-agent-review-orchestrator --private --source . --push
```

If you want a different repo name, pass `--orchestrator-name <name>` to `setup-pipeline`.

## Step 4. Add GitHub Actions secrets

### Orchestrator repo secrets

Add these to the orchestrator repository:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `ORCHESTRATOR_PAT`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional but recommended:
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

### Product repo secrets

Add these to every connected product repository:
- `ORCHESTRATOR_PAT`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional for preview/deploy awareness:
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## Step 5. Deploy the orchestrator

```bash
cd dual-agent-review-orchestrator
vercel link
vercel --prod
```

Once the production deployment succeeds, the `setup-onboarding` workflow sends a Telegram message asking whether to start the first baseline review.

## Step 6. Start the first review from Telegram

Expected Telegram message:
- setup complete notice
- connected repos list
- `Start review` button
- `Later` button

If you press `Start review`:
- the orchestrator dispatches a bootstrap run
- open PRs are scanned
- Claude/OpenAI review runs when keys are configured
- a review summary is posted to GitHub and Telegram
- decision buttons are attached for each PR

## What to expect after setup

For each open PR, the baseline flow should produce:
- a PR comment in GitHub
- a Telegram summary with verdict, blockers, next action, preview link
- decision buttons: `Approve`, `Revise`, `Hold`

If no open PR exists yet, the bootstrap summary still reports repo health and tells you that no PR was found.

## Real validation target

A valid `codex-main` install is not just a successful scaffold.
It is considered working only when all of these are true:
- `setup-pipeline` generates the orchestrator and workflow files
- `setup-onboarding` sends the Telegram prompt after production deploy
- `Start review` dispatches the bootstrap review job
- at least one PR receives a review summary comment
- Telegram receives the result and decision buttons

## Current validation status

The flow below has already been exercised on the live orchestrator owned by `seunghunbae-3svs`.

Proven:
- package install from a packed tarball
- `setup-pipeline` scaffold generation
- `setup-onboarding.yml` prompt run sending the Telegram setup message
- onboarding approval callback dispatching the bootstrap review workflow
- bootstrap review posting real PR comments on connected repos

Evidence:
- prompt run: [24452919850](https://github.com/seunghunbae-3svs/dual-agent-review-orchestrator/actions/runs/24452919850)
- bootstrap smoke: [24453233629](https://github.com/seunghunbae-3svs/dual-agent-review-orchestrator/actions/runs/24453233629)
- approval callback -> bootstrap: [24453476069](https://github.com/seunghunbae-3svs/dual-agent-review-orchestrator/actions/runs/24453476069)

Known remaining gap:
- the production-deployment trigger for the onboarding prompt is not yet proven because the current orchestrator Vercel preview deployments are failing
- until that is fixed, the prompt path is validated via workflow dispatch, not via a successful production deploy hook

## Troubleshooting

### Telegram prompt did not arrive
Check:
- `TELEGRAM_BOT_TOKEN` exists in the orchestrator repo
- `TELEGRAM_CHAT_ID` exists in the orchestrator repo
- the Vercel production deploy actually succeeded
- the `setup-onboarding` workflow ran successfully

### Bootstrap review ran but no AI review was generated
Check:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- whether the connected repos actually have open PRs

### Product repos are not dispatching back to the orchestrator
Check:
- `ORCHESTRATOR_PAT` is set in each product repo
- the repo name in `ops/config/projects.json` matches the real repo
- the generated workflow files were committed and pushed

### Preview links are missing
Check:
- PR body for preview URLs
- deployment statuses on the product repo commit
- optional Vercel-related secrets if you want richer deployment awareness
