# cowork-main — Semi-Auto Mode Install & Operating Guide

`cowork-main` = **Semi-auto mode**
`codex-main` = **Full-auto mode**

Cowork refers to the **Claude agent**.

---

## 0. Three Axes: Tier × Agent × Mode

`solo-cto-agent`는 3개의 독립 축으로 설계됩니다.

| 축 | 의미 | 값 |
|---|---|---|
| **Tier** (기능 강도) | 어떤 수준의 자동화/검증을 쓰는가 | `Maker` / `Builder` / `CTO` |
| **Agent** (구성) | 어떤 에이전트 조합을 쓰는가 | `Cowork`(Claude 단독) / `Cowork + Codex`(Dual) |
| **Mode** (운영 방식) | 자동화 엔진이 어디에서 도는가 | `Semi-auto`(cowork-main) / `Full-auto`(codex-main) |

이 문서는 **Mode = Semi-auto(cowork-main)** 기준으로 설명합니다.

---

## 1. Semi-auto mode (cowork-main) 정의

Cowork는 **desktop runtime**에서 동작하고, 품질은 **cloud amplifiers**가 올립니다.

- 로컬이 runtime, 클라우드는 amplifier
- 오프라인은 **정상 운영이 아니라 degraded fallback**
- 완성도는 **클라우드 통합**에서 올라갑니다

---

## 2. Agent 구성

### Cowork 단독 (Claude)
- 필요 키: `ANTHROPIC_API_KEY`
- 장점: 비용/속도 균형, 로컬 중심 운영

### Cowork + Codex (Dual)
- 필요 키: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- 장점: 교차 리뷰, 품질 편향 감소

---

## 3. 설치 (5분)

```bash
npx solo-cto-agent init --wizard
```

Wizard에서:
- **Mode**: `cowork-main` 선택
- 스택 입력: OS / Editor / Framework / Deploy / DB 등

환경변수:
```bash
# Cowork 단독
export ANTHROPIC_API_KEY="sk-ant-..."

# Dual
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

---

## 4. Tier 선택 (Maker / Builder / CTO)

- **Maker**: 수동 중심, 개인 작업에 최적
- **Builder**: 운영 루틴 강화, 반복 작업 고속화
- **CTO**: 정책 기반 의사결정 + 교차 검증 (권장 모드: Full-auto + Dual)

Semi-auto + CTO는 **일부 기능만 사용**하는 형태입니다.
자세한 정책은 `docs/cto-policy.md` 참고.

---

## 5. Cloud Amplifiers

Semi-auto는 다음 클라우드 레이어로 성능이 강화됩니다:

1) **MCP Connectors**: GitHub, Vercel, Supabase, Figma, Drive, Slack
2) **Web Search / WebFetch**: 최신 레퍼런스 주입
3) **Scheduled Tasks**: 반복 리포트/모니터링
4) **Multimodal**: 이미지/시각 검증 포함
5) **Live Source of Truth**: 최신 repo/문서 기반 판단

---

## 6. Degraded fallback (오프라인)

오프라인은 정상 운영이 아니라 **임시 모드**입니다.
- Web search 불가
- 외부 MCP 연결 불가
- 최신성 검증 불가

---

## 7. 표준 예시 (권장 흐름)

### 예시 A — Cowork 단독
1) 모드 설정
```
# ops/orchestrator/project-config.json
{ "automation_mode": "cowork-main" }
```
2) Cowork 단독으로 작업
```
# issue 생성
"[tribo] seller page not loading"

# 리뷰 요청
"repo review"
```

### 예시 B — Cowork + Codex (Dual)
1) Dual 구성
```
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```
2) dual-review 라벨로 교차 리뷰
```
gh issue edit <ISSUE_NUMBER> --add-label "dual-review,agent-codex,agent-claude"
```
3) 결정 (Telegram)
```
"repo PR17 approve"
"repo PR17 revise add loading state"
"repo PR17 hold"
```

---

## 8. 참고 문서
- `docs/tier-matrix.md`
- `docs/tier-examples.md`
- `docs/cto-policy.md`
