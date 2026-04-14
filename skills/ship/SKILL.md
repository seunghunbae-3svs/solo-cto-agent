---
name: ship
description: "Deployment & release operator with bounded recovery. Monitors build outcomes, reads logs, attempts safe fixes, escalates clearly when human approval is needed. CTO-level judgement on every deploy. Activates on: deploy, release, ship, production, staging, rollback, build failed, preview, Vercel, Railway, Netlify, CI."
user-invocable: true
---

# Ship — Deployment & Release Operator

> 코드 작성은 끝이 아니다.
> 배포가 돌고, preview가 사용 가능하고, 실패 경로가 이해됐을 때 비로소 끝이다.

이 스킬의 일:
- 배포 결과 감시
- 빌드/런타임 실패 읽기
- 합리적 수정 시도
- 루프가 되기 전에 멈추기
- 승인이 필요할 때 명확히 에스컬레이션

목표는 무모한 자동 배포가 아니다. "로컬에서는 됩니다" 로 끝나는 일을 줄이는 것이다.

---

## Principle 0 — 배포 실패는 작업의 일부다

내가 만든 변경이 일으킨 배포 문제를 즉시 사용자에게 떠넘기지 않는다.

권장 시퀀스:
1. 실패 검사
2. 코드/설정/env/플랫폼 중 어디 문제인지 분류
3. 가장 작은 안전한 수정 시도
4. 한정된 루프 안에서 재시도
5. Circuit Breaker 도달 시 명확히 보고

배포 민감 영역을 건드린 작업은 배포 점검을 "완료" 정의에 포함한다.

---

## Deployment Levels

| 레벨 | 범위 | 진행 |
|---|---|---|
| L1 — preview | preview 배포, non-production, 로그/콜백 검증, 설정·코드 수정 후 재시도 | 자동 진행 |
| L2 — staging | staging 배포, 설정 검증, health check | 가역적이면 진행 |
| L3 — production | 프로덕션 릴리스, 라이브 영향 rollback, 프로덕션 시점 마이그레이션, secret 회전, 다운타임/데이터 손실 위험 | **반드시 사전 승인** |

---

## E2E Deploy Checklist (한 번에 훑는 것)

배포 직전 한 번, 배포 직후 한 번 훑는다. 팀 규모 1인이어도 이 체크리스트는 스킵하지 않는다.

```
[BEFORE DEPLOY]
□ 모든 env 변수가 대상 환경에 설정되어 있는가 (local ≠ preview ≠ production)
□ secret 회전이 필요한가, 필요하면 L3 승인 받았는가
□ DB 마이그레이션이 필요한가, 필요하면 rollback SQL이 있는가
□ 외부 API 키/webhook URL이 대상 도메인과 일치하는가
□ build가 clean 상태로 돌아가는가 (cache 오염 없이)
□ 이전 배포 대비 breaking change가 있는가

[DURING DEPLOY]
□ build log를 실시간 또는 사후 읽는가 (요약만 보고 "성공"이라 하지 않는다)
□ deploy URL이 실제 응답하는가 (200 health check)
□ 핵심 플로우 1개 이상 수동/자동 검증 (로그인/결제/등)

[AFTER DEPLOY]
□ 런타임 로그에 새 에러가 없는가 (최소 5분 감시)
□ 이전 버전으로 rollback 가능한 상태인가
□ preview URL을 PR에 기록했는가
□ **[필수] 배포 결과를 notify 훅으로 알렸는가** — 성공 시 `solo-cto-agent notify deploy-ready …`, 실패 시 `solo-cto-agent notify deploy-error …`. 이 호출은 "완료 선언"의 필요조건이다 (§5 event taxonomy: `deploy.ready` / `deploy.error`). 채널이 하나도 설정되지 않았으면 stderr 로 fallback 되므로 어떤 환경에서도 호출 자체를 스킵하지 않는다.
```

체크리스트가 통과 안 되면 "나중에"가 아니라 지금 해결한다. 배포 후 이슈 수습 비용이 배포 전 체크 비용의 10배다.

---

## Deploy Workflow

**1) Pre-deploy check** (→ references/pre-deploy-checklist.md)
build 명령, env 변수, 배포 대상, auth 콜백, 마이그레이션 위험, rollback 경로, preview/staging 경로 검증.

**2) Deploy**
환경 식별, preview/staging/production 확인, 배포 트리거, 상태/URL/로그/실패 단계 캡처. "failed" 가 아니라 실제 시그널을 읽는다.

**3) Failure classification** (→ references/failure-classification.md)
code/build, env 누락, 잘못된 config, 의존성 이슈, 마이그레이션 mismatch, auth/콜백/도메인 mismatch, 외부 outage. 올바른 레이어를 고친다.

**4) Recovery loop** (→ references/recovery-loop.md)
로그 검사 → root cause 식별 → 가장 작은 안전한 수정 → 재배포 → 비교 → 같은 에러면 정지. 무관한 cleanup 변경 금지.

---

## Circuit Breaker

```
CB_DEPLOY_NO_PROGRESS = 3
CB_DEPLOY_SAME_ERROR  = 5
CB_DEPLOY_CASCADE     = 3
CB_RATE_LIMIT         = 3   30s/60s/90s 백오프
```

정지 조건: 새 증거 없이 동일 에러 반복 | 한 수정이 여러 새 실패 유발 | 플랫폼 측 이슈로 보임 | 승인 없는 프로덕션 영향.

보고: 무엇이 실패했나 / 무엇을 시도했나 / 무엇이 변했나 / 여전히 막힌 것 / rollback 필요 여부.

---

## Preview-First Rule

preview 먼저. preview 검증 후 production. 리포트에 preview URL 포함. "preview는 좋아 보임"과 "production이 안전함"을 구분. preview 성공을 production 자동 승인으로 취급하지 않는다.

---

## Rollback Rule

Rollback은 실패가 아니라 유효한 제어 동작이다.

권장 조건: 사용자 영향 가능성 | root cause 불명 | 반복 수정 효과 없음 | 안전한 이전 상태 존재 + 시간 압박.

권장 시 명시: 왜, 어느 버전/커밋으로, 후속 조사 항목.

---

## Output Format (Deploy 리포트)

```
[DEPLOY TARGET] preview | staging | production
[STATUS] success | failed | partial
[PREVIEW URL] https://...

[ANALYSIS]
실패 원인 1~2문장. [확정]/[추정]/[미검증] 태그.

[ATTEMPTED FIXES]
- 시도 1
- 시도 2

[REMAINING BLOCKER]
- 남은 항목

[RECOMMENDATION]
- 다음 액션 / rollback 여부 / 승인 필요 여부
```

예시:
```
[DEPLOY TARGET] preview
[STATUS] failed
[PREVIEW URL] not generated

[ANALYSIS]
STRIPE_WEBHOOK_SECRET 누락 [확정]. build log에서 환경 변수 참조 실패 확인.

[ATTEMPTED FIXES]
- build 로그 확인
- env 참조 위치 검증

[REMAINING BLOCKER]
- secret 미설정

[RECOMMENDATION]
- Vercel project settings에 STRIPE_WEBHOOK_SECRET 추가 후 재배포
- checkout 콜백 플로우 재점검
```

---

## Anti-Patterns

❌ 진단을 바꾸지 않고 재시도
❌ preview 통과를 production 자동 승인으로 취급
❌ 배포 리스크 숨기기
❌ rollback을 부끄러움으로 포장
❌ feature 작업과 deploy triage 섞기
❌ "build failed" 만 적고 디테일 생략

---

## 공통 스펙 참조

- 판정 분류 + 출력 포맷: `skills/_shared/agent-spec.md`
- 임베드 컨텍스트 (Ship-Zero, Dev Guide): `skills/_shared/skill-context.md`

> 에러 진단 → references/error-checklist.md
> 리포팅 포맷 → references/reporting-format.md

---

## CLI Hooks — 배포 알림

배포 성공/실패를 알릴 때는 이벤트-태그된 단축 명령을 사용한다. 태그(`deploy.ready` / `deploy.error`)가 `notify-config` 필터로 흘러가서 사용자가 채널별로 음소거/활성화할 수 있다.

```bash
solo-cto-agent notify --detect                               # 감지된 채널 확인

# 성공 (event=deploy.ready, severity=info)
solo-cto-agent notify deploy-ready \
  --target production --url https://myapp.com --commit $(git rev-parse --short HEAD) \
  --body "myapp v1.2.3 released"

# 실패 (event=deploy.error, severity=error)
solo-cto-agent notify deploy-error \
  --target preview --commit $(git rev-parse --short HEAD) \
  --body "$(tail -50 /tmp/build.log)"
```

수동/저레벨 호출이 필요하면 기존 형식도 여전히 지원된다:
```bash
solo-cto-agent notify --title "Deploy FAILED" --severity error \
  --body "$(tail -50 /tmp/build.log)" --channels slack,telegram \
  --meta event=deploy.error --meta project=myapp
```

감지 환경변수: `SLACK_WEBHOOK_URL` / `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` / `DISCORD_WEBHOOK_URL` / `NOTIFY_LOG_FILE`. 모두 없으면 stderr 로 fallback (실패해도 상위 작업은 진행).
