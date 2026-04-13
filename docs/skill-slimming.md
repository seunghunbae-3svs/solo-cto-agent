# Skill Slimming — the references/ pattern

## Why this matters

Every skill activation dumps the full `SKILL.md` into the context window. A 500-line skill eats ~6,000 tokens just by triggering. Two skills in one session and you've burned 12K tokens before doing anything useful.

The fix is obvious once you see it: most of that content isn't needed on every activation. Templates, full error catalogs, CSS blocks, API specs — the agent only reads those when it's actually doing that specific subtask.

## How it works

```
my-skill/
├── SKILL.md              ← Always loaded: routing, rules, checklists (~80-120 lines)
└── references/
    ├── error-catalog.md   ← Loaded on demand
    ├── templates.md       ← Loaded on demand
    └── api-reference.md   ← Loaded on demand
```

SKILL.md keeps only what the agent needs to decide *what to do*: routing tables, anti-pattern lists, quick-reference summaries, and pointers like `> Full error catalog → references/error-catalog.md`. The agent reads references/ files only when the task actually requires them.

## Measured results

Three production skills, before and after applying this pattern:

| Skill type | Before | After | Saved |
|------------|--------|-------|-------|
| Project/event management | 573 lines / ~6,600 tok | 122 lines / ~1,800 tok | 79% |
| Design system orchestrator | 318 lines / ~3,600 tok | 77 lines / ~1,000 tok | 76% |
| Platform dev guide | 203 lines / ~2,500 tok | 86 lines / ~1,000 tok | 58% |

Average session went from ~12K tokens on skill loading to ~3,800. That's 8K tokens freed up per session for actual work.

Over 50 sessions, the difference adds up to roughly 400K tokens — real context space that would otherwise be wasted on reference text the agent never reads.

## What stays inline vs. what moves

**Keep in SKILL.md:**
- Routing table (which tool/sub-skill for which task type)
- Anti-pattern list (condensed, no long examples)
- 1-line summaries with `→ references/filename.md` pointers
- Decision logic the agent needs every time
- Pre-flight checklists

**Move to references/:**
- Document templates and report structures
- CSS/code blocks (design tokens, color definitions, shadow systems)
- Full error catalogs with solutions
- API endpoint specs
- Dev history and changelogs
- Per-project component guides

Rule of thumb: if a section is 20+ lines of reference data that's only needed for specific subtasks, it belongs in references/.

## Applying this to your skills

```
1. Count SKILL.md lines (target: under 150)
2. Find sections that are reference data, not decision logic
3. Create references/ and move those sections
4. Replace with 1-line pointers in SKILL.md
5. Test that the skill still triggers and references/ loads when needed
```

## solo-cto-agent integration

`npx solo-cto-agent init` scaffolds with references/ by default:

```
.claude/skills/{skill-name}/
├── SKILL.md
└── references/
    └── .gitkeep
```

Future: `npx solo-cto-agent lint` will flag skills where SKILL.md exceeds 150 lines or has large inline code blocks that should be in references/.
