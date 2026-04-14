# solo-cto-agent

[![npm](https://img.shields.io/npm/v/solo-cto-agent)](https://www.npmjs.com/package/solo-cto-agent)
[![Package Validate](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/package-validate.yml/badge.svg)](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/package-validate.yml)
[![Test](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/test.yml/badge.svg)](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/test.yml)
[![Changelog](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/changelog.yml/badge.svg)](https://github.com/seunghunbae-3svs/solo-cto-agent/actions/workflows/changelog.yml)
[![License](https://img.shields.io/github/license/seunghunbae-3svs/solo-cto-agent)](LICENSE)

> **Languages**: English (primary) 쨌 [?쒓뎅???붿빟](#?쒓뎅???붿빟-korean-summary) below.

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

Primary workflow: **Claude Cowork + OpenAI Codex**. This is the only supported combination, and the rest of this document assumes Cowork + Codex.

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

---

## Tool entry points

The agent is organised around **per-tool entry points**. Start from the doc for the tool you actually use.

| Tool | Entry point | Status |
|---|---|---|
| **Claude** (Cowork + CLI) | [`docs/claude.md`](docs/claude.md) | Supported (primary) |
| Cursor | — | Not yet. Planned as this grows. |
| Windsurf | — | Not yet. Planned as this grows. |
| GitHub Copilot | — | Not yet. Planned as this grows. |

Right now Claude is the only supported execution surface. Other tools are on the roadmap and will get their own entry points as they land — each with its own install, invocation pattern, and compatible skill subset. The repo's core skills (`review`, `build`, `ship`, `memory`, `craft`, `spark`) are written to be tool-agnostic; the entry-point docs are the place where the per-tool glue lives.

## Examples

Real-world flows, four-part shape (input → agent behavior → output → pain reduced). Start with whichever subfolder matches your bottleneck:

- [`examples/build/`](examples/build/) — writing features, escaping recurring error loops
- [`examples/ship/`](examples/ship/) — pre-deploy env lint, idempotent release pipeline
- [`examples/review/`](examples/review/) — dual-review blockers, UI/UX vision gates
- [`examples/founder-workflow/`](examples/founder-workflow/) — session brief, idea critique

See [`examples/README.md`](examples/README.md) for the full index.

---

## ?쒓뎅???붿빟 (Korean summary)

> ?곸뼱媛 湲곕낯 臾몄꽌?닿퀬, ?꾨옒???듭떖留??붿빟???쒓뎅??踰꾩쟾?낅땲?? ?꾩껜 紐낆꽭?????곸뼱 蹂몃Ц???곗꽑 李멸퀬?섏꽭??

### ?닿쾶 萸먯빞

`solo-cto-agent` ??**Claude Cowork + OpenAI Codex** 議고빀??湲곕낯?쇰줈 ?섎뒗, ?붾줈 ?뚯슫??쨌 ?몃뵒?댁빱 쨌 ?뚭퇋紐?????꾪븳 AI 肄붾뵫 ?먯씠?꾪듃??skill pack ?낅땲?? "肄붾뱶瑜?????곕뒗 ?꾧뎄" 媛 ?꾨땲??"洹?肄붾뱶瑜??섎윭??CTO ?섏????〓Т瑜?????뚮젮二쇰뒗 loop" 媛 紐⑹쟻?낅땲??

- 媛숈? 鍮뚮뱶 ?먮윭瑜?臾댄븳 諛섎났?섏? ?딅룄濡?**circuit breaker** 濡?猷⑦봽瑜??딄퀬 ?붿빟?⑸땲??
- ?몄뀡留덈떎 ?ㅽ깮???ㅼ떆 ?ㅻ챸???꾩슂媛 ?녿룄濡?**以묒슂??寃곗젙?ы빆???ъ궗??* ?⑸땲??
- 由щ럭媛 "醫뗭븘 蹂댁뿬?? 濡??앸굹吏 ?딅룄濡?**?먭린 援먯감 由щ럭 (self cross-review) + dual-review (Cowork+Codex)** 瑜?媛뺤젣?⑸땲??
- AI ???섎뒗 ?붿옄?몄쓣 ?↔린 ?꾪븳 **UI/UX 媛먯떆 skill** ???ы븿?⑸땲??
- 由ъ뒪????? ?묒뾽? 留ㅻ쾲 ?덈씫??諛쏆? ?딄퀬 agent 媛 癒쇱? 泥섎━?⑸땲??

### ?꾧뎄?먭쾶 留욌굹

- 嫄곗쓽 ?쇱옄 鍮뚮뱶?섍굅??2-3紐????寃쎌슦.
- Claude Cowork (?좏깮?곸쑝濡?Codex) 媛 ?대? 二??뚰겕?뚮줈?곗씤 寃쎌슦.
- ?뷀꽣?꾨씪?댁쫰 ?섏???媛뺥븳 ?뱀씤 泥닿퀎媛 ?꾩슂????먮뒗 留욎? ?딆뒿?덈떎.

### 鍮좊Ⅸ ?쒖옉

```bash
# ??踰덈쭔: 湲濡쒕쾶 ?꾨━???ㅼ튂
npx solo-cto-agent init --wizard

# 留?由щ럭 (staged 蹂寃?湲곗?)
npx solo-cto-agent review

# Codex ?ㅺ? ?덉쓣 ?????쒕줈 ?ㅻⅨ 紐⑤뜽 ?⑤?由ъ쓽 援먯감 寃利?
npx solo-cto-agent dual-review
```

?먯꽭???ㅼ튂/?댁쁺 媛?대뱶: [`docs/cowork-main-install.md`](docs/cowork-main-install.md) ???쒓뎅??蹂몃Ц.

### Tier 異?(湲곕뒫 踰붿쐞)

| Tier | 踰붿쐞 | ?꾩슂????|
|---|---|---|
| **Maker** | review 쨌 knowledge 쨌 session | `ANTHROPIC_API_KEY` |
| **Builder** (default) | Maker + build 쨌 ship 쨌 apply-fixes 쨌 watch 쨌 notify | ??+ (?좏깮) `OPENAI_API_KEY` |
| **CTO** | Builder + orchestrate 쨌 routing-engine 쨌 dual-review | ??????+ 沅뚯옣: CI |

Tier ?곸꽭 ?뺤쓽: [`docs/tier-matrix.md`](docs/tier-matrix.md) (?쒓? 蹂몃Ц).

### ?몃? 猷⑦봽 ?뺤콉 (Self-loop 寃쎄퀬)

由щ럭瑜?**?먭린 ?쇱옄 ??diff 瑜??먭린 ??紐낆씠 蹂몃떎** 硫?blind spot ??諛섎났?⑸땲?? 蹂??⑦궎吏????媛吏 ?몃? ?좏샇 (T1 peer model 쨌 T2 external knowledge 쨌 T3 ground truth) 瑜?媛먯???遺議깊븯硫?寃쎄퀬?⑸땲?? ?꾩껜 ?뺤콉: [`docs/external-loop-policy.md`](docs/external-loop-policy.md).

### ?듭떖 臾몄꽌 諛붾줈媛湲?

- **Claude 도구 엔트리 (primary):** [`docs/claude.md`](docs/claude.md) — 이 레포의 기본 진입점. 설치 · 키 · tier · 루프 개요.
- **실사용 예시 (`examples/`):** [`examples/README.md`](examples/README.md) — build / ship / review / founder-workflow 시나리오. 입력 → agent 동작 → 출력 → 줄어든 문제.
- 설치/운영 상세 (한글): [`docs/cowork-main-install.md`](docs/cowork-main-install.md)
- Tier 정의 (한글): [`docs/tier-matrix.md`](docs/tier-matrix.md)
- Tier 사용 예 (한글): [`docs/tier-examples.md`](docs/tier-examples.md)
- CTO 운영 정책 (한글): [`docs/cto-policy.md`](docs/cto-policy.md)
- 외부 루프 정책 (영문): [`docs/external-loop-policy.md`](docs/external-loop-policy.md)
- 피드백 가이드 (영문): [`docs/feedback-guide.md`](docs/feedback-guide.md)
- Skill slimming 패턴 (영문): [`docs/skill-slimming.md`](docs/skill-slimming.md)

---

## What's inside

```text
solo-cto-agent/
?쒋?? autopilot.md
?쒋?? skills/
??  ?쒋?? build/
??  ??  ?붴?? SKILL.md
??  ?쒋?? ship/
??  ??  ?붴?? SKILL.md
??  ?쒋?? craft/
??  ??  ?붴?? SKILL.md
??  ?쒋?? spark/
??  ??  ?붴?? SKILL.md
??  ?쒋?? review/
??  ??  ?붴?? SKILL.md
??  ?붴?? memory/
??      ?붴?? SKILL.md
?붴?? templates/
    ?쒋?? project.md
    ?붴?? context.md
```

## Three Axes ??Tier 횞 Agent 횞 Mode

`solo-cto-agent` ???ㅼ젙? **?쒕줈 ?낅┰?곸씤 ??異?*??議고빀?대떎. ?섎굹留?怨좊Ⅴ??寃??꾨땲???뗭쓣 媛곴컖 ?좏깮?쒕떎.

| 異?| ?섎? | 媛?|
|---|---|---|
| **Tier** (湲곕뒫 ?덈꺼) | ?대뼡 ?ㅽ궗/湲곕뒫 踰붿쐞瑜???寃껋씤媛 | `Maker` / `Builder` / `CTO` |
| **Agent** (?먯씠?꾪듃 援ъ꽦) | ?꾧? ?묒뾽/由щ럭?섎뒗媛 | `Cowork` (Claude ?⑤룆) / `Cowork + Codex` (Dual) |
| **Mode** (?먮룞??紐⑤뱶) | ?몄젣 ?대뵒???먮룞?쇰줈 ?뚮┫ 寃껋씤媛 | `Semi-auto` = cowork-main / `Full-auto` = codex-main |

?먯젙 湲곗?, 異쒕젰 ?щ㎎, 肄붾뱶 由щ럭 泥댄겕由ъ뒪?? Circuit Breaker ?뺤콉? **??異??꾩껜?먯꽌 怨듯넻?대떎.**
李⑥씠??異뺣쭏???섎굹?????대뼡 湲곕뒫源뚯? ?곕깘 (Tier), ?꾧? 由щ럭?섎깘 (Agent), ?대뵒???먮룞?붾릺??(Mode).

> ?먯꽭???뺤쓽: `docs/tier-matrix.md` 쨌 `docs/tier-examples.md` 쨌 `docs/cto-policy.md` 쨌 `docs/cowork-main-install.md`

### Mode 異???Semi-auto vs Full-auto

| | **Semi-auto** = `cowork-main` | **Full-auto** = `codex-main` |
|---|---|---|
| **?ъ???* | Claude Cowork desktop + cloud amplifiers | ? ?먮룞 CI/CD ?뚯씠?꾨씪??|
| **?ㅽ뻾 ?꾩튂** | Claude Cowork / 濡쒖뺄 CLI | GitHub Actions |
| **?몃━嫄?* | ?먯씠?꾪듃 ?먮떒, ?ъ슜???몄텧, scheduled tasks | webhook, repository_dispatch |
| **?대씪?곕뱶 ?쒖슜** | API ?ㅺ굔 (Claude, OpenAI, GitHub, Vercel, Supabase, Figma, Drive, Slack?? | GitHub Actions ?대? ?꾧껐 |
| **?먮윭 ?⑦꽩** | `sync --apply` 濡??섎룞 癒몄? (?쇱씠釉?MCP ?щ줈?ㅼ껜?? | CI ?ㅽ뙣?먯꽌 ?먮룞 ?섏쭛 |
| **Agent scores** | ?꾩슂????sync | PR ?대깽?몃쭏???먮룞 ?낅뜲?댄듃 |
| **湲곕낯 沅뚯옣 Tier** | Maker / Builder | Builder / CTO |
| **媛???곹빀** | ?붾줈 ?뚯슫?? ?щ━?먯씠?? 硫???꾨줈?앺듃 ?댁쁺??| CI/CD ?명봽???덈뒗 ? |

**??異?怨듯넻 (agent spec parity):**

| ??ぉ | 紐⑤뱺 議고빀?먯꽌 ?숈씪 |
|---|---|
| ?먯씠?꾪듃 ?뺤껜??| CTO 湲?co-founder. ?댁떆?ㅽ꽩???꾨떂. |
| ?먯젙 遺꾨쪟 | `APPROVE` / `REQUEST_CHANGES` / `COMMENT` (?쒓?: ?뱀씤/?섏젙?붿껌/蹂대쪟) |
| ?ш컖??| `BLOCKER` ??/ `SUGGESTION` ?좑툘 / `NIT` ?뮕 |
| ?⑺듃 ?쒓퉭 | `[?뺤젙]` / `[異붿젙]` / `[誘멸?利?` |
| ?꾨쿋??而⑦뀓?ㅽ듃 | Ship-Zero Protocol + Project Dev Guide + 肄붾뵫 洹쒖튃 |
| 由щ럭 泥댄겕由ъ뒪??| 10??ぉ (import, Prisma, NextAuth, Supabase, TS, ?먮윭, 蹂댁븞, 諛고룷, Next 踰꾩쟾, Tailwind 踰꾩쟾) |
| Circuit Breaker | 3???ъ떆?? rate-limit 30s/60s/90s 諛깆삤??|
| 異쒕젰 ?щ㎎ | `[VERDICT]` / `[ISSUES]` / `[SUMMARY]` / `[NEXT ACTION]` |

> ?쒖? 紐낆꽭: `skills/_shared/agent-spec.md`
> ?꾨쿋??而⑦뀓?ㅽ듃: `skills/_shared/skill-context.md`

```bash
npx solo-cto-agent init --wizard
# Prompts: Choose mode ??[1] codex-main  [2] cowork-main
```

### Semi-auto mode (`cowork-main`) ??Desktop-Native AI CTO

Semi-auto mode runs **inside Claude Cowork** as a self-contained AI CTO. Cowork agent 猷⑦봽 ?먯껜媛 ?먮룞???붿쭊?닿퀬, MCP 而ㅻ꽖?걔톣eb search쨌scheduled tasks 媛숈? cloud amplifier 瑜???뼱 ?덉쭏???꾩꽦?쒕떎. CI, webhook ?꾩슂 ?놁쓬.

Agent 異뺤? Mode ? ?낅┰?대떎 ??Semi-auto ?덉뿉?쒕룄 Cowork ?⑤룆 / Cowork+Codex ????媛??(???좊Т濡??먮룞 媛먯?).

> **Full guide:** [`docs/cowork-main-install.md`](docs/cowork-main-install.md) ??3異??ㅻ챸, install, daily workflow, cloud amplifiers, 媛쒖씤?? env vars, troubleshooting.

**Default posture:** remote side-effects OFF. In-session agent automation ON. Every remote operation (`sync --apply`, PR push) is opt-in.

| Command | Behavior |
|---|---|
| `solo-cto-agent review` | Local Claude review of `git diff` (staged / branch / file). No GitHub required. Supports `--json` / `--markdown` / `--solo` / `--dry-run`. |
| `solo-cto-agent dual-review` | Claude + OpenAI cross-review locally. Auto-enabled when both keys present. |
| `solo-cto-agent uiux-review code\|vision\|cross-verify\|baseline\|tokens` | UI/UX review ??diff code audit, vision 6-axis scoring (layout / typography / spacing / color / a11y / polish), code ??vision cross-verify, screenshot baseline diff, design-token extraction. |
| `solo-cto-agent apply-fixes --review <file.json>` | Parse `[FIX]` blocks from review JSON, validate with `git apply --check`, apply with `--apply` (clean-tree required). `--only BLOCKER,SUGGESTION`, `--max-fixes 5` circuit-breaker. |
| `solo-cto-agent feedback accept\|reject --location <path>` | Record accept/reject verdicts into personalization ??down/up-weights future reviews (80/20 anti-bias rotation). `feedback show` displays accumulated patterns. |
| `solo-cto-agent watch [--auto] [--force]` | File watcher with tier gate. Only CTO tier + cowork+codex gets `--auto` by default (maker/builder manual-only, CTO+cowork-only needs `--force`). Emits scheduled-tasks manifest for Cowork MCP pickup. |
| `solo-cto-agent notify --title <t> [--channels slack,telegram]` | Outbound notification to Slack / Telegram / Discord / file / console. Auto-detects channels from env vars. |
| `solo-cto-agent knowledge` | Extract decisions / error patterns from recent commits into local knowledge articles. |
| `solo-cto-agent sync --org <org>` | **Dry-run by default.** Fetch agent-scores / error-patterns from orchestrator repo and display. |
| `solo-cto-agent sync --org <org> --apply` | Merge remote data into local cache. |
| `solo-cto-agent session save/restore/list` | Local session context ??survives across Claude Code / Cowork sessions. |
| `solo-cto-agent doctor` | One-pass health check: skills, engine, API keys, lint, sync, catalog. |
| `solo-cto-agent status` | Local cache only ??no network calls. |

#### Phase roadmap

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** | Manual pull (`sync` dry-run default), local-cache `status`, `doctor`, session context | ??current |
| **Phase 2** | CI/CD post-run auto-commits `agent-scores.json` + error patterns to orchestrator repo ??manual `sync` always gets fresh data | planned |
| **Phase 3** | Opt-in auto-sync at session start (`auto_sync: true` in SKILL.md) for power users | planned |

## Tier 異???Maker / Builder / CTO

Tier ??**?대뼡 湲곕뒫/?ㅽ궗 踰붿쐞瑜???寃껋씤媛** 瑜?寃곗젙?섎뒗 異뺤씠?? Agent 援ъ꽦 쨌 Mode ????낅┰?곸쑝濡??좏깮?쒕떎.
?곸꽭 ?뺤쓽??`docs/tier-matrix.md` 李몄“.

| Tier | ?ы븿 ?ㅽ궗 | 湲곕낯 Agent 沅뚯옣 | Mode 沅뚯옣 |
|---|---|---|---|
| **Maker** | spark / review / memory / craft | Cowork ?⑤룆 | Semi-auto |
| **Builder** (default) | Maker + build + ship | Cowork ?⑤룆 ?먮뒗 Cowork+Codex | Semi-auto ?먮뒗 Full-auto |
| **CTO** | Builder + orchestrate | Cowork+Codex (?뺤콉) | Full-auto (?뺤콉, `docs/cto-policy.md`) |

?꾨옒??Builder / CTO Tier ??? ?ㅽ럺 ??Maker ??媛?대뱶 ?뚰겕?뚮줈??以묒떖?대씪 蹂꾨룄 ?명봽???붽뎄 ?놁쓬.

### Builder (Lv4) ??Single-Agent, Default

For solo devs who want Claude reviewing every PR automatically. One agent, no extra infrastructure.

| What you get | Details |
|---|---|
| Agent | Claude (single) |
| Product repo workflows | 3 core + 1 optional (telegram) |
| Orchestrator workflows | 8 (single-agent only) |
| Skills | spark, review, memory, craft, build, ship |
| Required secrets | `ORCHESTRATOR_PAT`, `ANTHROPIC_API_KEY` |
| Optional secrets | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |

Product repo automation: PR opened ??Claude auto-review ??preview summary ??rework cycle on review feedback.

### CTO (Lv5+6) ??Multi-Agent

For teams or power users who want agents competing and cross-checking each other. Claude + Codex by default, with a routing-engine designed to accept custom agents if you want to extend it.

| What you get | Details |
|---|---|
| Agents | Claude + Codex (extensible via `agent-scores.json`) |
| Product repo workflows | 7 core + 1 optional (telegram) |
| Orchestrator workflows | 24 (8 base + 16 multi-agent & pro) |
| Skills | all Builder skills + orchestrate |
| Required secrets | `ORCHESTRATOR_PAT`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |
| Optional secrets | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Extra features | UI/UX 4-stage quality gate, daily briefings, decision tracking, agent scoring, comparison reports |

Product repo automation: PR opened ??Claude + Codex both review ??cross-review each other ??comparison report ??rework dispatch on issues ??optional Telegram notifications.

### What CTO adds over Builder

| Capability | Builder (Lv4) | CTO (Lv5+6) |
|---|---|---|
| Claude auto-review | Yes | Yes |
| Codex auto-review | ??| Yes |
| Cross-review (agents review each other) | ??| Yes |
| Comparison reports | ??| Yes |
| Agent score tracking | ??| Yes |
| UI/UX quality gate (4-stage) | ??| Yes |
| Visual regression (Playwright + Vision) | Scheduled | Scheduled + PR-triggered |
| Daily briefings | ??| Yes |
| Decision queue + insights | ??| Yes |
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
solo-cto-agent review --branch --dry-run

# Review a branch diff against a specific base (e.g., master)
solo-cto-agent review --branch --target master

# Review specific file
solo-cto-agent review --file src/app/page.tsx
```

The review checks your diff against the local failure catalog (known error patterns), then sends it to Claude for security, performance, correctness, and style analysis. Results are saved as markdown reports in `~/.claude/skills/solo-cto-agent/reviews/`. This is the same review quality as the CI/CD pipeline, but runs entirely locally ??useful for private repos, offline work, or pre-push checks.

### Local Code Review (Both tiers)

Run multi-agent code review locally without GitHub Actions:

```bash
# Claude review of staged changes (default)
ANTHROPIC_API_KEY=sk-xxx solo-cto-agent review --staged

# Claude review of branch diff vs default branch (auto-detects main/master/develop)
ANTHROPIC_API_KEY=sk-xxx solo-cto-agent review --branch

# Explicit base branch
ANTHROPIC_API_KEY=sk-xxx solo-cto-agent review --branch --target develop

# Dual-agent review (Claude + GPT) ??auto-enabled when both keys present
ANTHROPIC_API_KEY=sk-xxx OPENAI_API_KEY=sk-xxx solo-cto-agent review --branch

# Force Claude-only even when both keys are set
ANTHROPIC_API_KEY=sk-xxx OPENAI_API_KEY=sk-xxx solo-cto-agent review --staged --solo

# Pipe-safe JSON output (banner/info routed to stderr so jq works)
solo-cto-agent review --staged --json | jq '.verdict'

# Save JSON / markdown to a file via redirect
solo-cto-agent review --staged --json > review.json
solo-cto-agent review --staged --markdown > review.md

# Dry-run ??prints prompt sizes + self-loop warning without calling the API
ANTHROPIC_API_KEY=sk-xxx solo-cto-agent review --staged --dry-run
```

Works completely offline from CI/CD. Claude reviews the diff first. If an OpenAI key is also set, GPT provides a second opinion and the tool cross-compares both reviews ??highlighting agreed issues (high confidence) vs. divergent findings. New error patterns found during review are automatically added to the local failure catalog.

**Ground-truth grounding (T3 ??PR-E1).** If `VERCEL_TOKEN` is set and the repo has a `.vercel/project.json` (from `vercel link`) or `VERCEL_PROJECT_ID` is exported, every `review` and `dual-review` automatically fetches the last 10 deployments and injects a `## 理쒓렐 ?꾨줈?뺤뀡 ?좏샇 (T3 Ground Truth)` block into the system prompt. The review model uses this as [?뺤젙] evidence ??for example, if there's a recent `ERROR` deployment, the review explicitly cross-checks whether the current diff might be related. This is the cheapest way to escape the pure self-loop described in [`docs/external-loop-policy.md`](docs/external-loop-policy.md) ??runtime behavior beats model opinion. Failures (missing token, unreachable API, timeout) never block the review; the section is simply omitted or marked `[誘멸?利?`.

**External knowledge (T2 ??PR-E2).** Set `COWORK_EXTERNAL_KNOWLEDGE=1` (or `COWORK_PACKAGE_REGISTRY=1`) to activate npm-registry currency checks. Every `review` scans `package.json` `dependencies` (add `COWORK_EXTERNAL_KNOWLEDGE_INCLUDE_DEV=1` for `devDependencies` too), queries `registry.npmjs.org` with 5 s timeouts and concurrency-of-6, capped at 20 packages, and injects a `## ?ㅽ깮 理쒖떊??(T2 External Knowledge)` block flagging deprecated packages, major/minor version lags. This closes the "model thinks it's still 2024" gap without any external token. Failures (registry outage, timeout, missing `package.json`) are surfaced per-package and never block the review.

**Periodic refresh (PR-E5).** External signals need to stay fresh even when no code changes. `solo-cto-agent external-loop` runs a one-shot T2 + T3 ping (no diff review, no cost) and exits with code 0 (all clear), 1 (alerts present ??deprecated packages, ERROR deployments, major-version drift), or 2 (no signals active). Use `--json` for machine output. `solo-cto-agent watch` now also emits periodic tasks into `~/.claude/skills/solo-cto-agent/scheduled-tasks.yaml`: `cowork-external-loop-daily` (24 h) when any T2/T3 signal is set, and `cowork-dual-review-weekly` (7 days) when `OPENAI_API_KEY` is set ??gated by tier/agent policy so free-tier users don't pay for unexpected dual runs.

**Inbound feedback channel (PR-E4).** External reviewers (Slack teammates, GitHub bots) can send verdicts *into* personalization without CLI access. `solo-cto-agent feedback-inbound --source slack|github|generic --payload '<json>'` (also `--payload-file` or `--stdin`) parses interactive payloads and pipes verdicts through `recordFeedback`. Slack block-kit actions use the value format `feedback|<verdict>|<location>|<severity>` (e.g. `feedback|accept|src/Btn.tsx:42|BLOCKER`) plus optional `state.values` free-text note. GitHub `repository_dispatch` events use a normalized `client_payload` (`{type, verdict, location, severity, note, actor}`) ??the legacy `category`/`detail` form is surfaced as `unrecordable` so it can't silently poison personalization. Every recorded note is wrapped as `[via <source>:<attribution>] <note>` so the audit trail survives. Host your own HTTPS endpoint (Vercel function / Cloudflare Worker / Express) that forwards the parsed body to the CLI ??Slack signature verification and auth belong in the endpoint, not in this offline tool.

### Knowledge Article Generation (Both tiers)

Auto-generates durable knowledge articles from accumulated session memory:

```bash
# Dry-run: show which articles would be generated
solo-cto-agent knowledge

# Generate articles
solo-cto-agent knowledge --apply
```

Scans `memory/episodes/`, `CONTEXT_LOG.md`, and `error-patterns.md` for topics that appear 3+ times. When a recurring pattern is detected, it generates a structured knowledge article at `memory/knowledge/{topic}.md` and updates the index. This is the Layer 2 ??Layer 3 compression that the memory skill describes but previously required manual effort.

### Local ??Remote Sync

The `sync` command bridges the gap between your local skill files and remote CI/CD results. It runs in dry-run mode by default ??fetches and displays data without modifying local files. Add `--apply` to merge remote data into local:

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

The routing engine (`ops/orchestrator/routing-engine.js`) dynamically adapts to the number of registered agents. Builder tier ships with Claude-only `agent-scores.json` and `routing-policy.json` (default: `single-agent` mode). CTO tier ships with Claude + Codex dual-agent config. To plug in a third agent, extend `agent-scores.json` with its metrics and add a corresponding workflow. The routing engine auto-detects registered agents and skips dual-agent logic when only one agent exists.

### Secrets Summary

| Secret | Builder | CTO | Where to get |
|---|---|---|---|
| `ORCHESTRATOR_PAT` | Required | Required | github.com/settings/tokens (scope: repo + workflow) |
| `ANTHROPIC_API_KEY` | Required | Required | console.anthropic.com |
| `OPENAI_API_KEY` | ??| Required | platform.openai.com/api-keys |
| `TELEGRAM_BOT_TOKEN` | Optional | Optional | t.me/BotFather |
| `TELEGRAM_CHAT_ID` | Optional | Optional | Telegram API |
| `GITHUB_TOKEN` | Auto | Auto | Provided by GitHub Actions |

Not CI/CD secrets (app-level only, set in your hosting dashboard separately): `VERCEL_TOKEN`, `SUPABASE_*`, `gh` CLI auth.

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
GITHUB_TOKEN=ghp_xxx solo-cto-agent sync --org myorg --apply   # merge remote ??local
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
  ??solo-cto-agent review          # Claude reviews your staged changes
  ??solo-cto-agent knowledge       # extracts decisions into knowledge articles
  ??solo-cto-agent sync --org X    # fetches remote CI data (dry-run by default)
  ??git push                       # GitHub Actions (if set up) handles the rest
```

Requirements: `ANTHROPIC_API_KEY` only. This mode is ideal for Cowork Desktop users who want local review + memory without CI/CD infrastructure.

What you get locally without CI/CD: code review, error pattern matching against failure catalog, session decision capture, knowledge article generation. What requires CI/CD: cross-repo dispatch, automated rework cycles, visual regression, agent score tracking.

### Mode B: Cowork + Codex Dual

Both Claude and OpenAI review your code independently, then the system cross-compares.

```text
You write code
  ??solo-cto-agent review          # auto-detects both keys, runs dual review
  ??Claude reviews                 # via Anthropic API
  ??OpenAI reviews                 # via OpenAI API
  ??Cross-comparison report        # agreements, disagreements, final verdict
```

Requirements: `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`. Use `--solo` flag to force Claude-only mode even when both keys are set.

The dual mode surfaces issues that one agent misses ??Claude tends to catch architectural concerns while OpenAI tends to catch implementation bugs. Disagreements between agents are the most valuable signal.

### Semi-Automatic Sync

The `sync` command solves the local?봱emote gap without requiring webhooks:

```text
Local (Cowork)                         Remote (GitHub Actions)
?????????????????                      ??????????????????????
failure-catalog.json  ??sync --apply ??failure-catalog.json
agent-scores-local.json  ??sync ??????agent-scores.json
reviews/ (local)         ??sync ??????workflow runs, PR reviews
knowledge/               (local only)  (no remote equivalent)
```

Sync is read-only by default (`dry-run`). Add `--apply` to merge remote error patterns into local. This is intentional ??automatic merging without review is risky.

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
{{YOUR_EDITOR}}    -> Cowork / VSCode / etc.
{{YOUR_DEPLOY}}    -> Vercel / Railway / Netlify / etc.
{{YOUR_FRAMEWORK}} -> Next.js / Remix / SvelteKit / etc.
```

### Using with Cowork + Codex

Codex is a first-class target. Use the SKILL.md files directly as your instruction source. No extra Codex-specific files are required ??Cowork reads SKILL.md natively, and Codex (via OpenAI API) is invoked through the CLI when both keys are set.


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

**Q: Does this work outside Cowork + Codex?**
A: Not officially. This repo focuses on Cowork + Codex only.

**Q: Why a separate orchestrator repo?**
A: The orchestrator holds cross-repo logic (agent routing, score tracking, visual baselines, daily briefings) that doesn't belong in any single product repo. It dispatches workflows across your product repos and collects results centrally. If you only have one product repo, you can still use it ??the separation keeps CI/CD config out of your application code.

**Q: How much do the API calls cost?**
A: Typical per-PR cost depends on your review depth. A Claude auto-review of a medium PR (under 500 lines changed) uses roughly 5K??5K input tokens and 1K??K output tokens. At Anthropic's Sonnet pricing that is well under $0.10 per review. If you add Codex cross-review (CTO tier), add roughly $0.05??.15 per review for the OpenAI side. A solo dev doing 2-3 PRs per day can stay comfortably under $5/month on Anthropic and $5/month on OpenAI. Visual checks (Playwright screenshots) use no API tokens ??they run in GitHub Actions compute only.

**Q: Can I use this without GitHub Actions?**
A: The skills (init, build, review, craft, etc.) work independently of CI/CD. You can install them and use them in your editor without ever running setup-pipeline. The CI/CD automation is an optional layer on top.

**Q: How do I keep local skill data in sync with CI/CD results?**
A: Run `solo-cto-agent sync --org <your-org>`. This fetches agent scores, workflow results, PR reviews, and error patterns from your orchestrator repo via the GitHub API. By default it runs in dry-run mode (display only). Add `--apply` to merge remote data into local files. This way you always preview what will change before any local files are modified.

**Q: What does a real review look like?**
A: Here is a trimmed example from a production PR review:

```
[claude-review] PR #42 ??Add group-buying countdown timer
  ?좑툘 CHANGES_REQUESTED
  - Missing error boundary around countdown component
  - useEffect cleanup not handling unmount (memory leak risk)
  - Hardcoded timezone offset ??use Intl.DateTimeFormat instead
  - Price calculation should use Decimal, not float
  ??Good: proper loading states, accessible aria-labels
```

The review targets real issues (memory leaks, timezone bugs, floating-point money) rather than style nits.

**Q: What happens on Day 1 with no data?**
A: Everything works ??skills activate, build checks run, reviews trigger. The system starts empty and accumulates value over time. Agent scores begin tracking from the first PR. Error patterns grow as the failure catalog catches new issues. By session 10+ you will notice fewer repeated errors and more context-aware reviews.

**Q: Does this make network calls automatically?**
A: No. `status` reads only local files. `sync` is manual and opt-in ??you run it explicitly when you want CI/CD data pulled from GitHub. Error pattern merging from `sync` is dry-run by default; use `sync --apply` to actually write changes. No background network activity, no telemetry.

---


