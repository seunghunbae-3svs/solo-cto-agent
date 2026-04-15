# solo-cto-agent

[![npm](https://img.shields.io/npm/v/solo-cto-agent)](https://www.npmjs.com/package/solo-cto-agent)
[![Package Validate](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/package-validate.yml/badge.svg)](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/package-validate.yml)
[![Test](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/test.yml/badge.svg)](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/test.yml)
[![Changelog](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/changelog.yml/badge.svg)](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/changelog.yml)
[![License](https://img.shields.io/github/license/seunghunbae-3svs/solo-cto-agent)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?style=flat&logo=github)](https://github.com/sponsors/seunghunbae-3svs)

> **Languages**: English (primary) - [한국어 안내](#한국어-안내) below.

## Quickstart (5 minutes)

```bash
# 1. Install
npm install -g solo-cto-agent

# 2. Initialize (recommended: choose mode during wizard)
npx solo-cto-agent init --wizard

# 3. Set your Anthropic API key (required for reviews)
#    Get one at: https://console.anthropic.com/settings/keys
export ANTHROPIC_API_KEY="sk-ant-..."

# 4. (Optional) Set OpenAI key for dual-review mode
#    Get one at: https://platform.openai.com/api-keys
export OPENAI_API_KEY="sk-..."

# 5. Verify everything is ready
solo-cto-agent doctor --quick

# 6. Run your first review (inside a git repo with staged changes)
solo-cto-agent review
```

That is it. `doctor --quick` will tell you what is missing, where to get it, and the next command to run.

### Platform-specific setup

**macOS / Linux**

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."   # optional for cowork-main, required for codex-main
solo-cto-agent doctor
```

**Windows PowerShell**

```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."
$env:OPENAI_API_KEY="sk-..."   # optional for cowork-main, required for codex-main
solo-cto-agent doctor
```

If you choose `codex-main` during the wizard, also install:
- GitHub CLI: [cli.github.com](https://cli.github.com/)
- GitHub PAT for cross-repo dispatch: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)

---

I made this because I got tired of using AI coding tools that were good at writing code, but still left me doing all the messy CTO work around it.

The hard part was rarely "write the feature." It was everything around the feature:

* catching missing env vars before a deploy breaks
* not re-explaining the same stack every new session
* stopping error loops before they waste half an hour
* getting honest pushback on ideas instead of empty encouragement
* cleaning up UI that looks obviously AI-generated

This repo is my attempt to package those habits into a small set of reusable skills. It is not magic. It is not a replacement for judgment. It is just a better operating system for the kind of AI agent I wanted to work with.

## What this is

`solo-cto-agent` is an opinionated CTO toolkit for solo founders, indie hackers, and small teams using AI coding agents in their build workflow.

Primary workflow: **Claude Cowork + OpenAI Codex**. Cowork-only is supported for single-agent use, but this document assumes Cowork + Codex unless noted.

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
* already use Claude Cowork (optionally with Codex) as your primary AI coding workflow
* want the agent to take more initiative
* care about startup execution, not just code completion
* are okay with opinionated defaults

It is probably not a good fit if you:

* work in a tightly locked-down enterprise environment
* do not want agents touching files or setup
* want every action manually approved
* prefer a neutral framework-agnostic starter pack with very conservative defaults

## Operating modes

Choose a mode during `init --wizard`. The same package supports both.

| Mode | Default behavior | Best for |
|---|---|---|
| **codex-main** | Full CI/CD automation (GitHub Actions, auto-review, auto-rework) | Stable GitHub Actions + webhook environments |
| **cowork-main** | Local-first with manual sync (wizard + local review/sync) | Offline work, minimal external dependencies |

**codex-main** — PR opened → Claude review → Codex cross-review → rework loop → merge conditions. Agent scores auto-updated in orchestrator repo.

**cowork-main** — Local review/learn commands work without GitHub Actions. `sync --apply` pulls latest scores/patterns when you choose.

The selected mode is saved in `~/.claude/skills/solo-cto-agent/SKILL.md`.

---

## Tool entry points

This pack is designed for Cowork + Codex. Start from the Claude entry point and expand only if you need automation.

| Tool | Entry point | Status |
|---|---|---|
| **Claude** (Cowork + CLI) | [docs/claude.md](docs/claude.md) | Supported (primary) |

Gamma users can still use the toolkit today, but **Gamma is not a core runtime**. The intended flow is:
- use `solo-cto-agent` to generate, review, tighten, and validate the content or product narrative
- move the final output into Gamma for presentation publishing

That keeps the core position stable: **Cowork + Codex are the operating surface, Gamma is a downstream publishing surface**.

## Examples

Real-world flows, four-part shape (input -> agent behavior -> output -> pain reduced). Start with whichever subfolder matches your bottleneck:

- [`examples/build/`](examples/build/) - writing features, escaping recurring error loops
- [`examples/ship/`](examples/ship/) - pre-deploy env lint, idempotent release pipeline
- [`examples/review/`](examples/review/) - dual-review blockers, UI/UX vision gates
- [`examples/founder-workflow/`](examples/founder-workflow/) - session brief, idea critique

If you want the live codex-main proof first, start here:

- [`examples/ship/codex-main-setup-on-live-project.md`](examples/ship/codex-main-setup-on-live-project.md) - real full-auto install on a private Next.js app
- [`examples/review/codex-main-live-pr-review.md`](examples/review/codex-main-live-pr-review.md) - real PR-open automation timings and outputs
- [`examples/founder-workflow/codex-main-live-rework-and-digest.md`](examples/founder-workflow/codex-main-live-rework-and-digest.md) - real rework-round comments and scheduled digest behavior

See [`examples/README.md`](examples/README.md) for the full index.

---

## 한국어 안내

`solo-cto-agent`는 Claude Cowork + OpenAI Codex 워크플로우에 최적화된 실전형 CTO 스킬팩입니다. "코드 작성" 자체가 아니라, 배포/리뷰/설계/의사결정 전반에서 더 나은 판단을 돕는 것이 목표입니다.

핵심 포인트:
- 반복되는 빌드/배포 에러는 circuit breaker가 루프를 자동 차단합니다.
- 빈말 리뷰가 아닌 dual-review + cross-check로 실질적인 블로커를 잡습니다.
- UI/UX 디자인에서 vision 체크로 뻔한 AI 디자인을 막습니다.
- 세션 큐/브리핑/메모리로 컨텍스트 손실을 줄입니다.

빠른 시작:
```bash
npm install -g solo-cto-agent
solo-cto-agent init
export ANTHROPIC_API_KEY="sk-ant-..."   # https://console.anthropic.com/settings/keys
solo-cto-agent doctor                    # 설치 상태 확인 + 누락 안내
solo-cto-agent review                    # 첫 리뷰 실행
```

가이드 링크:
- Claude 엔트리: `docs/claude.md`
- 예제 모음: `examples/README.md`
- 설치/셋업(한국어): `docs/cowork-main-install.md`
- 설정/커스터마이징: `docs/configuration.md`
- Tier 비교/예시: `docs/tier-matrix.md`, `docs/tier-examples.md`
- CTO 티어 정책: `docs/cto-policy.md`
- 외부 루프 정책: `docs/external-loop-policy.md`
- 피드백 가이드: `docs/feedback-guide.md`
- 스킬 슬리밍: `docs/skill-slimming.md`
---
## What's inside

```text
solo-cto-agent/
  autopilot.md
  skills/
    build/
      SKILL.md
    ship/
      SKILL.md
    craft/
      SKILL.md
    spark/
      SKILL.md
    review/
      SKILL.md
    memory/
      SKILL.md
  templates/
    project.md
    context.md
```

## Three Axes: Tier / Agent / Mode

`solo-cto-agent` is configured across three independent axes. You choose each based on your workflow.

| Axis | Decision | Options |
|---|---|---|
| Tier | Scope of capability | Maker / Builder / CTO |
| Agent | Who reviews | Cowork (Claude) / Cowork + Codex |
| Mode | Automation depth | Semi-auto (cowork-main) / Full-auto (codex-main) |

Quick pick if you are unsure:
- Start with Maker + Cowork + Semi-auto.
- Move to Builder when you are shipping real features.
- Move to CTO + Full-auto when you want always-on CI/CD and multi-agent routing.

### Agents (summary)

| Agent | What it means | When to use |
|---|---|---|
| Cowork (Claude) | single-agent review and fixes | cost-sensitive, fast iteration |
| Cowork + Codex | dual review + cross-check | higher confidence, higher cost |

### Modes (summary)

| | Semi-auto (cowork-main) | Full-auto (codex-main) |
|---|---|---|
| Runtime | Cowork desktop + CLI | GitHub Actions + orchestrator |
| Triggers | manual / scheduled | webhook + repository_dispatch |
| Data freshness | manual sync (dry-run default) | auto-commits scores + patterns |
| Infra | local-first, minimal | CI/CD + orchestrator repo |
| Best for | low infra, private repos | full automation, multi-repo |

Mode notes:
- Semi-auto keeps network side-effects off by default. You run `sync --apply` only when you want remote data.
- Full-auto assumes CI/CD is active and runs reviews, scoring, and reporting automatically.

Full-auto requires:
- an orchestrator repo
- GitHub Actions secrets: `ORCHESTRATOR_PAT`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- pipelines installed via `setup-pipeline` or `setup.sh`

Full-auto adds:
- auto reviews + rework dispatch
- decision queue + daily briefing
- agent scores + routing
- UI/UX quality gate + visual checks

### Tiers (summary)

**Not sure which tier? One question:**
- Are you shipping code to production? → **Builder** (default, recommended for most users)
- Only doing idea validation / reviews? → **Maker**
- Running multi-repo CI/CD with full automation? → **CTO**

| Tier | Includes | Recommended for |
|---|---|---|
| Maker | spark + review + memory + craft | idea and validation loops |
| Builder | Maker + build + ship | solo dev shipping |
| CTO | Builder + orchestrate | multi-agent + routing |

Details: `docs/tier-matrix.md`, `docs/tier-examples.md`, `docs/cto-policy.md`, `docs/cowork-main-install.md`, `docs/configuration.md`.

## Install

### npm (recommended)

```bash
npm install -g solo-cto-agent
solo-cto-agent init
```

### Platform notes

- **macOS:** supported directly. `zsh` is the default shell assumed by most examples.
- **Windows:** supported for the CLI. Use PowerShell environment variables during setup. Some Cowork-side shell snippets still assume POSIX-style commands.
- **Gamma:** supported as a downstream presentation tool for decks/docs/content, not as a primary execution surface.

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
{{YOUR_EDITOR}}    -> Cowork / VSCode / etc.
{{YOUR_DEPLOY}}    -> Vercel / Railway / Netlify / etc.
{{YOUR_FRAMEWORK}} -> Next.js / Remix / SvelteKit / etc.
```

### Using with Cowork + Codex

Codex is a first-class target. Use the SKILL.md files directly as your instruction source. No extra Codex-specific files are required - Cowork reads SKILL.md natively, and Codex (via OpenAI API) is invoked through the CLI when both keys are set.


## Shell completions

Tab completion for all commands, flags, and options.

```bash
# Bash — add to ~/.bashrc
source <(solo-cto-agent --completions bash)

# Zsh — add to ~/.zshrc
source <(solo-cto-agent --completions zsh)
```

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

## Support

If this tool saves you time, consider [sponsoring the project](https://github.com/sponsors/seunghunbae-3svs). Every contribution helps maintain and improve solo-cto-agent.

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor_on_GitHub-%E2%9D%A4-pink?style=for-the-badge&logo=github)](https://github.com/sponsors/seunghunbae-3svs)

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

**Q: Does this work outside Cowork + Codex?**
A: Yes. Provider abstraction supports any OpenAI-compatible or Anthropic-compatible API (Ollama, LM Studio, Groq, etc.). Set `OPENAI_API_BASE` or `ANTHROPIC_API_BASE` to point at your provider. See [docs/configuration.md](docs/configuration.md) for setup details.

**Q: Why a separate orchestrator repo?**
A: The orchestrator holds cross-repo logic (agent routing, score tracking, visual baselines, daily briefings) that doesn't belong in any single product repo. It dispatches workflows across your product repos and collects results centrally. If you only have one product repo, you can still use it - the separation keeps CI/CD config out of your application code.

**Q: How much do the API calls cost?**
A: Typical per-PR cost depends on your review depth. A Claude auto-review of a medium PR (under 500 lines changed) uses roughly 5K-15K input tokens and 1K-3K output tokens. At Anthropic's Sonnet pricing that is well under $0.10 per review. If you add Codex cross-review (CTO tier), add roughly $0.05-0.15 per review for the OpenAI side. A solo dev doing 2-3 PRs per day can stay comfortably under $5/month on Anthropic and $5/month on OpenAI. Visual checks (Playwright screenshots) use no API tokens - they run in GitHub Actions compute only.

**Q: How do I set up the 3-pass auto-review on my repos?**
A: Copy the workflow below to `.github/workflows/solo-cto-review.yml` in your repo and add `ANTHROPIC_API_KEY` to your repo secrets. Every PR will automatically get a 3-pass review:

- **Pass 1 — Code Review**: structure, security, performance, bugs
- **Pass 2 — Cross-Check**: validates Pass 1 findings, catches missed issues
- **Pass 3 — UI/UX Review**: accessibility, responsiveness, usability

Final verdict: **APPROVE** (merge-ready) or **REQUEST_CHANGES** (fix and push to re-trigger). See the [workflow file](examples/solo-cto-review.yml) for the full YAML.

**Q: Can I use this without GitHub Actions?**
A: The skills (init, build, review, craft, etc.) work independently of CI/CD. You can install them and use them in your editor without ever running setup-pipeline. The CI/CD automation is an optional layer on top.

**Q: How do I keep local skill data in sync with CI/CD results?**
A: Run `solo-cto-agent sync --org <your-org>`. This fetches agent scores, workflow results, PR reviews, and error patterns from your orchestrator repo via the GitHub API. By default it runs in dry-run mode (display only). Add `--apply` to merge remote data into local files. This way you always preview what will change before any local files are modified.

**Q: What does a real review look like?**
A: Here is a trimmed example from a production PR review:

```
[claude-review] PR #42 - Add group-buying countdown timer
  CHANGES_REQUESTED
  - Missing error boundary around countdown component
  - useEffect cleanup not handling unmount (memory leak risk)
  - Hardcoded timezone offset - use Intl.DateTimeFormat instead
  - Price calculation should use Decimal, not float
  Good: proper loading states, accessible aria-labels
```

The review targets real issues (memory leaks, timezone bugs, floating-point money) rather than style nits.

**Q: What happens on Day 1 with no data?**
A: Everything works - skills activate, build checks run, reviews trigger. The system starts empty and accumulates value over time. Agent scores begin tracking from the first PR. Error patterns grow as the failure catalog catches new issues. By session 10+ you will notice fewer repeated errors and more context-aware reviews.

**Q: Does this make network calls automatically?**
A: No. `status` reads only local files. `sync` is manual and opt-in - you run it explicitly when you want CI/CD data pulled from GitHub. Error pattern merging from `sync` is dry-run by default; use `sync --apply` to actually write changes. No background network activity, no telemetry.
