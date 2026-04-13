---
name: build
description: "Development pipeline orchestrator. Architect -> Build -> Review -> Deploy with pre-flight checks, pre-req scanning, and bounded error recovery. Activates on: code, dev, deploy, build, error, bug, fix, API, DB, git, npm, TypeScript, component, feature, debug, hotfix, patch, schema, migration, auth."
user-invocable: true
---

# Build — Development Pipeline Orchestrator

This skill is for the part of software work that usually gets bounced back to the founder:

* missing env vars
* package mismatches
* half-finished migrations
* repeated build failures
* hidden setup work discovered too late

The goal is not “maximum autonomy at any cost.”
The goal is to reduce repetitive operational work while keeping risky decisions explicit.

---

## Principle 0 — Agent handles routine work. User approves risky work.

The agent should take initiative where it is safe and useful.

* Write files directly when the environment allows it.
* Reuse known context instead of asking the same setup questions again.
* Batch setup requests into one clear request when direct access is not available.
* Avoid offloading obvious routine work back to the user too early.

Preferred behavior:

1. scan first
2. identify what is missing
3. ask once if something truly requires user input or restricted access
4. then continue the task without repeated interruptions

Do not pretend direct configuration is possible when access is not available.
Do not ask the user to do the same manual step repeatedly across repos or environments.

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

### Stack-Specific Warnings (edit these for your real stack)

* Next.js 14: `params` is not a Promise. Do not `await` it.
* Next.js 15: `params` is a Promise. `await` it.
* React 18: confirm compatible package versions before adopting examples blindly.
* Prisma: run `prisma generate` before `next build` when relevant.
* Tailwind v4: use the correct import and utility model for v4. Do not assume old syntax.

Keep this section grounded in the actual stack, not generic internet advice.

---

## Working model

The pipeline is:

**Architect -> Build -> Review -> Deploy**

Each phase has a job.
Do not skip straight to coding if setup risks are obvious.

---

## 1) Architect

Before changing code:

```text
1. Identify the project and the exact task
2. Separate "what to change" from "why it matters"
3. Estimate impact:
   - files
   - routes
   - APIs
   - DB tables
   - env vars
   - deploy behavior
4. Check prerequisites before coding
5. Lock scope:
   - do the requested task
   - note adjacent issues separately instead of expanding scope silently
```

Questions to resolve early:

* Is there a migration involved?
* Is there a new environment variable?
* Is there a new dependency?
* Is there a platform or webhook configuration change?
* Is the build command still valid after this change?
* Is there a deployment risk that should be surfaced before coding?

If the answer is yes, handle it early.

---

## 2) Build

When coding:

```text
1. Make the smallest safe change that solves the task
2. Keep imports real and local
3. Avoid unnecessary refactors unless they remove direct risk
4. Run type checks / build checks where appropriate
5. Record changed files and why they changed
```

Practical rules:

* Prefer boring code that is easy to verify over clever code.
* Do not introduce new abstractions unless they pay for themselves immediately.
* If the environment cannot run a full build safely, do the highest-signal validation available and say so clearly.
* If a fix touches a risky area, leave a short risk note.

---

## 3) Review

Before calling the task done, check:

```text
□ Does the implementation match the request exactly?
□ Are imports pointing to real files?
□ Are types explicit where they need to be?
□ Are error states handled where failure is likely?
□ Do API methods and response shapes still make sense?
□ Do DB queries match the actual schema?
□ Are any new env vars or platform settings required?
□ Did this introduce auth / security / permission risk?
```

Also check for these anti-patterns:

* hidden scope expansion
* “temporary” fixes with no exit plan
* hand-wavy TODOs in critical paths
* type assertions used to silence uncertainty
* retries or loops without a stop condition

---

## 4) Deploy

The task is not fully done until the deploy story is understood.

Deploy loop:

```text
1. Prepare the code and config needed for deploy
2. Push or propose changes through the available workflow
3. Watch the build if the environment supports it
4. If it fails, read the logs before changing anything
5. Attempt reasonable fixes only
6. Stop when the circuit breaker is reached
7. Report clearly instead of spiraling
```

Do not treat deployment failure as “someone else’s problem” if the work caused it.

---

## Circuit Breaker

Bound the loop.

```text
CB_NO_PROGRESS = 3   same error, no real progress -> stop and report
CB_SAME_ERROR  = 5   same error repeated -> hard stop
CB_CASCADE     = 3   one fix causes 3+ new breakages -> stop
```

When the breaker trips, report:

* what was attempted
* what changed
* what is still failing
* what likely needs human judgment

---

## Pre-flight Checklist

Customize this to the actual deployment environment.

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

### Principle

Scan before coding.
Ask once if required.
Do not surprise the user halfway through the task.

### What to scan

Before starting any meaningful code or deploy work, check for:

```text
□ Env vars
□ API keys / tokens
□ Secrets in CI / deploy platform
□ Webhooks and callback URLs
□ DB schema / migrations
□ Package additions or version constraints
□ Access scope / permissions
□ Domain / DNS assumptions
```

### How to handle missing requirements

If something is missing:

* collect the missing items
* ask in one grouped request
* proceed after the required values or decisions are provided

Bad behavior:

* asking the same question repo by repo
* discovering a required key halfway through the task
* turning one missing input into five separate messages

Good behavior:

* one clear grouped request
* one explanation of why it is needed
* one place to continue from once resolved

---

## Batch Automation Guidance

When access is available, apply configuration directly.

Examples:

* env vars on the deploy platform
* local `.env` updates
* CI secret insertion where the environment allows it
* repeated config across multiple repos

When access is not available:

* ask once
* state exactly what is missing
* group the required setup into one batch
* avoid vague “please configure this somewhere” guidance

Preferred summary format:

| target | item           | action            | status  |
| ------ | -------------- | ----------------- | ------- |
| repo-a | `DATABASE_URL` | set in deploy env | done    |
| repo-b | `DATABASE_URL` | waiting on access | blocked |

---

## Avoid these patterns

```text
- Asking for the same setup value multiple times
- Discovering required env vars halfway through the task
- Giving one-repo-at-a-time setup instructions when the same change applies everywhere
- Offloading obvious routine work back to the user too early
- Pretending direct configuration is possible when access is not available
- Repeating the same failed fix without changing the diagnosis
```

Preferred behavior:

```text
scan first
ask once
apply broadly where possible
stop loops early
report clearly when access or policy prevents automation
```

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

## Session reuse

If values or decisions were already established in the session:

* reuse them
* mention reuse briefly
* avoid asking again unless the value is ambiguous or risky

Examples of reusable context:

* deploy platform token already provided
* bot token already confirmed
* repo naming convention already established
* framework/version already known
* migration policy already decided

---

## Platform notes

### Windows PowerShell

* Be careful with file writing methods and encoding.
* Paths with special characters or route syntax should be quoted carefully.

### macOS / Linux

* File permissions and executable bits can matter in deploy scripts.
* Shell assumptions should be kept conservative.

---

## Output expectations

When this skill is applied to a real task, the final report should usually include:

```text
- what changed
- what prerequisites were detected
- what was configured directly
- what still needs access or approval
- build/deploy status
- risks or rollback notes
```

This skill should make the user feel like the setup burden got lighter, not heavier.

## Execution Examples

- "Use build to fix a Prisma generate failure before deploy."
- "Use build to add a missing env var and re-run the build."
- "Use build to debug a TypeScript error in an API route."
