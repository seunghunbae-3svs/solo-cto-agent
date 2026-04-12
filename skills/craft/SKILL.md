---

name: craft
description: "Design orchestrator that pushes back against generic AI-looking UI. Focuses on typography, OKLCH color systems, purposeful shadows, spacing, and motion. Activates on: UI, design, component, page, layout, CSS, Tailwind, shadcn, responsive, dark mode, dashboard, landing page, beautiful, sleek, modern."
user-invocable: true
---

# Craft — Anti-Slop Design Orchestrator

This skill exists because AI-generated UI often has a recognizable look:
too many gradients, too many rounded defaults, too much visual sameness.

This skill is intentionally opinionated.
It is meant to reduce generic AI-looking UI, not define a universal design truth.

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

## Typography System

### Font Pairing Rules

```text
1. Max 2 typefaces per project
2. Display font should add character, not noise
3. Body font should optimize readability first
4. Test at actual sizes before committing
```

### Recommended Pairings (examples — customize)

```text
| Display         | Body            | Feel                     |
|----------------|-----------------|--------------------------|
| Space Grotesk  | Inter           | Clean tech               |
| Fraunces       | Commissioner    | Premium editorial        |
| Sora           | Nunito Sans     | Friendly modern          |
| DM Serif Text  | DM Sans         | Elegant balanced         |
| Archivo Black  | Source Sans 3   | Bold startup             |
| Playfair       | Lato            | Luxury minimal           |
```

### Type Scale

```css
Base: 16px
Scale ratio:
- 1.25 for product/app UI
- 1.333 for more editorial layouts

--text-xs:   0.75rem
--text-sm:   0.875rem
--text-base: 1rem
--text-lg:   1.25rem
--text-xl:   1.563rem
--text-2xl:  1.953rem
--text-3xl:  2.441rem
--text-4xl:  3.052rem
```

---

## OKLCH Color System

Use OKLCH when the stack supports it.
It is easier to make coherent palettes when lightness and chroma changes behave more predictably.

### Structure

```text
oklch(lightness chroma hue)

- lightness: black -> white
- chroma: gray -> saturated
- hue: color angle
```

### Palette building

```text
1. Pick one main hue
2. Build a lightness scale first
3. Keep chroma consistent within a family
4. Create semantic tokens:
   - surface
   - text
   - accent
   - error
5. In dark mode, reduce chroma slightly and redesign contrast intentionally
```

### Example

```css
:root {
  --brand-50:  oklch(95% 0.05 280);
  --brand-100: oklch(90% 0.08 280);
  --brand-200: oklch(80% 0.12 280);
  --brand-300: oklch(70% 0.16 280);
  --brand-400: oklch(60% 0.20 280);
  --brand-500: oklch(50% 0.22 280);
  --brand-600: oklch(40% 0.20 280);
  --brand-700: oklch(30% 0.16 280);
  --brand-800: oklch(20% 0.12 280);
  --brand-900: oklch(15% 0.08 280);
}
```

---

## Shadow System

Shadows should imply consistent elevation, not random decoration.

```css
--shadow-xs:  0 1px 2px oklch(0% 0 0 / 0.05);
--shadow-sm:  0 2px 4px oklch(0% 0 0 / 0.06), 0 1px 2px oklch(0% 0 0 / 0.04);
--shadow-md:  0 4px 8px oklch(0% 0 0 / 0.08), 0 2px 4px oklch(0% 0 0 / 0.04);
--shadow-lg:  0 8px 24px oklch(0% 0 0 / 0.12), 0 4px 8px oklch(0% 0 0 / 0.04);
--shadow-xl:  0 16px 48px oklch(0% 0 0 / 0.16), 0 8px 16px oklch(0% 0 0 / 0.06);
```

Rules:

* low-elevation cards: `shadow-sm`
* hover/elevation shift: `shadow-md`
* dialogs/modals: `shadow-xl`
* never use shadows with no structural reason

---

## Motion System

Motion should support clarity, not show off.

```css
--duration-instant: 50ms;
--duration-fast: 150ms;
--duration-normal: 250ms;
--duration-slow: 400ms;

--ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);
--ease-in: cubic-bezier(0.4, 0.0, 1, 1);
--ease-in-out: cubic-bezier(0.4, 0.0, 0.2, 1);
```

Rules:

* hover: fast and subtle
* menus/dropdowns: readable, not flashy
* page transitions: only when they add orientation
* respect `prefers-reduced-motion`
* avoid decorative motion with no information value

---

## Spacing & Layout

```text
Base unit: 4px

Internal component padding: 12-16px
Card padding: 16-24px
Section spacing: 48-96px
Content width: ~1280px
```

Patterns:

* dashboards: strong grid and predictable columns
* content pages: readable measure first
* cards: use layout rhythm, not just repetition
* mobile: one-column clarity beats clever responsiveness

---

## Component Principles

### Cards

* Pick one radius system for the project and stay with it
* Use border or shadow as the main separator, not both by default
* Hover states should feel intentional, not louder

### Buttons

* Size should reflect importance
* Loading state should preserve button width
* Primary / secondary / destructive should be clearly distinct

### Forms

* Label above field
* Placeholder is not a label
* Error state should be obvious
* Focus state should be visible without being theatrical

### Tables

* Prefer horizontal rhythm over full grid boxing
* Sticky headers are often worth it
* Mobile should degrade honestly, not pretend dense tables work on tiny screens

---

## Dark Mode Rules

```text
1. Do not just invert; redesign for dark surfaces
2. Maintain at least three surface levels
3. Avoid pure white body text
4. Borders matter more in dark mode
5. Reduce chroma slightly
6. Test the hierarchy, not just the palette
```

---

## Pre-Output Checklist

Before presenting UI work:

```text
□ Anti-slop checklist passed?
□ Typography intentional?
□ Color tokens consistent?
□ Shadows justified?
□ Motion restrained?
□ Mobile considered?
□ Dark mode considered?
□ No obvious filler or lazy defaults?
```

This skill should make the output feel more deliberate, not just more decorated.
