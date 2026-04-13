# Orchestrator Operations

이 폴더는 dual-agent review orchestrator의 운영 데이터를 저장합니다.

## Structure
```
ops/orchestrator/
├── README.md          ← 이 파일
├── agent-scores.json  ← 에이전트 성능 점수 누적
└── round-logs/        ← 이슈별 리뷰 라운드 기록
```

## agent-scores.json
각 에이전트의 누적 성능 지표:
- accuracy: 첫 구현이 요구사항에 맞는 비율
- test_pass_rate: 자체 테스트 통과 비율
- review_hit_rate: 리뷰에서 실제 수정으로 이어진 비율
- rework_rate: 추가 수정이 필요했던 비율

### 자동 업데이트 기준 (P0)
- PR opened → `tasks_completed += 1`
- CI success/failure → `ci_pass/ci_total` 갱신 후 `test_pass_rate` 계산
- Review submitted → `reviews_submitted += 1` 후 `review_hit_rate = reviews_submitted / tasks_completed`
- Merge completed → `merges += 1` 후 `accuracy = merges / tasks_completed`
- hotfix/rollback label → `hotfixes += 1` 후 `rework_rate = hotfixes / tasks_completed`

> fallback 가정: `review_hit_rate`는 "리뷰가 제출된 비율"로 근사합니다.  
> (리뷰로 실제 수정이 발생했는지의 신호는 P0에서 수집하지 않습니다.)

## round-logs/
각 이슈의 리뷰 라운드 기록. 파일명: `issue-<number>.md`

## Additional Operational Logs
- error-patterns.md: recurring failure patterns used for self-evolve loop.
- quality-log.md: quality regressions and fixes.
- skill-changelog.md: tracked skill behavior changes.
- trigger-keywords.json: dev vs design routing keywords (no overlap).

