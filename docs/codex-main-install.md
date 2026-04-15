# Codex-Main Setup Guide

## Template Audit Default

`codex-main` now turns on template drift detection by default.

- local command: `solo-cto-agent template-audit`
- scheduled workflow: `template-audit.yml` in the orchestrator repo
- default policy: `report-only`

This means older copied workflows are detected automatically, but nothing is overwritten without an explicit setup or refresh run.

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
- `dual-agent-orchestrator/` 디렉터리 생성 (orchestrator repo)
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
cd dual-agent-orchestrator
git add -A && git commit -m "init orchestrator"
git remote add origin https://github.com/<org>/dual-agent-orchestrator.git
git push -u origin main
```

Product repo에서 PR을 하나 만들면 `claude-auto.yml`이 자동 실행됩니다. Issue에 `agent-codex` 라벨을 붙이면 `codex-auto.yml`이 트리거됩니다.

### 5. Doctor로 확인

```bash
solo-cto-agent doctor
```

codex-main 모드에서는 ANTHROPIC_API_KEY + OPENAI_API_KEY 모두 필요합니다.

---

## Two operating models inside codex-main

`codex-main` is one mode, but it can run in two distinct agent shapes.

### 1. Codex solo

Use this when the task should stay on Codex only.

- typical trigger: issue label `agent-codex`
- routing result: `single-agent`
- implementer: `codex`
- reviewer metadata: `claude`
- telegram tier: `notify`

This path is useful when you want full automation but do not need a second agent on every task.

Proof:

- `examples/review/codex-main-codex-solo-routing.md`
- `docs/codex-main-validation.svg`
- `docs/codex-main-live-validation.md`

### 2. Codex + Cowork

Use this when you want the dual-agent path.

- typical trigger: PR open on a CTO-tier repo, or label `dual-review`
- routing result: `dual-agent`
- both Claude and Codex participate in review/comparison
- telegram tier: `decision`
- max rounds: `2`

This is the higher-confidence path. It costs more, but it is the path that catches disagreements before merge.

Proof:

- `examples/review/codex-main-codex-plus-cowork.md`
- `examples/review/codex-main-live-pr-review.md`
- `examples/founder-workflow/codex-main-live-rework-and-digest.md`
- `docs/codex-main-validation.svg`
- `docs/codex-main-live-validation.md`

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

---

## Live E2E findings (2026-04-15)

This install path was re-checked against a real private Next.js 14 + NextAuth + Prisma project on Windows PowerShell.

Observed setup result:

- orchestrator scaffold: 24 workflows
- product repo install: 8 workflows
- detected services: `next-auth`, `prisma`
- generated secret list: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`, `ORCHESTRATOR_PAT`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`

One live runtime caveat also surfaced during PR testing:

- if Vercel refuses a PR preview, check the git author email first
- the commit author email must be linked to a GitHub account that Vercel can match
- if it is not, the review pipeline can still run, but preview deployment may be blocked

One install-age caveat also surfaced:

- older product repos can keep stale copied workflow files even after the core codex-main templates improve
- if a repo was wired earlier and shows odd failures in side-lane checks, refresh the copied workflows first
- the two files that most clearly surfaced in live validation were:
  - `.github/workflows/solo-cto-review.yml`
  - `.github/workflows/preview-summary.yml`

