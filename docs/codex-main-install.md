# Codex-Main Setup Guide

> `codex-main` = **Full-auto mode**. GitHub Actions가 PR/이슈마다 자동으로 Claude + Codex 리뷰를 실행하고, rework을 디스패치하고, agent-scores를 추적합니다.

Semi-auto (cowork-main)와 다른 점: 로컬 CLI 실행이 아니라 **CI/CD에서 자동 실행**됩니다. 로컬 `review` / `dual-review` 명령도 동일하게 작동합니다.

---

## Prerequisites

| 항목 | 필요 여부 | 발급처 |
|---|---|---|
| Node.js 18+ | 필수 | https://nodejs.org/ |
| git | 필수 | https://git-scm.com/ |
| GitHub org 또는 개인 계정 | 필수 | https://github.com/ |
| ANTHROPIC_API_KEY | 필수 | https://console.anthropic.com/settings/keys |
| OPENAI_API_KEY | 필수 (dual-review) | https://platform.openai.com/api-keys |
| ORCHESTRATOR_PAT | 필수 (GitHub PAT, repo scope) | GitHub Settings > Developer settings > Personal access tokens |
| TELEGRAM_BOT_TOKEN + CHAT_ID | 선택 | `solo-cto-agent telegram wizard` |
| VERCEL_TOKEN | 선택 (배포 훅) | https://vercel.com/account/tokens |

---

## Step-by-step

### 1. Install + Init

```bash
npm install -g solo-cto-agent
solo-cto-agent init --wizard
```

wizard에서 `[1] codex-main`을 선택합니다. 프로젝트 스택 정보를 입력하면 `~/.claude/skills/solo-cto-agent/SKILL.md`에 `mode: codex-main`이 세팅됩니다.

### 2. Setup Pipeline

이 커맨드가 orchestrator repo를 자동 생성하고, product repo에 워크플로우를 설치합니다.

```bash
solo-cto-agent setup-pipeline --org <github-org> --repos <repo1,repo2>
```

실행 결과:
- `dual-agent-review-orchestrator/` 디렉터리 생성 (orchestrator repo)
  - `.github/workflows/` — claude-auto, codex-auto, cross-review, rework-auto 등
  - `ops/agents/` — codex-worker.js, claude-worker.js, cross-reviewer.js 등
  - `ops/scripts/` — 유틸리티 스크립트
- 각 product repo에 `.github/workflows/` 설치
  - codex-auto.yml, claude-auto.yml, cross-review-dispatch.yml 등

CTO tier (multi-agent routing 포함):
```bash
solo-cto-agent setup-pipeline --org <github-org> --tier cto --repos <repo1,repo2>
```

### 3. GitHub Secrets 설정

orchestrator repo와 각 product repo의 **Settings > Secrets and variables > Actions**에 아래 시크릿을 추가합니다.

**Orchestrator repo:**
```
ANTHROPIC_API_KEY    — Claude API 키
OPENAI_API_KEY       — OpenAI API 키
GITHUB_TOKEN         — (자동 제공, 추가 불필요)
TELEGRAM_BOT_TOKEN   — (선택) 알림용
TELEGRAM_CHAT_ID     — (선택) 알림용
```

**각 Product repo:**
```
ORCHESTRATOR_PAT     — GitHub PAT (repo scope). orchestrator로 dispatch 보낼 때 사용.
TELEGRAM_BOT_TOKEN   — (선택) PR 알림용
TELEGRAM_CHAT_ID     — (선택) PR 알림용
VERCEL_TOKEN         — (선택) 배포 상태 체크용
VERCEL_ORG_ID        — (선택)
VERCEL_PROJECT_ID    — (선택)
```

PAT 발급: GitHub > Settings > Developer settings > Personal access tokens > Generate new token (classic) > `repo` scope 체크.

### 4. Push + 확인

```bash
cd dual-agent-review-orchestrator
git add -A && git commit -m "init orchestrator"
git remote add origin https://github.com/<org>/dual-agent-review-orchestrator.git
git push -u origin main
```

Product repo에서 PR을 하나 만들면 `claude-auto.yml`이 자동 실행됩니다. Issue에 `agent-codex` 라벨을 붙이면 `codex-auto.yml`이 트리거됩니다.

### 5. Doctor로 확인

```bash
solo-cto-agent doctor
```

codex-main 모드에서는 ANTHROPIC_API_KEY + OPENAI_API_KEY 모두 필요합니다.

---

## 실행 플로우 (자동)

```
PR 생성/업데이트
  → product repo: claude-auto.yml 실행 → Claude 리뷰
  → product repo: cross-review-dispatch.yml → orchestrator에 dispatch
  → orchestrator: cross-reviewer.js → 양쪽 비교
  → orchestrator: rework-auto.yml → 필요시 자동 수정 PR 생성
  → orchestrator: telegram-notify.yml → 결과 알림
```

Issue 기반:
```
Issue에 'agent-codex' 라벨
  → product repo: codex-auto.yml → orchestrator에 dispatch
  → orchestrator: codex-worker.js → 작업 실행
  → 결과 → Issue comment + 알림
```

---

## 로컬 명령 (codex-main에서도 동일하게 사용)

```bash
solo-cto-agent review                    # 로컬 Claude 리뷰
solo-cto-agent dual-review               # 로컬 Claude + OpenAI 크로스 리뷰
solo-cto-agent knowledge --project myapp # 세션 지식 추출
solo-cto-agent notify deploy-ready ...   # 배포 알림
solo-cto-agent doctor                    # 상태 확인
```

---

## Troubleshooting

| 증상 | 원인 | 해결 |
|---|---|---|
| PR에 리뷰 안 붙음 | Secrets 미설정 | repo Settings > Secrets에 ANTHROPIC_API_KEY 추가 |
| dispatch 실패 | ORCHESTRATOR_PAT 만료/미설정 | PAT 재발급 후 product repo Secret 업데이트 |
| codex-auto 트리거 안 됨 | 라벨 이름 불일치 | Issue에 정확히 `agent-codex` 라벨 사용 |
| rework PR 안 생김 | orchestrator 워크플로우 비활성 | orchestrator repo > Actions 탭에서 워크플로우 Enable |

---

## cowork-main으로 전환하기

```bash
solo-cto-agent init --wizard
# Mode 선택에서 [2] cowork-main 선택
```

CI/CD 워크플로우는 그대로 두어도 무방합니다 (트리거되지 않으면 비용 없음).
cowork-main 가이드: `docs/cowork-main-install.md`
