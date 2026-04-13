# Memory Storage Structure — Implementation Details

## File Organization

Memory is stored across three layers in the project root:

```
project/
├── CONTEXT_LOG.md           ← session decisions (append-only)
├── LOGS/
│   └── YYYY-MM-DD.md        ← daily log (created per session)
├── memory/
│   ├── index.md             ← searchable episode index
│   ├── episodes/
│   │   └── YYYY-MM-DD-{N}.md ← session snapshots (14-day retention)
│   ├── knowledge/
│   │   └── {topic}.md       ← durable compressed rules (permanent)
│   └── archive/             ← compressed/expired episodes
└── error-patterns.md         ← repeated failure catalog (append)
```

## What Goes Where

### CONTEXT_LOG.md (session-level decisions)

Append-only log of decisions made per session.

**When to write:**
- Major decision made
- New pattern discovered
- Risk accepted/deferred
- Strategic direction confirmed

**Format:**
```markdown
## Session: YYYY-MM-DD

### Decisions
- [Decision 1] → [Reasoning] → [Next action]
- [Decision 2] → [Reasoning] → [Next action]

### Patterns Discovered
- [Pattern name] → [Impact]

### Risks Deferred
- [Risk] → [Revisit trigger]
```

### Daily Log (LOGS/YYYY-MM-DD.md)

Per-day summary created at end of session.

**Format:**
```markdown
# Session: YYYY-MM-DD

## Participants
- Agent
- (User if applicable)

## Projects Touched
- [Project name]

## Key Discussions
- [Topic] → [Outcome]

## Decisions Made
- [Decision] → [Impact]

## Patterns Noted
- [Pattern name] → [Severity]

## Open Threads
- [Unresolved item] → [Next step]

## Next Session Priorities
- [ ] [Action item]
```

### Episodes (memory/episodes/YYYY-MM-DD-{N}.md)

Session snapshots for reference during active projects.

**What to capture:**
- What changed today
- What broke and how it was fixed
- What assumption was made
- What still needs attention

**Retention:** 14 days (auto-archive after)

### Knowledge Articles (memory/knowledge/{topic}.md)

Durable compressed rules that transcend individual sessions.

**Examples:**
- `deploy-auth-patterns.md` — recurring auth deployment issues
- `package-conflicts.md` — known package version incompatibilities
- `schema-evolution-strategy.md` — how to safely migrate in this project
- `ux-preferences.md` — user design/interaction preferences

**When to create:**
- A pattern has appeared 3+ times in different sessions
- A lesson is stable and unlikely to change
- Future sessions will reference this repeatedly

**Format:**
```markdown
# {Topic}

## Summary
[One-sentence rule]

## When This Applies
[Trigger conditions]

## Why It Matters
[Impact/friction reduced]

## Examples
- Case 1
- Case 2

## How to Handle
[Step-by-step or checklist]

## Exceptions
[When this rule doesn't apply]

## Last Updated
YYYY-MM-DD
```

### Error Patterns Catalog (error-patterns.md)

Append-only log of repeated failure modes.

**Format:**
```markdown
## Pattern: [Name]

**First seen:** YYYY-MM-DD  
**Frequency:** [# of occurrences]  
**Severity:** [critical / high / medium / low]

**Trigger:** [What causes this]  
**Symptom:** [What it looks like]  
**Root cause:** [Why it happens]  
**Fix:** [Step-by-step resolution]  
**Prevention:** [How to avoid next time]

**Episodes:** YYYY-MM-DD, YYYY-MM-DD, ...
```

## Index (memory/index.md)

Searchable catalog of all episodes and knowledge articles.

**Format:**
```markdown
# Memory Index

## Knowledge Articles (Permanent)
- [deploy-auth-patterns.md](knowledge/deploy-auth-patterns.md) — recurring auth issues
- [package-conflicts.md](knowledge/package-conflicts.md) — version incompatibilities

## Recent Episodes (Last 14 Days)
- [2026-04-13-1](episodes/2026-04-13-1.md) — deployed new feature, broke auth
- [2026-04-12-1](episodes/2026-04-12-1.md) — refactored API routes

## Error Patterns
- [Build breaks on skipped prisma generate](../error-patterns.md#prisma-generate)
```

## Retrieval Workflow

Before starting related task, check memory:

1. **Search index.md** for relevant episodes or articles
2. **Read relevant knowledge article** if it exists
3. **Skim recent episodes** (last 5 sessions) for related decisions
4. **Check error-patterns.md** if debugging or deploying
5. **Review CONTEXT_LOG.md** for deferred risks in this area

Use memory to **avoid re-asking or re-discovering**, not to replace user input.
