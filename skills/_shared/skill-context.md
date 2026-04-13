# Embedded Skill Context (Shared)

이 블록은 codex-main 의 `claude-worker.js`, `claude-reviewer.js` 와
cowork-main 의 `cowork-engine.js` 에 **동일하게 주입된다.**

에이전트가 리뷰·작업·배포 프롬프트를 돌릴 때마다 `SKILL_CONTEXT` 로 사용한다.

---

## A. 운영 원칙 (스택 무관, 항상 적용)

### A.1 Live Source of Truth
프로젝트 현황은 **라이브 소스** 에서 직접 확인한다. 문서·STATE.md·이전 응답 기억은 *기록* 이지 *현황* 이 아니다.

| 항목 | 라이브 소스 (우선) | 절대 하지 말 것 |
|---|---|---|
| 배포 상태 | Vercel API / 호스팅 dashboard | 문서가 "READY" 라고 적혀 있다고 믿기 |
| DB 상태 | DB 직접 SQL / MCP 조회 | 코드 schema 만 보고 추정 |
| 코드 현황 | git / GitHub API (branches, PRs) | 이전 세션 기억 기반 추정 |
| 빌드/런타임 에러 | provider build logs / runtime logs | 에러 메시지 추정 |

라이브 소스 조회 결과는 `[확정]`. 캐시는 `[캐시]`. 추정은 `[추정]`. 미확인은 `[미검증]`.

### A.2 최소 안전 수정
- 요청 범위 밖 리팩토링 금지.
- diff 가 닿지 않는 파일은 리뷰에서도 언급하지 않는다.
- "겸사겸사" 수정 금지 — 별도 PR.

### A.3 에러 처리
- 조용한 실패 금지. 모든 catch 는 구조화된 에러 반환 또는 명시적 재던짐.
- try-catch 는 *실제 실패 가능 지점* 에만. 함수 전체를 감싸지 않는다.
- Circuit Breaker: 같은 에러 3회 재시도 실패 시 정지 후 보고.

### A.4 팩트 기반
- 수치·주장에는 `[확정]` / `[추정]` / `[미검증]` 태그.
- 산출 근거 또는 출처 표기.
- "강력한", "빠르게 성장" 같은 모호한 표현 금지.

### A.5 PR / 변경 본문 필수 항목
- 변경 요약 (1-3줄)
- 리스크 레벨 (LOW / MEDIUM / HIGH)
- 롤백 방법
- Preview / 검증 링크

---

## B. Common Stack 패턴 (해당 스택 사용 시)

아래는 자주 등장하는 스택의 **반복 발생 에러 패턴** 이다. 사용자 SKILL.md 의 stack 필드와 매칭되는 항목만 활성 적용.

### B.1 Next.js / React
- **import 경로:** `./relative` → `@/absolute` 변환. 경로 alias 누락 시 빌드 실패.
- **Next.js 14 vs 15:** `params` 동기(14) / `Promise<params>`(15) 처리 다름. 혼용 금지.
- **Server vs Client Component:** `'use client'` 누락 → hooks 에러. 불필요 추가 → SSR 무력화.
- **Tailwind v3 vs v4:** PostCSS 설정 + import 방식 다름. 혼용 금지.

### B.2 Prisma / DB ORM
- Prisma + Drizzle 동시 사용 금지 — 하나만 선택.
- `prisma generate` 타이밍: postinstall 또는 build 사전 단계.
- schema 변경 → 마이그레이션 미생성 시 production 차단.

### B.3 NextAuth / Auth
- 콜백에서 session.user 확장 시 `next-auth.d.ts` types 파일 필요.
- import 경로: `@/lib/auth` 컨벤션 일관성.
- secret / callback URL 환경별 분리.

### B.4 Supabase / Postgres
- RLS 정책 활성화 여부 확인. 비활성 = 보안 BLOCKER.
- `service_role` vs `anon` key 혼동 금지. 클라이언트 코드에 service_role 노출 금지.
- N+1 쿼리: select 안에 select 중첩 패턴 점검.

### B.5 Vercel / 배포
- 빌드 실패 상위 원인: env 변수 누락, prisma generate 타이밍, build command 불일치.
- Preview vs Production 환경변수 차이 점검.
- `vercel.json` 의 build/output 설정과 framework preset 일치.

---

## C. 리뷰 기준 (요약 — diff 검토 시 우선순위)

1. **보안** — secret 노출, auth bypass, SQL injection, RLS 비활성화 → BLOCKER
2. **데이터 손실 위험** — 마이그레이션 누락, 무차별 delete, 트랜잭션 누락 → BLOCKER
3. **타입 안전성** — `any`, 미정의, strict 모드 위반 → SUGGESTION (의도 명확하면 NIT)
4. **에러 처리** — try-catch 누락, 조용한 실패, 구조화 안 된 에러 → SUGGESTION
5. **스택 일관성** — Common Stack §B 위반 → SUGGESTION 또는 BLOCKER
6. **PR 본문** — §A.5 누락 → SUGGESTION
7. **성능** — N+1, 불필요 re-render, 큰 번들 추가 → SUGGESTION
8. **스타일/일관성** — naming, formatting → NIT

---

## D. Cowork 런타임 컨텍스트 (Semi-auto mode 전용)

### D.1 자율성 경계
- L1 (auto): 로컬 파일 읽기, diff 분석, 캐시 조회, MCP 라이브 조회, 리뷰 작성
- L2 (auto + notice): failure-catalog 자동 머지, knowledge 저장, 세션 캐시 갱신, web search
- L3 (must ask): `sync --apply`, `git push`, production DB 변경, 결제/계약 호출

### D.2 Degraded Fallback
- API 실패 → 캐시된 failure-catalog + skill-context 로 정적 분석만 수행 → `[OFFLINE]` 태그
- MCP 실패 → 마지막 성공 조회를 `[캐시]` 태그로 노출
- Web search 실패 → 학습 컷오프 이내 지식만 `[미검증]` 으로 표시

### D.3 Cross-Review 우선순위 (Cowork 단독 vs Cowork+Codex)
- **Cowork 단독:** self cross-review (1차 리뷰 → 2차 devil's advocate) 자동 수행
  - 두 패스 합의 항목 = 우선 수정. 1차만 / 2차만 항목 = 별도 표기.
- **Cowork+Codex:** Claude + Codex 양쪽 리뷰 → 합의/불일치 명시. Cowork 가 중재자.

### D.4 개인화 누적 (Personalization Layer)
세션을 거치면서 누적되는 사용자 컨텍스트:
- 수락된 제안 패턴 → 향후 우선순위 ↑
- 거부된 제안 패턴 → 향후 우선순위 ↓ 또는 톤 조정
- 반복 에러 패턴 → failure-catalog 강화
- 코딩 스타일 선호 (verbose / terse, comment 빈도, naming) → 프롬프트 자동 반영

이 누적치는 `~/.claude/skills/solo-cto-agent/personalization.json` 에 저장된다.
