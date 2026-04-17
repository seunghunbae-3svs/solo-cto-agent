# CLAUDE.md

## 1. Autonomy Levels (Summary)
- L1: Read-only analysis and reporting.
- L2: Code changes and PRs within repo scope.
- L3: Requires explicit human approval (production deploy, DB schema changes, secret rotation).

## 2. Session End Condition (Proposal-Based)
At the end of every session, always propose the next 1-3 actions and ask whether to log the session.
Do not rely on automatic detection to decide if a log should be created.

## 3. Logging Expectations
- If the user approves, append to the relevant operational log.
- Logs should be short, factual, and actionable.

## 4. Compaction Survival Rules (2026 Context Defense)

**CRITICAL: Context compaction can destroy project knowledge. Follow these rules to maintain continuity.**

### After Any Context Compaction (`/compact`)

The `.claude/hooks/post-compact.sh` hook will automatically fire to restore critical context.
But YOU must also follow this checklist:

```
MANDATORY POST-COMPACTION CHECKLIST:
- [ ] Read the hook output above — it re-injects CLAUDE.md, types, and schema
- [ ] Confirm current branch: git branch --show-current
- [ ] Check modified files: git status --short
- [ ] BEFORE editing any component: Re-read its Props interface from src/types/
- [ ] BEFORE touching database code: Re-read the schema (prisma/ or supabase/)
- [ ] BEFORE modifying imports: Check tsconfig.json path aliases exist
- [ ] After EVERY file change: Run build or type-check (don't wait for end of session)
```

### Critical Files to Preserve

These are the sources of truth that MUST be re-read after compaction:

| File | Purpose | When to Re-read |
|---|---|---|
| `CLAUDE.md` | Project rules & autonomy levels | After every compaction |
| `src/types/**` | Type definitions & interfaces | Before modifying any component |
| `prisma/schema.prisma` or `supabase/schema.sql` | Database schema | Before any DB changes |
| `tsconfig.json` | TypeScript path aliases & compiler options | Before using imports |
| `package.json` | Dependencies & project metadata | Before installing packages |
| `.env.example` | Required environment variables | Before running locally |

### The Rework Loop & Compaction (Critical)

The rework loop (`bin/rework.js`) is vulnerable to compaction. To fix this:

1. **Before rework starts**: Agent should re-read type definitions
2. **During rework**: If a fix introduces a type error, re-read the full interface
3. **After rework**: Always run `npm run build` or `npm run type-check`

Use the `--context-refresh` flag when running rework after compaction:
```bash
node bin/rework.js --review fixes.json --apply --context-refresh
```

### Compaction Defense Checkpoint

Before long operations (multi-file changes, complex refactors), create a checkpoint:
```bash
# Manually save checkpoint
echo '{"branch":"$(git branch --show-current)","time":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}' > .claude/context-checkpoint.json
```

## 5. Compaction-Safe Development Flow

```
Step 1: After compaction, run the post-compact hook (automatic)
Step 2: Review the hook output for your project's structure
Step 3: For ANY code changes:
        a. Read the relevant type/schema files first
        b. Make the change
        c. Run build/type-check immediately
        d. Commit or continue (never assume it works)
Step 4: If you see type errors that weren't there before:
        - DON'T guess the type
        - Re-read the actual definition from src/types/
        - Check if schema.prisma matches the code
        - Ask Claude to re-read the interface before retrying
```

### The "Golden Rule" of Compaction
**Never assume you remember a type shape, import path, or schema field after compaction.**
**Always read the source of truth before using it.**
