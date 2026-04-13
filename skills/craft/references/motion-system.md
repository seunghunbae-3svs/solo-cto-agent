# Motion System Tokens

Motion should support clarity, not show off.

## Duration Tokens

```css
--duration-instant: 50ms;
--duration-fast: 150ms;
--duration-normal: 250ms;
--duration-slow: 400ms;
```

## Easing Functions

```css
--ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);
--ease-in: cubic-bezier(0.4, 0.0, 1, 1);
--ease-in-out: cubic-bezier(0.4, 0.0, 0.2, 1);
```

## When to Use Each

| Duration | Context | Example |
|----------|---------|---------|
| instant | State changes with no motion intent | State toggles, instant visual feedback |
| fast | Hover states, micro-interactions | Button hover, icon transitions |
| normal | Typical transitions, modal enter/exit | Page navigation, dropdown open |
| slow | Deliberate, purposeful motion | Page transitions (use sparingly) |

| Easing | Context | Example |
|--------|---------|---------|
| ease-out | Enter/appear | Item enters screen, menu opens |
| ease-in | Exit/disappear | Item leaves screen, menu closes |
| ease-in-out | Continuous motion | Carousel slides, scroll effects |

## Critical Rules

1. **Respect `prefers-reduced-motion`**
   ```css
   @media (prefers-reduced-motion: reduce) {
     * { animation-duration: 0.01ms !important; }
   }
   ```

2. **Avoid decorative motion with no information value**
   - Motion should clarify relationships or state changes
   - Avoid motion for motion's sake

3. **Readability first**
   - Menus/dropdowns must remain readable during transition
   - Text should never be illegible during animation

