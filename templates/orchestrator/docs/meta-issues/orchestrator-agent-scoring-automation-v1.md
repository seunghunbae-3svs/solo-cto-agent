# orchestrator-agent-scoring-automation-v1

## Summary
`ops/orchestrator/agent-scores.json`를 정적 파일이 아니라, 실제 작업 결과와 리뷰 효과를 반영하는 자동 업데이트 시스템으로 고도화한다.

---

## Goal
다음을 달성한다.

1. agent score를 실제 GitHub 이벤트로부터 자동 누적
2. score가 단순 보고서가 아니라 routing 의사결정에 반영되도록 연결
3. 점수 산정 방식이 너무 복잡하지 않으면서도 실무적으로 유의미하도록 설계

---

## Success criteria
- [ ] `agent-scores.json`가 아래 이벤트를 기준으로 자동 갱신된다:
  - PR opened
  - CI success/failure
  - cross-review submitted
  - review finding adopted
  - merge completed
  - rollback or follow-up hotfix
- [ ] 각 에이전트별 최소 지표를 추적한다:
  - accuracy
  - test_pass_rate
  - review_hit_rate
  - rework_rate
  - tasks_completed
- [ ] score update 규칙이 문서화되어 있다.
- [ ] routing recommendation에서 historical score를 입력으로 활용할 수 있다.

---

## Deliverables
### 1. Scoring model
각 지표를 어떻게 계산하는지 제안 또는 구현.

### 2. Update workflow
점수 갱신을 수행하는 workflow 또는 script 제안/구현.

### 3. Data model update
`agent-scores.json` 확장 필요 시 구조 개편안.

### 4. Reporting integration
Telegram 또는 orchestrator report에서 점수를 어떻게 노출할지 제안.

---

## Constraints
- 계산은 해석 가능해야 한다.
- 과도하게 복잡한 ML-style scoring은 금지.
- 데이터가 부족할 때는 null 또는 low-confidence 상태를 허용한다.
- score가 사람 판단을 완전히 대체하지는 않는다.

---

## Evaluation criteria
- interpretability
- usefulness for routing
- maintenance cost
- resistance to noisy data
- ease of implementation

---

## Requested workflow
1. Codex proposes scoring automation
2. Claude proposes scoring automation
3. Cross-review
4. Optional one refinement pass
5. review orchestrator recommends final scoring model

---

## Output format for each agent
### Proposal summary
### Scoring rules
### Required files/workflows
### Risks and edge cases
### Recommended priority
