# Skill Slimming — the references/ pattern

> **Languages**: English (primary) · [한국어 요약](#한국어-요약) below.

## 한국어 요약

> 영어가 primary 입니다. 아래는 개념 요약이며 정확한 명세는 영문 본문을 기준으로 합니다.

**왜 중요한가**: skill 이 activate 될 때마다 `SKILL.md` 전체가 context 창에 덤프됩니다. 500 줄짜리 skill 하나가 ~6,000 토큰을 먹습니다. 한 세션에 두 개 켜지면 실제 작업 시작도 전에 12K 토큰이 사라집니다.

**references/ 패턴**: 결정 로직은 `SKILL.md` 에 남기고 (routing table, anti-pattern list, pre-flight checklist) 실제 참조 데이터 (템플릿, 에러 카탈로그, API spec, CSS block 등) 는 `references/` 하위 파일로 분리해서 **필요한 순간에만 로드** 합니다.

```
my-skill/
├── SKILL.md              ← 항상 로드: routing, rules, checklists (~80-120줄)
└── references/
    ├── error-catalog.md  ← 필요할 때만 로드
    ├── templates.md      ← 필요할 때만 로드
    └── api-reference.md  ← 필요할 때만 로드
```

**실측 결과** (production skill 3 개):

| 종류 | Before | After | 절감 |
|---|---|---|---|
| 프로젝트/행사 관리 | 573줄 / ~6,600 토큰 | 122줄 / ~1,800 토큰 | 79% |
| 디자인 시스템 오케스트레이터 | 318줄 / ~3,600 토큰 | 77줄 / ~1,000 토큰 | 76% |
| 플랫폼 dev guide | 203줄 / ~2,500 토큰 | 86줄 / ~1,000 토큰 | 58% |

세션당 평균 skill 로딩이 ~12K → ~3,800 토큰. 50 세션 누적이면 ~400K 토큰 절약 — agent 가 읽지도 않는 참조 텍스트에 쓰이던 컨텍스트가 실제 작업에 돌아옵니다.

**SKILL.md 에 남길 것 / references/ 로 옮길 것**:

- 남김: routing table, anti-pattern 요약, `→ references/xxx.md` 포인터, 매번 필요한 결정 로직, pre-flight checklist.
- 이동: 템플릿·리포트 구조, CSS/코드 블록, 전체 에러 카탈로그, API endpoint spec, dev history, 프로젝트별 컴포넌트 가이드.

**경험칙**: 특정 서브태스크에만 필요한 20줄 이상 참조 데이터는 references/ 로.

**적용 방법**:

1. SKILL.md 줄 수 카운트 (목표: 150 줄 이하)
2. 결정 로직이 아닌 reference 섹션 식별
3. `references/` 생성 → 그 섹션 이동
4. SKILL.md 에는 한 줄 포인터만 남김
5. 스킬이 여전히 trigger 되고 references/ 가 on-demand 로 로드되는지 테스트

**solo-cto-agent 기본 제공**: `npx solo-cto-agent init` 은 skill 스캐폴드를 `references/` 포함 구조로 생성합니다. 향후 `npx solo-cto-agent lint` 가 150 줄 초과 / 큰 inline 코드 블록이 있는 skill 을 경고 예정.

---

## Why this matters

Every skill activation dumps the full `SKILL.md` into the context window. A 500-line skill eats ~6,000 tokens just by triggering. Two skills in one session and you've burned 12K tokens before doing anything useful.

The fix is obvious once you see it: most of that content isn't needed on every activation. Templates, full error catalogs, CSS blocks, API specs — the agent only reads those when it's actually doing that specific subtask.

## How it works

```
my-skill/
├── SKILL.md              ← Always loaded: routing, rules, checklists (~80-120 lines)
└── references/
    ├── error-catalog.md   ← Loaded on demand
    ├── templates.md       ← Loaded on demand
    └── api-reference.md   ← Loaded on demand
```

SKILL.md keeps only what the agent needs to decide *what to do*: routing tables, anti-pattern lists, quick-reference summaries, and pointers like `> Full error catalog → references/error-catalog.md`. The agent reads references/ files only when the task actually requires them.

## Measured results

Three production skills, before and after applying this pattern:

| Skill type | Before | After | Saved |
|------------|--------|-------|-------|
| Project/event management | 573 lines / ~6,600 tok | 122 lines / ~1,800 tok | 79% |
| Design system orchestrator | 318 lines / ~3,600 tok | 77 lines / ~1,000 tok | 76% |
| Platform dev guide | 203 lines / ~2,500 tok | 86 lines / ~1,000 tok | 58% |

Average session went from ~12K tokens on skill loading to ~3,800. That's 8K tokens freed up per session for actual work.

Over 50 sessions, the difference adds up to roughly 400K tokens — real context space that would otherwise be wasted on reference text the agent never reads.

## What stays inline vs. what moves

**Keep in SKILL.md:**
- Routing table (which tool/sub-skill for which task type)
- Anti-pattern list (condensed, no long examples)
- 1-line summaries with `→ references/filename.md` pointers
- Decision logic the agent needs every time
- Pre-flight checklists

**Move to references/:**
- Document templates and report structures
- CSS/code blocks (design tokens, color definitions, shadow systems)
- Full error catalogs with solutions
- API endpoint specs
- Dev history and changelogs
- Per-project component guides

Rule of thumb: if a section is 20+ lines of reference data that's only needed for specific subtasks, it belongs in references/.

## Applying this to your skills

```
1. Count SKILL.md lines (target: under 150)
2. Find sections that are reference data, not decision logic
3. Create references/ and move those sections
4. Replace with 1-line pointers in SKILL.md
5. Test that the skill still triggers and references/ loads when needed
```

## solo-cto-agent integration

`npx solo-cto-agent init` scaffolds with references/ by default:

```
.claude/skills/{skill-name}/
├── SKILL.md
└── references/
    └── .gitkeep
```

Future: `npx solo-cto-agent lint` will flag skills where SKILL.md exceeds 150 lines or has large inline code blocks that should be in references/.
