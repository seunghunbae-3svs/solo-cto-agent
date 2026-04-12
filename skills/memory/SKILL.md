---
name: memory
description: "Self-evolution engine. Collects error patterns, analyzes output quality, auto-improves skills, and maintains session memory across conversations. Activates on: feedback, improve, analyze, error pattern, quality check, skill update, what went wrong, session memory, remember, context."
user-invocable: true
---

# Memory — Self-Evolution & Session Persistence Engine

Continuously improves the agent skill system based on error patterns, quality analysis, and cross-session learning. Also maintains memory across conversation boundaries.

---

## Module 1: Error Pattern Collector

### Auto-Trigger
Runs automatically when any skill encounters an error or produces a suboptimal result.

### Collection Format
```yaml
error_id: ERR-YYYY-MM-DD-NNN
skill: [which skill was active]
category: [build | deploy | design | idea | review | memory]
error_type: [type_error | runtime | logic | design_slop | missing_context]
description: "What went wrong"
root_cause: "Why it happened"
fix_applied: "What was done to fix it"
prevention: "Rule to add to prevent recurrence"
recurrence: [first | Nth time]
```

### Pattern Detection
```
If same root_cause appears 3+ times:
  → Auto-generate a new rule for the relevant skill
  → Add to skill's checklist or quick-fix table
  → Report: "Added prevention rule for [pattern]"
```

---

## Module 2: Quality Analyzer

### Auto-Trigger (silent)
Runs after every significant output (document, code, design, analysis).

### Quality Dimensions
```
| Dimension        | Check                                              | Score |
|------------------|----------------------------------------------------|-------|
| Completeness     | All requested items delivered?                     | /10   |
| Accuracy         | Facts verified? Numbers sourced?                   | /10   |
| Actionability    | User can act on this immediately?                  | /10   |
| Conciseness      | No filler, no repetition?                          | /10   |
| Format           | Right format for the content type?                 | /10   |
```

### Action Thresholds
```
Score >= 8.0: Pass silently
Score 6.0-7.9: Note improvement area internally
Score < 6.0: Flag and suggest re-do before presenting to user
```

---

## Module 3: Skill Auto-Improver

### Trigger
- Manual: User says "improve skills", "what went wrong", "skill update"
- Auto: Error pattern reaches 3+ occurrences
- Scheduled: End of session quality review

### Improvement Process
```
1. Scan error log for patterns since last improvement
2. Identify most impactful improvements (by frequency x severity)
3. Draft specific additions to relevant skill files
4. Apply changes to local skill copies
5. Package updated skills
6. Report changes in one summary
```

### What Gets Improved
```
- Checklists (add missing check items)
- Quick-fix tables (add new error→fix pairs)
- Anti-pattern lists (add observed anti-patterns)
- Process steps (add missing steps or gates)
- Templates (improve structure based on usage)
```

### What Doesn't Change
```
- Core principles (these are user-defined values, not optimizable)
- Autonomy levels (user decides what needs approval)
- Communication rules (user's preference)
```

---

## Module 4: Session Memory System

### Purpose
Bridge the gap between conversations. When a session ends or context compresses, critical information persists.

### Episode Format
```yaml
# memory/episodes/YYYY-MM-DD-N.md
date: YYYY-MM-DD
session: N
projects: [project-a, project-b]
decisions:
  - "Decided to use X instead of Y because Z"
  - "Confirmed pricing model at $N/unit"
actions:
  - "[DONE] Deployed feature X"
  - "[PENDING] Need API key from partner"
context:
  - "User prefers approach A over B"
  - "Blocker: waiting for partner response"
tags: [architecture, pricing, deployment]
```

### Memory Lifecycle
```
Episode created    → End of each session
Episode TTL        → 14 days (configurable)
Compression        → After TTL, compress into Knowledge Article
Knowledge Article  → Permanent, organized by topic
Archive            → Original episodes moved to archive/
```

### Knowledge Article Format
```yaml
# memory/knowledge/topic-name.md
topic: "Topic Name"
last_updated: YYYY-MM-DD
summary: "Concise summary of accumulated knowledge"
key_decisions:
  - "Decision 1 + reasoning"
  - "Decision 2 + reasoning"
patterns:
  - "Pattern observed across sessions"
references:
  - "Episode YYYY-MM-DD-N"
```

### Index
```yaml
# memory/index.md
# Auto-maintained. Used for fast lookup.

| Keyword    | Type      | Location                        |
|------------|-----------|---------------------------------|
| pricing    | episode   | episodes/2026-04-12-1.md        |
| deployment | knowledge | knowledge/deploy-patterns.md    |
| auth       | knowledge | knowledge/auth-decisions.md     |
```

### Session Start Protocol
```
1. Read memory/index.md
2. Load knowledge articles matching today's likely topics
3. Load recent episodes (last 3-5)
4. Merge into working context
5. Never re-ask questions that are answered in memory
```

---

## Module 5: Skill Scout (manual trigger)

### Trigger
User says "new skills?", "skill recommendations", "trending skills"

### Process
```
1. Analyze current skill gaps based on recent error patterns
2. Search for community skills/plugins that fill gaps
3. Before recommending:
   - Check existing skills for overlap
   - Verify no duplicate functionality
   - Confirm the new skill adds unique value
4. Present findings:
   | Skill | What it does | Gap it fills | Overlap risk |
5. If approved: install and configure
```

### Duplicate Prevention
```
Before installing ANY new skill:
□ Scan all existing skill names and descriptions
□ Check for functional overlap (>50% same purpose)
□ If overlap found: suggest merging into existing skill instead
□ Never install two skills that do the same thing
```

---

## End-of-Session Protocol

```
1. Generate episode for this session
2. Update memory/index.md
3. Run quality analyzer on session outputs
4. Check for error patterns → auto-improve if threshold met
5. Compress episodes past TTL → Knowledge Articles
6. One-line report: "Session logged. [N] decisions, [M] pending actions."
```
