# User Journey

This is the end-to-end story of what happens when you install `solo-cto-agent` on a fresh machine and take it through one full cycle — from triggering work to a merged PR with a before/after visual report.

If you want the one-line version: **you write code (or ask the agent to), push it, the orchestrator runs dual-agent review + consensus + self-rework + visual-report, and the PR lands on green CI.** You stay in the loop via PR comments and (optionally) a Telegram bot.

---

## 0. Decide your mode

Two modes. Pick once in `init --wizard`; switch any time by re-running it.

| Mode | When to use | What runs where |
|---|---|---|
| `cowork-main` (semi-auto) | You want local-first, manual control | CLI on your laptop |
| `codex-main` (full-auto) | You want CI/CD-driven review + rework | GitHub Actions + orchestrator repo |

The rest of this document assumes `codex-main` unless noted, because that is where the end-to-end automation lives.

---

## 1. Install + first-time setup

```bash
npm install -g solo-cto-agent
npx solo-cto-agent init --wizard
```

The wizard asks:

1. **GitHub org or username** — used to scope repo discovery.
2. **Repos to track** (new in v1.4) — `gh api` fetches your repos and shows a multi-select. The top 5 most-recently-pushed non-fork non-archived repos are pre-checked. Hit enter to accept, or type `1,3,5-7` / `all` / `none` / a name.
3. **Tier** — `builder` (solo Claude + Telegram, default) or `cto` (adds dual-agent cross-review, scoring, routing).

Then set the keys (examples from `.env.example`):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."          # required
export OPENAI_API_KEY="sk-..."                 # required for cto tier
export GITHUB_TOKEN="ghp_..."                  # required
export ORCHESTRATOR_PAT="ghp_..."              # required — cross-repo dispatch
export TELEGRAM_BOT_TOKEN="..."                # optional — PR notifications
export TELEGRAM_CHAT_ID="..."                  # optional
```

Verify:

```bash
solo-cto-agent doctor
```

Install CI pipelines (once per org):

```bash
solo-cto-agent setup-pipeline --org <your-org>
# (--repos is now optional — we use the saved wizard selection)
```

You are done with setup.

---

## 2. How you trigger work

There are **five** ways to kick off a cycle. Pick whichever matches your workflow.

| # | How | What happens |
|---|---|---|
| 1 | `git push` → PR opens | `solo-cto-pipeline.yml` dispatches `cross-review` to orchestrator |
| 2 | Label an issue `agent-claude` or `agent-codex` | `claude-auto.yml` / `codex-auto.yml` creates a branch + opens a PR with the implementation |
| 3 | `solo-cto-agent do "<plain English>"` | LLM picks the target repo, drafts a spec issue, labels it `agent-claude` or `agent-codex` → same path as #2 |
| 4 | Telegram `/do "<plain English>"` | Dispatches `nl-order-process` to the orchestrator → same as #3 |
| 5 | Telegram `/rework <pr_number>` | Force-triggers a rework cycle on an existing PR |

### Example — natural-language order

```bash
solo-cto-agent do "redesign the empty-cart state on my-store, less gradient, more typography"
```

The CLI asks Claude to classify the order. For the example above, it notices UI/design keywords, so `scope: design`. The worker later inspects the current rendering (Playwright via visual-report) and any configured Figma source before coding.

Output looks like:

```
✅ Issue created: https://github.com/acme/my-store/issues/127
   Repo:       acme/my-store
   Agent:      claude
   Scope:      design
   Labels:     agent-claude, nl-order, design-review
```

Once that issue is labeled, `claude-auto.yml` on the product repo takes over.

---

## 3. What happens after a PR opens

This is the consensus + rework loop. Everything below is automatic on `codex-main`.

```
PR opened
  │
  ▼
solo-cto-pipeline.yml (product repo)
  │   7 anti-loop guards fire:
  │   bot actor, skip-marker, review-engine tag, consensus-report,
  │   commit skip-review, rework-signal gate, self-dispatch
  │
  ▼  repository_dispatch(cross-review)
cross-review-dispatch.yml (orchestrator, concurrency-gated per PR)
  │
  ▼
ops/agents/cross-reviewer.js — 3-round consensus
  │   R1: Agent A produces BLOCKER/SUGGESTION/NIT list
  │   R2: Agent B per item: AGREE / DISAGREE / ADD_MORE
  │   R3 (only if needed): A renders KEEP / DROP / DOWNGRADE
  │   Early exits:
  │     R1 returns zero blockers   → APPROVE, post comment, done.
  │     R2 all agree, no additions → stop, post comment.
  │   After R3 still diverging     → emit [non-consensus] flag.
  │
  ├─► PR comment: single "## Consensus Review (N rounds)" message
  ├─► Telegram:   one summary with action buttons (✅❌🔧🔀)
  └─► If consensus blockers OR non-consensus: dispatch rework-request
        │
        ▼
      rework-auto.yml (orchestrator)
        │
        ▼
      ops/agents/rework-agent.js
        │   Circuit breaker: 3-strike per (repo, pr, agent)
        │   Max rounds: 2 (3 if CHANGES_REQUESTED persists)
        │   Picks agent from PR branch name
        │   Captures prevSha BEFORE push
        │   LLM generates file updates → commit + push via Octokit
        │   Captures newSha AFTER push
        │   Writes visual-report payload artifact (prev/new SHAs)
        │
        ├─► PR commit(s) under `solo-cto-agent[bot]`
        ├─► PR comment "[rework-round]"
        ├─► Telegram: "✅ Rework 완료" + action buttons
        └─► If PR has label `auto-merge-when-ready`:
              enable GitHub native auto-merge (SQUASH)
              → merges when all required checks pass.
                │
                ▼  workflow_run: completed (rework succeeded)
              visual-report.yml (orchestrator)
                │
                ▼
              ops/agents/visual-reporter.js
                │   Provider picked by VISUAL_REVIEW_PROVIDER var:
                │     'playwright' (default) | 'browserless' | 'off'
                │   Resolves Vercel preview URLs for prevSha + newSha
                │   Detects up to 3 routes from PR title/body/issue
                │   Captures before + after screenshots
                │   Composites side-by-side PNG via sharp
                │   Commits to orchestrator at visual-reports/{pr}/
                │   Posts PR comment with raw.githubusercontent.com imgs
                │   Posts Telegram sendMediaGroup
                │   Circuit breaker: 3-strike per PR for visual-report
                │   continue-on-error: never blocks rework success
```

---

## 4. Consensus review — what the comment looks like

```markdown
## 🔍 Consensus Review (2 rounds)

Agent A = Codex · Agent B = Claude
Verdict: **REQUEST_CHANGES**

### BLOCKERS — 2건 (합의)
1. `auth/callback.ts` resets session without the `user.id` check — `/login` races.
2. `Cart.tsx` drops optimistic UI on empty state — loses keyboard focus.

### Suggestions / Nits
1. [SUGGESTION] Extract `formatKRW` to utils; used three times.
2. [NIT] Trailing semicolon missing on L284.

<details><summary>원본 라운드별 응답</summary>
... full transcript ...
</details>

<!-- cross-reviewer:consensus -->
```

When agents disagree after round 3, you get a `### 미해결 이견` section and a `[non-consensus]` flag. The rework dispatch fires with `reason=non-consensus-blocker` so you can tune policy.

---

## 5. Visual before/after report

If the rework succeeded and a Vercel preview exists, the next PR comment is a before/after strip per detected route:

```markdown
## 🎨 Visual Report — 3 routes

**/** — home
![before](before)  ![after](after)

**/checkout** — cart
![before](before)  ![after](after)

**/settings/profile**
![before](before)  ![after](after)

Provider: playwright@1.48.0 · prev=abcd123 · new=efgh456
```

If no Vercel preview exists (you do not have Vercel wired, or the deployment failed), the step self-skips with a `[visual-report-skipped: no-preview-url]` comment. Rework is never blocked on this.

To enable Browserless instead (dodges Playwright browser install in CI):

```
# orchestrator repo → Settings → Variables
VISUAL_REVIEW_PROVIDER=browserless

# orchestrator repo → Settings → Secrets
BROWSERLESS_API_KEY=...   # free tier: 1000 screenshots/month
```

Kill switch: `VISUAL_REVIEW_PROVIDER=off`.

---

## 6. Auto-merge (opt-in)

Default: every PR waits for a human to click Merge.

Opt-in per PR by adding the label `auto-merge-when-ready`. After the rework agent pushes a successful fix, it enables GitHub's native auto-merge (SQUASH). GitHub then merges the PR the instant all required status checks pass — branch protection + required reviews are fully respected.

Remove the label to cancel.

---

## 7. Telegram bot — CTO surface

The bot is optional but the fastest way to drive things from your phone.

| Command | What it does | Admin-only? |
|---|---|---|
| `/status [repo]` | List open non-draft PRs + review state across tracked repos | no |
| `/list [repo]` | Last 10 PRs with one-line summaries | no |
| `/rework <pr>` | Force-dispatch `rework-request` for an existing PR | no |
| `/approve <pr>` | Submit a GitHub APPROVE review | no |
| `/do "<plain English>"` | Dispatch `nl-order-process` to the orchestrator | no |
| `/merge <pr>` | Immediate merge (squash) | **yes** |
| `/digest` | Today's PR activity summary | no |

Every review/rework/command reply that references a PR includes action buttons:

```
✅ Approve   ❌ Reject
🔧 Rework    🔀 Merge
```

Clicking edits the message to show "✅ Approved by @you" and performs the action via the same underlying API calls.

Admin gate: set `TELEGRAM_ADMIN_CHAT_IDS` (CSV of chat IDs) in the orchestrator env. `/merge` and the Merge button refuse unless the caller's `chat_id` is listed. Empty list → everyone blocked from /merge.

### Deploying the Telegram webhook (if you want inline button callbacks)

Plain `bin/telegram-bot.js` (long-polling) runs on your laptop and handles everything in cowork-main. For `codex-main` with inline action buttons from Telegram messages posted by CI workflows, you need the serverless webhook at `templates/orchestrator/api/telegram-webhook.js` deployed so Telegram has an endpoint to call back to.

Fastest deploy target: **Vercel Functions** (there's a free tier, your orchestrator repo likely already deploys to Vercel). Drop `api/telegram-webhook.js` into any Vercel project's `api/` dir, set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ORCHESTRATOR_PAT`, `GITHUB_OWNER`, `ORCH_REPO` as env vars, then register the webhook with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://<your-vercel-project>.vercel.app/api/telegram-webhook"
```

Alternatives: Cloudflare Workers (repackage the file as a `fetch` handler), Netlify Functions, Deno Deploy, AWS Lambda. All work because the file has no Node-specific deps beyond `fetch` (built-in) and `https.request` fallbacks.

If you skip the webhook entirely, you still get everything — you just won't see the ✅ Approve / ❌ Reject / 🔧 Rework / 🔀 Merge buttons fire back into GitHub from Telegram. You can still tap the "Open PR" button and act in the GitHub UI.

---

## 8. Local / cowork-main commands

If you are on `cowork-main` or just want to work locally:

```bash
solo-cto-agent review               # local Claude review of staged diff
solo-cto-agent dual-review          # Claude + GPT cross-check locally
solo-cto-agent deep-review          # sandboxed code execution (CTO tier)
solo-cto-agent do "..."             # works in both modes
solo-cto-agent repos list           # show / re-pick tracked repos
solo-cto-agent doctor               # setup self-check
solo-cto-agent session save         # checkpoint context for later
solo-cto-agent knowledge --session  # extract decisions into knowledge articles
```

---

## 9. Common scenarios

### You pushed a PR and want it reviewed + fixed + merged without touching it again

1. Add label `auto-merge-when-ready` to the PR.
2. Walk away.

Pipeline runs dual-review → consensus → rework → visual-report → GitHub auto-merge on green CI.

### You want an AI to build a new feature from a prompt

```bash
solo-cto-agent do "add a monthly ARPU chart to the admin dashboard, colored OKLCH(70% 0.10 200)"
```

The order is routed, the appropriate worker opens a branch + PR, consensus reviews it, rework polishes it, visual-report shows before/after.

### You want to stop the loop

- Add `[skip-review]` to the commit message → pipeline ignores that push.
- Remove `rework` label → no more auto-rework cycles for that PR.
- Set repo variable `DISABLE_AUTO_REWORK=true` → cross-reviewer stops dispatching rework on blocker.
- Set `VISUAL_REVIEW_PROVIDER=off` → visual-report silently skips.

### A review went wrong and you want to restart

```bash
# Via CLI
gh pr comment <pr> --body "[skip-review] restarting"
gh pr comment <pr> --body "Please re-review: <your note>"

# Or from Telegram
/rework <pr_number>
```

### Circuit breaker tripped (3 consecutive failures)

The PR gets a `⚠️ Rework Stopped (Circuit Breaker)` comment. To reset:

```bash
# orchestrator repo
node ops/lib/circuit-breaker.js reset <product-repo> <pr> <agent>
```

Or just push a fresh commit — that resets the circuit for the next pipeline run.

---

## 10. When something breaks

| Symptom | Most likely cause | Fix |
|---|---|---|
| `--org is required` in CI | stale workflow on a branch | Rebase or cherry-pick `.github/workflows/package-validate.yml` from main |
| Review comment never appears | orchestrator dispatch failed | Check `ORCHESTRATOR_PAT` secret on the product repo |
| `codex-auto` never triggers | label mismatch | Use exactly `agent-codex` (case-sensitive) |
| Telegram silent | creds missing / bot not started | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in orchestrator env |
| Visual-report skipped | no Vercel preview for SHA | Ensure Vercel is wired to the repo, or disable with `VISUAL_REVIEW_PROVIDER=off` |
| `/merge` denied | chat_id not in admin list | Add your chat_id to `TELEGRAM_ADMIN_CHAT_IDS` |

---

## 11. What this does *not* do

Setting expectations explicitly:

- It does not auto-discover your full GitHub history and rewrite it.
- It does not replace your judgment — every non-auto-merge PR still goes through human review by default.
- It does not inject code into your local dev environment (rework commits land on the PR branch in GitHub, not on your laptop).
- It does not send secrets outside the diff-guard-redacted channel.
- It will not escape the circuit breaker. After 3 consecutive rework failures on a single PR, it stops and asks.

If the system does something surprising, the commit message, PR comment, or Telegram message will tell you exactly which file + which function made the decision. Open that file and read — every autonomous action is traceable to named code.
