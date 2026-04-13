# Secrets Setup — dual-agent product repo

이 파일은 `.github/workflows/*.yml` 이 참조하는 시크릿 전체 목록이다. Settings → Secrets and variables → Actions 에서 Repository secret으로 등록.

---

## Required

| Secret | 용도 | 발급 |
|---|---|---|
| `ORCHESTRATOR_PAT` | repository_dispatch 로 오케스트레이터에 이벤트 전달 | GitHub Settings → Developer settings → Personal access tokens (classic 또는 fine-grained). Scope: `repo`, `workflow`. **오케스트레이터 레포와 같은 값** 사용. |

---

## Telegram (옵션, 강력 권장)

| Secret | 용도 | 발급 |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | T1/T2/T3 카드 발송 | @BotFather 에게 `/newbot` → 이름 지정 → 토큰 수신 |
| `TELEGRAM_CHAT_ID` | 발송 대상 | 자기 봇에게 메시지 한 번 보낸 후 `curl https://api.telegram.org/bot<TOKEN>/getUpdates` 의 `message.chat.id` 확인 |

---

## Agent 워커 (오케스트레이터 레포에 있으면 여기는 옵션)

대부분의 경우 이 키들은 **오케스트레이터 레포**에만 두면 된다. 제품 레포가 자체 워커를 돌릴 때만 여기 추가.

| Secret | 용도 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude 워커 API 호출 |
| `OPENAI_API_KEY` | Codex 워커 API 호출 |

---

## 배포 통합 (옵션)

Vercel 연동 시 preview URL 자동 캡처가 가능해진다.

| Secret | 용도 |
|---|---|
| `VERCEL_TOKEN` | Vercel API 호출 (`vercel.com/account/tokens`) |
| `VERCEL_ORG_ID` | 조직 ID (`vercel whoami` 또는 `.vercel/project.json`) |
| `VERCEL_PROJECT_ID` | 프로젝트 ID (`.vercel/project.json`) |

Netlify/Railway/기타는 `preview-summary.yml` 을 해당 플랫폼 API에 맞게 수정.

---

## 검증 체크

등록 후 간단히 확인:

```bash
# 시크릿 목록 확인 (값은 안 보임, 이름만)
gh secret list --repo <owner>/<repo>

# 기대 출력에 최소 다음이 있어야 함
ORCHESTRATOR_PAT           Updated ...
TELEGRAM_BOT_TOKEN         Updated ...
TELEGRAM_CHAT_ID           Updated ...
```

스모크 테스트 (`references/setup.md §6`) 로 실제 동작 확인.

---

## 보안 주의

- 절대 `.env.example` 에 실제 값을 넣지 않는다.
- PAT 만료 전에 갱신 알림을 캘린더에 등록 (GitHub는 default 90일).
- Telegram chat_id를 그룹 채팅으로 설정한 경우, 봇이 그룹에서 `/start` 받아야 메시지 발송 가능.
- `ORCHESTRATOR_PAT` 유출 시 즉시 revoke. 해당 PAT로 로그인 가능한 모든 레포 영향받음.

---

## 재발급 절차

PAT를 바꿨을 때:

1. GitHub에서 새 토큰 발급 (같은 scope).
2. 오케스트레이터 레포의 `ORCHESTRATOR_PAT` 업데이트.
3. 등록된 **모든 제품 레포**의 `ORCHESTRATOR_PAT` 업데이트 (자동화: `ops/scripts/rotate-pat.sh` 있으면 사용).
4. 기존 토큰 revoke.
5. 각 제품 레포 workflow 1개씩 재실행해서 dispatch 성공 확인.
