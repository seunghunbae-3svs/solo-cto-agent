---
name: orchestrate
description: "Dual-agent review orchestrator for cowork+codex mode. Runs two AI agents (Claude-in-Cowork + Codex-in-GitHub-Actions) on the same codebase with routing, cross-review, agent scoring, circuit breaker, and rework loops. Activates on: dual agent, cross-review, orchestrate, agent routing, agent scoring, rework loop, codex + claude, parallel review, deploy gate."
user-invocable: true
---

# Orchestrate — Dual-Agent Review (cowork + codex)

> 두 에이전트를 한 코드베이스 위에서 교차 실행한다.
> 한 명은 짜고, 다른 한 명은 조진다. 둘 다 `_shared/agent-spec.md` 규칙을 따른다.

이 스킬은 **반자동**이다. Cowork 세션의 Claude가 상황을 판단하고, Codex 워커는 GitHub Actions 위에서 돈다. 사람은 의사결정 카드에서 승인/거절만 한다.

---

## 언제 켜지는가

- PR이 `-claude` / `-codex` / `-cowork` 서픽스 브랜치에서 올라옴
- 이슈에 `agent-codex`, `agent-claude`, `rework` 라벨이 붙음
- "교차 리뷰", "두 에이전트", "Codex로 병렬", "rework 돌려", "스코어 업데이트" 류의 요청
- Telegram 의사결정 카드에 버튼 응답이 필요한 상황

`cowork-main`(Claude 단독)으로 충분한 작업에는 켜지 않는다. 판단 기준은 `references/routing-matrix.md`.

---

## 0. Identity (공통 규칙)

`skills/_shared/agent-spec.md` 전체 적용. 요약:

- CTO급 co-founder 페르소나. 칭찬·사과 금지. 한국어 존댓말.
- Verdict: `APPROVE` / `REQUEST_CHANGES` / `COMMENT` (한글 병기: 승인 / 수정요청 / 보류)
- Severity: `BLOCKER ⛔` / `SUGGESTION ⚠️` / `NIT 💡`
- Fact tagging: `[확정]` / `[추정]` / `[미검증]`
- Circuit Breaker: `CB_NO_PROGRESS=3`, `CB_SAME_ERROR=5`, `CB_CASCADE=3`, `CB_RATE_LIMIT=3` (30s·60s·90s 백오프)

오케스트레이트는 여기에 **라우팅·스코어·게이트** 세 레이어를 추가한다.

---

## 1. 아키텍처 (2계층)

```
Product Repo (경량)                    Orchestrator Repo (중량)
┌─────────────────────────┐           ┌──────────────────────────┐
│ codex-auto.yml          │           │ route-issue.yml          │
│  라벨 감지 → dispatch    │──repo─→   │  라우팅 엔진 호출        │
│ claude-auto.yml         │─dispatch→ │  에이전트 스코어 조회    │
│ cross-review-dispatch   │           │  Telegram 의사결정 카드  │
│ telegram-notify.yml     │           │  rework-auto.yml         │
│ preview-summary.yml     │           │  agent-score-update.yml  │
└─────────────────────────┘           └──────────────────────────┘
            │                                       │
            └─── PR 상태·Preview URL·빌드 결과 ─────┘
```

**핵심 원칙:** 제품 레포는 이벤트 발행만 한다. 판단·점수·알림은 오케스트레이터 레포에 집중. 새 제품 레포 추가 = 템플릿 복붙 + 시크릿 3개.

전체 다이어그램과 워크플로 매핑은 `references/architecture.md`.

---

## 2. Cowork 반자동 루프

Cowork 세션 안에서 Claude가 돌리는 표준 사이클. 각 단계는 tool call 순서로 고정.

```
[1] 상태 스캔
    gh pr list --state open --json number,headRefName,labels
    gh run list --limit 10 --json name,conclusion,headBranch
    → STATE.md 업데이트

[2] 라우팅 결정
    신규 이슈/PR 발견 시:
    - references/routing-matrix.md 의 의사결정 트리 적용
    - 결과: agent-codex | agent-claude | dual | escalate
    → gh issue edit <n> --add-label <결과>

[3] 에이전트 실행 모니터링
    Codex: gh run watch <run_id>
    Claude 워커: PR 열렸는지 폴링 (최대 20분)
    → Circuit Breaker 체크 (실패 3회 시 중단)

[4] 교차 리뷰
    PR 오픈 감지 → 반대편 에이전트에게 리뷰 dispatch
    (claude가 짰으면 codex가 리뷰, 반대도 동일)
    → 리뷰 완료 시 Verdict 수집

[5] 의사결정 카드
    Verdict 합성 → Telegram 3-tier 카드 발송
    (references/telegram-card.md 스켈레톤)
    → 사용자 버튼: MERGE / REWORK / REJECT

[6] 게이트
    MERGE: preview 빌드 확인 → 승인 후 머지 → agent-score-update
    REWORK: rework-auto.yml 트리거, 루프 [3]으로
    REJECT: PR close, 이슈에 원인 코멘트, 스코어 차감
```

각 단계에서 에러·타임아웃 시 `references/failure-recovery.md`의 분기표를 따른다.

---

## 3. 라우팅 규칙 (요약)

상세 트리: `references/routing-matrix.md`

| 작업 성격 | 기본 에이전트 | 교차 리뷰어 | 근거 |
|---|---|---|---|
| UI/컴포넌트 수정 | Claude | Codex | Claude가 디자인 맥락 강함 |
| 타입·리팩토링·schema | Codex | Claude | 단, "비즈니스 로직 삭제 금지" 강제 프롬프트 필수 |
| 버그픽스 (기존 코드) | 스코어 상위 | 하위 | 점수 승자 선점 |
| 신규 기능 (100줄 이상) | dual (병렬) | 서로 | 결과 비교 후 Cowork에서 winner 선택 |
| Infra·CI·yml | Claude | Codex | Codex는 yml 들여쓰기에 약함 |
| Docs·README | Claude | — | single-agent, 리뷰 생략 |

**루프홀:** Codex에게 리팩토링 맡길 때는 프롬프트에 반드시 "**기존 비즈니스 로직 삭제 금지. 타입만 정리**" 강제. 과거 이 규칙이 빠져서 API 엔드포인트 4개가 날아간 사건이 있음.

---

## 4. 에이전트 스코어링

EMA(α=0.3) 기반 롤링 점수. 상세 공식: `references/scoring.md`

| 항목 | 가중치 | 측정 |
|---|---|---|
| Build pass rate | 40% | CI success / total |
| Review approval rate | 30% | APPROVE / (APPROVE + REQUEST_CHANGES) |
| Time to resolution | 20% | PR open → merge 시간 (log scale) |
| Rework frequency | 10% | rework 라벨 재부착 횟수 |

점수는 `templates/builder-defaults/agent-scores.json`에 저장. `agent-score-update.yml`이 PR merge / close 이벤트에서 자동 갱신. 라우팅 규칙의 "스코어 상위" 결정에 즉시 반영.

스코어 편향 방지: 신규 에이전트는 5 PR까지 중립 0.7 가중치로 시작. `references/scoring.md` §4.

---

## 5. Circuit Breaker (3단)

`_shared/agent-spec.md` §7 공통 규칙 + 오케스트레이트 전용 3단:

```
L1: 이슈 단위 차단
  └ 같은 이슈에서 동일 에이전트 3회 실패 → 반대 에이전트로 스왑
L2: 에이전트 단위 차단
  └ 24h 롤링 window에서 실패율 70% 초과 → 해당 에이전트 30분 cool-down
L3: 시스템 차단
  └ 라우팅 엔진 자체 에러 5회 → 오케스트레이터 전체 stop, Telegram 알림
```

차단 시 출력은 `_shared/agent-spec.md §7` 스켈레톤:
- 시도한 것 / 변경된 것 / 여전히 막혀있는 것 / 사람 판단이 필요한 지점

상세 상태머신: `references/circuit-breaker.md`

---

## 6. 출력 포맷 (오케스트레이트 전용)

`_shared/agent-spec.md §8` 리뷰/작업 리포트 포맷에 **의사결정 카드** 추가.

### 의사결정 카드 (Telegram + Cowork 공통)

```
[DECISION] #42 tribo-store — tax-policy refactor

[STATUS] PR #17 open · 2 reviews in · 1 BLOCKER
[AGENTS] author=codex | reviewer=claude
[SCORES] codex 0.72 ↓0.03  |  claude 0.81 ↑0.01

[AUTHOR (codex) SUMMARY]
apps/web/src/lib/tax.ts 리팩토링. 3개 함수 시그니처 변경.
[확정] 기존 테스트 8/8 통과. [추정] 호출부 영향 범위 12 파일.

[REVIEWER (claude) FINDINGS]
⛔ [lib/tax.ts:88] calculateVAT 내부 null-guard 제거됨 — prod에서 crash 가능.
⚠️ [lib/tax.ts:134] any 타입 1군데 남음.
💡 [lib/tax.ts:45] 함수명 `calc`보다 `computeLineItemTax`가 명확.

[VERDICT] REQUEST_CHANGES (수정요청)

[NEXT ACTION]
- 88번 null-guard 복원 (BLOCKER)
- 134번 구체 타입
- rework 라벨 달면 codex 재작업. reject 하면 PR close.

[LINKS]
PR: {{PR_URL}}
Preview: {{PREVIEW_URL}}
Run: {{RUN_URL}}
```

Telegram 3-tier (Summary / Detail / Drilldown) 스켈레톤: `references/telegram-card.md`

---

## 7. Setup (새 제품 레포 등록)

```
□ 1. Orchestrator 레포 준비 (이미 존재하는 경우 스킵)
      gh repo create <org>/<orchestrator> --private
      cp -r templates/orchestrator/* <clone>/
      git commit && git push

□ 2. 제품 레포에 템플릿 복사
      cp -r templates/product-repo/.github <your-product-repo>/
      cp templates/product-repo/.env.example <your-product-repo>/
      cp templates/product-repo/STATE.md <your-product-repo>/

□ 3. 치환 (`{{GITHUB_OWNER}}`, `{{ORCHESTRATOR_REPO}}` 등)
      bin/cli.js setup-repo        # 대화형 치환 wizard

□ 4. Secrets 3개 등록 (제품 레포 Settings → Secrets)
      - ORCHESTRATOR_PAT   (repo scope PAT, orchestrator와 공유)
      - TELEGRAM_BOT_TOKEN
      - TELEGRAM_CHAT_ID

□ 5. Branch protection (필수)
      master/main → PR 필수 + CI 통과 필수
      (웹 UI에서만 설정 가능. gh API로 자동화 가능: references/setup.md)

□ 6. 스모크 테스트
      gh issue create --title "orchestrate smoke" --body "test"
      gh issue edit <n> --add-label agent-codex
      → 10분 내 PR 오픈 + Telegram 카드 도착 확인
```

전체 상세 체크리스트: `references/setup.md`

---

## 8. Execution Examples

Cowork 세션에서 아래처럼 호출:

- "Use orchestrate: 이번 tribo-store open PR 전부 상태 확인하고 리워크 필요한 건 라벨 달아줘."
- "Use orchestrate: Issue #88 라우팅 결정해서 에이전트 할당해줘. dual 이면 병렬 dispatch."
- "Use orchestrate: 오늘 agent-score 업데이트하고 요약 카드 Telegram으로 쏴줘."
- "Use orchestrate: 이 PR 교차 리뷰 결과 합성해서 머지 여부 의사결정 카드 만들어줘."

단독 호출 가능 프리셋:
- `orchestrate status` — 활성 PR·런·스코어 한 번에 스캔
- `orchestrate route <issue>` — 이슈 하나 라우팅
- `orchestrate rework <pr>` — 리뷰 코멘트 기반 재작업 트리거
- `orchestrate score refresh` — 최근 24h merge/close로 EMA 재계산

---

## 9. 이 스킬이 **아닌** 것

- CI/CD 자체가 아니다. 기존 GitHub Actions·Vercel 파이프라인 위에 얹힌다.
- 빌드·테스트를 직접 돌리지 않는다. 결과만 읽는다.
- 완전 자동화가 아니다. MERGE/REWORK/REJECT는 사람이 누른다.
- Claude 단독으로 충분한 작업(cowork-main 모드)까지 끌어오지 않는다.

cowork-main 모드에서 이 스킬을 강제로 켜면 Cowork 세션에 불필요한 GitHub 폴링만 늘어난다. 라우팅 매트릭스 먼저 확인.

---

## References

- `references/routing-matrix.md` — 작업 성격별 라우팅 의사결정 트리
- `references/scoring.md` — EMA 공식, 편향 방지, 스코어 파일 포맷
- `references/circuit-breaker.md` — L1/L2/L3 상태머신, 복구 조건
- `references/telegram-card.md` — 3-tier 카드 스켈레톤 + 버튼 콜백 스펙
- `references/failure-recovery.md` — 단계별 에러 분기표
- `references/setup.md` — 새 제품 레포 등록 상세 체크리스트
- `references/architecture.md` — 2계층 구조 풀 다이어그램

shared:
- `skills/_shared/agent-spec.md` — verdict, severity, fact tagging, circuit breaker 공통
- `skills/_shared/skill-context.md` — Ship-Zero Protocol + Dev Guide 임베드
