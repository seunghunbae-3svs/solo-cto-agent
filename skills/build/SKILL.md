---
name: build
description: “Development pipeline orchestrator. Architect -> Build -> Review -> Deploy with pre-flight checks, pre-req scanning, and bounded error recovery. Activates on: code, dev, deploy, build, error, bug, fix, API, DB, git, npm, TypeScript, component, feature, debug, hotfix, patch, schema, migration, auth.”
user-invocable: true
---

# Build — Development Pipeline Orchestrator

This skill handles the part of software work that usually gets bounced back to the founder:
missing env vars, package mismatches, half-finished migrations, repeated build failures, hidden setup work.

The goal is to reduce repetitive operational work while keeping risky decisions explicit.

---

## Principle 0 — Agent handles routine work. User approves risky work.

The agent should take initiative where it is safe and useful.

* Write files directly when the environment allows it.
* Reuse known context instead of asking the same setup questions again.
* Batch setup requests into one clear request when direct access is not available.
* Avoid offloading obvious routine work back to the user too early.

Preferred behavior: scan first → identify what is missing → ask once → continue without interruption.

---

## Your Stack (customize this section)

```text
OS:          {{YOUR_OS}}          # e.g. Windows 11, macOS, Linux
Editor:      {{YOUR_EDITOR}}      # e.g. VSCode, Cursor
Deploy:      {{YOUR_DEPLOY}}      # e.g. Vercel, Netlify, Railway
DB:          {{YOUR_DB}}          # e.g. Supabase PostgreSQL, PlanetScale
ORM:         {{YOUR_ORM}}         # e.g. Prisma, Drizzle, TypeORM
Framework:   {{YOUR_FRAMEWORK}}   # e.g. Next.js 14, Next.js 15, Remix, SvelteKit
Style:       {{YOUR_STYLE}}       # e.g. Tailwind CSS + shadcn/ui
Git:         {{YOUR_GIT_USER}}
```

### Stack-Specific Warnings

* Next.js 14: `params` is not a Promise. Do not `await` it.
* Next.js 15: `params` is a Promise. `await` it.
* React 18: confirm compatible package versions before adopting examples blindly.
* Prisma: run `prisma generate` before `next build` when relevant.
* Tailwind v4: use the correct import and utility model for v4. Do not assume old syntax.

---

## Working Model

**Architect -> Build -> Review -> Deploy**

Each phase has a job. Do not skip straight to coding if setup risks are obvious.

### 1) Architect
Before changing code, identify the project, separate “what” from “why”, estimate impact (files/routes/APIs/DB/env vars/deploy), check prerequisites, and lock scope.

> Full details → references/architect.md

### 2) Build
Make the smallest safe change that solves the task. Keep imports real and local. Avoid unnecessary refactors. Run type checks. Record changed files and why.

> Full details → references/build.md

### 3) Review
Before calling the task done, check implementation, imports, types, error states, API shapes, DB queries, env vars, and security.

**Checklist:**
```
□ Does the implementation match the request exactly?
□ Are imports pointing to real files?
□ Are types explicit where they need to be?
□ Are error states handled where failure is likely?
□ Do API methods and response shapes still make sense?
□ Do DB queries match the actual schema?
□ Are any new env vars or platform settings required?
□ Did this introduce auth / security / permission risk?
```

> Anti-patterns to avoid → references/review-antipatterns.md

### 4) Deploy
The task is not fully done until the deploy story is understood. Prepare code/config, push changes, watch build, read logs before changing, attempt reasonable fixes only, stop at circuit breaker.

> Full details → references/deploy.md

---

## Circuit Breaker

```text
CB_NO_PROGRESS = 3   same error, no real progress -> stop and report
CB_SAME_ERROR  = 5   same error repeated -> hard stop
CB_CASCADE     = 3   one fix causes 3+ new breakages -> stop
```

When breaker trips, report: what was attempted, what changed, what is still failing, what needs human judgment.

---

## Pre-flight Checklist

```text
□ Build command is still valid
□ Required env vars are known
□ DB connection target is correct for the environment
□ Auth callback / redirect settings match the target domain
□ ORM generate / migration steps are included when needed
□ Package manager configuration is compatible with the repo
□ Git identity and deployment target are aligned
```

Do not assume production and local setup are interchangeable.

---

## Pre-Requisite Scan Protocol

Scan before coding. Ask once if required. Do not surprise the user halfway through the task.

**What to scan:** Env vars, API keys/tokens, CI secrets, webhooks, DB schema, packages, access scope, domains.

If something is missing: collect items, ask in one grouped request, proceed after values are provided.

> Full details → references/prereq-scan.md

---

## Batch Automation Guidance

When access is available, apply configuration directly (env vars, .env, CI secrets, repeated config across repos).

When access is not available: ask once, state exactly what is missing, group into one batch, avoid vague guidance.

> Full details and template → references/batch-automation.md

---

## Build Error Quick Fix Catalog

| Error pattern             | First check                                               |
| ------------------------- | --------------------------------------------------------- |
| Module not found          | Verify the import path and that the file exists           |
| Type error                | Fix to match real types instead of bypassing with `any`   |
| ORM generate missing      | Add the required generate step before build               |
| Params / routing mismatch | Check framework version and route conventions             |
| CSS utility issue         | Confirm framework version and syntax model                |
| Instant deploy fail       | Check framework preset, root directory, and build command |
| Auth failure after deploy | Check env vars, callback URLs, and deployment domain      |

Treat this as a starting catalog, not a substitute for reading logs.

---

## Patterns to Avoid

```
scan first → ask once → apply broadly → stop loops early → report clearly
```

> Detailed anti-patterns → references/avoid-patterns.md

---

## Session Reuse

If values or decisions were already established in the session: reuse them, mention reuse briefly, avoid asking again unless ambiguous or risky.

Examples: deploy platform token, bot token, repo naming convention, framework/version, migration policy.

---

## Platform Notes

**Windows PowerShell:** Be careful with file writing methods and encoding. Quote paths with special characters carefully.

**macOS / Linux:** File permissions and executable bits can matter in deploy scripts. Keep shell assumptions conservative.

---

## Output Expectations

Final report should usually include:
- what changed
- what prerequisites were detected
- what was configured directly
- what still needs access or approval
- build/deploy status
- risks or rollback notes

This skill should make the user feel like the setup burden got lighter, not heavier.

> Examples → references/execution-examples.md
