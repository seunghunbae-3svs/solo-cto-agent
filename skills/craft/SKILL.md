---
name: craft
description: "Design orchestrator that eliminates AI-generated visual slop. Enforces premium typography, OKLCH color systems, purposeful shadows, and motion. Activates on: UI, design, component, page, layout, CSS, Tailwind, shadcn, responsive, dark mode, dashboard, landing page, beautiful, sleek, modern."
user-invocable: true
---

# Craft — Anti-Slop Design Orchestrator

AI-generated UI has a recognizable "slop" aesthetic: gratuitous gradients, generic blue, uniform border-radius, meaningless shadows. This skill eliminates that.

---

## Anti-AI-Slop Checklist (run on every UI output)

```
□ No gradient that doesn't serve information hierarchy
□ No border-radius: 9999px on non-avatar elements
□ No shadow-lg without light-source logic
□ No blue-500 as default brand color (choose intentionally)
□ No identical card grids with no visual variation
□ No emoji as icon substitute in production UI
□ No "floating" elements with no visual anchor
□ No placeholder images (use real content or structured placeholders)
□ No text smaller than 14px for body content
□ No more than 2 font weights on one screen
```

---

## Typography System

### Font Pairing Rules
```
1. Max 2 typefaces per project (1 display + 1 body)
2. Display font: higher contrast, personality
3. Body font: high x-height, open counters, regular weight >= 400
4. Test at actual sizes before committing
```

### Recommended Pairings (examples — customize)
```
| Display         | Body            | Vibe                    |
|----------------|-----------------|-------------------------|
| Space Grotesk  | Inter           | Tech/SaaS clean         |
| Fraunces       | Commissioner    | Premium editorial       |
| Sora           | Nunito Sans     | Friendly modern         |
| DM Serif Text  | DM Sans         | Elegant balanced        |
| Archivo Black  | Source Sans 3   | Bold startup            |
| Playfair       | Lato            | Luxury minimal          |
```

### Type Scale
```
Base: 16px (1rem)
Scale ratio: 1.25 (Major Third) for apps, 1.333 (Perfect Fourth) for editorial

--text-xs:   0.75rem   (12px)
--text-sm:   0.875rem  (14px)
--text-base: 1rem      (16px)
--text-lg:   1.25rem   (20px)
--text-xl:   1.563rem  (25px)
--text-2xl:  1.953rem  (31px)
--text-3xl:  2.441rem  (39px)
--text-4xl:  3.052rem  (49px)
```

---

## OKLCH Color System

Use OKLCH instead of hex/HSL for perceptually uniform color manipulation.

### Structure
```
oklch(Lightness% Chroma Hue)
- Lightness: 0% (black) to 100% (white)
- Chroma: 0 (gray) to 0.4 (max saturation)
- Hue: 0-360 degrees
```

### Building a Palette
```
1. Pick brand hue (e.g., 250 for violet)
2. Generate lightness scale: 15%, 25%, 35%, 45%, 55%, 65%, 75%, 85%, 95%
3. Keep chroma consistent within a scale (e.g., 0.15 for UI, 0.25 for accents)
4. Semantic tokens: --color-surface, --color-text, --color-accent, --color-error
5. Dark mode: flip lightness values, reduce chroma by ~20%
```

### Example Preset: Midnight Violet
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

Create your own presets by changing the hue value.

---

## Shadow System

Shadows must follow a consistent light source (top-left default).

```css
--shadow-xs:  0 1px 2px oklch(0% 0 0 / 0.05);
--shadow-sm:  0 2px 4px oklch(0% 0 0 / 0.06), 0 1px 2px oklch(0% 0 0 / 0.04);
--shadow-md:  0 4px 8px oklch(0% 0 0 / 0.08), 0 2px 4px oklch(0% 0 0 / 0.04);
--shadow-lg:  0 8px 24px oklch(0% 0 0 / 0.12), 0 4px 8px oklch(0% 0 0 / 0.04);
--shadow-xl:  0 16px 48px oklch(0% 0 0 / 0.16), 0 8px 16px oklch(0% 0 0 / 0.06);

/* Colored shadow for elevated brand elements */
--shadow-brand: 0 8px 24px oklch(50% 0.15 var(--brand-hue) / 0.25);
```

Rules:
- Cards resting on surface: shadow-sm
- Cards on hover/focus: transition to shadow-md
- Modals/dialogs: shadow-xl
- Never use shadow without matching elevation context

---

## Motion System

```css
/* Duration tokens */
--duration-instant:  50ms;
--duration-fast:     150ms;
--duration-normal:   250ms;
--duration-slow:     400ms;
--duration-glacial:  700ms;

/* Easing */
--ease-out:     cubic-bezier(0.0, 0.0, 0.2, 1);
--ease-in:      cubic-bezier(0.4, 0.0, 1, 1);
--ease-in-out:  cubic-bezier(0.4, 0.0, 0.2, 1);
--ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1);
```

Rules:
- Hover effects: --duration-fast + --ease-out
- Dropdowns/menus: --duration-normal + --ease-out
- Page transitions: --duration-slow + --ease-in-out
- Loading spinners: use CSS @keyframes, never JS setInterval
- prefers-reduced-motion: reduce → disable all non-essential animation

---

## Spacing & Layout

```
Base unit: 4px
Scale: 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64

Component internal padding: 12-16px (3-4 units)
Card padding: 16-24px (4-6 units)
Section spacing: 48-96px (12-24 units)
Page max-width: 1280px (content), 1440px (wide)
```

### Grid Patterns
- Dashboard: 12-column grid, sidebar 240-280px fixed
- Marketing: centered content, max-w prose for text
- Cards: CSS Grid with auto-fill, minmax(300px, 1fr)
- Mobile: single column, 16px horizontal padding

---

## Component Design Principles

### Cards
- Consistent corner radius within a project (pick 8px, 12px, or 16px — not mixed)
- Visible boundary: either shadow OR border, not both
- Hover state: subtle shadow elevation OR border color shift

### Buttons
- Min height: 36px (sm), 40px (md), 48px (lg)
- Horizontal padding: 1.5x vertical padding
- Primary: filled. Secondary: outlined or ghost. Destructive: red-tinted.
- Loading state: spinner replaces label, width unchanged

### Forms
- Label above input (not placeholder-as-label)
- Error messages below field, red accent, appear with transition
- Focus ring: 2px solid brand color, offset 2px
- Disabled: reduced opacity (0.5-0.6), cursor-not-allowed

### Tables
- Horizontal lines only (no full grid borders)
- Sticky header on scroll
- Row hover highlight: surface+1 shade
- Responsive: horizontal scroll on mobile, not column hiding

---

## Dark Mode Rules

```
1. Don't invert — redesign. Dark backgrounds need lower chroma, warmer grays.
2. Surface hierarchy: 3 levels minimum (background < surface < elevated)
3. Text: not pure white. Use oklch(90% 0.01 hue) for body text.
4. Shadows still work in dark mode — use lower opacity.
5. Borders become more important for separation.
6. Test in both modes before shipping.
```

---

## Pre-Output Checklist

Before presenting any UI to user:
```
□ Anti-slop checklist passed?
□ Font pairing intentional (not browser default)?
□ Color system consistent (OKLCH tokens used)?
□ Shadows follow light-source logic?
□ Motion respects reduced-motion preference?
□ Mobile layout tested/considered?
□ Dark mode considered (even if not implemented)?
□ No orphaned CSS/unused classes?
```
