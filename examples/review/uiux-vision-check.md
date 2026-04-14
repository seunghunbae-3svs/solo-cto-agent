# UI/UX vision check on a preview URL

Tier: CTO - Agent: Cowork + Claude Vision - Mode: Semi-auto

## Input

A PR ships a new landing page. Vercel preview is live at `https://my-app-git-landing.vercel.app`. The code looks fine to a human. You run:

```bash
solo-cto-agent uiux-review vision \
  --url https://my-app-git-landing.vercel.app \
  --viewport desktop,mobile
```

## Agent behavior

1. **`craft` skill (UI/UX vision sub-command)**:
   - Captures screenshots at 1280x800 (desktop) and 375x812 (mobile). Uses Playwright if installed; falls back to the headless capture in `bin/` otherwise.
   - Produces two PNGs and hands them to Claude Vision.
2. Vision scores on **six axes**, each 1-10:

   | Axis | Criterion |
   |---|---|
   | Layout | grid discipline, alignment, hierarchy |
   | Typography | scale, pairing, readable line length |
   | Spacing | consistent rhythm, no orphan whitespace |
   | Color | contrast, palette coherence, not generic |
   | Accessibility | visible focus, contrast ratios, tap targets |
   | Polish | micro-details, absence of AI-slop tells |
3. Cross-verifies against the committed code (if both `code` and `vision` sub-commands were run) to flag claims that don't match. Here we only ran `vision`.
4. Emits the scorecard. Any axis under 6 is a `[BLOCKER]`; 6-7 is `[SUGGESTION]`; 8+ passes silently.

## Output

```text
UI/UX VISION REPORT - landing page
  desktop 1280x800    mobile 375x812

  Layout        8 / 10    7 / 10
  Typography    5 / 10    5 / 10   ->BLOCKER
  Spacing       7 / 10    6 / 10
  Color         4 / 10    4 / 10   ->BLOCKER
  Accessibility 6 / 10    5 / 10   ->BLOCKER (mobile)
  Polish        5 / 10    5 / 10   ->BLOCKER

  OVERALL       35 / 60   32 / 60

BLOCKERS
  1. Typography ->only one font size used for H1 / H2 / H3. No hierarchy.
     Fix: set up a type scale (e.g., 3.75rem / 2.25rem / 1.5rem / 1rem).
  2. Color ->purple-to-pink gradient on 3 different surfaces (hero, CTA, footer).
     Reads as "generated UI". Pick one surface for the gradient, flatten the rest.
  3. Accessibility (mobile) ->CTA button tap target is 36px (below 44px guideline).
     Also: body text contrast is 3.8:1 on gradient background (needs ->4.5:1).
  4. Polish ->placeholder lorem ipsum in testimonials section. Unfilled avatar shapes.

SUGGESTIONS
  - Spacing (mobile): hero padding is 64px, next section is 48px, third is 80px.
    Normalize to a single rhythm (e.g., 80 / 64 / 80 / 64).

NEXT ACTION
  Fix 4 blockers, re-run vision. Ship when overall ->48 / 60 per viewport.
```

Also written: `uiux-review/<timestamp>/desktop.png`, `mobile.png`, `report.json`.

## Pain reduced

**The rounded-blue-gradient AI-slop UI that ships because no one had a concrete vocabulary to reject it.** "It looks a bit AI" is not something you can reasonably paste into a PR comment. A six-axis scorecard with three BLOCKERs each naming a specific fix is something you can act on before merge.

Secondary pain: **mobile-specific issues missed because the reviewer only looked at desktop.** The 36px tap target and 3.8:1 contrast are both legitimate WCAG failures, both mobile-only, both missed by a casual "looks fine" glance at the preview URL on a laptop.

Tertiary pain: **placeholder content reaching production.** Lorem ipsum in testimonials is the kind of thing the vision pass catches because it looks at pixels, not at `grep "Lorem"`. The code pass would miss it if the text came from a CMS.

