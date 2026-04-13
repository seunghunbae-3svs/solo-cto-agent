# Failure Recovery — 단계별 에러 분기표

SKILL.md §2 사이클의 각 단계에서 발생하는 에러와 복구 경로.

---

## [1] 상태 스캔 실패

| 증상 | 원인 | 복구 |
|---|---|---|
| `gh pr list` rate limit | GitHub API 사용량 초과 | 대기 (`X-RateLimit-Reset` 헤더 확인), 60s 후 재시도 |
| `gh` 미인증 | PAT 만료 or 미설정 | `gh auth login --with-token` 또는 CLAUDE.md §12 PAT 재주입 |
| STATE.md 충돌 (다른 세션) | 동시 편집 | Cowork 세션 종료 시만 써야 함. 중간 저장 필요시 LOCK 파일 사용 |
| 빈 응답 | 레포 권한 없음 | PAT scope 확인 (repo, workflow, issues:write 필요) |

---

## [2] 라우팅 결정 실패

| 증상 | 원인 | 복구 |
|---|---|---|
| `routing-matrix.md` 매칭 안 됨 | 새로운 작업 유형 | 기본값 = claude. 사후 매트릭스 업데이트 제안 |
| agent-scores.json 손상 | 쓰기 중 crash | backup (`agent-scores.json.bak`) 에서 복구, 없으면 리셋 + 중립 0.7 재시작 |
| CB 이중 트립 (양쪽 cooldown) | 시스템 이슈 | L3 에스컬레이트 — 사람 호출 |
| dual 결정 but 한쪽 비용 초과 | 예산 가드 발동 | single로 다운그레이드, Telegram 알림 |

---

## [3] 에이전트 실행 실패

### Claude 워커 (Cowork or API)

| 에러 | 원인 | 복구 |
|---|---|---|
| `credit balance too low` | Anthropic 크레딧 소진 | Telegram 알림 + 해당 이슈 pending. 운영자 충전 후 `orchestrate resume` |
| `overloaded_error` | Anthropic 서버 혼잡 | 30/60/90s 백오프 재시도 3회 |
| `context_length_exceeded` | 프롬프트 너무 큼 | `references/skill-context.md` 참조해서 context 줄이기, diff 요약본으로 재시도 |
| PR 오픈 됐는데 diff 0 | 프롬프트가 "변경 없음"으로 해석됨 | CB +2 (silent fail), 프롬프트에 "반드시 코드 수정" 강조 추가 후 재시도 |

### Codex 워커 (GitHub Actions)

| 에러 | 원인 | 복구 |
|---|---|---|
| workflow_run conclusion=failure | 빌드 or 스크립트 에러 | `gh run view <id> --log` 로 원인 파악 후 분기 |
| `SyntaxError: Unexpected identifier` in workflow | yml 내 JS 문자열에 escape 누락 | 가장 흔한 codex 실수. workflow 파일 자체 수정 필요, CB +1 |
| PR 오픈 후 reviewer 지정 실패 | codex가 reviewer 필드 무시 | 오케스트레이터 후처리에서 강제 assign |
| 비즈니스 로직 삭제 감지 | 프롬프트 무시 | CB +3, PR 즉시 close, rework 금지 (보안상 재작업해도 같은 실수 반복) |

---

## [4] 교차 리뷰 실패

| 증상 | 원인 | 복구 |
|---|---|---|
| 리뷰어 에이전트 verdict 파싱 불가 | 포맷 미준수 | `cowork-engine.js` parser의 normalization 이미 커버. 그래도 실패하면 `COMMENT`로 처리 |
| 리뷰 타임아웃 (> 15분) | 에이전트 멈춤 | 강제 종료, 반대 에이전트로 swap 후 재시도 |
| 리뷰 결과 둘 다 BLOCKER | 정상 — PR 품질 낮음 | REQUEST_CHANGES 카드 발송, rework 루프 |
| 리뷰 결과 상충 (한쪽 APPROVE, 한쪽 REJECT) | 에이전트 간 판단 차이 | BLOCKER 기준 엄격하게 — REJECT 판정 우선. Telegram에 두 의견 모두 노출 |

---

## [5] 의사결정 카드 실패

| 증상 | 원인 | 복구 |
|---|---|---|
| Telegram send 5xx | Telegram API 일시 장애 | 30s 재시도 3회 → GitHub PR 코멘트로 fallback |
| chat_id 미설정 | secrets 누락 | Cowork에서 `orchestrate status --no-telegram` 로 직접 확인, Secrets 수정 안내 |
| 버튼 클릭 응답 없음 | bot 토큰 webhook 미등록 | `api/telegram-webhook` 엔드포인트 배포 상태 확인 |
| 중복 카드 발송 | workflow 재실행 | dedupe 로직 (same commit_sha → 1회만 발송) 확인 |

---

## [6] 게이트 실패

### MERGE 실패

| 에러 | 복구 |
|---|---|
| `not mergeable` (conflict) | PR 본문에 "rebase 필요" 코멘트, rework 라벨 자동 부착 |
| branch protection 위반 | 필요 check 누락 — `gh pr checks <n>`로 누가 빠졌는지 확인 |
| CI 실패 (머지 직전 fail) | 머지 중단, 이슈에 "CI flaky 가능성" 태그, 재실행 1회 후 판단 |

### REWORK 실패

| 에러 | 복구 |
|---|---|
| rework-auto.yml 미트리거 | 라벨 이벤트 누락 — `gh issue edit --remove-label rework && --add-label rework` 로 재트리거 |
| 재작업 결과가 이전보다 나쁨 | CB L1 카운터 증가. 3회 반복 시 swap |
| 무한 rework (같은 지적 반복) | `CB_SAME_ERROR=5` 도달 시 PR close + 이슈에 사람 개입 요청 |

### REJECT 처리

| 시나리오 | 처리 |
|---|---|
| 정책 위반 (비즈니스 로직 삭제 등) | PR close, 이슈에 원인 코멘트, codex -0.05 penalty |
| 중복 PR | 이전 PR로 통합 후 close |
| 스코프 미스매치 | 이슈에 "스코프 재정의 필요" 코멘트, 이슈 pending |

---

## 7. 실패 로그 보관

모든 복구 시도는 `ops/state/failure-log.jsonl` 에 어펜드:

```json
{"ts":"2026-04-14T03:15:22Z","stage":"3","agent":"codex","issue":"tribo-store#42","error":"SyntaxError","action":"workflow-fix","resolved":true,"attempts":2}
```

24h 이상 된 로그는 `ops/state/archive/` 로 자동 이동. self-evolve 스킬의 `error-patterns.md`에 집계.

---

## 8. 기본 원칙

- **silent fail 금지.** 워크플로 success 찍혔는데 결과물 없으면 CB +2.
- **같은 실패 3회 이상 자동 시도 금지.** CB 작동 후 사람 개입.
- **롤백은 정상 옵션.** PR close = 실패가 아님. 잘못 만들면 접는 게 맞다.
- **복구 중에도 fact tagging.** 원인을 `[확정]` / `[추정]` / `[미검증]` 으로 구분.
