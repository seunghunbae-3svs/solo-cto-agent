# Tier Matrix — `solo-cto-agent`

> **Tier 축 정의 문서.** 기능 범위를 결정하는 축. Agent(구성) · Mode(자동화) 와 독립적으로 선택한다.
> 관련: [`docs/tier-examples.md`](tier-examples.md) · [`docs/cto-policy.md`](cto-policy.md) · [`docs/cowork-main-install.md`](cowork-main-install.md)

---

## 1. Why Tier exists

솔로 파운더 / 인디해커 / 소규모 팀은 **같은 레포라도 그날의 작업 맥락**에 따라 필요한 기능이 다르다.

- 아이디어를 풀어쓰는 날 → review·memory·craft 만 있으면 충분
- 기능 빌드 / 배포 가는 날 → build·ship 이 추가로 필요
- 파이프라인 / 멀티-에이전트 오케스트레이션 → orchestrate 가 추가

매번 "설치 / 해제" 하지 않고 **한 번 설치해 두고 필요한 Tier 만 활성화**할 수 있도록 기능 범위를 3 단계로 나눈 것이 Tier 축이다.

Tier 는 **기능이 켜지느냐** 의 문제이고, Agent / Mode 축은 **누가·어디서 돌리느냐** 의 문제다. 셋은 서로 독립적으로 선택한다.

---

## 2. Tier 정의 표

| 항목 | **Maker** (Lv3) | **Builder** (Lv4, default) | **CTO** (Lv5+6) |
|---|---|---|---|
| **포함 스킬** | spark · review · memory · craft | Maker + build · ship | Builder + orchestrate |
| **대상 유저** | 크리에이터 / 솔로 기획자 / 디자이너 / 1-person 프로젝트 | 솔로 개발자 / 인디해커 / 소규모 팀 | 멀티-에이전트 운영 / CI 인프라 있는 팀 / 파운더 겸 CTO |
| **기본 Agent** | Cowork 단독 | Cowork 단독 또는 Cowork+Codex | Cowork+Codex (정책, `cto-policy.md`) |
| **기본 Mode** | Semi-auto | Semi-auto 또는 Full-auto | Full-auto (정책) |
| **필요 API 키** | `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` (+ `OPENAI_API_KEY` 선택) | `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` |
| **CI 인프라** | 불필요 | 선택 | 권장 |
| **Circuit Breaker** | 3회 재시도 | 3회 재시도 | 3회 재시도 + 정책 lock |
| **Watch 자동화** | manual only | manual only (`--force` 로 자동 가능) | auto allowed (cowork+codex 조합 한정) |
| **대표 명령** | `review`, `knowledge`, `session save` | Maker + `apply-fixes`, `uiux-review`, `watch`, `notify` | Builder + `setup-pipeline`, dual-review, routing-engine |

---

## 3. 활성화 방법

### 3.1. 설치 시 프리셋 선택

```bash
# Maker — 가벼운 에이전트 루프만
npx solo-cto-agent init --preset maker

# Builder (default) — 빌드/배포까지
npx solo-cto-agent init --preset builder

# CTO — 멀티-에이전트 오케스트레이션
npx solo-cto-agent init --preset cto
```

### 3.2. 설치 후 Tier 전환

`~/.claude/skills/solo-cto-agent/SKILL.md` 의 `tier:` 필드를 직접 수정하거나, wizard 재실행:

```bash
npx solo-cto-agent init --wizard
```

Tier 는 한 번 정하면 대부분 그대로 쓰지만 **프로젝트 단위로 바꿔도 된다**. 스킬 파일은 글로벌 + 프로젝트 로컬 둘 다 작동한다.

---

## 4. Tier 가 영향을 주는 것 / 주지 않는 것

### 영향 주는 것
- 활성화되는 스킬 목록
- `setup-pipeline` 시 생성되는 GitHub workflow 개수
- `watch --auto` 정책 (CTO + Cowork+Codex 만 기본 auto, 그 외는 `--force` 필요)
- `orchestrate` 관련 명령의 가용성

### 영향 주지 않는 것 (세 축 공통)
- 에이전트 정체성 (CTO 급 co-founder)
- 판정 분류 (`APPROVE` / `REQUEST_CHANGES` / `COMMENT`)
- 심각도 (`BLOCKER` / `SUGGESTION` / `NIT`)
- 팩트 태깅 (`[확정]` / `[추정]` / `[미검증]`)
- 리뷰 체크리스트 (10항목)
- Circuit Breaker (3회 재시도, 30/60/90s 백오프)
- 출력 포맷 (`[VERDICT]` / `[ISSUES]` / `[SUMMARY]` / `[NEXT ACTION]`)

즉 **판단 기준과 품질은 Tier 와 무관하게 동일** 하다. Tier 는 기능 범위만 결정한다.

---

## 5. Tier 선택 가이드

| 상황 | 권장 Tier |
|---|---|
| 아이디어 정리 / 글쓰기 / 기획이 대부분 | Maker |
| 솔로로 SaaS 빌드하며 배포까지 혼자 | Builder |
| 멀티 프로젝트 운영 + 반자동 개선 loop | Builder (+ Semi-auto watch) |
| 멀티-에이전트 크로스리뷰 / 파이프라인 운영 | CTO |
| 팀이 있고 CI/CD 가 이미 돌고 있음 | CTO + Full-auto |
| 정말 뭘 고를지 모르겠다 | Builder (default) |

---

## 6. Tier 전환 시 주의사항

- **Maker → Builder**: 신규 스킬(build/ship) 이 추가되며 `setup-pipeline` 을 돌릴 수 있게 된다. 기존 작업물은 영향 없음.
- **Builder → CTO**: `OPENAI_API_KEY` 가 없으면 dual-review 기능이 "degraded" 로 돌고 Cowork 단독처럼 작동. 키 설정 후 자동 활성화.
- **CTO → Builder 역방향**: `orchestrate` 스킬 제거. `routing-policy.json` 은 남지만 에이전트 라우팅이 single-agent 모드로 자동 downgrade.
- **어떤 전환이든 기존 `knowledge/`, `memory/`, `session` 데이터는 보존** 된다 — Tier 는 스킬 활성화 여부일 뿐이다.

---

## 7. 참고

- Tier × Agent × Mode 조합 구체 시나리오: [`tier-examples.md`](tier-examples.md)
- CTO Tier 정책 (왜 Full-auto + Dual 이 권장인가): [`cto-policy.md`](cto-policy.md)
- 설치 흐름 전체: [`cowork-main-install.md`](cowork-main-install.md)
