# Codex 작업 프롬프트

각 프로젝트별로 Codex에 복붙하세요.

---

## eventbadge

```
GitHub repo seunghunbae-3svs/eventbadge 를 클론해서 feature/1-codex 브랜치를 만들어.

Issue: https://github.com/seunghunbae-3svs/dual-agent-review-orchestrator/issues/1

작업:
1. ESLint + Prettier 설정 추가
2. lint 에러 전부 수정
3. dead code 제거 (미사용 import, 변수, 컴포넌트)
4. 하드코딩된 Supabase URL/key → env 변수로 이동
5. 핵심 플로우 테스트 3개 추가
6. npm run build 통과 확인

완료 후 main으로 PR 만들어. 제목: "[Codex] eventbadge: 코드 품질 검증 + CI 구축"
PR에 self-review 코멘트도 남겨.
```

---

## 3stripe-event

```
GitHub repo seunghunbae-3svs/3stripe-event 를 클론해서 feature/2-codex 브랜치를 만들어.

Claude가 이미 PR을 만들었으니, Claude PR #1을 리뷰해줘.
https://github.com/seunghunbae-3svs/3stripe-event/pull/1

리뷰 기준: requirement mismatch, regression, missing tests, edge cases, security, rollback risk
각 항목을 blocker/suggestion/nit으로 분류해서 PR에 리뷰 코멘트 남겨.
```

---

## golf-now

```
GitHub repo seunghunbae-3svs/golf-now 를 클론해서 feature/3-codex 브랜치를 만들어.

Issue: https://github.com/seunghunbae-3svs/dual-agent-review-orchestrator/issues/3

작업:
1. TypeScript any 타입 제거
2. Supabase 쿼리 N+1 패턴 수정
3. 랭킹 점수 동기화 race condition 검증
4. ESLint 에러 수정
5. 미사용 CSS 정리
6. npm run build + lint 통과

완료 후 main으로 PR 만들어. 제목: "[Codex] golf-now: TypeScript 강화 + 최적화"
PR에 self-review 코멘트도 남겨.
```

---

## tribo-store

```
GitHub repo seunghunbae-3svs/tribo-store 를 클론해서 feature/4-codex 브랜치를 만들어.

Issue: https://github.com/seunghunbae-3svs/dual-agent-review-orchestrator/issues/4
⚠️ HIGH PRIORITY — 최근 3커밋이 전부 배포 실패 수정

작업:
1. 배포 실패 근본 원인 분석 + 문서화
2. Prisma schema validate
3. NextAuth 설정 검증
4. Vercel 빌드 파이프라인 안정화
5. npm run type-check + build 통과

완료 후 main으로 PR 만들어. 제목: "[Codex] tribo-store: 배포 안정화 + 근본 원인 수정"
PR에 근본 원인 분석 + self-review 남겨.
```

---

## palate-pilot

```
GitHub repo seunghunbae-3svs/palate-pilot 를 클론해서 feature/5-codex 브랜치를 만들어.

Issue: https://github.com/seunghunbae-3svs/dual-agent-review-orchestrator/issues/5

작업:
1. 카카오 검색 API 에러 핸들링 + rate limit 대응
2. SQL 마이그레이션 3개 순서 정합성 확인
3. gz 파일 3개 — 불필요하면 삭제
4. 추천 알고리즘 에지 케이스 검증
5. build 통과

완료 후 main으로 PR 만들어. 제목: "[Codex] palate-pilot: 카카오 API + DB 검증"
PR에 self-review 남겨.
```