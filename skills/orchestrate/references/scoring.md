# Agent Scoring — EMA 공식과 편향 방지

SKILL.md §4에서 참조. 오케스트레이터 레포의 `agent-score-update.yml` + `ops/orchestrator/update-agent-scores.js`가 이 규칙을 구현한다.

---

## 1. 점수 파일 포맷

`templates/builder-defaults/agent-scores.json`

```json
{
  "updated_at": "2026-04-14T03:00:00Z",
  "agents": {
    "claude": {
      "score": 0.81,
      "prs_counted": 42,
      "components": {
        "build_pass": 0.88,
        "review_approval": 0.76,
        "time_to_resolution": 0.82,
        "rework_frequency": 0.71
      }
    },
    "codex": {
      "score": 0.72,
      "prs_counted": 38,
      "components": { "...": "..." }
    }
  }
}
```

---

## 2. 구성 요소

| 지표 | 가중치 | 계산 |
|---|---|---|
| `build_pass` | 0.40 | CI success / total runs (최근 30 PR 내) |
| `review_approval` | 0.30 | APPROVE / (APPROVE + REQUEST_CHANGES) |
| `time_to_resolution` | 0.20 | 1 - min(1, log10(hours_to_merge + 1) / 2.5) |
| `rework_frequency` | 0.10 | 1 - min(1, rework_count / 5) |

최종 점수:

```
score = 0.40 * build_pass
      + 0.30 * review_approval
      + 0.20 * time_to_resolution
      + 0.10 * rework_frequency
```

각 컴포넌트는 0~1 범위로 clip.

---

## 3. EMA (Exponential Moving Average)

새 이벤트 발생 시 즉시 전체 재계산하지 않고 EMA로 갱신:

```
alpha = 0.3

new_score_component = alpha * event_value + (1 - alpha) * prev_score_component
final_score = weighted_sum(components)
```

`alpha=0.3`: 최근 3~4 PR이 점수의 약 70%를 차지. 급격한 drift 없이 현재 상태 반영.

---

## 4. 편향 방지

### 4.1 신규 에이전트 워밍업

```
if prs_counted < 5:
    score = 0.7  # 고정
    return
```

5 PR까지 점수에 의한 라우팅 패널티 없음. 새 에이전트 평가 기회 확보.

### 4.2 복구 중 에이전트

```
if recent_failures > 3 and current_score < 0.5:
    # 복구 단계: small-batch 전용
    routing.allow_only(["docs", "small-fix"])
    when score >= 0.6 for 5 consecutive PRs:
        lift restriction
```

### 4.3 샘플 편향 보정

한 에이전트가 계속 쉬운 이슈만 받으면 점수가 실제 능력을 반영하지 못함. 보정:

```
difficulty_factor = avg(issue_difficulty[agent, last 10 PRs])
# issue_difficulty: 라벨 + 변경 예상량 기반 0.3~1.5 가중
adjusted_score = score * difficulty_factor / 1.0
```

`issue_difficulty` 휴리스틱은 `ops/orchestrator/difficulty-estimator.js`.

---

## 5. 갱신 트리거

| 이벤트 | 업데이트 대상 |
|---|---|
| PR merged | `build_pass`, `review_approval`, `time_to_resolution` |
| PR closed (unmerged) | `build_pass` (fail), `rework_frequency` |
| `rework` 라벨 부착 | `rework_frequency` 증가 |
| Circuit breaker trip | `build_pass` 즉시 -0.1 (penalty) |
| 24h cron | 전체 파일 무결성 검증 (schema ajv) |

---

## 6. 수동 조정

운영자가 이상 점수 발견 시:

```bash
# 강제 리셋
node ops/orchestrator/update-agent-scores.js --reset claude
# 특정 컴포넌트 설정
node ops/orchestrator/update-agent-scores.js --set claude.build_pass=0.85
# 전체 히스토리에서 재계산
node ops/orchestrator/update-agent-scores.js --recompute --from 2026-03-01
```

수동 조정은 Telegram 카드에 `[MANUAL OVERRIDE by <user>]` 태그로 기록. 투명성 필수.

---

## 7. 점수 해석 가이드

| 범위 | 상태 | 라우팅 |
|---|---|---|
| 0.85+ | Excellent | 어떤 작업이든 우선 배정 |
| 0.70–0.84 | Healthy | 기본 분류대로 |
| 0.55–0.69 | Watch | Infra·Schema 회피 |
| 0.40–0.54 | Degraded | docs·small-fix 전용 |
| < 0.40 | Broken | 30분 cool-down. 원인 분석 후 수동 복귀. |

**주의:** 점수는 지표지 판결이 아니다. 신규 스킬 테스트·모델 변경 직후 점수가 출렁이는 건 정상. 10 PR 이동평균을 본다.
