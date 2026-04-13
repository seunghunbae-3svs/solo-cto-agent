# Architecture — 2계층 구조 풀 다이어그램

SKILL.md §1 의 상세 버전.

---

## 1. 역할 분담 원칙

```
제품 레포 (경량, N개)           오케스트레이터 레포 (중량, 1개)
────────────────────────        ────────────────────────────────
이벤트 발생기                    의사결정기 + 상태 저장소

- 이슈/PR 이벤트 감지            - 라우팅 로직
- Telegram 통지 (경량)           - 에이전트 스코어링
- Preview URL 감지               - Circuit Breaker 상태
- 타 레포로 dispatch             - 크로스 프로젝트 메타 분석
                                 - Telegram 카드 생성 + 콜백 처리
                                 - 에이전트 워커 호스팅
```

제품 레포는 "상태 없는 트리거"로 유지. 새 제품 추가 = 단순 복붙. 복잡한 로직은 전부 오케스트레이터 한 곳에서 관리.

---

## 2. 풀 다이어그램

```
┌──────────────────────────────────────┐
│  Product Repo: tribo-store           │
│                                      │
│  이슈 #42 생성 (agent-codex 라벨)    │
│  │                                   │
│  ▼                                   │
│  codex-auto.yml                      │
│  ├─ Step 1: Post assignment comment  │
│  ├─ Step 2: repository_dispatch ────┐│
│  └─ Step 3: Telegram T1 (이슈 생성) ││
│                                     ││
│  PR #17 오픈 (feat/42-codex 브랜치) ││
│  │                                  ││
│  ▼                                  ││
│  cross-review-dispatch.yml          ││
│  └─ repository_dispatch ────────────┼┼──┐
│                                     ││  │
│  PR #17 merged                      ││  │
│  │                                  ││  │
│  ▼                                  ││  │
│  preview-summary.yml                ││  │
│  ├─ Wait for Vercel preview         ││  │
│  └─ Post preview URL to PR          ││  │
│                                     ││  │
└─────────────────────────────────────┼┼──┼─
                                      ││  │
                                      ▼▼  │
┌─────────────────────────────────────────▼───┐
│  Orchestrator Repo                          │
│                                             │
│  route-issue.yml                            │
│  ├─ Load routing-policy.json                │
│  ├─ Load agent-scores.json                  │
│  ├─ Run routing-engine.js                   │
│  ├─ Decision: claude | codex | dual | esc   │
│  └─ Output: Telegram T1 card + issue label  │
│                                             │
│  cross-review.yml                           │
│  ├─ Identify reviewer (opposite agent)      │
│  ├─ Dispatch to claude-reviewer or          │
│  │   codex-reviewer worker                  │
│  └─ Post review on PR (REQUEST_CHANGES /    │
│     APPROVE / COMMENT)                      │
│                                             │
│  agent-score-update.yml                     │
│  ├─ PR merge/close event                    │
│  ├─ Compute EMA update                      │
│  └─ Commit agent-scores.json                │
│                                             │
│  rework-auto.yml                            │
│  ├─ Label `rework` detected                 │
│  ├─ Parse review comments                   │
│  ├─ Build structured prompt                 │
│  └─ Re-invoke author agent worker           │
│                                             │
│  workers:                                   │
│  ├─ claude-worker.js (Anthropic API)        │
│  ├─ codex-worker.js (OpenAI API)            │
│  ├─ claude-reviewer.js                      │
│  ├─ codex-reviewer.js                       │
│  ├─ cross-reviewer.js                       │
│  └─ rework-agent.js                         │
│                                             │
│  api/ (Vercel serverless)                   │
│  ├─ /api/health                             │
│  ├─ /api/webhook (GitHub)                   │
│  ├─ /api/telegram-webhook (callback)        │
│  └─ /api/scores (read-only score API)       │
│                                             │
│  state:                                     │
│  ├─ ops/state/circuit-breaker.json          │
│  ├─ ops/state/projects.json                 │
│  ├─ ops/state/failure-log.jsonl             │
│  └─ templates/builder-defaults/             │
│     ├─ agent-scores.json                    │
│     └─ routing-policy.json                  │
└─────────────────────────────────────────────┘
```

---

## 3. 데이터 흐름 — 시나리오별

### 3.1 이슈 생성 → PR 오픈

```
사용자: gh issue create
  → codex-auto.yml on: issues(labeled)
    → repository_dispatch (event-type: route-issue)
      → orchestrator: route-issue.yml
        → routing-engine.js (load policy, scores)
        → Telegram T1 card
        → Invoke codex-worker.js
          → PR 오픈 (branch: feat/42-codex)
```

### 3.2 PR 오픈 → 교차 리뷰

```
Codex PR 오픈
  → product repo: cross-review-dispatch.yml
    → repository_dispatch (event-type: cross-review)
      → orchestrator: cross-review.yml
        → Identify reviewer = claude (codex가 author이므로)
        → Invoke claude-reviewer.js
          → Anthropic API → verdict + issues
          → Post review on PR
          → Telegram T1 update (verdict 추가)
```

### 3.3 REWORK 버튼 클릭

```
운영자: Telegram 버튼 클릭
  → api/telegram-webhook
    → gh issue edit --add-label rework
      → orchestrator: rework-auto.yml
        → Parse review comments
        → Build prompt (원 PR diff + reviewer feedback)
        → Invoke codex-worker.js (재작업)
          → 동일 브랜치에 commit push
            → product repo: cross-review-dispatch 재트리거
              → (반복 — CB_SAME_ERROR=5 도달 시 중단)
```

### 3.4 MERGE → 배포

```
운영자: Telegram MERGE 버튼
  → api/telegram-webhook
    → gh pr merge --merge
      → product repo: preview-summary.yml
        → Vercel preview URL 수신
        → Post to PR + Telegram T3
      → orchestrator: agent-score-update.yml
        → Compute EMA
        → Commit agent-scores.json
```

---

## 4. 상태 파일 소유권

| 파일 | 위치 | 소유자 | 쓰기 주체 |
|---|---|---|---|
| `STATE.md` | 제품 레포 | 제품 | preview-summary, manual |
| `agent-scores.json` | 오케스트레이터 | orchestrator | agent-score-update.yml |
| `routing-policy.json` | 오케스트레이터 | orchestrator | manual PR only |
| `circuit-breaker.json` | 오케스트레이터 (ops/state/) | orchestrator | 전 워크플로 |
| `projects.json` | 오케스트레이터 | orchestrator | register-project.js |
| `failure-log.jsonl` | 오케스트레이터 | orchestrator | 전 워크플로 (append-only) |

**주의:** routing-policy.json 은 수동 PR로만 변경. 자동 프로세스가 정책을 바꾸면 감사 불가.

---

## 5. 확장 — N개 제품 레포

제품 레포가 늘어나도 오케스트레이터는 동일 코드 베이스. projects.json 에 항목만 추가:

```json
{
  "projects": [
    { "name": "tribo-store", "owner": "seunghunbae-3svs", "tier": "dual", "preset": "webapp" },
    { "name": "golf-now", "owner": "seunghunbae-3svs", "tier": "single", "preset": "webapp" },
    { "name": "eventbadge", "owner": "seunghunbae-3svs", "tier": "single", "preset": "webapp" }
  ]
}
```

tier:
- `single` = claude or codex 단독 (스코어 상위 고정)
- `dual` = 교차 리뷰 + rework 루프 전체
- `trial` = 신규 프로젝트, 2주간 dual 강제 후 자동 평가

preset:
- `webapp` = Next.js + Vercel 가정
- `api` = API 서버, preview URL 없음
- `lib` = 라이브러리 레포, preview·배포 스킵

---

## 6. 실패 영역 분리

아키텍처가 2계층인 이유는 **실패가 번지지 않게** 하는 것:

- 오케스트레이터 다운 → 제품 레포 이벤트는 실패하지만, 수동 라우팅 가능. 제품 코드는 영향 없음.
- 제품 레포 CI 깨짐 → 오케스트레이터는 healthy, 다른 제품에 영향 없음.
- Anthropic API 다운 → Claude 워커만 L2 트립. Codex 단독으로 계속 운영.
- Telegram API 다운 → GitHub PR 코멘트로 fallback, 핵심 의사결정 지연.

단일 레포에 전부 몰았을 때의 사고 경험 (2026-03) 이후 이 구조로 분리됐다.
