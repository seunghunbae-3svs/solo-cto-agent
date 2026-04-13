# Setup — 새 제품 레포 등록 상세

SKILL.md §7의 체크리스트 상세 버전. 10분 안에 한 레포 완료 가능.

---

## 0. 전제

- 오케스트레이터 레포가 이미 있고 작동 중이어야 한다.
- 없으면 먼저 §5 "오케스트레이터 레포 초기 설치" 진행.

---

## 1. 제품 레포에 템플릿 복사

```bash
# 현재 레포 루트에서
cp -r <solo-cto-agent>/templates/product-repo/.github ./
cp <solo-cto-agent>/templates/product-repo/.env.example ./
cp <solo-cto-agent>/templates/product-repo/STATE.md ./
```

생성되는 파일:

```
.github/
├── ISSUE_TEMPLATE/
│   └── dual-agent-task.md
├── pull_request_template.md
└── workflows/
    ├── claude-auto.yml
    ├── codex-auto.yml
    ├── comparison-dispatch.yml
    ├── cross-review-dispatch.yml
    ├── cross-review.yml
    ├── preview-summary.yml
    ├── rework-dispatch.yml
    └── telegram-notify.yml
.env.example
STATE.md
```

---

## 2. 치환 (Template Variables)

템플릿에는 아래 플레이스홀더가 박혀있다. 대화형 wizard로 처리:

```bash
node <solo-cto-agent>/bin/cli.js setup-repo
```

wizard가 묻는 것:

| 변수 | 설명 | 예시 |
|---|---|---|
| `{{GITHUB_OWNER}}` | 레포 owner (org or user) | `seunghunbae-3svs` |
| `{{ORCHESTRATOR_REPO}}` | orchestrator 레포 이름 | `solo-cto-agent` |
| `{{PRODUCT_REPO}}` | 현재 제품 레포 이름 | `tribo-store` |
| `{{DEPLOY_TARGET}}` | `vercel` / `netlify` / `railway` | `vercel` |
| `{{PREVIEW_BASE_URL}}` | 프리뷰 배포 도메인 패턴 | `https://{{branch}}-{{project}}.vercel.app` |

wizard가 없으면 수동 `sed`:

```bash
find .github -type f -exec sed -i \
  -e 's|{{GITHUB_OWNER}}|seunghunbae-3svs|g' \
  -e 's|{{ORCHESTRATOR_REPO}}|solo-cto-agent|g' \
  -e 's|{{PRODUCT_REPO}}|tribo-store|g' {} \;
```

---

## 3. Secrets 설정

제품 레포 Settings → Secrets and variables → Actions → **Repository secret**:

| Secret | 필수/선택 | 값 출처 |
|---|---|---|
| `ORCHESTRATOR_PAT` | 필수 | GitHub PAT, orchestrator 레포 write 권한 필요 (repo, workflow) |
| `TELEGRAM_BOT_TOKEN` | 옵션 | @BotFather에서 bot 생성 후 발급 |
| `TELEGRAM_CHAT_ID` | 옵션 | `orchestrate status --chat-id-probe` 로 확인 가능 |
| `ANTHROPIC_API_KEY` | claude worker 쓸 때 필수 | console.anthropic.com |
| `OPENAI_API_KEY` | codex worker 쓸 때 필수 | platform.openai.com |
| `VERCEL_TOKEN` | deploy 통합 시 필수 | vercel.com/account/tokens |
| `VERCEL_ORG_ID` | Vercel 다중 프로젝트 | `vercel whoami` |
| `VERCEL_PROJECT_ID` | Vercel 통합 | `.vercel/project.json` |

**주의:** `ORCHESTRATOR_PAT`은 두 레포에 **같은 값**으로 넣어야 한다. 서로 다른 PAT로 하면 raise limit 두 배 먹는 비용만 늘어남.

---

## 4. Branch Protection (필수)

제품 레포 Settings → Branches → **Add branch ruleset**:

- Target: `master` or `main`
- Rules:
  - ✅ Require a pull request before merging
  - ✅ Require approvals: **1**
  - ✅ Require status checks to pass
    - Required checks: CI(필수), cross-review(옵션), preview-build(옵션)
  - ✅ Require branches to be up to date
  - ⚠️ Do not allow bypassing (단, admin override 는 유지 — hotfix 시 필요)

이 설정 없으면 agent가 리뷰 없이 main에 바로 push할 수 있음. 오케스트레이터 의미 없어짐.

API로 자동화:

```bash
curl -X PUT \
  -H "Authorization: token $PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/$OWNER/$REPO/branches/main/protection \
  -d @- <<'EOF'
{
  "required_status_checks": {"strict": true, "contexts": ["CI"]},
  "enforce_admins": false,
  "required_pull_request_reviews": {"required_approving_review_count": 1},
  "restrictions": null
}
EOF
```

---

## 5. 오케스트레이터 레포 쪽 등록

제품 레포 추가 시 orchestrator 측에서도 알아야 한다:

```bash
# orchestrator 레포 local clone에서
node ops/scripts/register-project.js \
  --name tribo-store \
  --owner seunghunbae-3svs \
  --tier dual \
  --preset webapp
```

이 명령이 하는 것:
- `ops/state/projects.json` 에 항목 추가
- routing-policy.json 에 default 정책 상속
- Telegram 카드 템플릿에 repo 이름 매핑

수동 등록도 가능 (`projects.json` 직접 편집).

---

## 6. 스모크 테스트

```bash
# 1. 이슈 생성
gh issue create \
  --repo seunghunbae-3svs/tribo-store \
  --title "orchestrate smoke test" \
  --body "Simple README typo fix to validate pipeline."

# 2. 라벨 부착 (← 이게 트리거)
gh issue edit <issue_number> \
  --repo seunghunbae-3svs/tribo-store \
  --add-label agent-codex

# 3. 확인 체크포인트 (10분 이내 전부 발생해야 함)
#    [ ] codex-auto.yml 실행 (gh run list)
#    [ ] 이슈에 "Codex assigned" 코멘트
#    [ ] orchestrator 레포에 route-issue.yml 실행
#    [ ] Telegram T1 카드 도착
#    [ ] Codex가 PR 오픈 (최대 10분 더)
#    [ ] cross-review-dispatch.yml 실행
#    [ ] Claude reviewer 리뷰 완료
#    [ ] T1 카드 verdict 업데이트
```

하나라도 안 뜨면 `failure-recovery.md` 참조.

---

## 7. 오케스트레이터 레포 초기 설치 (처음 한 번만)

```bash
# 1. 레포 생성
gh repo create <org>/solo-cto-orchestrator --private

# 2. 템플릿 복사
cp -r <solo-cto-agent>/templates/orchestrator/* .

# 3. 의존성
pnpm install  # or npm ci

# 4. 시크릿 (제품 레포와 동일 + 아래 추가)
#    - ORCHESTRATOR_PAT (자기 자신에게도 필요 — rework commit)
#    - ANTHROPIC_API_KEY
#    - OPENAI_API_KEY
#    - (옵션) VERCEL_TOKEN, VERCEL_ORG_ID

# 5. Vercel 배포 (api/ 엔드포인트 있는 경우)
vercel link
vercel --prod

# 6. Telegram webhook 등록 (카드 버튼 수신용)
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<orchestrator>.vercel.app/api/telegram-webhook"

# 7. Health check
curl https://<orchestrator>.vercel.app/api/health
# 기대 응답: {"status":"ok","services":{"github":"ok","telegram":"ok"}}
```

---

## 8. 롤아웃 체크리스트 (5분 검토용)

- [ ] 제품 레포에 `.github/workflows/*.yml` 9개 복사됨
- [ ] 플레이스홀더 `{{...}}` 전부 치환됨 (`grep -r "{{" .github` 결과 빈 줄)
- [ ] Secrets 3개 이상 등록됨 (ORCHESTRATOR_PAT, TELEGRAM_*)
- [ ] Branch protection 활성화
- [ ] orchestrator `projects.json` 에 등록됨
- [ ] 스모크 테스트 성공
- [ ] STATE.md 초기값 세팅됨
- [ ] 이 레포 README에 "dual-agent review enabled" 배지 추가 (옵션)

배지 스니펫:

```markdown
![dual-agent](https://img.shields.io/badge/review-dual--agent-purple)
```
