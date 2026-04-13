# cowork-main — Install & Operating Guide

> Claude Cowork 안에서 CTO급 개발/디자인/텍스트 품질을 만드는 데스크톱 네이티브 모드.
> 외부 CI 없이도 **에이전트 루프 자체가 자동화 엔진**이 된다.

---

## 1. What cowork-main is

`cowork-main` 은 Claude Cowork (desktop) 안에서 돌아가는 **자체 완결형 AI CTO 모드**다.
외부 webhook / GitHub Actions 없이 세션 내부에서:

- 코드/디자인/문서를 **정해진 품질 기준까지** 에이전트가 반복 작업하고
- Claude 단독 또는 Claude + Codex 조합으로 **자동 크로스리뷰**를 돌리고
- 유저의 인풋·결정·스타일을 세션마다 누적해 **개인화된 CTO 모델**로 성장한다.

### codex-main과의 포지셔닝 차이

| | cowork-main | codex-main |
|---|---|---|
| 실행 환경 | Claude Cowork (desktop) / 로컬 CLI | GitHub Actions (CI/CD) |
| 트리거 | 에이전트 루프, 사용자 호출, 스케줄 | PR 이벤트, webhook, dispatch |
| 자동화 지점 | 세션 내부 | 원격 파이프라인 |
| 네트워크 의존도 | 낮음 (오프라인에서도 review 동작) | 높음 (GitHub API 안정성 필수) |
| 적합 유저 | 솔로 파운더, 크리에이터, 불안정 연결 | CI 인프라 있는 팀 |

**한 줄 요약:** codex-main 은 레포 밖에서 돌아가는 봇이고, cowork-main 은 **당신 옆에서 일하는 에이전트**다.

---

## 2. 두 가지 사용 패턴

### Solo — Claude Cowork 단독

Claude API 키 하나로 시작. 리뷰, 문서 생성, 크래프트, 메모리 모두 Claude 단독으로 동작.
- 세션 내에서 **self cross-review** 가능 (craft → review → craft 루프, 체크리스트 자동 검증)
- Tier가 높아질수록 자기 검증 강도 상승 (§4 참조)

### Dual — Claude Cowork + Codex

`ANTHROPIC_API_KEY` + `OPENAI_API_KEY` 둘 다 설정되면 **자동으로 Dual 모드로 전환**된다.
- `review` 명령이 Claude 리뷰 → Codex 리뷰 → 교차검증을 **한 번에** 실행
- 두 모델의 판정이 다르면 `[ISSUES]` 섹션에 교차 차이가 표시됨
- Dual 모드를 강제로 끄고 싶으면 `solo-cto-agent review --solo`

모드 전환에 별도 설정은 없다. API 키 유무만으로 결정된다.

---

## 3. Install — 5분 흐름

### 3.1. 설치

```bash
npx solo-cto-agent init --wizard
```

Wizard가 묻는 항목:

1. **Mode** — `[2] cowork-main` 선택
2. **Stack** — OS / Editor / Framework / Style / Deploy / DB / 패키지 매니저
3. **Optional** — GitHub org/username, Primary language

Wizard가 끝나면 `~/.claude/skills/solo-cto-agent/SKILL.md` 가 생성되고, `mode: cowork-main` 필드가 설정된다.

### 3.2. API 키

최소 하나 필요. 둘 다 있으면 Dual 모드 자동 활성.

```bash
# Solo — Claude만
export ANTHROPIC_API_KEY="sk-ant-..."

# Dual — Claude + Codex
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

키는 세션 환경변수 또는 shell rc 파일 (zshrc, bashrc, Powershell profile)에 넣는다.

### 3.3. 확인

```bash
solo-cto-agent doctor
```

Skills / engine / API keys / lint / sync / catalog 상태를 한 번에 점검한다.

---

## 4. 3단계 Preset — Maker / Builder / CTO

프로젝트 규모와 유저 경험에 따라 선택. `init --preset <tier>` 또는 wizard에서 지정.

| Preset | 대상 유저 | 포함 스킬 | 자동화 강도 |
|---|---|---|---|
| **Maker** | 처음 쓰는 사람, 크리에이터, 1인 | spark / review / memory / craft | 가이드 중심 (안전 기본값) |
| **Builder** (default) | 솔로 개발자 | Maker + **build** + **ship** | 실행 중심 (자동 재시도, 회로 차단기) |
| **CTO** | 파워 유저, 소규모 팀 | Builder + **orchestrate** | 판단 위임 (의사결정 추적, 멀티 에이전트 라우팅) |

Preset은 나중에 `solo-cto-agent upgrade` 로 올릴 수 있다. 다운그레이드는 권장하지 않음.

---

## 5. 일상 워크플로우 — 세션 안에서 자동화가 어떻게 돌아가나

cowork-main 의 자동화는 **"외부 CI 대신 Claude 루프가 일한다"** 는 뜻이다. 사용자는 의도만 던지고, 에이전트가 필요한 명령을 실행한다.

### 5.1. 작업 시작 시

```bash
solo-cto-agent session restore          # 이전 세션 컨텍스트 복구
# (또는 Claude Cowork에 말로 "어디까지 했었지?" — 에이전트가 자동 실행)
```

### 5.2. 코드 작업 중

에이전트가 `craft` → `build` 반복. 특정 지점에서 자동으로:

```bash
solo-cto-agent review                   # staged diff 자동 리뷰 (Solo/Dual 자동 감지)
solo-cto-agent review --branch          # 브랜치 전체 diff
solo-cto-agent review --file path.ts    # 단일 파일
solo-cto-agent review --json            # 다음 단계를 파싱하려면 JSON
```

판정은 `APPROVE` / `REQUEST_CHANGES` / `COMMENT` (한글: 승인/수정요청/보류). 심각도는 `BLOCKER` ⛔ / `SUGGESTION` ⚠️ / `NIT` 💡.
`REQUEST_CHANGES` 가 떨어지면 에이전트가 수정 후 재리뷰까지 한 루프로 돌린다.

### 5.3. 결정·에러·패턴 저장

```bash
solo-cto-agent knowledge                # 최근 세션에서 결정/에러 패턴 추출
solo-cto-agent knowledge --source file --file notes.md
solo-cto-agent knowledge --project tribo
```

저장 위치: 홈 디렉토리 지식 아티클 + 프로젝트 STATE.md. 다음 세션에서 자동 로드됨.

### 5.4. 세션 종료

```bash
solo-cto-agent session save             # 현재 컨텍스트 스냅샷
```

`bae-self-evolve` 스킬이 활성화돼 있으면 종료 시 일일 로그 / quality-log / error-patterns 자동 어펜드.

### 5.5. 원격 데이터 동기화 (선택)

codex-main 오케스트레이터 레포가 있는 경우에만 사용. 없으면 이 섹션 건너뜀.

```bash
solo-cto-agent sync --org <github-org>            # dry-run — 변경 사항만 표시
solo-cto-agent sync --org <github-org> --apply    # 로컬 캐시에 머지
```

기본 **dry-run**. `--apply` 가 있을 때만 실제 파일을 수정한다.

필요 env var (sync 명령에만):
- `GITHUB_TOKEN` / `GH_TOKEN` / `ORCHESTRATOR_PAT` 중 하나
- `--org` 플래그 (org name)
- `--orchestrator-name <repo>` (기본값 `dual-agent-orchestrator`)

---

## 6. 개인화 — 쓸수록 당신 스타일이 되는 구조

cowork-main 의 핵심 자산은 **누적된 컨텍스트**다. 다음 자료들이 세션마다 쌓이고 다음 세션에서 자동 로드된다.

| 자산 | 위치 | 누가 쓰나 |
|---|---|---|
| **SKILL.md** — 스택 / 규칙 / 선호 포맷 | `~/.claude/skills/solo-cto-agent/SKILL.md` | 모든 스킬 |
| **STATE.md** — 프로젝트별 현재 단계 | 작업 중인 프로젝트 루트 | `memory`, `build`, `ship` |
| **Knowledge articles** — 결정 / 에러 / 패턴 | 홈 디렉토리 memory 폴더 | `review`, `knowledge`, `spark` |
| **Session snapshots** — 세션 복원 | `session save` 경로 | 다음 세션 시작 시 자동 |
| **Style calibration** — 유저 코드/문서/디자인 취향 | SKILL.md + knowledge 누적 | `craft`, `review`, design 스킬 |

**결과:** 5~10세션 지나면 에이전트가
- 당신이 싫어하는 코드 패턴을 미리 피하고
- 당신이 자주 쓰는 스택으로 기본값을 잡고
- 당신의 문서 톤을 모사하고
- 당신이 내린 결정과 충돌하는 제안을 스스로 걸러낸다.

개인화는 강제되지 않는다. Knowledge 저장이나 session save 를 쓰지 않으면 일반 모드로 동작.

---

## 7. 자동화 경계 — 무엇이 자동이고 무엇이 아닌가

### 자동으로 일어나는 일 (세션 안에서)

- 에이전트가 판단한 `craft → review → craft` 루프
- Circuit Breaker (같은 에러 3회 반복 시 자동 중단 + 원인 요약)
- Tier에 맞는 품질 체크리스트 자동 적용
- Dual 모드에서 Claude ↔ Codex 교차리뷰
- 세션 컨텍스트 로드/저장 (session 명령 또는 `bae-self-evolve` 훅)

### 사용자 호출이 있어야만 일어나는 일

- 원격 sync (`sync --apply`)
- `git push` — PR 생성/머지 (cowork-main 은 코드 변경만 스테이징, push는 사용자가)
- 프로덕션 DB 스키마 변경
- 새 레포 생성
- 외부 서비스 결제·계약 발생 작업

### 절대 안 하는 일 — "cowork-main does NOT"

- PR 자동 머지 (codex-main 기능)
- webhook / GitHub Actions 의존
- 원격 파일을 dry-run 없이 바로 수정
- 네트워크 실패 시 세션 차단 (실패하면 오프라인 fallback으로 로컬 캐시만 사용)

---

## 8. Environment Variables — 전체 목록

| 변수 | 필수 여부 | 용도 |
|---|---|---|
| `ANTHROPIC_API_KEY` | review/knowledge 사용 시 필수 | Claude 호출 |
| `OPENAI_API_KEY` | Dual 모드에만 | Codex 호출 (있으면 자동 Dual) |
| `GITHUB_TOKEN` / `GH_TOKEN` / `ORCHESTRATOR_PAT` | `sync` 사용 시 셋 중 하나 | 오케스트레이터 레포 조회 |
| `TELEGRAM_BOT_TOKEN` | 선택 | 리뷰 결과 텔레그램 알림 |
| `TELEGRAM_CHAT_ID` | 선택 | 알림 대상 chat |

env var 를 프로젝트별로 관리하고 싶으면 프로젝트 루트 `.env.local` 을 사용. Wizard가 `.env.example` 템플릿을 만들어 둔다.

---

## 9. CLI Reference — cowork-main 에서 자주 쓰는 명령

```bash
# 설치 / 점검
solo-cto-agent init --wizard
solo-cto-agent doctor
solo-cto-agent status                 # 로컬 캐시만, 네트워크 없음

# 리뷰 (Solo/Dual 자동 감지)
solo-cto-agent review                 # staged diff
solo-cto-agent review --branch
solo-cto-agent review --file <path>
solo-cto-agent review --solo          # Dual 강제 해제
solo-cto-agent review --json          # 파싱용 JSON 출력
solo-cto-agent review --dry-run       # 프롬프트만 확인, API 호출 없음

# 지식 누적
solo-cto-agent knowledge
solo-cto-agent knowledge --source file --file notes.md
solo-cto-agent knowledge --project <tag>

# 세션 컨텍스트
solo-cto-agent session save
solo-cto-agent session restore
solo-cto-agent session list

# 원격 동기화 (선택)
solo-cto-agent sync --org <org>
solo-cto-agent sync --org <org> --apply
solo-cto-agent sync --org <org> --repos repo1,repo2
```

> `setup-pipeline`, `setup-repo` 명령은 cowork-main 에서 호출되면 "Not needed in cowork-main mode" 메시지만 뜬다. 이들은 codex-main 전용이다.

---

## 10. Troubleshooting

| 증상 | 원인 / 해결 |
|---|---|
| `❌ ANTHROPIC_API_KEY required` | 환경변수 미설정. shell rc 반영 확인 |
| Dual 모드가 안 켜짐 | `OPENAI_API_KEY` 누락 또는 키 이름 오타 |
| `sync` 가 토큰 오류 | `GITHUB_TOKEN` / `GH_TOKEN` / `ORCHESTRATOR_PAT` 중 최소 하나 필요 |
| Review 결과가 영어로만 나옴 | SKILL.md의 `language: Korean` 확인 (wizard에서 기본 설정) |
| 같은 에러 3번 반복 중 멈춤 | Circuit Breaker 정상 작동. `[ISSUES]` 섹션의 원인 요약을 먼저 읽고 수정 |
| 오프라인 상태에서 review 실패 | Claude API는 네트워크 필요. 캐시된 failure-catalog 기반 정적 검사만 가능 |
| Wizard를 다시 돌리고 싶음 | `solo-cto-agent init --wizard --force` |

더 긴 진단은 `docs/feedback-guide.md` 참조.

---

## 11. cowork-main vs codex-main 를 같이 쓰는 경우

한 프로젝트에서 두 모드를 **동시에** 운영할 수 있다. 다음이 전제될 때만 권장:

- 팀에 CI/CD 인프라가 있고 PR 단계는 자동화하고 싶다 → codex-main
- 로컬 개발·디자인·문서 작업은 Claude Cowork 안에서 하고 싶다 → cowork-main
- 두 모드가 같은 `agent-scores.json` / `error-patterns.md` 를 공유 → cowork-main 이 `sync` 로 codex-main 결과물을 끌어옴

이 경우 설치 순서:

1. codex-main 먼저 설치 (`init --wizard`, Mode 1, setup-pipeline 실행)
2. 같은 머신에서 cowork-main 설치 시에는 **SKILL.md 를 새로 쓰지 말고 mode 필드만 변경**
3. `sync --apply` 로 codex-main 에서 생성된 데이터를 가져와 로컬 리뷰에 반영

> cowork-main 단독 사용이 기본 권장. 위 병용은 "이미 CI 자동화가 있는데 추가로 로컬 툴링을 쓰고 싶다" 는 사용자에게만.

---

## 12. 다음 단계

- **스킬 규격:** `skills/_shared/agent-spec.md`
- **임베드 컨텍스트:** `skills/_shared/skill-context.md`
- **피드백 / 이슈:** `docs/feedback-guide.md`
- **스킬 슬리밍 전략:** `docs/skill-slimming.md`

문제가 생기면 `solo-cto-agent doctor` 출력을 함께 공유해 주세요.
