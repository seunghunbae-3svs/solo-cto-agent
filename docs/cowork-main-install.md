# cowork-main — Semi-Auto Mode Install & Operating Guide

> `cowork-main` = **Semi-auto mode**.  (대응: `codex-main` = Full-auto mode.)
> Claude Cowork agent 가 desktop runtime 에서 돌면서 필요한 cloud amplifier 를 엮어 CTO급 품질을 만든다.
> 관련 정의 문서: `docs/tier-matrix.md` (Tier 축) · `docs/tier-examples.md` (티어별 사용 예) · `docs/cto-policy.md` (CTO 운영 정책)

---

## 0. 세 개의 축 — Tier × Agent × Mode

`solo-cto-agent` 의 설정은 **서로 독립적인 세 축**의 조합이다.

| 축 | 의미 | 값 |
|---|---|---|
| **Tier** (기능 레벨) | 어떤 스킬/기능을 쓸 것인가 | `Maker` / `Builder` / `CTO` |
| **Agent** (에이전트 구성) | 누가 작업/리뷰하는가 | `Cowork` (Claude 단독) / `Cowork + Codex` (Dual) |
| **Mode** (자동화 모드) | 언제 어디서 자동으로 돌릴 것인가 | `Semi-auto` = cowork-main / `Full-auto` = codex-main |

**이 문서는 Mode 축이 Semi-auto (cowork-main) 인 경우의 설치·운영을 다룬다.**
Tier 와 Agent 는 Semi-auto 모드 안에서도 별도로 선택할 수 있다. 단, CTO Tier 는 정책상 Full-auto + Dual 운영을 권장한다 (`docs/cto-policy.md`).

---

## 1. What Semi-auto mode (cowork-main) is

Claude Cowork agent 가 **desktop runtime** 에서 돌면서 세션 안에서:

- 코드/디자인/문서를 **정해진 품질 기준까지** 에이전트가 반복 작업
- Cowork 단독 또는 Cowork + Codex 조합으로 **자동 크로스리뷰**
- MCP 커넥터(GitHub, Vercel, Supabase, Figma, Google Drive, Slack 등)로 **라이브 컨텍스트 확인**
- Web search / WebFetch 로 **최신 문서·레퍼런스·경쟁 정보 주입**
- Scheduled tasks 로 **세션 밖 백그라운드 자동화**
- 유저 인풋·결정·스타일이 누적돼 **개인화된 CTO 모델**로 성장

즉 Semi-auto 는 "로컬로만 도는 오프라인 툴" 이 아니라 **desktop agent runtime + cloud amplifiers 조합**이다.
오프라인은 네트워크 실패 시의 degraded fallback 이지 정상 운영 전제가 아니다.

### Semi-auto vs Full-auto 포지셔닝

| | Semi-auto (cowork-main) | Full-auto (codex-main) |
|---|---|---|
| 실행 환경 | Claude Cowork desktop runtime | GitHub Actions (CI/CD) |
| 자동화 엔진 | 에이전트 루프 + MCP 커넥터 + scheduled tasks | GitHub workflow + webhook |
| 트리거 | 에이전트 판단, 사용자 호출, 스케줄 | PR 이벤트, repository_dispatch |
| 클라우드 활용 | API 다건 (Claude, OpenAI, GitHub, Vercel, Supabase, Figma, Drive, Slack…) | GitHub Actions 내부 완결 |
| 네트워크 끊김 시 | 캐시 기반 degraded fallback | 파이프라인 일시 중단 |
| 기본 권장 Tier | Maker / Builder | Builder / CTO |
| 적합 유저 | 솔로 파운더, 크리에이터, 멀티 프로젝트 운영자 | CI 인프라 있는 팀 |

**한 줄 요약:** Full-auto 는 레포 밖에서 돌아가는 봇이고, Semi-auto 는 **당신 옆에서 일하며 필요한 모든 클라우드를 찌르는 에이전트**다.

---

## 2. Agent 구성 — Cowork 단독 vs Cowork + Codex

Semi-auto mode 안에서 **누가 작업/리뷰를 돌릴지**는 API 키 유무로 결정된다. 별도 설정 없음.

### Cowork (단독) — Claude agent 만 사용

`ANTHROPIC_API_KEY` 하나로 시작. 리뷰·크래프트·knowledge·memory 전부 Cowork agent(Claude) 단독 처리.
- 세션 내에서 **self cross-review** 루프 (craft → review → craft, 체크리스트 자동 검증)
- Tier 가 높아질수록 자기 검증 강도 상승
- 가장 가벼운 설정, Maker / Builder Tier 에 권장

### Cowork + Codex — Dual agent 교차리뷰

`ANTHROPIC_API_KEY` + `OPENAI_API_KEY` 둘 다 설정되면 **자동으로 Dual 구성으로 전환**.
- `review` 명령이 Cowork 리뷰 → Codex 리뷰 → 교차검증을 **한 번에** 실행
- 두 에이전트의 판정이 다르면 `[ISSUES]` 섹션에 차이가 명시됨
- Dual 을 강제로 끄고 싶을 때만 `solo-cto-agent review --solo`
- CTO Tier 권장 구성 (cto-policy.md 정책)

> Agent 구성은 Mode(Semi-auto/Full-auto) 와 독립이다. Full-auto mode 에서도 Cowork 단독 또는 Cowork+Codex 둘 다 가능하다.

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

최소 하나 필요. 둘 다 있으면 Cowork+Codex 구성으로 자동 전환.

```bash
# Cowork 단독 — Claude agent 만
export ANTHROPIC_API_KEY="sk-ant-..."

# Cowork + Codex — Dual cross-review
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

## 4. Tier — 기능 레벨 선택 (Maker / Builder / CTO)

Tier 는 **어떤 스킬/기능 범위를 쓸 것인가** 를 결정한다. Agent 구성 · Mode 와는 별개 축이다.
`init --preset <tier>` 또는 wizard 에서 지정.

| Tier | 대상 유저 | 포함 스킬 | 기능 범위 | Semi-auto 에서의 권장 Agent |
|---|---|---|---|---|
| **Maker** | 처음 쓰는 사람, 크리에이터, 1인 | spark / review / memory / craft | 가이드 중심 (안전 기본값, 템플릿) | Cowork 단독 |
| **Builder** (default) | 솔로 개발자 | Maker + **build** + **ship** | 실행 중심 (자동 재시도, 회로 차단기) | Cowork 단독 또는 Cowork+Codex |
| **CTO** | 파워 유저, 소규모 팀 | Builder + **orchestrate** | 판단 위임 (의사결정 추적, 멀티 에이전트 라우팅) | Cowork+Codex (정책) |

Tier 는 `solo-cto-agent upgrade` 로 올릴 수 있다. 다운그레이드는 권장하지 않음.

### CTO Tier 정책 (중요)

CTO Tier 는 정책상 **Full-auto + Dual (Cowork + Codex)** 을 기본 운영 형태로 한다.  
이유는 CTO Tier의 `orchestrate` 스킬이 다음을 전제하기 때문:
- 멀티 에이전트 라우팅 → 최소 두 에이전트 필요
- 의사결정 추적 및 agent scoring 자동 업데이트 → CI 레벨의 안정적 이벤트 흐름 필요
- 24개 오케스트레이터 워크플로우의 교차검증 로직

→ **Semi-auto mode + CTO Tier** 는 기술적으로 가능하지만, 부분 기능만 쓰는 형태가 된다 (orchestrate 의 자동화 훅이 실행되지 않음). CTO Tier 를 원하면 Full-auto 로 전환하거나, Semi-auto 에서는 Builder Tier 로 제한하는 것을 권장.

자세한 정책: `docs/cto-policy.md` 참조.

---

## 5. 일상 워크플로우 — 세션 안에서 자동화가 어떻게 돌아가나

Semi-auto 의 자동화는 **"외부 CI 대신 Cowork agent 루프가 일한다"** 는 뜻이다. 사용자는 의도만 던지고, 에이전트가 필요한 명령을 실행한다.

### 5.1. 작업 시작 시

```bash
solo-cto-agent session restore          # 이전 세션 컨텍스트 복구
# (또는 Claude Cowork에 말로 "어디까지 했었지?" — 에이전트가 자동 실행)
```

### 5.2. 코드 작업 중

에이전트가 `craft` → `build` 반복. 특정 지점에서 자동으로:

```bash
solo-cto-agent review                   # staged diff 자동 리뷰 (Cowork / Cowork+Codex 자동 감지)
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

Full-auto mode 의 오케스트레이터 레포가 있는 경우에만 사용. 없으면 이 섹션 건너뜀.

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

Semi-auto mode 의 핵심 자산은 **누적된 컨텍스트**다. 다음 자료들이 세션마다 쌓이고 다음 세션에서 자동 로드된다.

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

## 7. Cloud Amplifiers — 어떤 클라우드 자원으로 품질이 완성되나

Semi-auto mode 의 리뷰/크래프트 품질은 **연결된 클라우드 자원의 수와 비례**한다.
아래는 세션 안에서 자동으로 활용되는 대표적인 클라우드 레이어. 각 레이어는 독립적으로 끼우고 뺄 수 있다.

### 7.1. 모델 레이어

| 자원 | 역할 | 필수 여부 |
|---|---|---|
| **Anthropic Claude API** | 모든 리뷰/크래프트/knowledge 엔진 (Cowork agent 구동) | 공통 필수 |
| **OpenAI API (Codex)** | Cowork+Codex 구성 시 자동 크로스리뷰 | Dual 구성 시 필수 |
| **Claude Vision (multimodal)** | 스크린샷·디자인 목업 QA, UI slop 감지, 디자인 회귀 체크 | 디자인 스킬에서 선택 |

### 7.2. MCP 커넥터 (라이브 소스 오브 트루스)

Claude Cowork 에 연결된 MCP 커넥터들은 **문서 기록이 아니라 실제 운영 상태**를 조회한다.
Semi-auto mode 는 리뷰·브리핑 시 로컬 기록 대신 라이브 상태를 우선 확인한다.

| 커넥터 | 무엇을 끌어오나 |
|---|---|
| **GitHub** | PR diff, CI 상태, 브랜치, 코멘트, 최근 커밋 |
| **Vercel** | production 배포 상태, build logs, runtime logs (500/ERROR 진단) |
| **Supabase** | 실제 DB 스키마, 마이그레이션 이력, advisor 경고 |
| **Google Drive** | 기획 문서, 회의록, 결정 이력 → knowledge articles로 흡수 |
| **Figma** | 디자인 시스템 토큰, 컴포넌트 메타, code connect 매핑 |
| **Gmail / Calendar** | 기한 / 약속 / 계약 단계 crosscheck |
| **Slack** | 팀 결정 / 이슈 스레드 추출 |

MCP는 권한·연결 여부에 따라 끼워 쓴다. 없으면 해당 소스는 **"[미검증]"** 태그로 표시되고, 있으면 **"[확정]"** 태그가 붙는다.

### 7.3. 인터넷 레이어 (web search / WebFetch)

리뷰·설계 시 **최신 지식**이 필요하면 세션 내에서 직접 웹을 확인한다.

- 라이브러리 최신 버전, 변경사항, 알려진 버그
- Next.js / Tailwind / Prisma 같은 스택의 공식 문서 최신판
- 경쟁사·시장 레퍼런스 (spark / idea 스킬에서)
- 규제·정책 업데이트 (bae-regulatory-navigator 연계 시)

Claude 학습 컷오프(2025년 5월) 이후의 정보는 전부 web search로 보완된다.

### 7.4. Scheduled Tasks (세션 밖 자동화)

scheduled-tasks MCP 를 쓰면 Semi-auto mode 의 자동화가 **세션 밖으로 확장**된다.

- 매일 아침 프로젝트별 상태 브리핑 (Vercel 배포, PR, 미결 액션)
- 주간 quality-log / error-patterns 요약
- 특정 레포에 새 PR이 열리면 review 자동 트리거 → 결과만 세션 시작 시 표시
- 월간 knowledge 아티클 자동 정리

Full-auto mode 의 GitHub Actions 대체재이지만, **사용자 머신 기준으로 돌기 때문에** CI 설정 없이도 동작한다.

### 7.5. 원격 knowledge 공유 (선택)

Semi-auto mode 의 knowledge / agent-scores / error-patterns 를 **여러 머신에서 공유**하고 싶으면:

- 오케스트레이터 레포(`dual-agent-orchestrator`) 한 개를 GitHub에 두고
- 각 머신에서 `solo-cto-agent sync --org <org> --apply` 로 동기화
- Full-auto mode 가 같이 돌고 있으면 Full-auto 의 PR 리뷰 결과가 자동으로 이 레포에 쌓이고, Semi-auto 가 그걸 로컬로 끌어온다

즉 **같은 에이전트가 여러 곳에서 학습한 결과를 한 사람의 자산으로 합친다.**

---

## 8. 자동화 경계 — 무엇이 자동이고 무엇이 아닌가

### 자동으로 일어나는 일 (세션 안)

- 에이전트가 판단한 `craft → review → craft` 루프
- Circuit Breaker (같은 에러 3회 반복 시 자동 중단 + 원인 요약)
- Tier에 맞는 품질 체크리스트 자동 적용
- Cowork+Codex 구성에서 Claude ↔ Codex 교차리뷰
- 연결된 MCP 커넥터로 라이브 상태 크로스체크 (Vercel/Supabase/GitHub 등)
- Web search 로 최신 레퍼런스 주입
- 세션 컨텍스트 로드/저장 (session 명령 또는 `bae-self-evolve` 훅)

### 세션 밖에서 자동으로 일어나게 만드는 방법

- scheduled-tasks MCP 로 정기 실행 등록
- 오케스트레이터 레포를 두고 `sync` 로 다른 머신의 결과 흡수
- 두 가지 다 **사용자가 한 번 설정**하면 이후에는 자동

### 사용자 호출이 있어야만 일어나는 일

- `sync --apply` (dry-run 은 자동, 실제 머지는 명시)
- `git push` — PR 생성/머지 (Semi-auto 는 코드 변경만 스테이징, push 는 사용자가)
- 프로덕션 DB 스키마 변경
- 새 레포 생성
- 외부 서비스 결제·계약 발생 작업

### 절대 안 하는 일 — "Semi-auto does NOT"

- PR 자동 머지 (Full-auto mode 영역)
- GitHub Actions CI 강제 의존
- 원격 파일을 dry-run 없이 바로 수정

### 네트워크 끊김 시 — Degraded Fallback

정상 운영은 클라우드 연결을 전제한다. 네트워크가 끊기면 **축소 모드**로 내려간다:

- Claude/OpenAI API 호출 실패 → 캐시된 failure-catalog 기반 정적 검사만 가능
- MCP 커넥터 → 마지막으로 성공한 조회 결과를 `[캐시]` 태그로 표시
- Web search → 학습 컷오프 이내 지식만 사용, 불확실 항목은 `[미검증]`
- sync → 완전 차단 (재연결 시 재시도)

Circuit Breaker 가 3회 연속 네트워크 실패를 감지하면 offline mode를 선언하고 사용자에게 알린다.

---

## 9. Environment Variables — 전체 목록

| 변수 | 필수 여부 | 용도 |
|---|---|---|
| `ANTHROPIC_API_KEY` | review/knowledge 사용 시 필수 | Claude 호출 |
| `OPENAI_API_KEY` | Cowork+Codex 구성에만 | Codex 호출 (있으면 자동 Dual 전환) |
| `GITHUB_TOKEN` / `GH_TOKEN` / `ORCHESTRATOR_PAT` | `sync` 사용 시 셋 중 하나 | 오케스트레이터 레포 조회 |
| `TELEGRAM_BOT_TOKEN` | 선택 | 리뷰 결과 텔레그램 알림 |
| `TELEGRAM_CHAT_ID` | 선택 | 알림 대상 chat |

env var 를 프로젝트별로 관리하고 싶으면 프로젝트 루트 `.env.local` 을 사용. Wizard가 `.env.example` 템플릿을 만들어 둔다.

---

## 10. CLI Reference — Semi-auto mode 에서 자주 쓰는 명령

```bash
# 설치 / 점검
solo-cto-agent init --wizard
solo-cto-agent doctor
solo-cto-agent status                 # 로컬 캐시만, 네트워크 없음

# 리뷰 (Cowork / Cowork+Codex 자동 감지)
solo-cto-agent review                 # staged diff
solo-cto-agent review --branch
solo-cto-agent review --file <path>
solo-cto-agent review --solo          # Cowork+Codex 구성 감지되어도 Cowork 단독으로 강제
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

> `setup-pipeline`, `setup-repo` 명령은 Semi-auto mode 에서 호출되면 "Not needed in cowork-main mode" 메시지만 뜬다. 이들은 Full-auto mode 전용이다.

---

## 11. Troubleshooting

| 증상 | 원인 / 해결 |
|---|---|
| `❌ ANTHROPIC_API_KEY required` | 환경변수 미설정. shell rc 반영 확인 |
| Cowork+Codex 구성으로 안 전환 | `OPENAI_API_KEY` 누락 또는 키 이름 오타 |
| `sync` 가 토큰 오류 | `GITHUB_TOKEN` / `GH_TOKEN` / `ORCHESTRATOR_PAT` 중 최소 하나 필요 |
| Review 결과가 영어로만 나옴 | SKILL.md의 `language: Korean` 확인 (wizard에서 기본 설정) |
| 같은 에러 3번 반복 중 멈춤 | Circuit Breaker 정상 작동. `[ISSUES]` 섹션의 원인 요약을 먼저 읽고 수정 |
| 오프라인 상태에서 review 실패 | Claude API는 네트워크 필요. 캐시된 failure-catalog 기반 정적 검사만 가능 |
| Wizard를 다시 돌리고 싶음 | `solo-cto-agent init --wizard --force` |

더 긴 진단은 `docs/feedback-guide.md` 참조.

---

## 12. Semi-auto + Full-auto 병용

한 프로젝트에서 두 Mode 를 **동시에** 운영할 수 있다. 다음이 전제될 때만 권장:

- 팀에 CI/CD 인프라가 있고 PR 단계는 자동화하고 싶다 → Full-auto (codex-main)
- 로컬 개발·디자인·문서 작업은 Claude Cowork 안에서 하고 싶다 → Semi-auto (cowork-main)
- 두 Mode 가 같은 `agent-scores.json` / `error-patterns.md` 를 공유 → Semi-auto 가 `sync` 로 Full-auto 결과물을 끌어옴

이 경우 설치 순서:

1. Full-auto 먼저 설치 (`init --wizard`, Mode 1 = codex-main, setup-pipeline 실행)
2. 같은 머신에서 Semi-auto 를 쓰고 싶으면 **SKILL.md 를 새로 쓰지 말고 `mode:` 필드만 `cowork-main` 으로 변경**
3. `sync --apply` 로 Full-auto 에서 생성된 데이터를 가져와 로컬 리뷰에 반영

Agent 구성 축은 두 Mode 공통이다. CTO Tier 를 쓸 때는 Full-auto + Cowork+Codex 가 기본 정책 (`docs/cto-policy.md`).

> Semi-auto 단독 사용이 기본 권장. 위 병용은 "이미 CI 자동화가 있는데 추가로 로컬 툴링을 쓰고 싶다" 는 사용자에게만.

---

## 13. 다음 단계

- **Tier 축 정의:** `docs/tier-matrix.md`
- **Tier 별 사용 예:** `docs/tier-examples.md`
- **CTO Tier 운영 정책:** `docs/cto-policy.md`
- **스킬 규격 (양쪽 Mode 공통):** `skills/_shared/agent-spec.md`
- **임베드 컨텍스트:** `skills/_shared/skill-context.md`
- **피드백 / 이슈:** `docs/feedback-guide.md`
- **스킬 슬리밍 전략:** `docs/skill-slimming.md`

문제가 생기면 `solo-cto-agent doctor` 출력을 함께 공유해 주세요.
