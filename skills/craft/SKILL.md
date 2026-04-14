---
name: craft
description: "Design orchestrator that pushes back against generic AI-looking UI. CTO-level taste discipline — typography, OKLCH color, purposeful shadows, spacing, motion. Activates on: UI, design, component, page, layout, CSS, Tailwind, shadcn, responsive, dark mode, dashboard, landing page, beautiful, sleek, modern."
user-invocable: true
---

# Craft — Anti-Slop Design Orchestrator

> AI 가 만든 UI 는 알아본다.
> 둥근 모서리 어디에나, 파란 그라데이션, 기본 그림자, SaaS 스타터 키트 분위기.
> 이 스킬은 그 흐름에 거스른다.

의도적으로 강한 의견을 가진 스킬이다. 보편적 디자인 진리를 정의하는 게 아니라, 생성된 UI 가 generic 해 보이지 않도록 만든다.

---

## Anti-AI-Slop Checklist

Run this on every UI output:

```text
□ No gradient unless it actually improves hierarchy or meaning
□ No border-radius: 9999px on non-avatar elements
□ No large shadow without a believable elevation context
□ No default blue as brand color unless chosen intentionally
□ No identical card grids with no visual rhythm
□ No emoji as production icon substitute
□ No floating elements with no visual anchor
□ No placeholder images when real structure would be clearer
□ No body text below 14px
□ No more than 2 font weights competing on one screen
```

---

## Key Systems

### Typography
- Max 2 typefaces per project
- Display font: character > noise
- Body font: readability first

> Font pairings → references/typography-pairings.md
> Type scale tokens → references/type-scale.md

### OKLCH Color System
Use OKLCH for coherent palettes where lightness and chroma behave predictably.

```text
oklch(lightness chroma hue)
- lightness: 0–100% (black → white)
- chroma: 0–0.4 (gray → saturated)
- hue: 0–360° (color angle)
```

> Full palette examples → references/oklch-palette.md

### Shadow System
Shadows imply elevation, not random decoration.

- `shadow-sm`: low-elevation cards
- `shadow-md`: hover/elevation shift
- `shadow-xl`: dialogs/modals
- Never use shadows with no structural reason

> Full token definitions → references/shadow-system.md

### Motion System
Motion supports clarity, not ego.

- hover: fast + subtle
- menus/dropdowns: readable, not flashy
- page transitions: only for orientation
- Always respect `prefers-reduced-motion`

> Full motion tokens → references/motion-system.md

### Spacing & Layout
```
Base unit: 4px
Component padding: 12–16px
Card padding: 16–24px
Section spacing: 48–96px
Content width: ~1280px
```

**Patterns:** dashboards = strong grid; content = readable measure first; cards = layout rhythm; mobile = one-column clarity

---

## Component Principles

| Component | Key Rule |
|-----------|----------|
| Cards | Pick one radius system. Border OR shadow, not both. Hover: intentional. |
| Buttons | Size = importance. Loading state preserves width. Primary/secondary/destructive: distinct. |
| Forms | Label above. Placeholder ≠ label. Error obvious. Focus visible. |
| Tables | Horizontal rhythm > full boxing. Sticky headers. Mobile: degrade honestly. |

> Full component specs → references/component-specs.md

---

## Dark Mode Rules

1. Do not invert—redesign for dark surfaces
2. Maintain at least 3 surface levels
3. Avoid pure white body text
4. Borders matter more in dark mode
5. Reduce chroma slightly
6. Test hierarchy, not just palette

---

## Pre-Output Checklist

```text
□ Anti-slop checklist passed?
□ Typography intentional?
□ Color tokens consistent?
□ Shadows justified?
□ Motion restrained?
□ Mobile considered?
□ Dark mode considered?
□ No filler or lazy defaults?
```

---

## Output Discipline

UI 작업 보고도 나머지 스킬과 같은 톤이다.

```
[CHANGED FILES]
- components/Card.tsx
- styles/tokens.css

[DESIGN INTENT]
2~3문장. 어떤 결정을 왜 했는지.

[ANTI-SLOP CHECK]
□ 통과한 항목 / ⛔ 위반한 항목

[NEXT ACTION]
- 다크 모드 surface level 검증
- 모바일 1-column 점검
```

수치 (예: 컴포넌트 크기, 색상 lightness, 페이지 무게) 는 `[확정]` / `[추정]` / `[미검증]` 태그.

---

## How to Use

1. **Anti-AI-Slop Checklist** 를 모든 UI 작업에 적용
2. **Key Systems** 로 결정 근거 확보
3. **Component Principles** 로 구조 규칙 확인
4. **Pre-Output Checklist** 로 출하 전 검증
5. 디테일은 `references/` 토큰·예시 참조

---

## Anti-Patterns

❌ "예쁘게 만들었습니다" — 디자인 의도를 명시한다.
❌ 그라데이션 + 둥근 모서리 + 그림자 동시 사용 (justification 없이)
❌ 모바일/다크 모드 미검증 상태로 완료 선언
❌ 칭찬 / "감각적이죠" / "트렌디합니다" 같은 표현

---

## 공통 스펙 참조

- 출력 포맷·판정·팩트 태깅: `skills/_shared/agent-spec.md`

> 실행 예시 → references/execution-examples.md

이 스킬의 결과물은 장식이 아니라 의도가 보이게 한다.

---

## CLI Hooks — UI/UX craft 점검

```bash
solo-cto-agent uiux-review code                              # 변경된 UI 코드 리뷰
solo-cto-agent uiux-review tokens                            # 디자인 토큰 추출 + 일관성 리포트
solo-cto-agent uiux-review vision --screenshot shot.png      # 6축 점수 (layout/typography/spacing/color/a11y/polish)
solo-cto-agent uiux-review cross-verify --screenshot shot.png
                                                             # 코드 ↔ 비전 교차검증
solo-cto-agent uiux-review baseline save --screenshot shot.png --project tribo
solo-cto-agent uiux-review baseline diff --screenshot shot.png --project tribo
```

Vision 리뷰는 기본 manual 전용. watch 자동 트리거에서는 제외 (비용 가드레일).

