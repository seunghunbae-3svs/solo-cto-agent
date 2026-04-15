# Cowork-Main Setup Guide

> `cowork-main` = **Semi-auto mode**. Claude Cowork desktop agent에서 로컬 리뷰, 지식 캡처, 세션 관리를 실행합니다. CI/CD 파이프라인 없이 동작합니다.

codex-main(Full-auto)과 다른 점: GitHub Actions 없이 로컬에서 모든 명령을 실행합니다. 필요할 때 `sync`로 원격 데이터를 가져옵니다.

---

## Prerequisites

| 항목 | 필요 여부 | 발급처 |
|---|---|---|
| Node.js 18+ | 필수 | https://nodejs.org/ |
| git | 필수 | https://git-scm.com/ |
| ANTHROPIC_API_KEY | 필수 | https://console.anthropic.com/settings/keys |
| OPENAI_API_KEY | 선택 (dual-review) | https://platform.openai.com/api-keys |
| GITHUB_TOKEN | 선택 (sync) | GitHub Settings > Developer settings > Personal access tokens |
| TELEGRAM_BOT_TOKEN + CHAT_ID | 선택 | `solo-cto-agent telegram wizard` |

---

## Step-by-step

### 1. Install + Init

```bash
npm install -g solo-cto-agent
solo-cto-agent init --wizard
```

wizard에서 `[2] cowork-main`을 선택합니다. 프로젝트 스택 정보를 입력하면 `~/.claude/skills/solo-cto-agent/SKILL.md`에 `mode: cowork-main`이 세팅됩니다.

### 2. API Key 설정

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

dual-review를 사용하려면 OpenAI 키도 설정합니다:
```bash
export OPENAI_API_KEY="sk-..."
```

### 3. Doctor로 확인

```bash
solo-cto-agent doctor
```

SKILL.md 설치, API 키, 엔진 상태를 한 번에 확인합니다.

### 4. 첫 리뷰 실행

```bash
cd <your-git-repo>
git add -A
solo-cto-agent review
```

---

## 주요 명령

```bash
solo-cto-agent review                    # 로컬 Claude 리뷰
solo-cto-agent dual-review               # Claude + OpenAI 크로스 리뷰
solo-cto-agent knowledge --project myapp # 세션 지식 추출
solo-cto-agent session save              # 세션 컨텍스트 저장
solo-cto-agent session restore           # 이전 세션 복원
solo-cto-agent session list              # 저장된 세션 목록
solo-cto-agent sync --org <org>          # 원격 데이터 조회 (dry-run)
solo-cto-agent sync --org <org> --apply  # 원격 데이터 로컬 반영
solo-cto-agent doctor                    # 상태 확인
```

---

## Semi-auto vs Full-auto

| | Semi-auto (cowork-main) | Full-auto (codex-main) |
|---|---|---|
| 실행 환경 | Claude Cowork desktop | GitHub Actions (CI/CD) |
| 트리거 | 수동 CLI 명령 | PR 이벤트, Issue 라벨 |
| CI/CD 필요 | 불필요 | 필수 |
| 네트워크 의존 | API 키만 (오프라인 가능) | GitHub + webhook |
| 적합한 상황 | 개인 작업, 오프라인, 빠른 시작 | 팀 협업, 자동화 파이프라인 |

---

## Troubleshooting

| 증상 | 원인 | 해결 |
|---|---|---|
| review 실행 안 됨 | ANTHROPIC_API_KEY 미설정 | `export ANTHROPIC_API_KEY="sk-ant-..."` |
| dual-review 실패 | OPENAI_API_KEY 미설정 | `export OPENAI_API_KEY="sk-..."` |
| sync 실패 | GITHUB_TOKEN 미설정 또는 만료 | PAT 재발급 후 `export GITHUB_TOKEN="ghp_..."` |
| doctor 경고 다수 | SKILL.md 미설정 | `solo-cto-agent init --wizard` 재실행 |

---

## codex-main으로 전환하기

```bash
solo-cto-agent init --wizard
# Mode 선택에서 [1] codex-main 선택
```

codex-main 가이드: `docs/codex-main-install.md`
