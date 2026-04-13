# solo-cto-agent

[![npm](https://img.shields.io/npm/v/solo-cto-agent)](https://www.npmjs.com/package/solo-cto-agent)
[![Package Validate](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/package-validate.yml/badge.svg)](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/package-validate.yml)
[![Test](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/test.yml/badge.svg)](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/test.yml)
[![Changelog](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/changelog.yml/badge.svg)](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/changelog.yml)
[![License](https://img.shields.io/github/license/seunghunbae-3svs/solo-cto-agent)](LICENSE)


I made this because I got tired of using AI coding tools that were good at writing code, but still left me doing all the messy CTO work around it.

The hard part was rarely "write the feature." It was everything around the feature:

* catching missing env vars before a deploy breaks
* not re-explaining the same stack every new session
* stopping error loops before they waste half an hour
* getting honest pushback on ideas instead of empty encouragement
* cleaning up UI that looks obviously AI-generated

This repo is my attempt to package those habits into a small set of reusable skills. It is not magic. It is not a replacement for judgment. It is just a better operating system for the kind of AI agent I wanted to work with.

## What this is

`solo-cto-agent` is an opinionated skill pack for solo founders, indie hackers, and small teams using AI coding agents in their build workflow.

Primary workflow: Cowork + Codex.  
It was built around Claude Code & OpenAI Codex but the core rules also work in Cursor, Windsurf, and GitHub Copilot. The repo includes native config files where needed.

The point is simple:

* less repetitive setup work
* less context loss between sessions
* less AI slop in code and design
* more useful criticism before you commit to bad ideas
* more initiative from the agent on low-risk work

## What changes in practice

This is the difference I wanted in day-to-day use:

| Without this | With this |
| -------------------------------------------- | -------------------------------------------------------------- |
| Same build error over and over | Circuit breaker stops the loop and summarizes the likely cause |
| "Please add this manually to your dashboard" | Agent checks setup earlier and asks once when needed |
| New session, same explanation again | Important decisions get reused |
| Rounded-blue-gradient AI UI | Design checks push for more intentional output |
| "Looks good to me" feedback | Review forces actual criticism |
| Agent asks permission for every tiny step | Low-risk work gets done without constant back-and-forth |

## Who this is for

This repo is probably useful if you:

* build mostly alone or with a very small team
* already use Claude, Codex, Cursor, Windsurf, or Copilot in your workflow
* want the agent to take more initiative
* care about startup execution, not just code completion
* are okay with opinionated defaults

It is probably not a good fit if you:

* work in a tightly locked-down enterprise environment
* do not want agents touching files or setup
* want every action manually approved
* prefer a neutral framework-agnostic starter pack with very conservative defaults

## What's inside

```text
solo-cto-agent/
├── autopilot.md
├── .cursorrules              ← Cursor picks this up automatically
├── .windsurfrules            ← Windsurf (Cascade) picks this up automatically
├── .github/
│   └── copilot-instructions.md  ← GitHub Copilot workspace instructions
├── skills/
│   ├── build/
│   │   └── SKILL.md
│   ├── ship/
│   │   └── SKILL.md
│   ├── craft/
│   │   └── SKILL.md
│   ├── spark/
│   │   └── SKILL.md
│   ├── review/
│   │   └── SKILL.md
│   └── memory/
│       └── SKILL.md
└── templates/
    ├── project.md
    └── context.md
```

## Two Modes

The CLI supports two workflow modes. Pick during `init --wizard`:

| | codex-main | cowork-main |
|---|---|---|
| **Primary tool** | GitHub Actions + Codex | Claude Code / Cowork Desktop |
| **Automation** | Full — webhooks, auto-rework, auto-score | Manual — `sync`, `local-review`, `knowledge` |
| **CI/CD pipeline** | Required (setup-pipeline) | Optional |
| **Network dependency** | Needs stable GitHub API access | Works offline, sync when convenient |
| **Best for** | Teams with CI/CD infra, power users | Solo devs, unstable connections, local-first |
| **Error patterns** | Auto-collected from CI failures | Manual sync with `--apply` flag |
| **Agent scores** | Auto-updated per PR event | Synced on demand |

Both modes use the same skills and tiers. The difference is whether automation runs automatically (codex-main) or on-demand (cowork-main).

```bash
npx solo-cto-agent init --wizard
# Prompts: Choose mode → [1] codex-main  [2] cowork-main
```

## Tiers

Two tiers, one CLI. Pick what fits your workflow.

### Builder (Lv4) — Single-Agent, Default

For solo devs who want Claude reviewing every PR automatically. One agent, no extra infrastructure.

| What you get | Details |
|---|---|
| Agent | Claude (single) |
| Product repo workflows | 3 core + 1 optional (telegram) |
| Orchestrator workflows | 8 (single-agent only) |
| Skills | spark, review, memory, craft, build, ship |
| Required secrets | `ORCHESTRATOR_PAT`, `ANTHROPIC_API_KEY` |
| Optional secrets | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |

Product repo automation: PR opened → Claude auto-review → preview summary → rework cycle on review feedback.

### CTO (Lv5+6) — Multi-Agent

For teams or power users who want agents competing and cross-checking each other. Claude + Codex by default, with routing-engine architecture designed for adding more agents (Cursor, Copilot, custom).

| What you get | Details |
|---|---|
| Agents | Claude + Codex (extensible to Cursor, Copilot, etc.) |
| Product repo workflows | 7 core + 1 optional (telegram) |
| Orchestrator workflows | 24 (8 base + 16 multi-agent & pro) |
| Skills | all Builder skills + orchestrate |
| Required secrets | `ORCHESTRATOR_PAT`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |
| Optional secrets | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Extra features | UI/UX 4-stage quality gate, daily briefings, decision tracking, agent scoring, comparison reports |

Product repo automation: PR opened → Claude + Codex both review → cross-review each other → comparison report → rework dispatch on issues → optional Telegram notifications.

### What CTO adds over Builder

| Capability | Builder (Lv4) | CTO (Lv5+6) |
|---|---|---|
| Claude auto-review | Yes | Yes |
| Codex auto-review | — | Yes |
| Cross-review (agents review each other) | — | Yes |
| Comparison reports | — | Yes |
| Agent score tracking | — | Yes |
| UI/UX quality gate (4-stage) | — | Yes |
| Visual regression (Playwright + Vision) | Scheduled | Scheduled + PR-triggered |
| Daily briefings | — | Yes |
| Decision queue + insights | — | Yes |
| Telegram notifications | Optional | Optional |
| Rework dispatch | Yes | Yes |
| Preview summary | Yes | Yes |
| Circuit breaker (3-fail stop) | Yes | Yes |

### Visual Verification (Both tiers)

Visual checks use Playwright for real browser screenshots (desktop 1280px + mobile 375px). Scheduled mode runs every 6 hours comparing against baselines and opens issues on visual regression. PR mode triggers on preview deployment, screenshots the preview URL, and posts results as a PR comment. Falls back to thum.io if Playwright is unavailable.

### Auto Service Detection (Both tiers)

When you run `setup-pipeline` or `setup-repo`, the CLI scans your project's `package.json` and file structure to detect required services (NextAuth, Supabase, Stripe, Prisma, Firebase, AWS, etc.). It then prints every secret needed and generates copy-paste `gh secret set` commands for one-shot setup. No more discovering missing secrets mid-deployment.

### Local Code Review (No CI/CD Required)

Run a Claude-powered code review directly from your terminal, no GitHub Actions needed:

```bash
# Review last commit
ANTHROPIC_API_KEY=sk-xxx solo-cto-agent review

# Review a branch diff (dry-run: see the prompt without calling API)
solo-cto-agent review --diff main..feature --dry-run

# Review specific directory
solo-cto-agent review --path ./src --diff HEAD~3
```

The review checks your diff against the local failure catalog (known error patterns), then sends it to Claude for security, performance, correctness, and style analysis. Results are saved as markdown reports in `~/.claude/skills/solo-cto-agent/reviews/`. This is the same review quality as the CI/CD pipeline, but runs entirely locally — useful for private repos, offline work, or pre-push checks.

### Knowledge Articles

After CI/CD data accumulates (via `sync`), generate synthesized knowledge articles:

```bash
solo-cto-agent learn
```

This scans your failure catalog, agent scores, and sync history, then generates markdown articles grouped by category (deploy failures, database patterns, auth issues, etc.) at `~/.claude/skills/solo-cto-agent/knowledge/`. The articles include pattern frequencies, prevention checklists, and agent performance notes — making the accumulated data immediately useful to your AI agent.

### Local Code Review (Both tiers)

Run multi-agent code review locally without GitHub Actions:

```bash
# Claude review of staged changes
ANTHROPIC_API_KEY=sk-xxx solo-cto-agent review --diff staged

# Dual-agent review (Claude + GPT) of branch diff
ANTHROPIC_API_KEY=sk-xxx OPENAI_API_KEY=sk-xxx solo-cto-agent review --diff branch

# Output as markdown file
solo-cto-agent review --diff staged --output markdown --file review.md
```

Works completely offline from CI/CD. Claude reviews the diff first. If an OpenAI key is also set, GPT provides a second opinion and the tool cross-compares both reviews — highlighting agreed issues (high confidence) vs. divergent findings. New error patterns found during review are automatically added to the local failure catalog.

### Knowledge Article Generation (Both tiers)

Auto-generates durable knowledge articles from accumulated session memory:

```bash
# Dry-run: show which articles would be generated
solo-cto-agent knowledge

# Generate articles
solo-cto-agent knowledge --apply
```

Scans `memory/episodes/`, `CONTEXT_LOG.md`, and `error-patterns.md` for topics that appear 3+ times. When a recurring pattern is detected, it generates a structured knowledge article at `memory/knowledge/{topic}.md` and updates the index. This is the Layer 2 → Layer 3 compression that the memory skill describes but previously required manual effort.

### Local ↔ Remote Sync

The `sync` command bridges the gap between your local skill files and remote CI/CD results. It runs in dry-run mode by default — fetches and displays data without modifying local files. Add `--apply` to merge remote data into local:

```bash
# Dry-run: fetch + display only (safe, no local changes)
GITHUB_TOKEN=ghp_xxx solo-cto-agent sync --org myorg --repos app1,app2

# Apply: merge remote error patterns + update local agent scores
GITHUB_TOKEN=ghp_xxx solo-cto-agent sync --org myorg --repos app1,app2 --apply
```

What it fetches and updates (with `--apply`):

| Data | Source | Local file |
|---|---|---|
| Agent scores | `ops/orchestrator/agent-scores.json` | `~/.claude/skills/solo-cto-agent/agent-scores-local.json` |
| Workflow runs | GitHub Actions API | displayed in sync output |
| PR reviews | Pull request review API | displayed in sync output |
| Visual baselines | `ops/orchestrator/visual-baselines.json` | displayed in sync output |
| Error patterns | Remote failure-catalog | merged into local `failure-catalog.json` |

After syncing, `solo-cto-agent status` shows when data was last synced and how many agents are tracked locally.

### Agent Score Personalization (CTO tier)

`agent-scores.json` auto-updates on every PR event, review, and CI run. Scores are tracked globally and per-repo (`by_repo`), so the routing engine learns which agent performs better on which project. History is kept for trend analysis, and feedback patterns from `repository_dispatch` events feed into personalization. Over time the system routes work to the best-performing agent for each repo.

### Multi-Agent Extensibility (CTO tier)

The routing engine (`ops/orchestrator/routing-engine.js`) dynamically adapts to the number of registered agents. Builder tier ships with Claude-only `agent-scores.json` and `routing-policy.json` (default: `single-agent` mode). CTO tier ships with Claude + Codex dual-agent config. To add a third agent (e.g., Cursor Agent, Copilot), extend `agent-scores.json` with the new agent's metrics and add a corresponding workflow. The routing engine auto-detects registered agents and skips dual-agent logic when only one agent exists.

### Secrets Summary

| Secret | Builder | CTO | Where to get |
|---|---|---|---|
| `ORCHESTRATOR_PAT` | Required | Required | github.com/settings/tokens (scope: repo + workflow) |
| `ANTHROPIC_API_KEY` | Required | Required | console.anthropic.com |
| `OPENAI_API_KEY` | — | Required | platform.openai.com/api-keys |
| `TELEGRAM_BOT_TOKEN` | Optional | Optional | t.me/BotFather |
| `TELEGRAM_CHAT_ID` | Optional | Optional | Telegram API |
| `GITHUB_TOKEN` | Auto | Auto | Provided by GitHub Actions |

Not CI/CD secrets (app-level only, set in your hosting dashboard separately): `VERCEL_TOKEN`, `SUPABASE_*`, Cursor OpenAI key, `gh` CLI.

---

## 5-Minute Quick Start

Three steps, under two minutes:

1) Install with interactive wizard (recommended)
```bash
npx solo-cto-agent init --wizard
```
The wizard asks about your stack (framework, deploy target, database, etc.) and generates a configured `SKILL.md` automatically. No manual placeholder editing needed.

Or install without wizard and edit manually:
```bash
npx solo-cto-agent init --preset builder
# Then open ~/.claude/skills/solo-cto-agent/SKILL.md and replace {{YOUR_*}} placeholders
```

2) Verify
```bash
solo-cto-agent status
```

3) (Optional) Sync CI/CD data
```bash
GITHUB_TOKEN=ghp_xxx solo-cto-agent sync --org myorg           # preview (dry-run)
GITHUB_TOKEN=ghp_xxx solo-cto-agent sync --org myorg --apply   # merge remote → local
```

Presets:
- `maker` = spark + review + memory + craft
- `builder` (default) = maker + build + ship
- `cto` = builder + orchestrate

### Pipeline Setup (CI/CD Automation)

After installing skills, deploy the full CI/CD pipeline:

```bash
# Builder tier (single-agent: Claude)
npx solo-cto-agent setup-pipeline --org myorg --repos myapp1,myapp2

# CTO tier (multi-agent: Claude + Codex + cross-review)
npx solo-cto-agent setup-pipeline --org myorg --tier cto --repos myapp1,myapp2,myapp3
```

Or use the bash script:
```bash
bash setup.sh --org myorg --tier cto --repos myapp1,myapp2
```

## Demo

![CLI demo](docs/demo.svg)

## Cowork Working Model

The system supports two working models depending on your API keys and workflow preference.

### Mode A: Cowork Solo (Claude only)

Everything runs locally via the Anthropic API. No GitHub Actions required.

```text
You write code
  → solo-cto-agent review          # Claude reviews your staged changes
  → solo-cto-agent knowledge       # extracts decisions into knowledge articles
  → solo-cto-agent sync --org X    # fetches remote CI data (dry-run by default)
  → git push                       # GitHub Actions (if set up) handles the rest
```

Requirements: `ANTHROPIC_API_KEY` only. This mode is ideal for Cowork Desktop users who want local review + memory without CI/CD infrastructure.

What you get locally without CI/CD: code review, error pattern matching against failure catalog, session decision capture, knowledge article generation. What requires CI/CD: cross-repo dispatch, automated rework cycles, visual regression, agent score tracking.

### Mode B: Cowork + Codex Dual

Both Claude and OpenAI review your code independently, then the system cross-compares.

```text
You write code
  → solo-cto-agent review          # auto-detects both keys, runs dual review
  → Claude reviews                 # via Anthropic API
  → OpenAI reviews                 # via OpenAI API
  → Cross-comparison report        # agreements, disagreements, final verdict
```

Requirements: `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`. Use `--solo` flag to force Claude-only mode even when both keys are set.

The dual mode surfaces issues that one agent misses — Claude tends to catch architectural concerns while OpenAI tends to catch implementation bugs. Disagreements between agents are the most valuable signal.

### Semi-Automatic Sync

The `sync` command solves the local↔remote gap without requiring webhooks:

```text
Local (Cowork)                         Remote (GitHub Actions)
─────────────────                      ──────────────────────
failure-catalog.json  ← sync --apply → failure-catalog.json
agent-scores-local.json  ← sync ────→ agent-scores.json
reviews/ (local)         ← sync ────→ workflow runs, PR reviews
knowledge/               (local only)  (no remote equivalent)
```

Sync is read-only by default (`dry-run`). Add `--apply` to merge remote error patterns into local. This is intentional — automatic merging without review is risky.

## Architecture

```mermaid
graph TD
  subgraph "Session Start"
    A[autopilot.md] --> B[Load context + templates]
  end

  subgraph "Skills"
    C[build] --> D[ship]
    E[spark] --> F[review]
    G[craft]
    H[memory]
    I[orchestrate]
  end

  subgraph "Error Recovery"
    J[failure-catalog.json] --> K[Pattern match]
    K --> L{Fix found?}
    L -->|yes| M[Apply + verify]
    L -->|no, 3 tries| N[Stop + report]
  end

  B --> C
  B --> E
  D --> J
  M --> D
  H --> B
```

## Install

### npm (recommended)

```bash
npm install -g solo-cto-agent
solo-cto-agent init
```

### Maintainer note (publish)

Publishing requires either:
- an Automation token with Bypass 2FA enabled, or
- a 6-digit OTP from an Authenticator app

### Quick install (Claude Code)

```bash
curl -sSL https://raw.githubusercontent.com/seunghunbae-3svs/solo-cto-agent/main/setup.sh | bash
```

### Manual install

```bash
git clone https://github.com/seunghunbae-3svs/solo-cto-agent.git
cp -r solo-cto-agent/skills/* ~/.claude/skills/
cat solo-cto-agent/autopilot.md >> ~/.claude/CLAUDE.md
```

### Only want one skill?

```bash
cp -r solo-cto-agent/skills/build ~/.claude/skills/
```

Then open the skill file and replace the placeholders with your actual stack. Example:

```text
{{YOUR_OS}}        -> macOS / Windows / Linux
{{YOUR_EDITOR}}    -> Cursor / VSCode / etc.
{{YOUR_DEPLOY}}    -> Vercel / Railway / Netlify / etc.
{{YOUR_FRAMEWORK}} -> Next.js / Remix / SvelteKit / etc.
```

### Using with Cowork + Codex

Codex is a first-class target. Use the SKILL.md files directly as your instruction source. No extra Codex-specific files are required.

### Using with Codex, Cursor, Windsurf, or Copilot

If you use Codex, Cursor, Windsurf, or GitHub Copilot instead of (or alongside) Claude, the repo includes native rule files:

* `.cursorrules` - Cursor reads this from your project root automatically
* `.windsurfrules` - Windsurf (Cascade) reads this from your project root automatically
* `.github/copilot-instructions.md` - GitHub Copilot reads this as workspace-level instructions

Just copy the files you need into your project:

```bash
cp solo-cto-agent/.cursorrules ./
cp solo-cto-agent/.windsurfrules ./
cp -r solo-cto-agent/.github ./
```

These files contain the same CTO philosophy as the Claude skills - autonomy levels, build discipline, design standards, review rules - adapted to each tool's format. They are not watered-down versions. They are the same operating system, just in a different config file.

## How I use autonomy

Most agent workflows feel too timid in the wrong places and too reckless in the dangerous ones. So I split behavior into 3 levels.

### L1 - just do it

Small, low-risk work should not need approval. Examples:

* fixing typos
* creating obvious files
* loading context
* choosing an output format
* doing routine search or setup checks

### L2 - do it, then explain

If something is a bit ambiguous but still low-risk, the agent makes the best assumption, does the work, and tells me what it assumed. That is usually better than spending 10 messages clarifying something that could have been resolved in one pass.

### L3 - ask first

Some things still need explicit approval:

* production deploys
* schema changes
* cost-increasing decisions
* anything sent under my name
* actions that could cause irreversible damage

That split has worked much better for me than asking permission every 30 seconds.

## Skills

### build

This is the one I use most. Its job is to reduce the annoying parts of implementation work:

* check prerequisites before coding
* catch missing env vars, packages, migrations, or config earlier
* keep scope from drifting
* stop repeated error loops
* keep build and deploy problems from bouncing back to the user too quickly

The core idea is simple:

> do more of the setup thinking before writing code, not after something fails.

### ship

The job is not done when the code is written. It is done when the deploy works.

This skill treats deploy failures as part of the work:

* monitor the build
* read the logs
* try reasonable fixes
* stop when a circuit breaker is hit
* escalate clearly instead of spiraling

### craft

This exists because AI-generated UI often has a very obvious look. Too many gradients. Too much rounded everything. Too many generic SaaS defaults that look "fine" but still feel cheap.

This skill is an opinionated design filter:

* typography rules
* color discipline
* spacing consistency
* motion sanity
* anti-slop checks

It does not guarantee great design, but it helps avoid lazy AI design.

### spark

For idea work, I wanted something better than "this market is huge."

This skill takes an early idea and forces it through structure:

* market scan
* competitors
* unit economics
* scenarios
* risk framing
* PRD direction

Useful when an idea is still vague but you need something more testable.

### review

This skill is intentionally not friendly. It looks at a plan from three perspectives:

* investor
* target user
* smart competitor

The point is to expose weak points early, not to make the founder feel good.

### memory

This is for reducing repeat explanation and preserving useful context.

Not everything needs to be remembered forever. But decisions, repeated failure patterns, and project context should not disappear every session.

## Skill slimming

When skills grow past 150 lines, most of that weight is reference data the agent doesn't need on every activation. The `references/` pattern splits hot-path logic from cold-path data, cutting token costs by 58-79% per skill without losing functionality.

See [docs/skill-slimming.md](docs/skill-slimming.md) for the pattern, measured results, and how to apply it.

## Feedback and personalization

The system learns from CI/CD events automatically, but you can accelerate it with explicit feedback. See [docs/feedback-guide.md](docs/feedback-guide.md) for how to send feedback, what categories exist, and how the routing engine uses it.

## Design principles

### Agent does the work, user makes decisions

If the agent can reasonably figure something out, it should do that. The user should spend time on judgment calls, not repetitive setup.

### Risks before strengths

Good review starts with what is broken, vague, or contradictory. Praise comes after that.

### Facts over vibes

If a number appears, it should have a source, a formula, or a clear label like:

* `[confirmed]`
* `[estimated]`
* `[unverified]`

### Pre-scan, don't surprise

A lot of agent frustration comes from late discovery: missing env vars, missing package installs, missing DB changes, missing credentials. This pack tries to catch those earlier.

### Keep the loop bounded

If the same problem keeps happening, stop and report clearly. An agent that loops forever is worse than one that asks for help.

## What this is not

This is not:

* a hosted product
* a full framework
* a universal standard for agent behavior
* a replacement for technical judgment

It is just a set of operating rules that worked well enough for me to package and share.

## Recommended first use

If you want to try this without changing your whole workflow:

1. install only `build` and `review`
2. replace the stack placeholders
3. use them on one real feature or bug
4. see whether the agent becomes more useful or just more opinionated

That is the easiest way to tell whether this fits how you work.

## License

MIT - fork it, modify it, ship it.


---

## Post-install verification

After installation, verify the pack works:

1. Check skills exist in your agent directory (e.g. `~/.claude/skills`)
2. Confirm each skill has valid frontmatter (`---` block)
3. Run a simple prompt like "Use build to fix a TypeScript error"
4. Run `bash scripts/validate.sh` to check file integrity
5. Confirm no auto-merge or deploy happens without approval

If something fails, re-run `setup.sh --update` and check again.


---

## Sample output

**Build (preflight + fix)**
```
[build] pre-scan: missing env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
[build] request: please provide the 2 keys above before proceeding
[build] applied: fixed prisma client mismatch
[build] build: npm run build -> OK
[build] report: 3 files changed, 1 risk flagged, rollback path noted
```

**Review + rework**
```
[review] Codex: REQUEST_CHANGES (blocker: missing RLS policy)
[review] Claude: APPROVE (nits: copy, spacing)
[rework] round 1/2 -> fixed RLS policy + added tests
[decision] recommendation: HOLD until preview verified
```


---

## FAQ

**Q: Do I need all six skills?**
A: No. Start with `build` and `review`. Add the others if you find yourself wanting them. Each skill is independent.

**Q: Why does the agent stop retrying after 3 attempts?**
A: Infinite loops waste more time than they save. If something fails 3 times, the agent summarizes what it knows and hands control back to you.

**Q: Why is the design skill so opinionated?**
A: Because default AI output tends toward the same rounded-gradient look. The rules push for more intentional choices. Override whatever doesn't fit your taste.

**Q: Does this work in Cursor/Windsurf?**
A: Yes. The repo includes native config files for each. The core philosophy is the same across all tools.

**Q: Why a separate orchestrator repo?**
A: The orchestrator holds cross-repo logic (agent routing, score tracking, visual baselines, daily briefings) that doesn't belong in any single product repo. It dispatches workflows across your product repos and collects results centrally. If you only have one product repo, you can still use it — the separation keeps CI/CD config out of your application code.

**Q: How much do the API calls cost?**
A: Typical per-PR cost depends on your review depth. A Claude auto-review of a medium PR (under 500 lines changed) uses roughly 5K–15K input tokens and 1K–3K output tokens. At Anthropic's Sonnet pricing that is well under $0.10 per review. If you add Codex cross-review (CTO tier), add roughly $0.05–0.15 per review for the OpenAI side. A solo dev doing 2-3 PRs per day can stay comfortably under $5/month on Anthropic and $5/month on OpenAI. Visual checks (Playwright screenshots) use no API tokens — they run in GitHub Actions compute only.

**Q: Can I use this without GitHub Actions?**
A: The skills (init, build, review, craft, etc.) work independently of CI/CD. You can install them and use them in your editor without ever running setup-pipeline. The CI/CD automation is an optional layer on top.

**Q: How do I keep local skill data in sync with CI/CD results?**
A: Run `solo-cto-agent sync --org <your-org>`. This fetches agent scores, workflow results, PR reviews, and error patterns from your orchestrator repo via the GitHub API. By default it runs in dry-run mode (display only). Add `--apply` to merge remote data into local files. This way you always preview what will change before any local files are modified.

**Q: What does a real review look like?**
A: Here is a trimmed example from a production PR review:

```
[claude-review] PR #42 — Add group-buying countdown timer
  ⚠️ CHANGES_REQUESTED
  - Missing error boundary around countdown component
  - useEffect cleanup not handling unmount (memory leak risk)
  - Hardcoded timezone offset — use Intl.DateTimeFormat instead
  - Price calculation should use Decimal, not float
  ✅ Good: proper loading states, accessible aria-labels
```

The review targets real issues (memory leaks, timezone bugs, floating-point money) rather than style nits.

**Q: What happens on Day 1 with no data?**
A: Everything works — skills activate, build checks run, reviews trigger. The system starts empty and accumulates value over time. Agent scores begin tracking from the first PR. Error patterns grow as the failure catalog catches new issues. By session 10+ you will notice fewer repeated errors and more context-aware reviews.

**Q: Does this make network calls automatically?**
A: No. `status` reads only local files. `sync` is manual and opt-in — you run it explicitly when you want CI/CD data pulled from GitHub. Error pattern merging from `sync` is dry-run by default; use `sync --apply` to actually write changes. No background network activity, no telemetry.
