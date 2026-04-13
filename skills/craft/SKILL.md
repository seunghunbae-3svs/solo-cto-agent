---

name: craft
description: "Design orchestrator that pushes back against generic AI-looking UI. Focuses on typography, OKLCH color systems, purposeful shadows, spacing, and motion. Activates on: UI, design, component, page, layout, CSS, Tailwind, shadcn, responsive, dark mode, dashboard, landing page, beautiful, sleek, modern."
user-invocable: true
---

# Craft — Anti-Slop Design Orchestrator

AI-generated UI has a recognizable look: too many gradients, too many rounded defaults, too much visual sameness.

This skill is intentionally opinionated. It reduces generic AI-looking UI, not define universal design truth.

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

## How to Use This Skill

1. Run **Anti-AI-Slop Checklist** on all UI work
2. Reference **Key Systems** for decision guidance
3. Check **Component Principles** for structure rules
4. Verify against **Pre-Output Checklist** before shipping
5. Link to **references/** for detailed tokens and examples when building code

> Execution examples and invocation patterns → references/execution-examples.md

This skill makes output feel deliberate, not just decorated.

