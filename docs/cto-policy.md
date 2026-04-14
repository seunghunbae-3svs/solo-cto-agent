# CTO Tier — Operating Policy

> CTO Tier 의 **기본 권장 구성과 그 이유**.
> 관련: [`docs/tier-matrix.md`](tier-matrix.md) · [`docs/tier-examples.md`](tier-examples.md)

---

## 1. 기본 권장 조합

> **CTO Tier = Full-auto mode + Cowork + Codex dual agent**

이것이 CTO Tier 의 **기본 정책**이다. 세 축 중 두 개(Agent, Mode)의 값이 Tier 와 함께 추천된다. 사용자는 항상 오버라이드할 수 있지만, 각 축을 기본에서 벗어나게 하려면 의식적인 결정이 필요하다.

---

## 2. 왜 이 조합이 기본인가

### 2.1. 왜 Full-auto (codex-main) 인가

CTO Tier 는 여러 레포 / 여러 에이전트 / 여러 리뷰 사이클을 동시에 돈다. 이걸 Semi-auto (desktop agent loop) 로 돌리면:

- 에이전트 세션이 **유저 작업 시간에 종속** 된다 (밤/주말 워크로드 공백)
- 멀티 레포 병렬 리뷰가 desktop runtime 한 개로 직렬화
- PR 이벤트 트리거 대응이 유저 개입을 요구

Full-auto 는 GitHub Actions 에서 상시 돌기 때문에 **유저 부재 시에도 파이프라인이 멈추지 않는다**. CTO Tier 의 본래 목적(크로스 레포 오케스트레이션)에 부합한다.

### 2.2. 왜 Cowork + Codex Dual 인가

CTO Tier 는 **cross-review 자체가 기능이다**. 단일 에이전트로는:

- 같은 에이전트가 놓친 블라인드스팟을 재검토할 주체가 없음
- `[ISSUES]` 의 disagreement 섹션이 비워져서 가장 중요한 시그널 사라짐
- agent-scores 가 비교 대상 없이 1-agent baseline 으로만 쌓임 → routing-engine 의미 없음

Dual agent 는 CTO Tier 의 원가 구조에 내장되어 있고, single-agent 로 돌리면 **Tier 의 실질 가치가 Builder 수준으로 내려간다**.

---

## 3. 이 정책이 강제되는 영역

| 영역 | 강제 여부 | 비고 |
|---|---|---|
| `setup-pipeline --tier cto` | 강제 | Dual agent workflow 24개를 자동 설치. Single-agent 로는 실행 불가. |
| `watch --auto` (CTO + Cowork 단독) | 기본 차단 | `--force` 필요. CLI 가 정책 경고 출력. |
| `watch --auto` (CTO + Cowork+Codex) | 자동 허용 | 정책 조합이므로 경고 없이 진행. |
| orchestrator 레포 생성 | 강제 | CTO Tier 만 생성 가능. Builder 이하에서는 명령 자체 비가용. |
| dual-review 실행 | 선택 | 키 둘 다 있으면 자동 활성, 없으면 경고 후 single 로 degraded. |
| agent-scores routing | 자동 | 등록된 agent 수에 따라 routing-engine 이 자동 어댑트. |

---

## 4. 이 정책을 벗어나는 경우

### 4.1. CTO × Cowork 단독 × Semi-auto

```bash
# 기본 차단
solo-cto-agent watch --auto
# → "CTO+Cowork 단독 조합은 --force 필요"

# --force 로 의식적 오버라이드
solo-cto-agent watch --auto --force
```

허용되는 시나리오:
- CI 인프라 구축 전 로컬에서 orchestrate 기능을 시험
- `OPENAI_API_KEY` 비용을 일시 절감 (장기 사용은 비권장)
- 외부망 차단 환경 (GitHub Actions 접근 불가)

허용되지 않는 이유(정책적으로):
- Dual cross-check 가 없으면 CTO Tier 의 핵심 가치인 **분산 검증** 이 사라짐
- `agent-scores.json` 의 `by_repo` 점수가 Claude baseline 만 쌓여 routing 의미 없음
- BLOCKER 판정이 단일 에이전트의 의견이 되어 false negative 위험

### 4.2. CTO × Cowork+Codex × Semi-auto

허용. 다만 권장 조합은 아님. 시나리오:
- 개인 프로젝트라 CI 인프라가 과함
- GitHub Actions 크레딧을 아끼고 싶음
- 실시간 desktop 에이전트 개입이 우선순위

이 조합에서는 `watch --auto` 가 **정책 조합(Cowork+Codex)** 이므로 자동 허용된다.

### 4.3. CTO × 어떤 조합이든 × 수동 오버라이드

`~/.claude/skills/solo-cto-agent/SKILL.md` 에서 직접 오버라이드 가능:

```yaml
tier: cto
agent: cowork   # cowork+codex 가 기본이지만 cowork 단독으로 강제
mode: semi-auto # full-auto 가 기본이지만 semi-auto 로 강제
```

CLI 는 이 조합을 **경고와 함께 허용** 한다. 정책 위반은 아니고, 운영 선택이다.

---

## 5. Circuit Breaker 와 Fail-Safe

CTO Tier 는 자동화 범위가 넓기 때문에 circuit breaker 가 더 엄격하다:

| 상황 | 정책 |
|---|---|
| 같은 에러 3회 연속 | 자동 중지 + `error-patterns.md` 에 append + 슬랙 알림 (설정 시) |
| `apply-fixes` 누적 5개 도달 | 자동 중지. `--max-fixes` 로 상향 가능하나 비권장. |
| cross-review disagreement 가 3회 연속 BLOCKER 로 갈림 | rework 루프 강제 중단. 유저 개입 요구. |
| agent score 변동이 24h 내 40% 이상 | 데이터 이상 의심 → routing-engine 일시 single-agent 모드로 하강 |

이 정책들은 CTO Tier 가 **"자동이지만 자기파괴적이지 않다"** 는 약속이다.

---

## 6. Downgrade 경로

CTO 를 선택했지만 부담이 크면:

```bash
# Builder 로 다운그레이드
# ~/.claude/skills/solo-cto-agent/SKILL.md 의 tier: cto → builder

# orchestrate 스킬만 비활성화하고 나머지 유지하고 싶으면
# SKILL.md 에서 skills: 목록에서 orchestrate 만 제거
```

Downgrade 해도 **기존 데이터(knowledge, memory, agent-scores, error-patterns) 는 보존**된다. 다시 CTO 로 돌아올 때 그대로 쓸 수 있다.

---

## 7. 요약

- CTO Tier 의 **기본값** = Full-auto + Cowork+Codex.
- 이 조합을 벗어나려면 **의식적 오버라이드** 가 필요 (`--force`, SKILL.md 수정).
- Circuit breaker 가 더 엄격 — 자동화 범위에 비례한 안전장치.
- Downgrade 는 무손실.

CTO Tier 는 **멀티 레포 + 멀티 에이전트 + 상시 파이프라인** 을 전제로 만들어진 티어다. 이 중 하나라도 맞지 않으면 Builder 가 맞는 선택이다.
