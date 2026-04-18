# Hero Banner Regeneration Prompt

The README hero image at `docs/hero-banner.png` should be regenerated whenever the surface the toolkit ships changes shape. The previous banner described a subset of features ("Dual-Agent Cross-Check · Secret Detection · Managed Agent Deep Review · GitHub Actions · VS Code Extension") and no longer reflects the full pipeline.

This document holds the single source of truth for what the banner should communicate and a ready-to-paste prompt for image generators. Update this file first, then regenerate.

---

## What the banner must convey

A new reader should be able to look at the banner and, in under five seconds, understand:

1. **Who it's for** — solo founders shipping product code alone or in a very small team.
2. **What it does** — the full PR loop (two AI agents debate → consensus → auto-rework → visual before/after → auto-merge when CI green).
3. **Where it lives** — phone (Telegram), optional Discord, CLI, GitHub Actions, VS Code.
4. **How you trigger it** — plain English (`do "..."`) or a normal git push.

Anything beyond that is noise.

---

## Recommended layout

Aspect ratio **1200 × 630** (standard OG image; works for npm, GitHub, Twitter/X, LinkedIn cards).

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  solo-cto-agent                          ┌─ • • •──────────┐ │
│  The full CTO loop, on your phone.       │ $ solo-cto do   │ │
│                                          │     "fix auth   │ │
│  • Natural-language work orders          │      in tribo"  │ │
│  • 3-round agent consensus               │                 │ │
│  • Auto-rework to PR branch              │ ✓ issue #127    │ │
│  • Before / after visual report          │ ✓ Claude R1→R3  │ │
│  • Telegram + Discord control            │ ✓ rework (2)    │ │
│  • Auto-merge when CI green              │ ✓ visual report │ │
│                                          │ ✓ auto-merge    │ │
│  npm i -g solo-cto-agent                 └─────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

Left column: product name + one-line tagline + feature bullets.
Right column: mock terminal showing the happy path end-to-end in one frame.

---

## Design constraints

- **Palette**: dark background (near-black, not pure `#000` — `#0b0d10` reads as more intentional). One accent color (the current violet used in `solo-cto-agent` wordmark works). Two muted text tones (primary white, secondary slate-400-ish). Keep contrast AA minimum.
- **Typography**: monospace for the terminal column; clean geometric sans for the left column. No decorative fonts.
- **No gradients on buttons**. No rounded-blue SaaS aesthetic. Sharp corners or very small radius only.
- **Icons are optional** — if used, a single icon per bullet, outlined not filled, same weight.
- **No AI-looking abstract background** — no nebulae, no gradient meshes, no holographic textures. Solid background with at most a subtle 1-2% noise.

---

## Prompt (paste into image generator)

Midjourney / Ideogram / DALL-E / Gemini Imagen:

> Clean dark-themed product hero banner for a developer tool called "solo-cto-agent". 1200x630 aspect ratio. Background near-black (#0b0d10) with a single subtle 1-2% noise texture, no gradient mesh, no abstract shapes.
>
> Left half of the frame: the wordmark "solo-cto-agent" in a clean geometric sans-serif (like Inter or Söhne), violet accent color matching npm's package page purple (#B265FF-ish). One-line tagline below: "The full CTO loop, on your phone." Beneath the tagline, a vertical list of six short feature bullets, each prefixed by a small minimal outline icon: "Natural-language work orders", "3-round agent consensus", "Auto-rework to PR branch", "Before / after visual report", "Telegram + Discord control", "Auto-merge when CI green". At the very bottom-left, the install command in monospace: "npm i -g solo-cto-agent".
>
> Right half of the frame: a flat dark terminal window with macOS traffic-light dots (red, yellow, green) in the top bar, subtle 1px border. Inside the terminal, monospace text in slate tones showing an end-to-end happy path: "$ solo-cto-agent do \"fix auth in tribo\"", then below "✓ issue #127 created on tribo", "✓ Claude review → Codex counter → consensus (2 rounds)", "✓ rework pushed (2 fix commits)", "✓ visual report posted", "✓ auto-merge enabled — CI green in 47s", "$ ". Use a green checkmark glyph. Cost readout in muted gray at the bottom: "total LLM cost: $0.042".
>
> Constraints: no rounded-blue SaaS aesthetic, no default Tailwind-looking gradients, no decorative shadows, no emoji except inside the terminal mock, no cluttered background. Sharp corners or ≤4px radius only. Minimal, editorial, like a well-designed documentation site hero. Contrast AA minimum.

If using Figma + manual render instead:
- Inter 600 for wordmark at 48px, Inter 400 for tagline at 20px, JetBrains Mono 14px inside terminal, Inter 400 for bullets at 16px with 12px vertical rhythm.
- Left column: left padding 80px, top padding 100px. Right column: terminal inset 40px from right, top-aligned with tagline.

---

## Validation checklist before replacing the file

- [ ] A reader new to the toolkit gets the full value prop in 5 seconds.
- [ ] At least 5 of the 6 bullets are readable at npm's thumbnail size (600px wide).
- [ ] Terminal mock shows end-to-end, not just a single command.
- [ ] No stale feature names removed from the codebase.
- [ ] OG preview renders correctly at 1200×630 and at the 600×315 fallback.
- [ ] File size under 500 KB; PNG with alpha, not JPEG.

Update `docs/hero-banner.png` and commit with message `docs: regenerate hero banner to match pipeline surface`.
