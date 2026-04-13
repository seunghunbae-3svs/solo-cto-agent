# orchestrator-hardening-v1

## Summary
운영 중인 dual-agent review orchestrator 시스템의 품질, 안정성, 토큰 효율, 작업 배분 정확도를 한 단계 끌어올리기 위한 메타 개선 이슈.

이 이슈는 일반 기능 개발 이슈가 아니라 **운영 시스템 자체를 검증하고 고도화하는 meta issue**다.

Codex와 Claude는 이 이슈를 각각 독립적으로 분석하고 개선안을 제안해야 하며, 이후 교차 리뷰와 review orchestrator의 판단을 통해 최종 운영 규칙을 선택하거나 통합한다.

---

## Goal
다음 항목을 개선한다.

1. Telegram 알림을 단순 알림에서 **결정 인터페이스**로 업그레이드
2. agent-scores 자동 누적 및 작업 배분 반영
3. 라우팅 규칙을 문서 수준에서 실제 자동 배분 엔진 수준으로 강화
4. CI를 문법 검사에서 운영 검증까지 확장
5. orchestrator 자체를 별도 이벤트로 검증하는 메타 루프 도입

---

## Why this matters
현재 시스템은 다음 강점을 이미 갖고 있다.

- dual-agent 병렬 작업 가능
- 교차 리뷰 가능
- Telegram 알림 가능
- Preview link 전달 가능
- 리뷰 라운드 제한 존재
- GitHub를 source of truth로 유지

하지만 아래는 아직 개선 여지가 있다.

- Telegram 메시지가 아직 관제형 의사결정 메시지로 충분히 구조화되지 않음
- agent-scores는 파일 구조만 있고 실사용 데이터 축적 및 배분 반영이 약함
- CI가 운영 규칙 검증보다 문법/존재 확인에 가까움
- routing policy가 아직 문서 중심이고 자동 추천 강도가 약함
- orchestrator 자체를 메타 이슈로 검증하는 루프가 아직 없음

---

## Success criteria
다음이 모두 충족되면 완료로 본다.

- [ ] Telegram 메시지가 항상 아래 요소를 포함한다:
  - current phase
  - best recommendation
  - blockers
  - codex assessment
  - claude assessment
  - preview link
  - required response: APPROVE / REVISE / HOLD
- [ ] `ops/orchestrator/agent-scores.json`가 실제 이벤트에 따라 자동 업데이트된다.
- [ ] task routing이 최소한 아래 기준을 자동 반영한다:
  - risk level
  - task type
  - historical agent score
  - user feedback priority
- [ ] CI가 최소 아래를 검증한다:
  - workflow syntax
  - JSON schema / score file validity
  - required report fields
  - preview link presence rule when applicable
- [ ] review loop termination 기준이 문서뿐 아니라 실제 운영 판단 기준으로 반영된다.
- [ ] orchestrator 자체 검증용 meta flow가 문서화되거나 자동화된다.

---

## Required deliverables

### 1. Telegram decision-message upgrade
아래 항목을 포함하는 표준 Telegram 메시지 포맷 제안 및 반영.

- project name
- phase
- recommendation
- blockers
- codex one-line assessment
- claude one-line assessment
- preview link
- explicit requested action from user

### 2. Agent scoring automation
다음 이벤트를 기준으로 `agent-scores.json` 갱신 로직 제안 또는 구현.

- PR opened
- CI success/failure
- cross-review produced
- fix adopted from review
- merge completed
- hotfix or rollback required

추천 지표:
- accuracy
- test_pass_rate
- review_hit_rate
- rework_rate
- tasks_completed

### 3. Routing engine upgrade
다음 기준으로 single-agent / dual-agent / lead-reviewer 모드를 추천하는 로직 제안 또는 구현.

- low-risk narrow task → single-agent
- high-risk or ambiguous task → dual-agent
- one agent consistently stronger on repo/task type → lead
- stronger reviewer hit rate on one side → reviewer preference

### 4. CI hardening
현재 CI 외에 아래 운영 검증을 추가 제안 또는 구현.

- score file format validity
- required report sections
- Telegram payload format safety
- preview link field rule
- round-log structure consistency

### 5. Meta validation flow
이 운영 시스템을 다시 같은 방식으로 검증하는 메타 루프를 제안.

예:
- orchestrator policy review event
- routing-engine review event
- telegram-decision-loop validation event

---

## Constraints
- 최대 리뷰 라운드는 2회를 유지한다.
- Telegram은 결정 인터페이스로 강화하되, GitHub를 계속 system of record로 둔다.
- production deploy는 사람 승인 없이는 진행하지 않는다.
- agent 간 역할 차이는 유지하되, 불필요한 무한 수렴 루프는 만들지 않는다.
- 새 기능보다 운영 신뢰성 향상을 우선한다.

---

## Evaluation framework
각 에이전트는 아래 기준으로 자신의 개선안을 제안해야 한다.

1. 품질 향상 효과
2. 토큰 효율성
3. 운영 복잡도 증가 여부
4. 사람 검토 피로도 감소 여부
5. 실제 자동화 가능성

review orchestrator는 최종적으로 아래 중 하나를 추천해야 한다.

- Codex proposal preferred
- Claude proposal preferred
- merged recommendation
- keep current behavior for now

---

## Requested workflow
이 이슈는 다음 순서로 진행한다.

1. Codex가 개선안 제안
2. Claude가 개선안 제안
3. Codex가 Claude 안 리뷰
4. Claude가 Codex 안 리뷰
5. 필요 시 각자 1회 개선
6. review orchestrator가 비교, 점수화, 추천안 작성
7. Telegram으로 최종 요약 + preview link + required decision 전달
8. 사용자 피드백 반영 후 종료 또는 follow-up meta issue 생성

---

## Output format for each agent
각 에이전트는 아래 형식으로 응답한다.

### Proposal summary
무엇을 어떻게 바꾸는지 요약

### Why this is better
현재 구조보다 왜 나은지

### Files or workflows to change
변경 대상 파일 / workflow / rules

### Token efficiency impact
토큰 사용량에 어떤 영향이 있는지

### Operational risk
운영상 위험이 무엇인지

### Recommendation priority
P0 / P1 / P2로 나눠 우선순위 제안

---

## Suggested labels
- meta
- orchestrator
- hardening
- dual-agent
- telegram
- routing
- ci

---

## Follow-up issues likely to be created
- orchestrator-telegram-decision-loop-v1
- orchestrator-agent-scoring-automation-v1
- orchestrator-routing-engine-v1
- orchestrator-ci-hardening-v1
- orchestrator-meta-validation-v1
