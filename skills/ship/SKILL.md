---
name: ship
description: "Deployment and release skill for shipping code with bounded recovery. Monitors build outcomes, reads logs, attempts safe fixes, and escalates clearly when human approval is needed. Activates on: deploy, release, ship, production, staging, rollback, build failed, preview, Vercel, Railway, Netlify, CI."
user-invocable: true
---

# Ship — Deployment and Release Operator

Writing code is not the finish line.
A task is only really done when the deploy works, the preview is usable, and the failure path is understood.

This skill is for that part.

Its job is to:

- monitor deployment outcomes
- read build and runtime failures
- attempt reasonable fixes
- stop before it becomes a loop
- escalate clearly when approval or judgment is needed

The goal is not reckless auto-deploy.
The goal is fewer "it works locally" endings.

---

## Principle 0 — Treat deploy failure as part of the task

Do not hand deployment problems back to the user immediately if the change caused them.

Preferred sequence:

1. inspect the failure
2. determine whether the issue is code, config, env, or platform
3. attempt the smallest safe fix
4. retry within a bounded loop
5. report clearly if the circuit breaker is hit

If the task touched deploy-sensitive areas, include deploy checks in the definition of done.

---

## Deployment levels

### L1 — preview / low-risk verification

Safe to proceed automatically:

- preview deployment
- non-production verification
- reading logs
- validating callback URLs or build commands
- retrying after small config/code fixes

### L2 — staging / limited release

Can proceed with caution if the environment is clearly non-production and the changes are reversible.

Examples:
- staging deploy
- config verification
- health check after deploy

### L3 — production / irreversible risk

Must ask first:

- production release
- rollback affecting live users
- schema or migration operations tied to production rollout
- secret rotation
- anything that could cause downtime or data loss

---

## Deploy workflow

### 1) Pre-deploy check

Before shipping:

```text
□ Build command is correct
□ Required env vars exist
□ Deploy target is correct
□ Auth callbacks / webhook URLs match target domain
□ Migration risk is understood
□ Rollback path exists
□ Preview or staging path is available if relevant
```

If one of these is missing, surface it before pushing forward.

---

### 2) Deploy

When deploying:

```text
1. identify target environment
2. confirm whether this is preview, staging, or production
3. trigger or monitor deploy
4. capture:
   - deploy status
   - preview URL
   - build logs
   - failing step
5. if failure occurs, classify it before changing anything
```

Do not guess blindly from the word "failed."
Read the actual signal first.

---

### 3) Failure classification

Common buckets:

```text
- code/build error
- missing environment variable
- bad framework/deploy config
- dependency or package install issue
- migration or database mismatch
- auth / callback / domain mismatch
- external provider outage or platform issue
```

The point is to fix the right layer, not just change code because code is nearby.

---

### 4) Recovery loop

Use a bounded loop:

```text
1. inspect logs
2. identify likely root cause
3. apply the smallest safe fix
4. redeploy or retry
5. compare outcome
6. stop if the same failure repeats
```

Do not make unrelated cleanup changes inside a deploy-fix loop.

---

## Circuit breaker

```text
CB_DEPLOY_NO_PROGRESS = 3
CB_DEPLOY_SAME_ERROR  = 5
CB_DEPLOY_CASCADE     = 3
```

Stop and escalate when:

- the same error repeats with no meaningful new evidence
- one fix creates multiple new failures
- the issue appears to be platform-side rather than code-side
- production impact is possible and approval is missing

When stopping, report:

- what failed
- what was attempted
- what changed
- what still blocks release
- whether rollback is recommended

---

## Preview-first rule

When possible:

- use preview first
- verify preview before talking about production
- include preview URL in the report
- distinguish clearly between "preview looks good" and "production is safe"

Do not treat a successful preview as automatic permission for production.

---

## Rollback rule

Rollback is not failure.
It is a valid control action.

Recommend rollback when:

- user-facing breakage is likely or confirmed
- the root cause is unclear
- repeated fixes are not improving the outcome
- a safe previous state exists and time matters more than exploration

If recommending rollback, say:

- why
- what version/commit to roll back to
- what follow-up investigation is needed

---

## Build/deploy error checklist

Before applying fixes, check:

```text
□ Is the failure from the app or the platform?
□ Did the task introduce a new env var or callback?
□ Did the build command change?
□ Did package versions change?
□ Did a migration or DB expectation change?
□ Is the project root / framework preset correct?
□ Is the preview URL actually for the right branch/build?
```

---

## Reporting format

A good deploy report includes:

```text
- target environment
- status
- preview URL (if available)
- likely cause
- attempted fixes
- remaining blocker
- next recommended action
```

Example:

```text
Deploy target: preview
Status: failed
Likely cause: missing STRIPE_WEBHOOK_SECRET
Attempted fixes: verified build logs, confirmed env reference, no secret found
Preview URL: not generated
Recommendation: add secret, redeploy, re-check checkout callback flow
```

---

## Avoid these patterns

```text
- retrying without changing the diagnosis
- deploying to production just because preview works
- hiding deploy risk behind optimistic language
- treating rollback as embarrassment instead of control
- mixing feature work and deploy triage in the same loop
- saying "build failed" without saying where or why
```

---

## Output expectations

When this skill is used, the final result should make it obvious:

- whether shipping is safe
- what failed if it is not
- whether preview is good enough for review
- whether approval is required
- whether rollback is the safer move

This skill should reduce deployment anxiety, not automate recklessness.

## Execution Examples

- "Use ship to diagnose a Vercel build failure and propose fixes."
- "Use ship to handle a failed deploy with a bounded retry plan."
- "Use ship to summarize deployment risk and required approvals."
