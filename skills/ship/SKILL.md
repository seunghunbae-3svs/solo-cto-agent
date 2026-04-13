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

The goal is not reckless auto-deploy. The goal is fewer "it works locally" endings.

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

**L1 — preview / low-risk**: preview deployment, non-production, logs, validating callbacks, retrying after config/code fixes. Proceed automatically.

**L2 — staging / limited release**: staging deploy, config verification, health check. Proceed with caution if reversible.

**L3 — production / irreversible**: production release, rollback affecting live users, schema/migration at production time, secret rotation, downtime/data loss risk. **Must ask first.**

---

## Deploy workflow

**1) Pre-deploy check** (> references/pre-deploy-checklist.md): verify build command, env vars, deploy target, auth callbacks, migration risk, rollback path, preview/staging path.

**2) Deploy**: identify environment, confirm preview/staging/production, trigger deploy, capture status/URL/logs/failing step. Read the actual signal, not just "failed."

**3) Failure classification** (> references/failure-classification.md): code/build error, missing env var, bad config, dependency issue, migration/DB mismatch, auth/callback/domain mismatch, external outage. Fix the right layer.

**4) Recovery loop** (> references/recovery-loop.md): inspect logs → identify root cause → apply smallest safe fix → redeploy → compare → stop if same error repeats. No unrelated cleanup changes.

---

## Circuit breaker

CB_DEPLOY_NO_PROGRESS=3, CB_DEPLOY_SAME_ERROR=5, CB_DEPLOY_CASCADE=3.

Stop and escalate if: same error repeats without new evidence | one fix creates multiple new failures | issue appears platform-side | production impact without approval.

Report: what failed, what was attempted, what changed, what still blocks, whether rollback is needed.

---

## Preview-first rule

Use preview first. Verify preview before production. Include preview URL in reports. Distinguish "preview looks good" from "production is safe." Do not treat preview success as automatic production approval.

---

## Rollback rule

Rollback is not failure — it is a valid control action. Recommend when: user-facing breakage is likely | root cause is unclear | repeated fixes are not helping | safe previous state exists and time matters.

When recommending: say why, what version/commit to roll back to, what follow-up investigation is needed.

---

## Error diagnosis

> Full details → references/error-checklist.md

Before applying fixes, check: app vs platform source, new env vars/callbacks, build command changes, package version changes, migration/DB changes, project root/framework correctness, preview URL correctness.

---

## Reporting format

> Full details → references/reporting-format.md

Include: target environment, status, preview URL, likely cause, attempted fixes, remaining blocker, next action.

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

## Anti-patterns

Never: retry without changing diagnosis | deploy to production just because preview works | hide deploy risk | treat rollback as embarrassment | mix feature work and deploy triage | say "build failed" without details.

---

## Output expectations

Make it obvious: whether shipping is safe, what failed if it is not, whether preview is good enough for review, whether approval is required, whether rollback is the safer move.

This skill should reduce deployment anxiety, not automate recklessness.
