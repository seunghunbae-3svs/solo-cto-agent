# Circuit Breaker — 무한 루프 차단 상태머신

SKILL.md §5에서 참조. `_shared/agent-spec.md §7` 공통 규칙 + 오케스트레이트 전용 3단 차단.

---

## 1. 공통 규칙 (shared)

```
CB_NO_PROGRESS  = 3    같은 에러 반복, 실질 진전 없음 → 보고 후 정지
CB_SAME_ERROR   = 5    동일 에러 5회 → 하드 스톱
CB_CASCADE      = 3    한 수정이 새 에러 3개 이상 → 정지
CB_RATE_LIMIT   = 3    API rate_limit → 30s/60s/90s 백오프 후 실패
```

---

## 2. 오케스트레이트 전용 3단

### L1 — 이슈 단위 차단 (가장 빠른 반응)

```
state: ISSUE_OK
  ↓ agent 실패 (build fail, test fail, empty PR)
state: ISSUE_DEGRADED (failure_count=1)
  ↓ 또 실패
state: ISSUE_DEGRADED (failure_count=2)
  ↓ 또 실패 (total 3)
state: ISSUE_BLOCKED
  action:
    - 현재 에이전트 태스크 중단
    - 반대 에이전트로 swap (동일 이슈에 대해)
    - 이슈에 `agent-swap` 라벨 + 코멘트
    - Telegram 알림 "L1 트립"
  recovery:
    - swap된 에이전트가 성공 → ISSUE_OK 복귀, 카운터 리셋
    - swap된 에이전트도 실패 → L3로 에스컬레이트
```

### L2 — 에이전트 단위 차단 (24h 롤링)

```
window: 24h
threshold: failure_rate > 70% OR 5 consecutive failures
  ↓ 트립 시
state: AGENT_COOLDOWN
  duration: 30분 (고정) + 실패 수 * 5분 (max 2시간)
  action:
    - 해당 에이전트는 신규 이슈 assignment 중단
    - 진행 중 작업은 완료
    - 라우팅 엔진이 반대 에이전트로 전부 우회
    - Telegram 알림 "L2 트립, 복구 예상 <시간>"
  recovery:
    - cooldown 만료 후 자동 재활성화
    - 첫 복귀 이슈는 난이도 0.3 이하 (라우팅 매트릭스 §1 docs/small-fix)
    - 연속 3 성공 → 정상 라우팅 복귀
```

### L3 — 시스템 차단 (최악)

```
triggers (어느 하나라도 충족):
  - 라우팅 엔진 자체 에러 5회
  - 양쪽 에이전트 모두 L2 트립
  - agent-scores.json 손상 감지
  - Vercel API 연속 10회 5xx
  - GitHub API rate limit 도달
  
state: SYSTEM_HALT
  action:
    - 모든 신규 assignment 중단
    - 진행 중 task도 soft-freeze (kill 하지 않음)
    - Telegram 긴급 카드 (🚨 prefix, @ 멘션)
    - 오케스트레이터 레포 이슈 자동 생성 + 진단 리포트
  recovery:
    - 사람 수동 해제 (`orchestrate unhalt` 명령)
    - 해제 시 원인 분석 필수 — `ops/scripts/diagnose.js` 리포트 첨부
```

---

## 3. 상태 저장

`ops/state/circuit-breaker.json` (오케스트레이터 레포):

```json
{
  "l1_by_issue": {
    "tribo-store#42": {
      "state": "BLOCKED",
      "agent": "codex",
      "failures": 3,
      "since": "2026-04-14T02:31:00Z",
      "errors": ["build fail: type error", "...", "..."]
    }
  },
  "l2_by_agent": {
    "codex": {
      "state": "OK",
      "failure_rate_24h": 0.22,
      "last_trip": "2026-04-10T14:00:00Z"
    },
    "claude": {
      "state": "COOLDOWN",
      "cooldown_until": "2026-04-14T03:30:00Z",
      "reason": "5 consecutive build fails"
    }
  },
  "l3": {
    "state": "OK",
    "last_halt": null
  }
}
```

---

## 4. 실패 유형별 가중치

모든 실패가 동일하지 않다. CB 카운터 증가량을 차등:

| 실패 유형 | 카운터 증가 |
|---|---|
| Build fail (빌드 깨짐) | +1 |
| Test fail | +1 |
| PR empty (diff 0줄) | +2 |
| Silent fail (워크플로는 성공했는데 결과물 없음) | +2 |
| Business logic deletion (리뷰어가 감지) | +3 |
| API timeout | +0.5 |
| Rate limit | +0 (별도 백오프로 처리) |

---

## 5. 리포트 포맷

CB 트립 시 Cowork + Telegram에 아래 형식으로:

```
[CB TRIP] L<1|2|3> — <agent|issue|system>

[시도한 것]
- claude에게 #42 3회 할당
- 마지막 3회 모두 "Cannot find module '@/lib/auth'" 에러

[변경된 것]
- PR #43, #45, #47 전부 close
- 새 PR 오픈되지 않음

[여전히 막혀있는 것]
- NextAuth 설정이 프로젝트에 없을 가능성 [추정]
- 또는 baseline이 broken [미검증]

[사람 판단이 필요한 지점]
- @/lib/auth 파일 존재 여부 확인
- 존재하면 tsconfig paths 점검
- 아니면 setup-pipeline 재실행 필요

[NEXT ACTION]
- L1 → codex로 swap (자동 시도 예정)
- 또는 `orchestrate unblock <issue>` 로 수동 해제
```

---

## 6. 주의

- CB는 **방어 장치**지 진단이 아니다. 트립 = 문제 원인 조사 시작점.
- 자동 복구에만 의존하지 않는다. L3는 반드시 사람이 해제.
- CB 로그(`ops/state/cb-history.jsonl`)는 자기 진단 + self-evolve 입력.
- 같은 프로젝트에서 L2 월 2회 초과하면 해당 프로젝트 baseline 재점검 필요.
