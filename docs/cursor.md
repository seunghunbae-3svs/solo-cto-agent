# Using solo-cto-agent with Cursor IDE

> Cursor is an AI-first code editor built on VS Code. This guide shows how to integrate solo-cto-agent skills into Cursor's native AI features.

## Overview

Cursor provides two AI interaction modes:
- **Cmd+K (Composer)**: Agentic code generation and refactoring
- **Cmd+L (Chat)**: Inline code review and explanations

`solo-cto-agent` skills map directly to these workflows via `.cursorrules` configuration.

## Setup

### 1. Install solo-cto-agent globally

```bash
npm install -g solo-cto-agent
export ANTHROPIC_API_KEY="sk-ant-..."
solo-cto-agent init --preset builder
```

### 2. Create `.cursorrules` file

In your project root, create a `.cursorrules` file that loads the solo-cto-agent failure catalog and skill reference:

```cursorrules
You are a CTO-tier code agent powered by solo-cto-agent framework.

## Error Handling
Load the error catalog from the project:
- Location: failure-catalog.json (same directory as this file)
- On compilation/runtime errors, match patterns from the catalog first
- Apply fixes from the catalog before suggesting new approaches

## Skill Mapping
The following skills are available via solo-cto-agent:
1. review    → Code review (Cmd+L or embedded in Composer)
2. build     → Build system diagnostics and compilation fixes
3. ship      → Deployment validation and environment setup
4. craft     → Component/function generation with patterns
5. memory    → Session context and decision tracking

## Integration Pattern
When you see an error:
1. Search failure-catalog.json for matching pattern
2. Apply the fix from the catalog
3. If not found, use your knowledge + suggest adding to catalog

When generating code:
1. Use craft skill patterns for consistency
2. Include error handling from review checks
3. Validate deployability per ship requirements

## File Structure
- .cursorrules (this file)
- failure-catalog.json (error patterns + fixes)
- src/ (application code)
- .env.local (local development secrets, not committed)
```

### 3. Link failure-catalog.json to Cursor

Cursor automatically reads `.cursorrules` but also needs the JSON. Copy it to your project:

```bash
# From your project root
cp ~/.claude/skills/solo-cto-agent/failure-catalog.json ./
```

Then add to `.cursorrules`:
```cursorrules
// Cursor will load failure-catalog.json automatically
// if it's in the same directory
```

## Feature Mapping

### Cmd+K (Composer) — `build` + `craft` skills
When you use Composer for multi-file edits:

```
What I want: "Add a login form to the dashboard"
Cmd+K will:
  1. Load craft patterns for form components
  2. Check build compatibility (TypeScript, imports)
  3. Validate against failure-catalog for common build errors
  4. Generate code + verify it compiles
```

### Cmd+L (Chat) — `review` skill
Inline questions and quick fixes:

```
What I want: "Why is this failing?"
Cmd+L will:
  1. Match error against failure-catalog patterns
  2. Suggest fix from catalog or explain root cause
  3. Link to docs/configuration.md for detailed setup
```

### Embedded Review
In code comment, ask Cursor to review:

```javascript
// @ask: review this function for performance issues
export async function fetchUserData(id) {
  const response = await fetch(`/api/users/${id}`);
  return response.json();
}
```

Cursor will:
1. Load the `review` skill context
2. Check failure-catalog for common patterns (missing error handling, N+1 queries)
3. Suggest fixes inline

## Configuration

### .cursor/settings.json

If you want Cursor-specific overrides:

```json
{
  "codeium.apiKey": "token_...",
  "ai.assistantModelOverride": "claude-3-5-sonnet",
  "ai.temperature": 0.1,
  "ai.contextLength": 8000,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```

### Environment Variables

```bash
# .env.local (in project root, .gitignored)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...      # Optional, for dual-review mode
GITHUB_TOKEN=ghp_...       # For ship skill (deployment checks)
```

Load these in your `.cursorrules`:

```cursorrules
// Environment is auto-loaded from .env.local
// Cursor will detect ANTHROPIC_API_KEY and route to Claude
```

## Advanced Patterns

### Context Window Management

For large files, use Cursor's context focus:

```
// Cmd+K: Focus this function only
// Type: "Review for security issues"
// Cursor will:
//   - Load failure-catalog patterns for {category: "security"}
//   - Apply review constraints (only this function)
//   - Return focused feedback
```

### Skill Composition

Chain skills by adding comments:

```javascript
// @skills: build, review, craft
// Generate a database migration that:
// 1. Creates users table
// 2. Passes type checking
// 3. Handles rollback safely

// Cursor will invoke build + review + craft in sequence
```

### Multi-File Edit Session

When Composer is editing multiple files:

```
Cmd+K: "Refactor auth to use NextAuth"
Cursor will:
  1. Load craft skill for NextAuth patterns
  2. Check build compatibility across all touched files
  3. Validate failure-catalog for common NextAuth errors
  4. Apply fixes before committing the edit
```

## Limitations & Workarounds

### Limitation: Cursor runs on client, solo-cto-agent runs server-side

**Workaround**: Use `solo-cto-agent review --json` in the terminal and paste results back to Cursor chat:

```bash
# In terminal
solo-cto-agent review --staged --json > review-result.json

# In Cursor Chat (Cmd+L)
# Paste the JSON and ask: "Summarize this review"
```

### Limitation: No cross-repo access from Cursor

**Workaround**: For multi-repo issues, run the full orchestrator in the CLI:

```bash
solo-cto-agent setup-pipeline --org myorg --repos app1,app2
# Then use Cursor only for single-repo work
```

### Limitation: .cursorrules is project-local, not global

**Workaround**: Use a template repo with pre-configured `.cursorrules`:

```bash
# Create a starter repo with .cursorrules + failure-catalog.json
# Share as a GitHub template
# New repos auto-inherit the configuration
```

### Limitation: Cursor's context window is smaller than full Claude API

**Workaround**: Break large reviews into chunks:

```
// Cursor: Review only app/routes/ first
// Then ask: Review only app/components/
// Then synthesize results
```

## Examples

### Example 1: Quick build fix with Cursor

```
1. You see: "Error: Tailwind @apply unknown utility"
2. Open .cursorrules (already loaded)
3. Cmd+L: "Why is @apply failing?"
4. Cursor:
   - Matches ERR-003 in failure-catalog.json
   - Suggests: "Check Tailwind version in package.json"
   - Offers: "Run npm install tailwindcss@latest"
5. You run the fix, press Cmd+K to re-run build check
```

### Example 2: Generate secure form with craft + review

```
Cmd+K:
"Generate a login form with password validation and CSRF protection"

Cursor will:
  1. Generate form component (craft skill)
  2. Add security headers (review skill checks)
  3. Validate imports compile (build skill)
  4. Return ready-to-use code
```

### Example 3: Embedded review comment

```javascript
// @ask solo-cto-agent review
// Does this API endpoint handle errors properly?

export async function POST(req) {
  const { email } = await req.json();
  const user = await db.users.findUnique({ where: { email } });
  return Response.json(user);
}

// Cursor output:
// ERR-007: Missing error handling for missing user
// Fix: Add null check or throw 404
```

## Keyboard Shortcuts

| Action | Shortcut | Maps to |
|---|---|---|
| Composer (agentic edit) | Cmd+K | build + craft |
| Quick chat | Cmd+L | review + chat |
| Refactor | Cmd+Shift+R | craft (pattern templates) |
| Fix error | Cmd+. (Quick Fix) | review (from failure-catalog) |
| Review file | Cmd+L then "@ask" | review skill |

## Troubleshooting

**Q: .cursorrules not being read?**
A: Restart Cursor or reload the window (Cmd+R). Cursor caches rule files.

**Q: Cursor says "failure-catalog.json not found"?**
A: Copy it from `~/.claude/skills/solo-cto-agent/` to your project root.

**Q: Review output is too generic?**
A: Add more context to `.cursorrules` by mentioning your stack (Next.js, Prisma, etc.).

**Q: Composer generates working code but with style issues?**
A: Run `solo-cto-agent review --json` after to catch style issues Cursor missed.

## See Also

- [docs/claude.md](./claude.md) — Main toolkit guide
- [docs/configuration.md](./configuration.md) — Full config reference
- [failure-catalog.json](../failure-catalog.json) — Error patterns & fixes
