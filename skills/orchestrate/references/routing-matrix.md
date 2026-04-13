# Routing Matrix — 어떤 에이전트에게 맡길까

SKILL.md 에서 "라우팅 결정" 단계를 돌릴 때 이 문서를 참조한다. 판단 트리는 위에서 아래로 순서대로 적용.

---

## 0. 전제

- 두 에이전트: `claude` (Cowork / Anthropic API 기반), `codex` (GitHub Actions OpenAI 기반).
- 점수는 `templates/builder-defaults/agent-scores.json` 에서 로드. 0~1 range.
- 신규 에이전트는 첫 5 PR까지 중립 0.7 고정 (편향 방지).

---

## 1. 1차 필터 — 작업 성격

| 시그널 | 신호 (라벨 또는 제목 키워드) | 결정 |
|---|---|---|
| Docs / README / 마크다운 only | `docs`, `readme`, 제목에 "docs:", 변경 파일 100% .md | `claude` 단독. 리뷰 생략. |
| CI·yml·workflow 수정 | 파일에 `.github/workflows/*.yml` 포함 | `claude` 주도. `codex`는 리뷰만. |
| Infra (Dockerfile, vercel.json, nginx) | 파일 경로 매칭 | `claude` 주도. `codex` 리뷰. |
| UI / 컴포넌트 (JSX/TSX) | `apps/**/components/**`, `.tsx`, `.jsx` 변경 | `claude` 주도. `codex` 리뷰. |
| 타입·스키마·리팩토링 | 제목/본문에 "refactor", "types", "schema"; `.d.ts` 변경 | `codex` 주도. `claude` 리뷰. **비즈니스 로직 삭제 금지 프롬프트 필수.** |
| Prisma 마이그레이션 | `prisma/migrations/**` | `claude` 주도. `codex` 리뷰. (codex가 schema.prisma 로직 지우는 사고 반복) |
| 버그픽스 (기존 코드) | 라벨 `bug`, 제목 "fix:" | 스코어 상위 주도. 하위 리뷰. |
| 신규 기능 100줄 이상 | 라벨 `feat`, 예상 변경량 큼 | **dual (병렬 실행)**. 양쪽 결과 비교 후 winner 선택. |
| 신규 기능 100줄 미만 | 라벨 `feat`, 소규모 | 스코어 상위 주도. |

---

## 2. 2차 필터 — 에이전트 가용성

1차 필터 결과에 아래 제약 적용:

```
if circuit_breaker.tripped(agent):
    → 반대 에이전트로 swap
    if both_tripped:
        → escalate (사람 호출, Telegram 긴급 카드)

if agent_score(agent) < 0.4 and 작업 성격 == "버그픽스":
    → 반대 에이전트로 swap (퇴화 중인 에이전트에 버그 맡기지 않음)

if 이슈 코멘트 수 > 10 (토론 과다):
    → escalate 우선 검토
```

---

## 3. 3차 필터 — 비용·시간

```
if 현재 월 Anthropic 비용 > 한도 80%:
    UI·Docs도 codex로 리라우팅
if 현재 월 OpenAI 비용 > 한도 80%:
    모든 단독작업 claude로, dual 중단
if 마감 < 2시간:
    dual 금지. 스코어 상위 단독.
```

비용 정보는 `ops/scripts/cost-snapshot.js` 에서 매 시간 업데이트 (없으면 이 필터 스킵).

---

## 4. 최종 결정 출력

라우팅 결정 시 아래 포맷으로 Cowork 세션 + Telegram에 기록.

```
[ROUTING] #<issue_number> — <title>

[CLASSIFICATION] <UI | Refactor | Bugfix | Feature | Infra | Docs>
[PRIMARY] claude | codex | dual
[REVIEWER] codex | claude | —
[REASONING] <한 문장, 어느 필터에서 결정됐는지 명시>
[SCORES] claude=0.81  codex=0.72

[PROMPT INJECTIONS]
- <있으면 강제 프롬프트, 예: "비즈니스 로직 삭제 금지">
- <없으면 "none">

[NEXT]
gh issue edit <n> --add-label agent-<결과>
```

---

## 5. 자주 놓치는 케이스

- **"그냥 타입만 바꾸면 됨" PR** → codex에게 맡기되 프롬프트에 `"DO NOT remove any business logic. Only modify type annotations."` 필수. 과거 사고: `golf-now` PR #2 (4개 API 엔드포인트 로직 삭제).
- **스키마 + 비즈니스 로직 혼합** → 분리 불가능하면 dual. 한쪽은 스키마, 한쪽은 호출부 영향 분석.
- **hotfix (prod crash)** → 스코어 상위 단독 + `skip-review` 라벨. 머지 후 사후 review dispatch.
- **의존성 업그레이드 (npm update)** → codex 주도. 변경 패치노트 요약을 PR 본문에 요구.
- **단순 리네이밍** → codex. 단, import 경로 전수조사 확인.

---

## 6. 엣지 케이스 — dual 이 dual 결과를 낼 때

dual 실행 후 양 에이전트 결과가 충돌하면:

1. 테스트 통과 여부가 우선 (통과한 쪽이 winner).
2. 둘 다 통과 → 리뷰어 교차 투입, 양쪽 PR에 상대 에이전트가 코멘트.
3. 여전히 결정 불가 → Telegram 의사결정 카드에 두 diff 링크 첨부, 사람이 선택.

절대 자동 머지하지 않는다. 최종 버튼은 사람이 누른다.
