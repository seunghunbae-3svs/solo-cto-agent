# Tier Examples — 티어별 사용 시나리오

> Tier × Agent × Mode 조합별 **실제 사용 예시**.
> 관련: [`docs/tier-matrix.md`](tier-matrix.md) · [`docs/cto-policy.md`](cto-policy.md)

---

## Maker × Cowork × Semi-auto — 크리에이터 / 솔로 기획자

### 유저 프로필
- Notion 에서 아이디어 / PRD / 피치덱 작성 위주
- 코드 작성은 가끔, 주로 노코드 툴 + Cowork
- API 키는 `ANTHROPIC_API_KEY` 하나

### 일과
```bash
# 아침 — 어제 생각 이어가기
solo-cto-agent session restore

# 작업 — 아이디어 풀어쓰기, Cowork 에이전트가 spark 스킬로 확장
# (세션 내에서 자동. 별도 명령 불필요)

# 글쓰기 막히면 — review 로 셀프 비평
solo-cto-agent review --path ./docs/pitch.md

# 끝나면 — 오늘 배운 것 누적
solo-cto-agent knowledge
solo-cto-agent session save
```

### 얻는 것
- 아이디어 단계의 자기 검열 루프
- 세션 사이 컨텍스트 유지
- 반복 패턴(자주 헷갈리는 논리, 피치 구조 등) 이 knowledge 로 축적

---

## Builder × Cowork × Semi-auto — 솔로 SaaS 파운더 (default)

### 유저 프로필
- Next.js + Supabase 로 혼자 SaaS 운영
- 커밋은 하루 3~10 회, 배포는 Vercel 프리뷰 + 프로덕션
- `ANTHROPIC_API_KEY` 만 있음 (dual review 는 안 씀)

### 일과
```bash
# 작업 시작 — 활성 프로젝트 컨텍스트 로드
solo-cto-agent session restore

# 기능 개발 후 커밋 전 리뷰
git add -A
solo-cto-agent review --diff staged --json > /tmp/review.json

# BLOCKER 자동 수정
solo-cto-agent apply-fixes --review /tmp/review.json --apply --only BLOCKER

# SUGGESTION 은 수동 확인 후 적용
solo-cto-agent apply-fixes --review /tmp/review.json --only SUGGESTION

# 배포 후 결과 통지
solo-cto-agent ship
solo-cto-agent notify --title "Shipped v0.3.2" --channels slack

# 세션 끝 — 결정/에러 패턴 흡수
solo-cto-agent knowledge
solo-cto-agent session save
```

### 얻는 것
- 커밋 전 CTO-급 리뷰
- BLOCKER 자동 수정으로 QA 마찰 축소
- 슬랙 자동 통지로 피드백 루프 단축

---

## Builder × Cowork × Semi-auto + Watch — 멀티 프로젝트 운영자

### 유저 프로필
- 동시에 3~6 개 프로젝트 운영
- 커밋 시마다 일일이 `review` 돌리기 귀찮음
- 반자동으로 백그라운드에서 저리뷰를 돌리고 싶음

### 일과
```bash
# 한 번 실행 후 백그라운드 유지
solo-cto-agent watch --force

# 에이전트가 파일 저장 감지 → 자동으로 review → scheduled-tasks manifest 갱신
# Cowork MCP 가 manifest 를 읽어 스케줄된 작업으로 review 결과 집계

# 필요 시 최근 리뷰 확인
solo-cto-agent status
```

### 얻는 것
- 한 번 세팅으로 모든 프로젝트에서 공통 품질 기준
- 세션 밖에서도 문제 포착
- 다음 세션 시작할 때 이미 "이번 주 누적된 이슈" 가 준비됨

> 주의: Builder Tier 의 `watch --auto` 는 기본 차단. `--force` 로 본인 책임 하에 활성화. (정책: `cto-policy.md`)

---

## Builder × Cowork+Codex × Semi-auto — 품질 중요한 오픈소스 메인테이너

### 유저 프로필
- 오픈소스 라이브러리 운영, 외부 PR 많음
- 놓치면 커뮤니티 신뢰 손상 → 크로스리뷰 필수
- `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` 둘 다 설정

### 일과
```bash
# Dual review — 키 둘 다 있으면 자동 활성화
solo-cto-agent review --diff branch

# Cowork 리뷰 → Codex 리뷰 → 차이 분석이 한 번에
# 판정이 갈리면 [ISSUES] 에 disagreement 섹션 나옴

# UI 컴포넌트 변경이면 6축 vision 점수도
solo-cto-agent uiux-review cross-verify

# 피드백 반영 — 과거 accept/reject 기록이 review 개인화에 반영
solo-cto-agent feedback accept --location src/foo.ts:42
```

### 얻는 것
- Claude 가 놓치는 것을 Codex 가 잡고, 반대도 마찬가지
- 두 에이전트의 disagreement 가 가장 중요한 시그널
- feedback loop 로 본인 프로젝트 스타일이 리뷰에 반영됨

---

## CTO × Cowork+Codex × Full-auto — 멀티-에이전트 오케스트레이션 (정책)

### 유저 프로필
- 여러 레포 / 멀티 에이전트 / CI 인프라 운영
- 파운더 겸 CTO, 팀원들에게 품질 가드레일 제공해야 함
- GitHub Actions, orchestrator 레포 모두 세팅됨

### 일과
```bash
# 최초 세팅
npx solo-cto-agent setup-pipeline --org myorg --tier cto \
  --repos myapp1,myapp2,myapp3

# 이후는 CI 가 자동 실행 — PR 열리면 Claude + Codex 동시 리뷰
# cross-review → comparison report → rework dispatch → 필요시 telegram 알림

# 로컬에서는 orchestrator 데이터 확인만
solo-cto-agent sync --org myorg               # dry-run
solo-cto-agent sync --org myorg --apply       # 로컬 캐시에 머지
solo-cto-agent status                          # agent-scores / 최근 패턴
```

### 얻는 것
- 파이프라인 전체가 24개 workflow 로 동작 (8 base + 16 multi-agent)
- agent-scores 가 실시간 업데이트 → routing-engine 이 best agent 로 라우팅
- UI/UX 4-stage 품질 게이트 + 일일 브리핑 + 결정 큐

> CTO Tier 에서 Semi-auto 로 내려가는 것도 가능하지만 정책적으로는 Full-auto 권장. 이유: [`cto-policy.md`](cto-policy.md).

---

## CTO × Cowork × Semi-auto — CTO Tier 인데 로컬로만 돌리고 싶은 경우

### 유저 프로필
- CTO 권한은 있지만 CI 인프라 구축이 아직
- 로컬에서 orchestrate 스킬만 써보고 싶음
- 또는 개인 프로젝트에서 파이프라인 부담 피하고 싶음

### 특수 정책
```bash
# watch --auto 기본 차단 (CTO+Cowork 조합은 --force 필요)
solo-cto-agent watch --auto
# → "CTO+Cowork 단독 조합은 --force 필요. cto-policy.md 참고."

# --force 로 본인 책임 하에
solo-cto-agent watch --auto --force
```

> 이 조합은 **정책상 권장되지 않지만 허용** 된다. Dual agent 없이 자동 실행하면 cross-check 가 빠지기 때문. 자세한 정책: [`cto-policy.md`](cto-policy.md).

---

## 잘못된 조합 가이드

| 조합 | 문제 | 해결 |
|---|---|---|
| Maker + `setup-pipeline` | Maker 는 CI workflow 없음 | Builder 이상으로 업그레이드 |
| Builder + `watch --auto` 무조건 시도 | 기본 차단됨 | `--force` 옵션 또는 CTO Tier 로 |
| CTO + Cowork 단독 + auto | 정책상 비권장 | Cowork+Codex 로 전환 or `--force` |
| 어떤 Tier든 API 키 없이 `review` | 호출 실패 | 최소 `ANTHROPIC_API_KEY` 설정 |

---

## 선택 플로우차트

```
혼자 작업?
  ├─ 기획/글쓰기 중심  → Maker / Cowork / Semi-auto
  ├─ 빌드/배포 중심    → Builder / Cowork / Semi-auto (default)
  └─ 멀티 프로젝트     → Builder / Cowork / Semi-auto + watch --force

팀 / CI 있음?
  ├─ 외부 PR 많음      → Builder / Cowork+Codex / Semi-auto
  └─ 여러 레포 운영    → CTO / Cowork+Codex / Full-auto (정책)
```
