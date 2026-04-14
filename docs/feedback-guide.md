# Feedback Collection Guide

How the solo-cto-agent system learns from your usage and how you can actively improve it.

Feedback works differently in the two modes:

- **Semi-auto mode (cowork-main)** — Local `feedback accept|reject` CLI writes directly to personalization. No GitHub required. See §1.
- **Full-auto mode (codex-main)** — CI events + `repository_dispatch` feed `agent-scores.json` in your orchestrator repo. See §2.

> **Languages**: English (primary) · [한국어 요약](#한국어-요약) below.

---

## 한국어 요약

> 영어가 primary 입니다. 아래는 개념 요약이며 정확한 명세는 §1 이후 영문 본문을 기준으로 합니다.

**피드백은 모드에 따라 다르게 동작합니다**:

- **Semi-auto (cowork-main)** — 로컬 `feedback accept|reject` CLI 가 personalization 에 직접 씁니다. GitHub 불필요.
- **Full-auto (codex-main)** — CI 이벤트 + `repository_dispatch` 가 orchestrator repo 의 `agent-scores.json` 을 갱신합니다.

**Semi-auto CLI 사용법**:

```bash
# 진짜 버그였음 → 해당 패턴을 강화
solo-cto-agent feedback accept --location src/Btn.tsx:42 --severity BLOCKER

# agent 가 틀렸음 / 과탐지 → 해당 패턴 감점 + 노트 기록
solo-cto-agent feedback reject --location src/Nav.tsx:12 --severity SUGGESTION \
  --note "이미 memoized — false positive"

# 누적 패턴 조회
solo-cto-agent feedback show
```

**내부 동작**: 매 verdict 는 `~/.claude/skills/solo-cto-agent/personalization.json` 의 두 버킷 중 하나에 기록됩니다.

| 버킷 | 의미 | 다음 리뷰에서 |
|---|---|---|
| `acceptedPatterns` | 실제 이슈라고 확정한 위치 | 유사 발견을 더 신뢰 |
| `rejectedPatterns` | 이슈가 아니라고 반박한 위치 | 유사 발견을 감점, "가능한 false positive" 라고 표시 |

`path + severity` 기준으로 merge (같은 라인 반복 accept 은 duplicate 가 아니라 count 증가). 각 버킷은 빈도순 100 개까지.

**Anti-bias 80/20 rotation**: `personalizationContext()` 는 80% 는 exploit (hotspot/accept/reject 주입), 20% 는 explore (최소 컨텍스트 + "fresh look" 힌트). 과거 결정에 락되지 않기 위한 장치. 테스트/의도적 fresh 보기 용도로 `{ exploration: true|false }` 강제 가능.

**언제 어느 걸 쓰나**:

| 상황 | 행동 |
|---|---|
| 리뷰가 진짜 버그를 잡았고 수정함 | 해당 위치에 `feedback accept` |
| 리뷰 지적이 과했음 | `feedback reject` + `--note` 로 이유 기록 |
| agent 가 뭘 배웠는지 감사 | `feedback show` |
| 과거 패턴 무시하고 fresh 하게 보고 싶음 | `review` 다시 실행 (20% 확률 explore) 또는 env seed |

**Full-auto (codex-main) 피드백 채널 3가지** (강도순):

1. **Passive** — PR 이벤트/CI run/리뷰가 자동으로 `agent-scores.json` 갱신. 할 일 없음.
2. **Semi-passive** — `solo-cto-agent sync --org myorg --repos app1,app2` 로 원격 CI/CD 데이터를 로컬 skill 파일에 끌어옴.
3. **Active** — GitHub API `repository_dispatch` 로 명시적 피드백 이벤트 발송. 자동 점수가 놓치는 정성적 signal 용.

`repository_dispatch` 로 보낼 때 카테고리: `review-quality` / `ci-reliability` / `routing-preference` / `general`.

**피드백의 효과**: `agent-scores.json` 의 `feedback.patterns` 에 최근 100 건 저장. 5 건마다 `detectFeedbackPatterns()` 가 recent history 를 분석해 repo 별 accuracy 를 "70% 기존 + 30% 최근" 으로 갱신. 시간이 지나면 특정 repo 에 잘 맞는 agent 가 우선 선택됩니다.

---

## 1. Semi-auto mode — `feedback` CLI (cowork-main)

The primary feedback channel for cowork-main users. Every review has issues; you tell the agent which ones were accurate and which were wrong. The next review uses those patterns as personalization weights.

### Basic usage

```bash
# Agent flagged a real bug → accept (reinforce this pattern)
solo-cto-agent feedback accept --location src/Btn.tsx:42 --severity BLOCKER

# Agent was wrong / over-flagged → reject (down-weight this pattern)
solo-cto-agent feedback reject --location src/Nav.tsx:12 --severity SUGGESTION \
  --note "already memoized — false positive"

# Review accumulated patterns
solo-cto-agent feedback show
```

### What happens under the hood

Each verdict writes to `~/.claude/skills/solo-cto-agent/personalization.json` into one of two buckets:

| Bucket | Meaning | Effect on next review |
|---|---|---|
| `acceptedPatterns` | Locations where you confirmed the issue was real | Agent trusts similar findings more |
| `rejectedPatterns` | Locations where you disputed the issue | Agent down-weights similar findings, flags them as "possible false positive" |

Entries merge on `path + severity` (so repeated accepts on the same line increment a count rather than duplicating). Each bucket is capped at 100 entries sorted by frequency.

### Anti-bias rotation (80/20)

`personalizationContext()` — the function that injects accumulated patterns into the review prompt — is **not** always on. It rotates:

- **80% of calls** → full exploit mode: hotspots, accept/reject lists, style hints injected
- **20% of calls** → explore mode: minimal context, explicit "fresh look — don't over-rely on past patterns" hint

This prevents the agent from locking into past decisions and missing new issues. You can force either mode deterministically (useful in tests or when you explicitly want a fresh perspective):

```js
personalizationContext({ exploration: true })   // force explore
personalizationContext({ exploration: false })  // force exploit
```

### When to use which

| Situation | Action |
|---|---|
| Review flagged a real bug you fixed | `feedback accept` on that location |
| Review flagged something that was fine | `feedback reject` with `--note` explaining why |
| You want to audit what the agent has learned | `feedback show` |
| You want a fresh review (ignore past patterns) | Just run `review` again — 20% chance of explore mode; or for CI, seed the env so exploration triggers |

### Notification hook (optional)

Pair `feedback` with `notify` to log verdicts to a channel:

```bash
solo-cto-agent feedback reject --location src/Nav.tsx:12 --severity SUGGESTION \
  --note "false positive"
solo-cto-agent notify --title "Feedback logged" --severity info \
  --body "rejected src/Nav.tsx:12 SUGGESTION" --channels file
```

---

## 2. Full-auto mode — CI events + `repository_dispatch` (codex-main)

### How feedback works

The system collects feedback through three channels, ranked by effort required:

**Passive (zero effort):** Every PR event, CI run, and review automatically updates `agent-scores.json` in your orchestrator repo. The routing engine uses these scores to improve agent selection over time. No action needed from you.

**Semi-passive (minimal effort):** The `sync` command pulls remote CI/CD data into your local skill files. Running it periodically keeps your local error patterns and agent scores up to date:

```bash
solo-cto-agent sync --org myorg --repos app1,app2
```

**Active (when you notice something):** You can dispatch explicit feedback events to the orchestrator via the GitHub API. This is useful when the automated scores miss something qualitative — like a review that was technically correct but missed the real issue, or an agent that keeps suggesting unnecessary refactors.

## Sending explicit feedback

Use `repository_dispatch` to send feedback to your orchestrator repo:

```bash
curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/YOUR_ORG/YOUR_ORCHESTRATOR/dispatches \
  -d '{
    "event_type": "feedback",
    "client_payload": {
      "type": "feedback",
      "category": "review-quality",
      "detail": "Claude review missed RLS policy gap on PR #42",
      "agent": "claude",
      "repo": "my-product-repo"
    }
  }'
```

Feedback categories:

| Category | When to use |
|---|---|
| `review-quality` | Review missed a real issue or flagged a non-issue |
| `ci-reliability` | CI passed but deploy still broke, or CI failed on a flaky test |
| `routing-preference` | You want a specific agent on a specific repo |
| `general` | Anything else worth recording |

## What happens with feedback

Feedback entries are stored in `agent-scores.json` under the `feedback.patterns` array (last 100 entries kept). Every 5 events, the system runs `detectFeedbackPatterns()` which analyzes recent history and adjusts per-repo accuracy scores using a weighted formula: 70% existing score + 30% recent performance.

Over time this means:

- An agent that consistently gets good reviews on a specific repo will be preferred for that repo
- An agent that keeps triggering rework cycles will get lower scores
- Your explicit feedback accelerates the learning beyond what automated events capture

## Viewing feedback data

After syncing, check your local agent scores:

```bash
cat ~/.claude/skills/solo-cto-agent/agent-scores-local.json | jq '.feedback'
```

Or check the sync status:

```bash
solo-cto-agent status
```

## Alternative: GitHub Issues as feedback

If `repository_dispatch` feels too manual, you can also use GitHub Issues on your orchestrator repo with the label `feedback`. While the system does not auto-process these today, they serve as a structured log that can be batch-processed later. Tag issues with the agent name and repo for easier filtering.

## Improving the failure catalog

The `failure-catalog.json` grows automatically as CI failures are encountered. But you can also add patterns manually:

```json
{
  "id": "prisma-migration-drift",
  "pattern": "P3009.*migration.*drift",
  "fix": "Run prisma migrate reset on dev, then prisma migrate deploy",
  "severity": "high",
  "added": "2026-04-13",
  "source": "manual"
}
```

Add entries to `~/.claude/skills/solo-cto-agent/failure-catalog.json`. On next `sync`, local-only patterns are flagged (future versions will auto-push them to remote).
