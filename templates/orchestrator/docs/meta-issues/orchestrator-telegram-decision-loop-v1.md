# orchestrator-telegram-decision-loop-v1

## Summary
Telegram 알림을 단순 이벤트 통지에서 벗어나, 실제 운영 의사결정과 승인/수정/보류 응답을 유도하는 결정 인터페이스로 고도화한다.

---

## Goal
다음을 달성한다.

1. Telegram 메시지 형식을 관제형 의사결정 메시지로 표준화
2. Preview link를 모든 review-ready 상태에서 최우선 노출
3. 사용자 응답을 `APPROVE / REVISE / HOLD` 또는 자유 텍스트 피드백 형태로 수용 가능하게 설계
4. GitHub를 source of truth로 유지하면서 Telegram을 사람 입력 인터페이스로 활용

---

## Success criteria
- [ ] Telegram 메시지가 항상 아래 요소를 포함한다:
  - project name
  - phase
  - best recommendation
  - blockers
  - codex one-line assessment
  - claude one-line assessment
  - preview link
  - explicit requested response
- [ ] review-ready 상태에서 preview link가 누락되면 경고 또는 대체 문구가 나온다.
- [ ] blocker 발생 시 일반 알림과 구분되는 human-input-required 메시지를 보낸다.
- [ ] 사용자 피드백이 나중에 GitHub에 기록될 수 있도록 구조화된 메시지 형식을 제안한다.

---

## Deliverables
### 1. Telegram message format spec
표준 메시지 포맷 정의.

### 2. Event mapping
어떤 GitHub 이벤트에서 어떤 텔레그램 메시지를 보내는지 정리.
예:
- PR review-ready
- cross-review completed
- blocker detected
- final recommendation ready

### 3. Response handling design
사용자 답변을 어떻게 GitHub comment 또는 ops log로 역주입할지 설계.

### 4. Workflow changes
`.github/workflows/telegram-notify.yml` 또는 관련 workflow 개선안.

---

## Constraints
- GitHub remains source of truth.
- Telegram is a decision surface, not the long-term record store.
- Avoid overly long messages.
- Keep action choices obvious.

---

## Evaluation criteria
- decision clarity
- response speed
- human review fatigue reduction
- preview visibility
- compatibility with future webhook ingestion

---

## Requested workflow
1. Codex proposes improved Telegram decision loop
2. Claude proposes improved Telegram decision loop
3. Cross-review
4. Optional one refinement pass
5. review orchestrator recommends final design

---

## Output format for each agent
### Proposal summary
### Message examples
### Required workflow/file changes
### Operational risks
### Recommended priority
