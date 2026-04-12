# solo-cto-agent

Turn your AI coding agent into a CTO-level co-founder. Six skills that handle development, deployment, design, idea validation, critical review, and self-improvement — so you focus on decisions, not execution.

## What's Inside

```
solo-cto-agent/
├── autopilot.md              ← Merge into CLAUDE.md for autonomy rules
├── skills/
│   ├── build/SKILL.md        ← Dev pipeline: Architect → Build → Review → Deploy
│   ├── ship/SKILL.md         ← E2E deploy: git push → monitor → fix → live
│   ├── craft/SKILL.md        ← Anti-AI-slop design: OKLCH, typography, motion
│   ├── spark/SKILL.md        ← Idea → Market scan → Unit economics → PRD
│   ├── review/SKILL.md       ← 3-lens evaluator: investor / user / competitor
│   └── memory/SKILL.md       ← Self-evolving error patterns + session memory
└── templates/
    ├── project.md            ← Project state tracking template
    └── context.md            ← Cross-session context log template
```

## 5-Minute Setup

### Option 1: One-liner

```bash
curl -sSL https://raw.githubusercontent.com/seunghunbae-3svs/solo-cto-agent/main/setup.sh | bash
```

### Option 2: Manual

```bash
git clone https://github.com/seunghunbae-3svs/solo-cto-agent.git
cp -r solo-cto-agent/skills/* ~/.claude/skills/
cat solo-cto-agent/autopilot.md >> ~/.claude/CLAUDE.md
```

### Option 3: Cherry-pick skills

Only want the build pipeline?

```bash
cp -r solo-cto-agent/skills/build ~/.claude/skills/
```

## Customize Your Stack

Open `skills/build/SKILL.md` and replace the placeholders:

```
OS:          {{YOUR_OS}}          →  macOS 15
Editor:      {{YOUR_EDITOR}}      →  Cursor
Deploy:      {{YOUR_DEPLOY}}      →  Vercel
Framework:   {{YOUR_FRAMEWORK}}   →  Next.js 15
```

Same for any stack-specific warnings — edit or delete the ones that don't apply.

## How It Works

### The Autonomy Matrix

The agent operates on 3 levels (defined in `autopilot.md`):

| Level | What happens | Example |
|-------|-------------|---------|
| **L1: Just Do It** | Agent acts without asking | Fix typos, load context, create files |
| **L2: Do → Report** | Agent acts, then tells you | "Used build + ship skills together" |
| **L3: Ask First** | Agent asks before acting | Deploy to production, change DB schema |

### The Pre-Requisite Scanner

Before ANY dev task, the build skill auto-scans:
- Missing env vars?
- New API keys needed?
- DB migrations required?
- Packages to install?

If something's needed → ONE question. Then the agent configures everything automatically.
No "please go to Settings and add this secret" — the agent does it.

### The Circuit Breaker

Same error 3 times → stops and reports instead of creating an error spiral.
Same error 5 times → hard stop. Fix creates 3+ new errors → rollback.

### Anti-Slop Design

The craft skill runs an anti-AI-slop checklist on every UI output:
- No gratuitous gradients
- No generic blue-500
- No meaningless shadows
- Enforces OKLCH color system, intentional typography, and real motion curves

### Session Memory

The memory skill persists decisions across conversations:
- Errors → patterns → auto-added prevention rules
- Session episodes → compressed into knowledge articles after 14 days
- Never re-asks questions already answered in memory

## Skills at a Glance

| Skill | Triggers On | What It Does |
|-------|------------|--------------|
| **build** | code, error, deploy, API, DB | Full dev pipeline with pre-req scanning |
| **ship** | deploy, push, 404, 500 | Autonomous deploy + rollback |
| **craft** | UI, design, component, CSS | Premium design without AI slop |
| **spark** | idea, business model, PRD | Idea → validated plan in 6 stages |
| **review** | evaluate, critique, viable? | 3-perspective stress test |
| **memory** | (always on) | Error learning + session persistence |

## Philosophy

- **Agent does the work.** You make decisions.
- **Risks first, strengths second.** No yes-man behavior.
- **Facts over vibes.** Every number has a source. [confirmed] / [estimated] / [unverified].
- **YAGNI.** Don't build Phase 3 features when Phase 0 isn't validated.
- **Pre-scan, don't surprise.** Know what's needed before writing code.

## License

MIT — use it, fork it, make it yours.
