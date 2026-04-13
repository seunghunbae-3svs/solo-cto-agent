# Shadow System Tokens

Shadows should imply consistent elevation, not random decoration.

## Shadow Definitions

```css
--shadow-xs:  0 1px 2px oklch(0% 0 0 / 0.05);

--shadow-sm:  0 2px 4px oklch(0% 0 0 / 0.06), 
              0 1px 2px oklch(0% 0 0 / 0.04);

--shadow-md:  0 4px 8px oklch(0% 0 0 / 0.08), 
              0 2px 4px oklch(0% 0 0 / 0.04);

--shadow-lg:  0 8px 24px oklch(0% 0 0 / 0.12), 
              0 4px 8px oklch(0% 0 0 / 0.04);

--shadow-xl:  0 16px 48px oklch(0% 0 0 / 0.16), 
              0 8px 16px oklch(0% 0 0 / 0.06);
```

## When to Use Each

| Shadow | Use Case | Example |
|--------|----------|---------|
| `shadow-xs` | Subtle borders, very subtle lift | Borders between sections |
| `shadow-sm` | Low-elevation cards, input fields | Card in list, form fields |
| `shadow-md` | Hover states, minor elevation shift | Card hover, button press |
| `shadow-lg` | Floating panels, popovers | Dropdown menus, floating menus |
| `shadow-xl` | Dialogs, modals, highest elevation | Modal windows, important overlays |

## Critical Rule

**Never use shadows with no structural reason.** Each shadow should visually communicate a position in the elevation hierarchy.

