# orchestrator-meta-validation-v1

## Summary
orchestrator 자체를 다시 같은 dual-agent 방식으로 검증하는 메타 루프를 설계 또는 구현한다.

---

## Goal
다음을 달성한다.

1. orchestrator 정책과 동작을 주기적으로 점검하는 meta validation 흐름 도입
2. routing, scoring, telegram loop, CI hardening 같은 운영 규칙 변경을 다시 교차 검증하는 표준 절차 정의
3. 운영 시스템이 스스로 개선될 수 있는 feedback loop 구축

---

## Success criteria
- [ ] orchestrator 정책 변경을 검증하는 meta issue/event 흐름이 정의된다.
- [ ] 어떤 변경이 meta validation 대상인지 규칙이 있다.
- [ ] review orchestrator가 자신에 대한 평가를 수행할 때의 제한과 기준이 명시된다.
- [ ] 결과적으로 follow-up meta issue 생성 기준이 정리된다.

---

## Deliverables
### 1. Meta validation trigger policy
어떤 변경이 meta validation을 요구하는지 정의.

예:
- routing policy change
- scoring model change
- telegram decision loop change
- deployment gate change
- CI governance change

### 2. Meta review workflow
다음 순서를 표준화.
- proposal
- counter-proposal
- cross-review
- optional refinement
- orchestrator recommendation
- user decision

### 3. Safeguards
orchestrator가 자기 자신을 평가할 때 생길 수 있는 편향이나 무한 루프를 막는 규칙.

### 4. Documentation path
meta review 결과를 어디에 기록하고 어떻게 follow-up issue를 만들지 제안.

---

## Constraints
- meta validation must not become an endless recursive process.
- maximum review rounds remain capped.
- user decision remains final.
- meta issues should be used selectively for high-impact operational changes.

---

## Evaluation criteria
- governance quality
- recursion control
- practical usefulness
- documentation clarity
- operational overhead

---

## Requested workflow
1. Codex proposes meta validation model
2. Claude proposes meta validation model
3. Cross-review
4. Optional one refinement pass
5. review orchestrator recommends final meta-validation approach

---

## Output format for each agent
### Proposal summary
### Trigger policy
### Workflow design
### Safeguards
### Risks
### Recommended priority
