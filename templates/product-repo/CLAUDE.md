# CLAUDE.md — Product Repo Context Defense

> Context version: 2026-04-17
> Compaction defense: ENABLED
> Last checkpoint: auto-generated

## Overview

This repository uses the 2026 Context Compaction Defense System. When Claude Code compacts your context, critical project information is automatically re-injected via `.claude/hooks/post-compact.sh`.

**Key Point:** After ANY compaction event (`/compact`), the post-compact hook runs automatically. But YOU MUST follow the checklist below before resuming code changes.

## Post-Compaction Survival Rules

### STEP 1: Always Run After Compaction
After compaction completes, Claude will run:
```bash
bash .claude/hooks/post-compact.sh
```

This script outputs:
- Project rules from CLAUDE.md
- Current Git branch and recent commits
- All type definitions from `src/types/**`
- Component Props interfaces
- Database schema (Prisma, Supabase, or custom)
- Build configuration (tsconfig.json, etc.)

**Read this output carefully.** It IS your project context after compaction.

### STEP 2: Quick Validation Checklist
Before making ANY code changes post-compaction:

```
[ ] Branch is correct: git branch --show-current
[ ] Working tree is clean: git status
[ ] Type definitions exist: ls -la src/types/
[ ] Database schema is readable: cat prisma/schema.prisma (or your schema)
[ ] Build config present: cat tsconfig.json
[ ] Dependencies installed: npm ls | head -5
```

If any of these fail, stop and ask Claude to re-run the post-compact hook.

### STEP 3: Edit Safety Rules

**BEFORE editing ANY component:**
- Re-read its Props interface from `src/types/`
- Don't trust your memory of the interface shape
- If in doubt, grep the full codebase for that type

**BEFORE touching database code:**
- Re-read `prisma/schema.prisma` or `supabase/schema.sql`
- Confirm field names, types, and relationships
- Never assume a field exists from memory

**BEFORE importing anything:**
- Check `tsconfig.json` for path aliases (e.g., `@/components`)
- Verify the import path exists: `ls -la src/components/...`
- Never use an alias without confirming it in tsconfig.json

### STEP 4: Build After Every Change

Do NOT wait until the end of the session. After EVERY file you change:

```bash
npm run build    # or: npm run type-check, tsc, next build, etc.
```

If the build fails with type errors:
1. **DO NOT guess the type**
2. Re-read the actual interface from `src/types/`
3. Ask Claude to re-read the definition
4. Try the fix again

## Critical Files (Sources of Truth)

| File | What It Contains | Must Re-read After Compaction? |
|---|---|---|
| `CLAUDE.md` | This file + project rules | **YES** |
| `src/types/` | All TypeScript type definitions | **YES (before any code change)** |
| `prisma/schema.prisma` | Database schema | **YES (before DB changes)** |
| `tsconfig.json` | TypeScript config + path aliases | **YES (before imports)** |
| `package.json` | Dependencies | YES |
| `.env.example` | Environment variables | YES |
| `README.md` | Setup & architecture overview | As needed |

## Rework Loop Safeguards

The rework loop (`bin/rework.js`) can break after compaction because it loses type context. To use rework safely:

1. **Always run post-compact hook first** — don't rework immediately after compaction
2. **Use the context-refresh flag** (if available):
   ```bash
   node bin/rework.js --review fixes.json --apply --context-refresh
   ```
3. **After rework completes**, immediately run build:
   ```bash
   npm run build
   ```
4. **If errors appear**, stop rework and ask Claude to re-read type definitions

## Checkpoint Management

Before large operations (multi-file refactors, complex changes), optionally create a checkpoint:

```bash
# Save current state
cat > .claude/context-checkpoint.json << EOF
{
  "branch": "$(git branch --show-current)",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "modified_files": "$(git diff --name-only | wc -l) files"
}
EOF
```

If something goes wrong, you can always revert to this checkpoint.

## The Golden Rule

**Never assume you remember a type, import path, or schema field after compaction.**

Always read the source of truth:
- Need a type? Read `src/types/file.ts`
- Need an import path? Check `tsconfig.json`
- Need a schema field? Read `prisma/schema.prisma`
- Unsure about a component prop? Read its Props interface

**Memory is your enemy after compaction. Read the source.**

## Debugging Post-Compaction Issues

If you see errors after compaction that make no sense:

1. **Re-run the post-compact hook manually:**
   ```bash
   bash .claude/hooks/post-compact.sh
   ```

2. **Check that all critical files still exist:**
   ```bash
   ls -la src/types/ CLAUDE.md tsconfig.json prisma/schema.prisma
   ```

3. **Verify git is in a good state:**
   ```bash
   git status
   git log --oneline -5
   ```

4. **Ask Claude to re-read the hook output** before trying to fix anything

5. **If type errors persist**: Run `npm run build` with verbose output:
   ```bash
   npm run build -- --verbose
   ```

## Configuration

Hook configuration is in `.claude/settings.json`:
- `hooks.PostCompaction` — defines the post-compact script
- `contextDefense.enabled` — turns on/off checkpoints
- `compactionAwareness` — auto-refresh behavior

Do not modify these unless you know what you're doing.

## Summary

```
After compaction:
  1. Hook runs automatically → re-reads CLAUDE.md, types, schema
  2. You run the validation checklist → confirm project state
  3. Before ANY code change → re-read the affected type/schema
  4. After EVERY file → run build
  5. If errors → re-read, don't guess

This ensures compaction never breaks your project.
```

---

**Last Updated:** 2026-04-17  
**System:** 2026 Context Compaction Defense v1.0
