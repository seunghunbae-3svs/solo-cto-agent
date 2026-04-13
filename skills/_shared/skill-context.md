# Embedded Skill Context (Shared)

이 블록은 codex-main의 `claude-worker.js`, `claude-reviewer.js`와
cowork-main의 `cowork-engine.js`에 **동일하게 주입된다.**

에이전트가 리뷰·작업·배포 프롬프트를 돌릴 때마다 `SKILL_CONTEXT`로 사용한다.

---

## Ship-Zero Protocol (배포 전 체크리스트)

- Prisma: schema validate, generate 타이밍, postinstall 스크립트
- NextAuth: import 경로(@/lib/), 콜백 로직, 세션 설정
- Vercel 빌드: env 변수 존재 확인, build command, output directory
- TypeScript: strict 모드, any 타입 제거, 타입 누락
- Supabase: RLS 정책, service_role vs anon key 구분, N+1 쿼리

## Project Dev Guide 에러 패턴

- import 경로 에러: `./relative` → `@/absolute` 변환 필수
- Prisma + Drizzle 동시 사용 금지: 하나만 선택
- NextAuth 콜백에서 session.user 확장 시 `next-auth.d.ts` types 파일 필요
- Vercel 배포 실패 상위 원인: env 변수 누락, prisma generate 타이밍, build command 불일치
- Next.js 14/15 혼용 금지: params 동기/비동기 처리 규칙 다름
- Tailwind v3/v4 문법 혼용 금지: PostCSS 설정과 import 방식 다름

## 코딩 규칙

- 최소 안전 수정: 요청 범위 밖 리팩토링 금지
- 에러 처리: 조용히 삼키지 않음, 구조화된 에러 반환, try-catch는 실제 실패 지점에만
- PR 본문 필수: 변경 요약, 리스크 레벨, 롤백 방법, Preview 링크
- 팩트 기반: 추정과 확정 구분 `[확정]` / `[추정]` / `[미검증]`
- Circuit Breaker: 같은 에러 3회 재시도 실패 시 정지 후 보고

## 리뷰 기준 (Ship-Zero + Project Dev Guide 통합)

1. Import 경로 `@/` 절대경로 사용 여부
2. Prisma/Drizzle 혼재 없는지, generate 타이밍
3. NextAuth 콜백 로직 + types 파일
4. Supabase RLS 정책, service_role vs anon, N+1
5. TypeScript: any 금지, strict 모드 준수
6. 에러 처리: try-catch 누락, 조용한 실패 금지
7. 보안: SQL injection, auth bypass, secret 노출
8. 배포: env 누락, build command, Vercel 설정
