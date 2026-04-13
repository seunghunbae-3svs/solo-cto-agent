# OKLCH Palette Example

## Brand Color Scale (280° hue)

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

## Semantic Tokens (based on brand scale)

```css
/* Surface */
--surface-primary: var(--brand-50);
--surface-secondary: var(--brand-100);
--surface-tertiary: var(--brand-200);

/* Text */
--text-primary: var(--brand-900);
--text-secondary: var(--brand-700);
--text-tertiary: var(--brand-500);

/* Interactive */
--accent-primary: var(--brand-600);
--accent-hover: var(--brand-700);

/* Feedback */
--error: oklch(55% 0.22 25);
--warning: oklch(70% 0.20 50);
--success: oklch(65% 0.18 150);
```

## Dark Mode Adjustments

For dark mode, reduce chroma by ~15–20% and redesign contrast intentionally:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --brand-50:  oklch(15% 0.04 280);
    --brand-100: oklch(25% 0.06 280);
    --brand-200: oklch(35% 0.10 280);
    --brand-300: oklch(50% 0.14 280);
    --brand-400: oklch(65% 0.16 280);
    --brand-500: oklch(75% 0.18 280);
    /* ...rest of scale */
  }
}
```

## Tips

- Pick one main hue for your brand scale
- Build lightness scale first, then adjust chroma for depth
- Keep chroma consistent within a color family
- Test contrast ratios in both light and dark modes

