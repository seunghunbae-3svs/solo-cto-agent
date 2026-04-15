# Real-user install validation

This file records actual install and smoke-test runs for `solo-cto-agent`, using the packaged CLI rather than direct `node bin/...` invocation.

## Test environment

- Date: 2026-04-15
- OS: Windows 11
- Shell: PowerShell
- Package source: local packed tarball from current repo head
- Packed artifact: `solo-cto-agent-1.1.0.tgz`
- GitHub auth: `gh auth status` already logged in

## What was tested

| Flow | Command path | Result |
|---|---|---|
| Package install | `npm pack` -> `npm install -g <tgz> --prefix <temp>` | Passed |
| Install health check | `solo-cto-agent doctor` | Passed |
| Safe wizard refusal | `solo-cto-agent init --wizard` in non-TTY | Passed |
| cowork-main first review | `solo-cto-agent review --staged` without key | Passed with actionable refusal |
| cowork-main sync | `solo-cto-agent sync --org seunghunbae-3svs` | Passed |
| codex-main generation | `solo-cto-agent setup-pipeline --org seunghunbae-3svs --tier cto --repos app1,app2 --orchestrator-name dual-agent-review-orchestrator` | Passed |

## Transcript summary

### 1. Install from packed tarball

Command:

```powershell
npm pack --silent --pack-destination .tmp-pack
npm install -g .tmp-pack\solo-cto-agent-1.1.0.tgz --prefix .tmp-prefix
```

Observed result:

```text
added 1 package in 6s
```

Interpretation:
- The CLI is installable as a packaged artifact.
- This is the path that matters for real users.

### 2. `doctor` after install

Command:

```powershell
solo-cto-agent doctor
```

Observed result summary:
- Detected unconfigured `SKILL.md`
- Detected missing `ANTHROPIC_API_KEY`
- Printed the actual key URL: `https://console.anthropic.com/settings/keys`
- Printed the Windows command to set the key: ``$env:ANTHROPIC_API_KEY="sk-ant-..."``
- Reported Telegram as optional, not blocking

Interpretation:
- Day-1 onboarding is now actionable.
- The tool tells the user what is missing and where to get it.

### 3. `init --wizard` in non-interactive shell

Command:

```powershell
solo-cto-agent init --wizard
```

Observed result:

```text
--wizard requires an interactive terminal (TTY).
```

Interpretation:
- This is the correct behavior.
- The CLI no longer partially initializes and then fails.

### 4. cowork-main first review path

Command:

```powershell
solo-cto-agent review --staged
```

Observed result without Anthropic key:

```text
ANTHROPIC_API_KEY required for local review.
$env:ANTHROPIC_API_KEY="sk-ant-..."
```

Interpretation:
- Failure is explicit and recoverable.
- The user gets the exact next step instead of a generic crash.

### 5. cowork-main sync path

Command:

```powershell
solo-cto-agent sync --org seunghunbae-3svs
```

Observed result summary:
- Agent scores fetched: `2 agents`
- Workflow runs fetched: `10 recent (5 pass, 5 fail)`
- PR reviews fetched: `0`
- Visual baselines tracked: `0`
- Error patterns loaded: `8`

Interpretation:
- `sync` works with real GitHub data.
- `gh auth token` fallback is enough for an already-logged-in user.

### 6. codex-main setup path

Command:

```powershell
solo-cto-agent setup-pipeline --org seunghunbae-3svs --tier cto --repos app1,app2 --orchestrator-name dual-agent-review-orchestrator
```

Observed result summary:
- Created orchestrator repo scaffold locally
- Generated `24` orchestrator workflows
- Generated `8` workflows in each product repo:
  - `claude-auto.yml`
  - `codex-auto.yml`
  - `comparison-dispatch.yml`
  - `cross-review.yml`
  - `cross-review-dispatch.yml`
  - `preview-summary.yml`
  - `rework-dispatch.yml`
  - `telegram-notify.yml`

Interpretation:
- codex-main packaging is usable by a real installer.
- The generated workflow surface matches the documented full-auto model.

## What this proves

### Proven today

| Claim | Status |
|---|---|
| A user can install the packaged CLI | Proven |
| A user can understand what keys are missing | Proven |
| A user can run cowork-main locally after install | Proven, assuming Anthropic key is set |
| A user can sync orchestrator data without manually exporting a GitHub token if `gh` is already logged in | Proven |
| A user can generate codex-main automation scaffolding from the packaged CLI | Proven |

### Not proven by this run

| Claim | Status |
|---|---|
| Full codex-main end-to-end dispatch on live repos | Not covered here |
| Telegram delivery from generated workflows | Not covered here |
| Vercel preview and rework loop on a live product repo | Not covered here |

## Same capabilities vs same operating level

`cowork-main` and `codex-main` should not be marketed as identical operating modes.

| Question | Answer |
|---|---|
| Do they share major capability families? | Yes |
| Do they operate at the same automation level? | No |
| Is cowork-main viable for real users? | Yes, as semi-auto |
| Is codex-main the stronger always-on operating model? | Yes |

Short version:
- `cowork-main` = semi-auto, local-first, user-invoked
- `codex-main` = full-auto, orchestrator-driven, CI-triggered

## Remaining rough edges

- Some Windows console output still contains mojibake in decorative text.
- Docs are stronger than before, but they still need cleanup to remove corrupted Korean sections and outdated examples.
- The next validation step should be a live `codex-main` end-to-end run against one real product repo.
