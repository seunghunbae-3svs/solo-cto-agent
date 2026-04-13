# Product Requirements

## Goal
Codex와 Claude가 같은 GitHub 프로젝트에서 병렬로 작업하고, review orchestrator가 상태를 집계하여 Telegram으로 요약과 Preview link를 전달하는 운영 체계를 구축합니다.

## Success criteria
- 병렬/단일 에이전트 라우팅 기준이 문서화되어 있다.
- 최대 2회 리뷰 라운드 규칙이 적용된다.
- Preview link가 리뷰 준비 상태마다 전달된다.
- 프로덕션 배포는 사람 승인 없이는 진행되지 않는다.

## Core flows
1. 이슈 생성
2. 오케스트레이터가 단일/병렬 모드 판단
3. 각 에이전트 구현 및 자체 QA
4. 교차 리뷰
5. 필요 시 1회 개선
6. Preview 공유
7. 사용자 승인 또는 수정 지시
8. 배포 게이트 통과 후 다음 단계 진행
