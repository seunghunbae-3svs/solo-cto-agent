# External Loop Policy — `solo-cto-agent`

> Why Cowork mode needs external signals, what counts as external, and how the CLI surfaces the gap.
> Related: [`docs/cowork-main-install.md`](cowork-main-install.md) · [`docs/feedback-guide.md`](feedback-guide.md)

> **Languages**: English (primary) · [한국어 요약](#한국어-요약) below.

---

## 한국어 요약

> 이 문서는 영어가 primary 입니다. 아래는 개념 이해를 위한 요약이며, 정확한 명세는 §1 이후 영문 본문을 기준으로 합니다.

**self-loop 문제**: Cowork 로컬 loop (review → apply-fixes → feedback → personalization → review) 은 같은 모델 패밀리 · 같은 diff · 같은 유저로 구성된 **구조적으로 닫힌 loop** 입니다. 두 가지 bias 가 쌓입니다 — (1) blind spot 반복: pass 1 에서 놓친 것을 pass 2 에서도 놓칩니다. (2) taste entrenchment: personalization 가중치가 유저 취향을 강화해 품질 상한이 유저의 안목에 묶입니다.

**외부 신호 3-tier**:

| Tier | 정의 | 예시 | 강도 |
|---|---|---|---|
| **T1 — Peer Model** | 다른 AI 패밀리가 같은 diff 를 리뷰 | `dual-review` (Claude + OpenAI) | 가장 약함. 같은 추론 카테고리. |
| **T2 — External Knowledge** | 스택/생태계 실시간 정보 | web search, npm registry, security advisory | 중간. "학습 데이터가 오래됐다" 를 알려줌. |
| **T3 — Ground Truth** | 실제 배포된 코드의 런타임 거동 | Vercel 배포 상태, runtime log, Supabase 쿼리 로그, 에러율 | 가장 강함. 의견이 아니라 **사실**. |

3 tier 모두 비활성 → **self-loop**. 3 tier 모두 켜짐 → "externally grounded".

**CLI 표기**: 매 `review` / `dual-review` 는 `externalSignals` 를 저장 JSON 과 터미널에 표시.

- 0/3 active → 노란색 `⚠️  [SELF-LOOP NOTICE]` 박스 + 활성화 방법 안내
- 1/3 또는 2/3 → `ℹ️  Active external signals: n/3. Missing: …` 한 줄 힌트
- 3/3 → 조용

**감지 규칙**:

| Tier | 트리거 |
|---|---|
| T1 | `OPENAI_API_KEY` 설정 (dual-review 가능) |
| T2 | `COWORK_EXTERNAL_KNOWLEDGE=1` 또는 `COWORK_WEB_SEARCH` / `COWORK_PACKAGE_REGISTRY` |
| T3 | `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, 또는 `COWORK_GROUND_TRUTH=1` |

**왜 경고일 뿐 차단이 아닌가**: 처음 쓰는 유저가 토큰 없이도 리뷰를 받을 수 있어야 하고 offline/air-gapped 환경도 지원해야 합니다. self-loop 리뷰도 실제 버그를 많이 잡습니다 — 상한이 낮을 뿐. 경고는 유저가 자기가 받고 있는 게 뭔지 알게 하는 정직성 feature 입니다.

**External 로 치지 않는 것** (여전히 self-loop):

- `selfCrossReview` (devil's-advocate 두번째 pass) — 같은 모델, 같은 학습 데이터
- 유저 feedback (`feedback accept/reject`) — 유저 자신의 과거 결정
- prior session 에서 합성된 `knowledge` article — 같은 loop, 롤업일 뿐
- 자기 orchestrator repo 에서 `sync --apply` — 자기 CI · 자기 agent · 자기 닫힌 loop

**로드맵**: PR-E3 (이 문서 주제, 경고 라벨) ✅ shipped. PR-E1 (T3 Vercel 배포 + runtime log) · PR-E2 (T2 package registry + web) · PR-E5 (`watch` 주기 dual-review) · PR-E4 (Slack 버튼 → `feedback`) 순서로 planned.

---

## 1. The self-loop problem

The local Cowork loop (`review` → `apply-fixes` → `feedback` → personalization → `review`) is **structurally closed**. Every stage is driven by the same model family, the same diff, and the same user. Without external signals this compounds two biases:

- **Blind spot persistence** — what the model misses in pass 1 it will likely miss in pass 2, even with a devil's-advocate prompt. `selfCrossReview` helps at the margin but does not close the gap.
- **Taste entrenchment** — personalization weights accumulate the user's accepts/rejects. This is good for personal fit but bad for quality ceiling: the user cannot reject what they never saw.

The local loop is not useless — it catches obvious errors, maintains a review habit, and accumulates session memory. But **its quality ceiling is bounded by the single model's knowledge and the user's taste**. To break past that ceiling, external signals must enter the loop.

---

## 2. Three tiers of external signal

Not all "external" signals are equal. We rank them by how strongly they push back against the model's own opinion.

| Tier | Definition | Example signal | Strength |
|---|---|---|---|
| **T1 — Peer Model** | Another AI family reviewing the same diff | `dual-review` (Claude + OpenAI) | Weakest. Different model, same category of reasoning. Catches family-specific blind spots. |
| **T2 — External Knowledge** | Live information about stack / ecosystem | Web search, npm registry, security advisories | Medium. Tells the model "your training data is old" or "this package has a known issue". |
| **T3 — Ground Truth** | Actual runtime behavior of the shipped code | Vercel deploy status, runtime logs, Supabase query logs, error rates | Strongest. Not an opinion — a fact. "This endpoint 500'd 12 times yesterday." |

A review with zero of these tiers active is a **self-loop**. A review with all three is "externally grounded".

---

## 3. How the CLI surfaces the tier state

Every `review` and `dual-review` call records an `externalSignals` object in the saved review JSON and shows it in terminal output.

```json
{
  "externalSignals": {
    "t1PeerModel": false,
    "t2ExternalKnowledge": false,
    "t3GroundTruth": false,
    "activeCount": 0,
    "isSelfLoop": true
  }
}
```

### Terminal output cases

**Self-loop (0/3 active):**
```
⚠️  [SELF-LOOP NOTICE]
This review was produced by a single model family with no external signals.
Missing: T1 peer model · T2 external knowledge · T3 ground truth.
Why it matters: opinions reinforce themselves — blind spots persist.
To close the loop, enable any of:
  • T1 — set OPENAI_API_KEY and use 'solo-cto-agent dual-review'
  • T2 — set COWORK_EXTERNAL_KNOWLEDGE=1 (trend + package checks)
  • T3 — set VERCEL_TOKEN or SUPABASE_ACCESS_TOKEN (runtime signals)
```

**Partial (1/3 or 2/3 active):**
```
ℹ️  Active external signals: 2/3. Missing: T2 external knowledge.
```

**Fully grounded (3/3 active):** no notice.

### Detection rules

| Tier | Trigger |
|---|---|
| T1 | `OPENAI_API_KEY` is set (dual-review is available) |
| T2 | `COWORK_EXTERNAL_KNOWLEDGE=1` or `COWORK_WEB_SEARCH` / `COWORK_PACKAGE_REGISTRY` set |
| T3 | `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, or `COWORK_GROUND_TRUTH=1` set |

> Note: the current release of `solo-cto-agent` implements only T1 fully. T2 and T3 integrations land in subsequent PRs (PR-E1, PR-E2). The env-var flags already gate the UI so users can opt in as those integrations ship.

---

## 4. Why this is a warning, not a block

The self-loop review is **still produced and saved**. We do not gate on external signals because:

- First-time users may not have any external tokens — forcing them to set up tokens before getting any review is an onboarding disaster.
- Offline / air-gapped environments may intentionally run self-loop.
- The self-loop still catches plenty of real bugs; it just has a lower ceiling.

The warning exists so the user **understands what they're getting**. This is an honesty feature, not a safety gate.

---

## 5. Recommended operating policies

### Builder tier, Cowork only (no Codex key)

This is the most common open-source user profile. They have a pure self-loop by default.

- **Minimum**: enable T2 (set `COWORK_EXTERNAL_KNOWLEDGE=1`) once PR-E2 ships so package-registry and trend checks land in reviews.
- **Recommended**: wire up T3 via `VERCEL_TOKEN` for runtime signal. This is the single highest-ROI external signal because it's ground truth, not opinion.

### Builder / CTO tier, Cowork + Codex

- T1 is automatic when both keys are set.
- Still add T3 (Vercel/Supabase) — peer models disagree about opinions, but neither has access to the actual production error rate.

### CTO tier, Full-auto

- All three tiers are expected. The CI pipeline already collects T3 implicitly (CI result / preview deploy status) and feeds it back into `agent-scores`.

---

## 6. What does NOT count as external

We classify these as **still self-loop**:

- `selfCrossReview` (Claude's second pass with a devil's-advocate prompt) — same model, same training data.
- User feedback (`feedback accept/reject`) — the user's own past decisions.
- `knowledge` articles synthesized from prior sessions — same loop, just rolled up.
- `sync --apply` from your own orchestrator repo — your own CI, your own agent, still your closed loop.

These layers are useful for personalization and continuity, but they do not add external reality to the review.

---

## 7. Roadmap

| PR | Scope | Status |
|---|---|---|
| **PR-E3** | Self-loop warning label (this doc's subject) | ✅ shipped |
| **PR-E1** | T3 injection — Vercel deploy status + runtime logs | planned |
| **PR-E2** | T2 injection — package-registry + web-search for stack |  planned |
| **PR-E5** | `watch` schedules periodic dual-review + T2 refresh | planned |
| **PR-E4** | Inbound feedback channel (Slack button → `feedback`) | planned |

After PR-E1+E2, "fully externally grounded" becomes achievable for any user with tokens. Before that, T1 via dual-review is the main escape hatch from the self-loop.
