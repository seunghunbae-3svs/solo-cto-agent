# orchestrator-ci-hardening-v1

## Summary
현재 레포의 CI를 문법/존재 확인 중심에서 운영 검증 중심으로 확장한다.

---

## Goal
다음을 달성한다.

1. workflow와 운영 데이터 파일의 무결성 검증
2. orchestrator report와 Telegram payload 포맷 검증
3. preview link, score file, round log 규칙 검증
4. 운영 규칙 변경이 main에 들어가기 전에 최소 검증을 통과하게 만들기

---

## Success criteria
- [ ] YAML/JSON 문법 검사 외에 운영 규칙 검사가 추가된다.
- [ ] `ops/orchestrator/agent-scores.json` 포맷 유효성 검사가 있다.
- [ ] round log structure consistency 검사가 있다.
- [ ] Telegram payload generation safety 또는 최소 포맷 검사가 있다.
- [ ] preview link required rule when applicable 검사가 있다.
- [ ] required report sections 누락 여부를 확인할 수 있다.

---

## Deliverables
### 1. CI expansion plan
현재 `ci.yml`에서 어떤 잡을 추가할지 제안 또는 구현.

### 2. Validation targets
아래 대상 검증 설계.
- score JSON
- round log structure
- report template sections
- telegram message schema
- workflow reference consistency

### 3. Failure behavior
검증 실패 시 어떤 수준으로 막을지 제안.
- warning only
- fail PR
- fail release gate

---

## Constraints
- CI는 유지보수 가능해야 한다.
- 과도한 false positive를 피한다.
- 로컬 개발을 지나치게 방해하지 않는다.
- 운영에 중요한 것부터 우선 검증한다.

---

## Evaluation criteria
- reliability gain
- false positive risk
- maintenance cost
- implementation complexity
- usefulness before merge

---

## Requested workflow
1. Codex proposes CI hardening
2. Claude proposes CI hardening
3. Cross-review
4. Optional one refinement pass
5. review orchestrator recommends final CI expansion plan

---

## Output format for each agent
### Proposal summary
### Validation scope
### Required files/workflows
### Failure policy
### Risks
### Recommended priority
