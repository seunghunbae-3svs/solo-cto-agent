# Component Specifications

## Cards

**Key Rules:**
- Pick one radius system for the project and stay with it
- Use border **or** shadow as the main separator, not both by default
- Hover states should feel intentional, not louder

**Typical Implementation:**
```css
.card {
  border-radius: 8px; /* or 12px — pick one */
  border: 1px solid var(--border-color);
  /* OR */
  box-shadow: var(--shadow-sm);
  padding: 16px–24px;
}

.card:hover {
  box-shadow: var(--shadow-md);
  /* Optional: very subtle background shift */
  background-color: var(--surface-hover);
}
```

---

## Buttons

**Key Rules:**
- Size should reflect importance
- Loading state should preserve button width (don't collapse)
- Primary / secondary / destructive should be clearly distinct

**Size Scale:**
```css
.btn-sm { padding: 6px 12px; font-size: 0.875rem; }
.btn-md { padding: 8px 16px; font-size: 1rem; }       /* default */
.btn-lg { padding: 12px 24px; font-size: 1.125rem; }
```

**State Variants:**
```css
.btn-primary {
  background: var(--brand-600);
  color: white;
}

.btn-secondary {
  background: var(--surface-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-destructive {
  background: var(--error);
  color: white;
}
```

---

## Forms

**Key Rules:**
- Label above field
- Placeholder is not a label
- Error state should be obvious
- Focus state should be visible without being theatrical

**Typical Structure:**
```html
<label for="email">Email Address</label>
<input id="email" type="email" placeholder="you@example.com" />
```

**CSS Approach:**
```css
label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  font-size: 0.875rem;
}

input {
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 1rem;
  transition: border-color var(--duration-fast) var(--ease-out);
}

input:focus {
  outline: none;
  border-color: var(--brand-500);
  box-shadow: 0 0 0 2px var(--brand-100);
}

input:invalid {
  border-color: var(--error);
}

.input-error {
  color: var(--error);
  font-size: 0.75rem;
  margin-top: 4px;
}
```

---

## Tables

**Key Rules:**
- Prefer horizontal rhythm over full grid boxing
- Sticky headers are often worth it
- Mobile should degrade honestly, not pretend dense tables work on tiny screens

**Typical Structure:**
```css
table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
  padding: 12px 16px;
  border-bottom: 2px solid var(--border-color);
  font-weight: 600;
  font-size: 0.875rem;
  background: var(--surface-secondary);
  position: sticky;
  top: 0;
}

td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

tr:hover {
  background: var(--surface-hover);
}
```

**Mobile Degradation:**
For small screens, either:
1. Stack as a vertical list (recommended)
2. Make table horizontally scrollable (preserve structure)
3. Never try to fit dense table data in a mobile view

