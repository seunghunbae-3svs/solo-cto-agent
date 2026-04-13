# orchestrator-routing-engine-v1

## Summary
single-agent / dual-agent / lead-reviewer 모드를 실제 작업 특성과 에이전트 성능 데이터를 바탕으로 동적으로 추천하는 routing engine을 설계 또는 구현한다.

---

## Goal
다음을 달성한다.

1. task type과 risk level에 따라 실행 모드 자동 추천
2. historical agent score를 routing에 반영
3. user feedback priority를 routing에 반영
4. routing 이유를 round log에 기록

---

## Success criteria
- [ ] low-risk narrow task는 기본적으로 single-agent를 추천한다.
- [ ] high-risk, ambiguous, high-impact task는 dual-agent를 추천한다.
- [ ] 특정 repo 또는 task type에서 한 에이전트 성능이 명확히 우세하면 lead preference를 반영한다.
- [ ] review_hit_rate가 높은 에이전트는 reviewer 역할에서 가중치를 받는다.
- [ ] routing 결정이 `ops/orchestrator/round-logs/`에 이유와 함께 기록될 수 있다.

---

## Deliverables
### 1. Routing rule spec
입력값과 결과값 정의.

입력 예시:
- risk level
- task type
- affected files count
- historical scores
- user preference

출력 예시:
- single-agent
- dual-agent
- codex lead / claude reviewer
- claude lead / codex reviewer

### 2. Decision rubric
어떤 상황에서 어떤 결과가 나오는지 명시.

### 3. Logging design
routing rationale를 어떻게 기록할지 설계.

### 4. Future automation path
문서 규칙에서 자동 추천 로직으로 어떻게 발전시킬지 제안.

---

## Constraints
- routing logic must remain explainable.
- user feedback overrides automatic preference.
- avoid unstable mode switching from noisy short-term results.
- do not optimize only for speed; quality and review value matter.

---

## Evaluation criteria
- routing usefulness
- explainability
- consistency across similar tasks
- sensitivity to user preferences
- operational simplicity

---

## Requested workflow
1. Codex proposes routing-engine design
2. Claude proposes routing-engine design
3. Cross-review
4. Optional refinement pass
5. review orchestrator recommends final routing logic

---

## Output format for each agent
### Proposal summary
### Decision rubric
### Examples of routing outcomes
### Required files/workflows
### Risks
### Recommended priority
