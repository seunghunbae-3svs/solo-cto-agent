---
name: build
description: "Development pipeline orchestrator. Architect → Build → Review → Deploy with pre-flight checks, auto-prerequisite scanning, and build error quick-fix catalog. Activates on: code, dev, deploy, build, error, bug, fix, API, DB, git, npm, TypeScript, component, feature, debug, hotfix, patch, schema, migration, auth."
user-invocable: true
---

# Build — Development Pipeline Orchestrator

Single pipeline that covers architecture, coding, review, and deployment.
Merge into your CLAUDE.md or use standalone.

---

## Principle 0 — Agent Does Everything. User Confirms Only.

User hates: (1) cascading errors (2) agent asking user to do manual work (3) manual file operations.
→ Agent writes files directly. Never ask user to run shell commands.
→ Agent configures secrets/env vars directly. Never say "please add X to your deploy platform."

---

## Your Stack (customize this section)

```
OS:          {{YOUR_OS}}          # e.g. Windows 11, macOS, Linux
Editor:      {{YOUR_EDITOR}}      # e.g. VSCode, Cursor
Deploy:      {{YOUR_DEPLOY}}      # e.g. Vercel, Netlify, Railway
DB:          {{YOUR_DB}}          # e.g. Supabase PostgreSQL, PlanetScale
ORM:         {{YOUR_ORM}}         # e.g. Prisma, Drizzle, TypeORM
Framework:   {{YOUR_FRAMEWORK}}   # e.g. Next.js 14, Remix, SvelteKit
Style:       {{YOUR_STYLE}}       # e.g. Tailwind CSS + shadcn/ui
Git:         {{YOUR_GIT_USER}}
```

### Stack-Specific Warnings (examples — edit for your stack)

- Next.js 14: `params` is NOT a Promise. Remove `await` on params.
- Next.js 15: `params` IS a Promise. Add `await`.
- React 18: react-leaflet v4 only. Not v5.
- Prisma: Always run `prisma generate` before `next build`.
- Tailwind v4: Use `@import "tailwindcss"` not `@tailwind`. `@apply` cannot reference custom classes.

---

## Pipeline: Architect → Build → Review → Deploy

### 1. Architect (start of task)
```
1. Identify project (existing/new)
2. Separate "what to change" from "why"
3. Impact scope: files, APIs, DB tables
4. Prerequisites: DB schema? env vars? packages? → resolve BEFORE coding
5. Scope lock: one thing at a time. Other issues → Known Gaps log
```

### 2. Build (write code)
```
1. Write code
2. TypeScript strict type check
3. Run build command → must succeed before next step
   ⚠️ VM memory limit → Bus error: for simple fixes, verify syntax then push, rely on deploy platform build
4. Record changed files + reasons
```

### 3. Review (verify)
```
□ Spec: Does implementation match the request exactly?
□ Import: Do all imports reference real files?
□ Type: No `any` abuse?
□ Error: try-catch where needed?
□ API: HTTP methods, response shapes correct?
□ DB: ORM queries match actual schema?
□ Env: New env vars registered on deploy platform?
□ Security: Auth, RLS, sensitive data handled?
```

### 4. Deploy (E2E autonomous)
```
1. Write/Edit files directly in user folder
2. Push to Git (direct .git / web editor / ask user as last resort)
3. Monitor deploy dashboard
4. Failure → read build logs → fix → re-push
5. Success → verify live URL → report done
```

### Circuit Breaker
```
CB_NO_PROGRESS = 3   Same error 3x → report to user
CB_SAME_ERROR  = 5   Same error 5x → hard stop
CB_CASCADE     = 3   Fix creates 3+ new errors → stop
```

---

## Pre-flight Checklist (customize for your deploy platform)

```
□ Build command succeeds locally
□ All .env vars registered on deploy platform
□ Database connection string uses correct pooler endpoint
□ Auth callback URL = production domain (not localhost)
□ ORM generate step in build command (e.g. "prisma generate && next build")
□ .npmrc: legacy-peer-deps=true (if needed)
□ Git identity matches deploy platform account
```

---

## Build Error Quick Fix Catalog

| Error | Fix |
|---|---|
| Module not found | Verify import path, check file actually exists |
| Type error | Fix per strict mode rules |
| ORM generate missing | Add generate step to build command |
| params Promise error | Check framework version — await or don't |
| @apply unknown utility | Tailwind v4: use inline utilities instead of custom classes |
| Deploy platform 404 | Check package.json is at project root |
| 14ms build (instant fail) | Set framework preset manually on deploy platform |

---

## Pre-Requisite Scan & Batch Automation Protocol

### Principle: "Scan everything needed BEFORE work → ask user ONCE → agent configures ALL automatically"

Asking the user to do manual setup is a failure. Gather needed values in ONE request, then agent handles all configuration.

### 1. Pre-Requisite Scan (mandatory before every task)

Before starting any code/deploy/infra work, auto-run this checklist:

```
□ Env vars — Any new env vars needed? (deploy platform, CI, .env.local)
□ API keys/tokens — External service integration keys needed?
□ Secrets — CI/CD secrets, deploy platform secrets to add?
□ Webhooks — New webhook setup needed? (URL, secret, events)
□ DB — Schema changes, migrations needed?
□ Packages — New npm/pip packages to install?
□ Permissions — Repo access, token scope additions needed?
□ DNS/Domain — Custom domain, CNAME setup needed?
```

**Result format:**
- If something is needed: Before starting work, say "This task requires [X, Y, Z]. Please provide [values]." — ONE request only.
- If already known from this session: Do NOT re-ask. Use the value already provided.
- If nothing is needed: Start work immediately without announcement.

### 2. Batch Automation

Once user provides values, **agent directly** handles:

```
CI/CD Secrets       → Configure via platform UI or API
Deploy Env Vars     → Configure via platform UI or API
Webhook Setup       → Register via platform UI or API
.env.local          → Write directly to project folder
```

**Multi-repo batch:**
- Same value needed across repos → loop through all repos, auto-insert
- Never give "please add this to repo X" manual guides
- Report results as table: `| repo | secret | status |`

### 3. Forbidden Patterns

```
❌ "Please add this value to Vercel" — agent adds it directly
❌ "Go to GitHub Settings and add a secret" — agent does it directly
❌ "Register the webhook URL" — agent does it directly
❌ Mid-task "this env var is needed" surprise — should have been caught in pre-scan
❌ Asking for the same value per repo — get it once, apply everywhere
```

### 4. Session Value Reuse

Secrets/tokens/keys received during session are reused:
- PAT, Bot Token, Chat ID, Webhook Secret, etc.
- "Using the [X] you provided earlier." — one line, then apply
- Next session: Check state files for "which secrets are configured where"

---

## Platform-Specific Notes (add your own)

### Windows PowerShell
- File creation: Use `[System.IO.File]::WriteAllText()`. echo/Set-Content = UTF-16 BOM → parse failure.
- App Router directories with special chars `(group)`, `[slug]`: wrap in quotes when cd-ing.

### macOS / Linux
- No special handling needed for most operations.
- Check file permissions if deploy scripts fail.
