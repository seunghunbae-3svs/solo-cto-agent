# Using solo-cto-agent with Windsurf IDE

> Windsurf is Codeium's AI code editor built on VS Code. This guide shows how to integrate solo-cto-agent into Windsurf's **Cascade** (agentic workflow engine).

## Overview

Windsurf's core strength is **Cascade** — a multi-step AI orchestration that handles:
- Multi-file edits with automatic dependency resolution
- State tracking across edits
- Built-in error recovery and validation

`solo-cto-agent` integrates via `.windsurfrules` to provide:
- Failure pattern matching (from failure-catalog.json)
- Consistent skill routing (build → ship → review loop)
- Error-recovery directives for Cascade

## Setup

### 1. Install solo-cto-agent globally

```bash
npm install -g solo-cto-agent
export ANTHROPIC_API_KEY="sk-ant-..."
solo-cto-agent init --preset builder
```

### 2. Create `.windsurfrules` file

In your project root:

```windsurfrules
[SKILL_LOADING]
// Load solo-cto-agent context
framework = "solo-cto-agent"
skills = ["build", "craft", "review", "ship"]
failure_catalog = "./failure-catalog.json"
config_schema = "./config.schema.json"

[CASCADE_FLOW]
// Windsurf Cascade orchestration workflow
// Maps to: build → review → rework → ship

stage_1_build {
  description = "Compile and validate"
  command = "npm run build"
  error_catalog = true
  retry_on_error = true
  max_retries = 3
}

stage_2_review {
  description = "Code review and pattern matching"
  skill = "review"
  check_failure_catalog = true
  auto_fix_known_patterns = true
}

stage_3_rework {
  description = "Apply fixes and regenerate"
  skill = "craft"
  use_patterns = true
  validate_after = true
}

stage_4_ship {
  description = "Deployment validation"
  skill = "ship"
  check_env_vars = true
  dry_run_first = true
}

[ERROR_HANDLING]
// Cascade will match errors to failure-catalog.json
// and auto-apply fixes when available

match_strategy = "pattern"
fallback_to_ai = true
accumulate_fixes = true

[CONTEXT_PRESERVATION]
// Windsurf Cascade preserves state across multi-file edits
// These settings help solo-cto-agent skills see the full context

include_package_json = true
include_tsconfig = true
include_env_schema = true
max_file_context = 50000
```

### 3. Copy failure-catalog.json to project

```bash
cp ~/.claude/skills/solo-cto-agent/failure-catalog.json ./
cp ~/.claude/skills/solo-cto-agent/config.schema.json ./
```

### 4. Configure Windsurf settings

Create or update `.windsurf/settings.json`:

```json
{
  "codeium.apiKey": "token_...",
  "codeium.enableCascade": true,
  "codeium.cascadeMaxSteps": 5,
  "codeium.cascadeTimeoutSeconds": 300,
  "codeium.enableErrorRecovery": true,
  "codeium.errorRecoveryStrategy": "retry",
  "ai.temperature": 0.1,
  "ai.contextLength": 12000,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```

## Cascade Flow Architecture

Windsurf Cascade executes skills in sequence, with state passed between stages:

```
┌─────────────────────────────────────────────────┐
│ STAGE 1: BUILD (compile + validate)             │
│ - Run build command                             │
│ - Capture errors                                │
│ - Match against failure-catalog.json            │
└────────────┬────────────────────────────────────┘
             │ (state: build_errors)
             ↓
┌─────────────────────────────────────────────────┐
│ STAGE 2: REVIEW (pattern matching + rules)      │
│ - Load review skill context                     │
│ - Match patterns to failure-catalog             │
│ - Generate fix recommendations                  │
└────────────┬────────────────────────────────────┘
             │ (state: fixes_proposed)
             ↓
┌─────────────────────────────────────────────────┐
│ STAGE 3: REWORK (craft + apply fixes)           │
│ - Load craft skill patterns                     │
│ - Apply fixes to multiple files                 │
│ - Validate no new errors introduced             │
└────────────┬────────────────────────────────────┘
             │ (state: fixes_applied)
             ↓
┌─────────────────────────────────────────────────┐
│ STAGE 4: SHIP (deployment check)                │
│ - Verify environment setup                      │
│ - Check deployment compatibility                │
│ - Report readiness                              │
└─────────────────────────────────────────────────┘
```

## Integration Patterns

### Pattern 1: Error-Driven Fixes

User gets a build error → Cascade auto-fixes:

```
1. User types code in editor
2. Windsurf detects build error
3. Cascade Stage 1: Captures error "Cannot find module 'next/headers'"
4. Cascade Stage 2: Matches ERR-010 in failure-catalog.json
5. Cascade Stage 3: Applies fix (adds 'use server' directive)
6. Cascade Stage 4: Re-validates build succeeds
7. User sees: "Fixed: Added 'use server' directive. Build passes."
```

### Pattern 2: Multi-File Refactoring

User asks for large refactor → Cascade handles dependencies:

```
User in Cascade: "Migrate this API route to use tRPC"

Cascade will:
  Stage 1: Validate current route compiles
  Stage 2: Review tRPC compatibility patterns
  Stage 3: Generate new route + client schema
            Update all imports across 5 files
            Verify no circular deps
  Stage 4: Run tests, check deployment vars
  
Result: 5-file refactor done in one Cascade session
```

### Pattern 3: Incremental Improvement

User focuses on one aspect per Cascade run:

```
Session 1:
  Input: "Add TypeScript strict types"
  Cascade: Focuses on TypeScript errors only
  
Session 2:
  Input: "Fix performance issues"
  Cascade: Focuses on slow queries + renders
  
Session 3:
  Input: "Deploy this"
  Cascade: Runs ship checks, confirms ready
```

## Cascade Commands

### Trigger Cascade manually

```
Ctrl+Shift+K (or Cmd+Shift+K on macOS)
```

This opens the Cascade prompt. Type your request:

```
"Fix all TypeScript errors"
"Add error handling to async functions"
"Migrate component to React Server Component"
"Deploy to production with checks"
```

### Quick Cascade (inline)

```
In editor comment or in Cascade chat:
@skills build, review, craft
Refactor this function to use async/await

Windsurf will:
  1. Load the three skills
  2. Run Cascade with those stages only
  3. Apply changes inline
```

### View Cascade steps

```
In Cascade chat, add flag:
@verbose

Shows each stage output and reasoning
```

## Configuration Details

### .windsurfrules Sections

#### [SKILL_LOADING]
Controls which skills are available to Cascade:

```windsurfrules
skills = ["build", "craft", "review", "ship"]
  // Only these skills are loaded
  // Reduces token overhead, focuses Cascade on essentials

failure_catalog = "./failure-catalog.json"
  // Path to error pattern database
  // Windsurf reads this file automatically in Stage 2

config_schema = "./config.schema.json"
  // TypeScript configuration schema for validation
```

#### [CASCADE_FLOW]
Defines the 4-stage pipeline:

```windsurfrules
stage_1_build {
  command = "npm run build"
  error_catalog = true  // Use failure-catalog.json
  retry_on_error = true
  max_retries = 3       // Auto-retry 3x before giving up
}

stage_2_review {
  skill = "review"
  check_failure_catalog = true  // Match patterns
  auto_fix_known_patterns = true  // Apply catalog fixes
}

stage_3_rework {
  skill = "craft"
  use_patterns = true           // Use craftpatterns
  validate_after = true         // Run build after craft
}

stage_4_ship {
  skill = "ship"
  check_env_vars = true         // Validate .env
  dry_run_first = true          // Preview changes
}
```

#### [ERROR_HANDLING]
Controls how Cascade recovers from errors:

```windsurfrules
match_strategy = "pattern"       // Search failure-catalog first
fallback_to_ai = true            // If no pattern match, ask Claude
accumulate_fixes = true          // Collect all fixes before applying
```

#### [CONTEXT_PRESERVATION]
Windsurf Cascade remembers files across stages:

```windsurfrules
include_package_json = true  // Always load deps
include_tsconfig = true      // Always load TypeScript config
include_env_schema = true    // Load schema for env vars
max_file_context = 50000     // Max chars for context
```

## Environment Variables

Create `.env.local` in project root (add to .gitignore):

```bash
# API keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...        # Optional for dual-review
GITHUB_TOKEN=ghp_...         # For ship skill

# Build environment
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000

# Windsurf-specific
WINDSURF_SKILL_PATH=./failure-catalog.json
```

Windsurf reads `.env.local` automatically in Cascade stages.

## Advanced: Custom Cascade Stages

If you need extra stages, extend `.windsurfrules`:

```windsurfrules
stage_5_custom_security_scan {
  description = "Run OWASP checks"
  command = "npm run audit:security"
  error_catalog = false
  retry_on_error = false
}

stage_6_performance_check {
  description = "Analyze bundle size"
  command = "npm run analyze:bundle"
  error_catalog = false
}
```

Then Cascade runs 6 stages instead of 4.

## Examples

### Example 1: Auto-fix TypeScript errors

```
1. You edit a file, TypeScript errors appear
2. Press Ctrl+Shift+K (Cascade)
3. Type: "Fix all TypeScript errors"
4. Windsurf Cascade:
   - Stage 1: Runs tsc, captures errors
   - Stage 2: Loads review skill, matches patterns
   - Stage 3: Craft generates fixes (add types, remove unused vars)
   - Stage 4: Ship validates no regressions
5. Result: All TypeScript errors fixed in one run
```

### Example 2: Multi-file refactoring

```
Cascade prompt:
"Convert all .js files to TypeScript"

Windsurf will:
  Stage 1: Validate existing build
  Stage 2: Review TypeScript compatibility
  Stage 3: Convert each .js file, update imports
  Stage 4: Verify build still passes
  
Output: 12 .js files now .ts with types
```

### Example 3: Deployment preparation

```
Cascade prompt:
"Prepare this for production deployment"

Windsurf will:
  Stage 1: Build with production flags
  Stage 2: Review for security issues
  Stage 3: Apply security hardening fixes
  Stage 4: Check .env vars, run dry-run deploy
  
Output: Ready for `solo-cto-agent notify deploy-ready`
```

## Limitations & Workarounds

### Limitation: Cascade timeout (default 300s)

**Workaround**: Increase in `.windsurf/settings.json`:

```json
{
  "codeium.cascadeTimeoutSeconds": 600
}
```

### Limitation: Large file context exceeds 50k limit

**Workaround**: Split Cascade into smaller requests:

```
Instead of:
  "Refactor the entire app"
  
Use:
  Cascade 1: "Refactor src/components only"
  Cascade 2: "Refactor src/hooks only"
  Cascade 3: "Refactor src/utils only"
```

### Limitation: No cross-repo Cascade

**Workaround**: Use full CLI for multi-repo work:

```bash
solo-cto-agent setup-pipeline --org myorg --repos app1,app2
# Use Windsurf Cascade only for single-repo tasks
```

### Limitation: failure-catalog.json must be in project root

**Workaround**: Symlink from global skills dir:

```bash
cd your-project
ln -s ~/.claude/skills/solo-cto-agent/failure-catalog.json ./
```

## Keyboard Shortcuts (Windsurf)

| Action | Shortcut | Maps to |
|---|---|---|
| Open Cascade | Ctrl+Shift+K | Trigger multi-stage flow |
| Quick fix (inline) | Ctrl+. | Review (single error) |
| Auto-format | Shift+Alt+F | Craft (style fixes) |
| Refactor | Ctrl+Shift+R | Craft (pattern templates) |
| Run tests | Ctrl+Shift+T | Build (validation) |

## Troubleshooting

**Q: Cascade hangs on Stage 3?**
A: It's likely waiting for a large file to process. Increase `max_file_context` in `.windsurfrules` or reduce input scope.

**Q: "failure-catalog.json not found"?**
A: Must be in project root. Run: `cp ~/.claude/skills/solo-cto-agent/failure-catalog.json ./`

**Q: Cascade applies unwanted fixes?**
A: Set `auto_fix_known_patterns = false` in Stage 2, then review fixes manually before applying.

**Q: Custom stages don't run?**
A: Windsurf only supports up to 6 stages. If you have more, collapse some into single commands.

## See Also

- [docs/claude.md](./claude.md) — Main toolkit guide
- [docs/configuration.md](./configuration.md) — Full config reference
- [failure-catalog.json](../failure-catalog.json) — Error patterns & fixes
- [Windsurf Docs](https://codeium.com/windsurf-docs) — Official Windsurf guide
