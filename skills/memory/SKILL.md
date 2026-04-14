---
name: memory
description: "Context & pattern retention for long-running work. Stores decisions, repeated failure patterns, conventions, open threads. Sharper over time, not larger. Activates on: remember, context, history, decision log, what did we decide, recurring issue, lesson learned, knowledge."
user-invocable: true
---

# Memory — Context & Pattern Retention

> 에이전트와 일할 때 가장 짜증나는 부분 — 같은 대화를 두 번 하는 것.
> 이 스킬은 그 비용을 줄인다.

보존 대상:
- 중요한 프로젝트 결정
- 반복되는 실패 패턴
- 유용한 가정
- 미해결 리스크
- 다음 세션으로 가져갈 가치 있는 컨텍스트

모든 것을 기억하는 게 아니라, **재발견 비용이 큰 것** 만 기억한다.

---

## Principle 0 — Save what reduces future friction

Do not store everything.
Store what will matter again.

Good candidates:

* architecture decisions
* stack conventions
* deploy constraints
* naming rules
* repeated bugs or failure patterns
* user preferences that affect future execution
* things that caused avoidable re-explanation

Bad candidates:

* trivial one-off details
* noisy intermediate states
* temporary scraps with no future value

---

## What to remember

Four types of memories that matter:

1. **Decisions** — framework, deploy platform, auth provider, migration policy, etc. Should capture: what was decided, why, what tradeoff was accepted, when to revisit.

2. **Repeated failure patterns** — build breaks, deploy failures, package conflicts, framework incompatibilities. High-value because they reduce wasted loops.

3. **User preferences** — UI style, communication tone, approval requirements, fact-marking. These shape future agent behavior.

4. **Open threads** — known gaps not yet prioritized, deferred risks, intentional postponements. Prevents forgotten debt from turning into repeated rediscovery.

---

## Memory layers

**Layer 1 — session notes** (short-lived): what changed today, what broke, assumptions made, what needs attention next.

**Layer 2 — durable project memory** (longer-lived): stable decisions, repeated patterns, working conventions, high-value lessons.

**Layer 3 — compressed knowledge** (permanent): if something repeats 3+ times, condense it into a short reusable rule instead of keeping noisy logs.

---

## Quality Log (per-artifact)

에이전트가 만든 결과물을 기록한다. 다음 세션에서 품질 추세를 보는 용도.

한 엔트리 = 한 결과물. 기록할 것:

- **Artifact**: 파일 경로 또는 세션 ID
- **Type**: code | doc | deploy | review
- **Outcome**: shipped | reverted | blocked | needs-rework
- **Quality signal**: 사람 피드백 (accept / reject / silent) + 자동 시그널 (tests pass/fail, build ok/error)
- **Lesson**: 이 결과물에서 남길 한 줄

한 주에 3회 이상 같은 lesson이 반복되면 Layer 3으로 승격한다. 반복되는 품질 구멍이 durable 규칙으로 굳는 메커니즘.

---

## Error Pattern Ledger (failure-specific)

반복되는 에러는 별도 원장에 모은다. Quality Log와 달리 **실패 재현 가능성**에 초점.

한 엔트리 = 한 에러 패턴. 기록할 것:

- **Error signature**: 에러 메시지의 스테이블한 부분 (정규식 가능)
- **First seen / Last seen**: 날짜
- **Occurrence count**: 누적 발생 횟수
- **Root cause category**: code | env | schema | deploy | external | unknown
- **Fix**: 가장 짧은 재현 가능한 수정
- **Prevention**: 재발 방지책 (테스트 추가 / 린트 규칙 / 체크리스트 항목)

**Promotion 규칙**: 같은 signature가 3회 이상 발생하면 build/ship의 Quick-Fix Catalog로 승격한다. 해결책이 카탈로그에 들어가면 Error Pattern Ledger에서는 "resolved: see build/ship"로 대체.

---

## Memory record format

Fields: topic, type (decision / pattern / preference / open-thread), summary, why it matters, trigger, when to revisit.

> Full examples → [references/record-format.md](references/record-format.md)

---

## Storage and retrieval

Organized across three layers: CONTEXT_LOG.md (session decisions), LOGS/ (daily snapshots), and memory/knowledge/ (durable rules).

> Full details → [references/storage-structure.md](references/storage-structure.md)

---

## Compression rule

If the same thing comes up multiple times:

* stop storing raw repetition
* compress it into a general rule
* keep the shortest useful version

Memory should get sharper over time, not just larger.

---

## Retrieval rule

Before starting a related task, check whether relevant memory exists.

Especially for:

* deployment work
* auth changes
* environment setup
* repeated bug classes
* product or UX preferences
* strategic decisions already debated

The point is to reduce repeated questioning and repeated mistakes.

---

## Anti-patterns

```text id=”arhlji”
❌ storing everything
❌ storing vague summaries with no future use
❌ keeping raw noise instead of compressing lessons
❌ treating temporary confusion as durable memory
❌ remembering facts but not the reason behind them
❌ re-asking the user something that was already settled clearly
```

---

## Output expectations

When this skill is applied, the result should help answer:

* what should not be forgotten
* what should affect future behavior
* what should be reused automatically next time
* what is still unresolved but worth keeping visible

This skill should make the next session lighter, not just longer.

---

## Execution Patterns

> 상세 워크플로우 → [references/execution-guide.md](references/execution-guide.md)

다루는 시나리오:
- 세션 결정사항 캡처
- 에러 패턴 기록
- 주간 변경 요약
- 보존 vs 폐기 기준
- Memory hygiene + cleanup

---

## cowork-engine 와의 연동

`solo-cto-agent knowledge <project-dir>` 명령은 이 스킬의 포맷을 그대로 사용한다.
저장 위치: `~/.claude/skills/solo-cto-agent/knowledge/`

추출된 ERROR_PATTERNS 는 `failure-catalog.json` 으로 자동 머지되어 다음 review 호출에서 즉시 활용된다.

---

## 공통 스펙 참조

- 출력 포맷·팩트 태깅: `skills/_shared/agent-spec.md`
- 임베드 컨텍스트: `skills/_shared/skill-context.md`

---

## CLI Hooks — personalization 명시 기록

```bash
solo-cto-agent feedback accept --location src/Btn.tsx:42 --severity BLOCKER
solo-cto-agent feedback reject --location src/Nav.tsx:12 --severity SUGGESTION \
  --note "이미 memoized — false positive"
solo-cto-agent feedback show                                 # 누적 accept/reject 패턴
solo-cto-agent knowledge                                     # 결정/에러 패턴 추출
solo-cto-agent session save                                  # 세션 스냅샷
```

`feedback` 은 다음 review 의 가중치로 반영 (80/20 anti-bias rotation — 과거 패턴 과적합 방지). 상세: `docs/feedback-guide.md`.
