# codex-main live validation runbook

This runbook is for recurring end-to-end validation of the two full-auto operating shapes inside `codex-main`:

1. **codex solo** — issue-driven, `agent-codex` path
2. **codex + cowork** — PR-driven, `dual-review` path

Use this document when you want fresh proof that the shipped templates still work on a real GitHub repository, not just inside local tests.

## Latest live result snapshot

Latest real-project verification used a private Next.js commerce repo with the full codex-main wiring installed.

Observed state:

```text
codex solo:
- issue label -> product dispatch -> orchestrator route -> codex worker -> new PR
- status: verified live

codex + cowork:
- PR open/synchronize -> auto review -> full review pipeline -> comparison/rework -> preview
- status: verified live, with one caveat

caveat:
- older product repos may still contain copied workflow files that predate later fixes
- specifically, stale `solo-cto-review.yml` or `preview-summary.yml` copies can break side-lane checks
- this is a repo refresh problem, not a routing-engine or dispatch-handoff problem
```

---

## Before you start

Minimum conditions:

- product repo already wired with `solo-cto-agent setup-pipeline`
- orchestrator repo exists and Actions are enabled
- product repo secrets are present:
  - `ORCHESTRATOR_PAT`
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
- orchestrator repo secrets are present:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
- `gh auth status` succeeds on the machine running validation

Recommended evidence capture:

- GitHub Actions run URL
- PR or issue URL
- PR checks screenshot
- PR/issue comment screenshot
- Telegram screenshot if the notification path is enabled

When you publish the result publicly:

- mask repo, org, branch, PR number, issue number, and user names
- keep workflow names, durations, verdicts, and routing results

---

## Validation point 1 — codex solo live issue

### Goal

Prove that a real `agent-codex` issue still follows the single-agent Codex path in GitHub Actions.

### Trigger

Create a small non-destructive issue in a wired product repo and label it `agent-codex`.

### Suggested issue body

```markdown
Validation task for codex-main.

Goal:
- confirm `agent-codex` routes into the codex solo path
- confirm orchestrator dispatch works
- confirm result comment lands back in GitHub

This task should not modify production settings.
```

### Suggested commands

Create the issue:

```bash
gh issue create \
  --repo <org>/<product-repo> \
  --title "codex-main live validation: codex solo" \
  --body-file ./tmp/codex-solo-validation.md \
  --label agent-codex
```

Watch the latest related runs:

```bash
gh run list --repo <org>/<product-repo> --limit 10
gh run list --repo <org>/<orchestrator-repo> --limit 10
```

Inspect the run summary:

```bash
gh run view <run-id> --repo <org>/<product-repo>
gh run view <run-id> --repo <org>/<orchestrator-repo>
```

### Pass criteria

All of the following should happen:

- product repo `codex-auto.yml` runs
- product repo dispatches to orchestrator successfully
- orchestrator receives the task
- a GitHub comment comes back onto the issue or linked PR
- no unexpected dual-review path is triggered

### Latest live outcome

- passed after the orchestrator dispatch handoff fix
- first live run exposed a real orchestrator gap: repository dispatch reached routing, but worker dispatch was missing
- after the orchestrator fix, the same validation produced a real product-repo PR

### Evidence to keep

- issue URL
- product repo `codex-auto.yml` run URL
- orchestrator route/worker run URL
- screenshot of the issue showing:
  - `agent-codex` label
  - returned comment
- optional Telegram screenshot

### Public example conversion

Turn the result into a public example by keeping only:

- workflow names
- timings
- routing decision
- returned comment shape

Then update:

- `examples/review/codex-main-codex-solo-routing.md`

---

## Validation point 2 — codex + cowork live PR

### Goal

Prove that a real PR still fans out through the dual-agent review path and returns visible PR evidence.

### Trigger

Open a low-risk PR on a wired product repo. Add `dual-review` if the repo routing policy does not already default to dual mode for that change type.

### Suggested test change

- docs-only change
- copy fix
- non-production configuration note

This keeps the run safe while still proving the automation path.

### Suggested commands

Create a branch and PR:

```bash
git checkout -b codex/live-validation-pr
git commit --allow-empty -m "chore: codex-main live validation"
git push origin codex/live-validation-pr

gh pr create \
  --repo <org>/<product-repo> \
  --title "codex-main live validation: dual path" \
  --body "Validate PR-open automation, dual review, and follow-up comments."
```

If needed, add the label:

```bash
gh pr edit <pr-number> --repo <org>/<product-repo> --add-label dual-review
```

Watch the runs:

```bash
gh run list --repo <org>/<product-repo> --limit 10
gh run list --repo <org>/<orchestrator-repo> --limit 10
```

### Pass criteria

All of the following should happen:

- PR-open workflows fire automatically
- dual-agent or comparison path appears in the run set
- review comments land on the PR
- decision/rework surface is visible in GitHub
- if Telegram is enabled, a decision or notify message is sent

### Latest live outcome

- PR-open automation fired correctly on a real private repo
- review comments, comparison output, rework output, and preview evidence all returned into GitHub
- one product repo still contained stale copied workflow files, which broke a secondary review lane
- that blocker belongs to workflow refresh on existing repos, not to the codex-main routing model itself

### Evidence to keep

- PR URL
- PR checks screenshot
- run URLs for:
  - product repo review workflow
  - orchestrator comparison/rework workflow
- screenshot of PR comments
- optional screenshot of Telegram notification

### Public example conversion

Turn the result into a public example by keeping only:

- workflow names
- durations
- verdict summary
- rework round shape

Then update:

- `examples/review/codex-main-live-pr-review.md`
- `examples/founder-workflow/codex-main-live-rework-and-digest.md`

---

## Red flags

If any of these happen, the validation is not complete:

- `codex-auto.yml` does not fire on `agent-codex`
- product repo dispatch succeeds but orchestrator never picks it up
- PR-open workflows run but no review comment is posted
- `dual-review` resolves into a single-agent path unexpectedly
- Telegram path is expected but silent
- Vercel preview fails before the review path can attach expected evidence

---

## Reporting format

When you convert a live run into public proof, keep it in this shape:

```text
Input
- masked repo type
- masked trigger

Agent behavior
- workflow names in order

Output
- run durations
- routing decision
- returned comments / verdicts

Pain reduced
- one sentence only
```

That keeps the examples readable and repeatable.
