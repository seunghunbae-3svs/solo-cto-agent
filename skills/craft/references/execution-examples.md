# Execution Examples

## How to Invoke Craft

Craft activates on these keywords and contexts:

**Direct invocation:**
```
"Use craft to redesign this dashboard so it looks less AI-generated."
"Use craft to fix spacing, typography, and visual hierarchy on the landing page."
"Use craft to propose a cleaner color system for the UI."
```

**Keyword triggers (auto-activation):**
- UI, design, component, page, layout, CSS
- Tailwind, shadcn, responsive, dark mode
- dashboard, landing page
- beautiful, sleek, modern, polished

---

## Workflow When Using Craft

1. **Input:** You describe a UI problem or request a redesign
2. **Anti-Slop Check:** Craft runs the checklist on your design/code
3. **Recommendations:** Specific guidance on typography, colors, shadows, spacing
4. **Code/Design Output:** Refactored UI with deliberate design choices
5. **Rationale:** Why each choice avoids generic AI aesthetics

---

## Example Request + Response

### Request
> "Make this card component less generic. It looks like default Tailwind."

### Craft Response (example flow)

1. **Anti-Slop Check:**
   ```
   ✓ No gradient (wasn't present)
   ✗ Border radius: 9999px (change to 8px)
   ✓ Shadow is justified (sm on base, md on hover)
   ✓ Color is intentional (not default blue)
   ✗ Padding feels too uniform (add visual rhythm)
   ```

2. **Recommendations:**
   - Change border-radius from 9999px to 8px (pick one radius system)
   - Use semantic color tokens (brand-500) instead of blue-500
   - Adjust internal padding to 16px instead of uniform 12px
   - Add a subtle border (1px) instead of relying only on shadow
   - Refine hover state to use shadow-md + slight background shift

3. **Code Output:**
   ```css
   .card {
     border-radius: 8px;
     border: 1px solid var(--border-color);
     padding: 20px;
     box-shadow: var(--shadow-sm);
     transition: all var(--duration-fast) var(--ease-out);
   }

   .card:hover {
     box-shadow: var(--shadow-md);
     background: var(--surface-hover);
   }
   ```

4. **Rationale:**
   - Consistent radius system (8px) throughout project
   - Border + subtle shadow hierarchy (not both doing the same work)
   - Semantic tokens ensure cohesion across light/dark modes
   - Hover state is intentional and restrained

