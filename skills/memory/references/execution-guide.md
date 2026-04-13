# Memory Execution Guide — Usage Patterns

## When to Use Memory

### Trigger Keywords

- "remember"
- "context"
- "history"
- "decision log"
- "what did we decide"
- "recurring issue"
- "lesson learned"
- "did we try this before"

### Scenario: Capture Session Decisions

**User request:** "Use memory to capture today's key decisions and update the context log."

**Workflow:**
1. Review session notes for major decisions made
2. For each decision:
   - Note what was decided
   - Document the reasoning
   - Mark any tradeoffs accepted
   - Identify when to revisit
3. Append to CONTEXT_LOG.md with session date and summary
4. Create/update relevant knowledge article if pattern is stable
5. Snapshot episode file (memory/episodes/YYYY-MM-DD-{N}.md) with what changed

**Output:** Updated CONTEXT_LOG, episode saved, possibly new knowledge article

---

### Scenario: Record Error Pattern

**User request:** "Use memory to record a repeated error pattern and the fix."

**Workflow:**
1. Identify the error pattern (name, trigger, symptom)
2. Research or recall root cause
3. Document the fix (step-by-step or automated check)
4. Note prevention steps
5. Append to error-patterns.md with all occurrences
6. Create/update knowledge article if this will recur
7. Link pattern in index.md

**Output:** error-patterns.md updated, knowledge article created, index refreshed

---

### Scenario: Summarize Weekly Changes

**User request:** "Use memory to summarize what changed in this repo this week."

**Workflow:**
1. Scan episodes and CONTEXT_LOG from past 7 days
2. For each change:
   - What was modified
   - Why it was changed
   - What impact it has
3. Create summary knowledge article if changes form a coherent pattern
4. Update index.md with all new articles
5. Archive old episodes if 14-day window passed

**Output:** Summary knowledge article, updated index, archived episodes

---

## Best Practices for Agents

### When to Store (and When Not To)

**Store these:**
- Architecture decisions made
- Stack conventions established
- Deploy constraints discovered
- Naming rules defined
- Repeated bugs/patterns
- User preferences affecting execution
- Anything that caused re-explanation

**Don't store these:**
- Trivial one-off details
- Noisy intermediate states
- Temporary scraps with no future value
- Raw logs (compress into patterns)
- Things already obvious from reading code

### Compression Workflow

When the same thing comes up 3+ times:

1. **Recognize the pattern** — "This is the 3rd time we hit this issue"
2. **Stop raw logging** — delete old noisy entries
3. **Extract the rule** — "When X happens, Y is almost always the cause"
4. **Create knowledge article** with:
   - What the pattern is
   - When it appears
   - How to fix it
   - How to prevent it
5. **Remove obsolete episodes** that are now covered by the rule
6. **Link pattern** in index.md

### Query Before Acting

Before starting any of these tasks:

1. **Deployment** → check error-patterns.md + deploy-related knowledge articles
2. **Auth changes** → check auth-pattern articles + CONTEXT_LOG
3. **Environment setup** → check setup knowledge articles + recent episodes
4. **Bug fixing** → check error-patterns.md first
5. **Design changes** → check UX preference articles
6. **Strategic changes** → check decision-patterns.md + CONTEXT_LOG

Use the memory to **reduce friction and wasted loops**, not to replace critical thinking.

---

## Memory Hygiene

### Monthly Cleanup

- Review error-patterns.md; compress old patterns into single articles
- Move episodes older than 14 days to archive/
- Review knowledge articles; consolidate related ones
- Remove entries that have never been referenced

### When Memory Becomes Stale

If a knowledge article no longer applies (e.g., framework was upgraded, pattern was fixed):

- Note the date it became obsolete
- Mark as "archived" in index.md
- Keep historical record in archive/ for reference
- Create new article for updated pattern

### Red Flag: Over-Storing

If memory/ folder has:
- 100+ episodes still in `episodes/` (should archive)
- 50+ error patterns (should consolidate into 10-15 knowledge articles)
- Multiple articles covering the same topic (should merge)

→ Time to compress and clean up.
