# Break out of a recurring build error

Tier: Builder · Agent: Cowork · Mode: Semi-auto

## Input

You are in an error loop. The same TypeScript error is showing up on `npm run build`:

```text
Type error: Property 'id' does not exist on type 'Session["user"]'.
  at lib/getUserContext.ts:14:29
```

You have already tried three fixes in this session:

1. Added `// @ts-expect-error` — the error moved to a different call site.
2. Widened the param to `any` — `next build` still fails because two other consumers now mismatch.
3. Imported `Session` from a different module — no-op, same error.

You ask the agent one more time:

```text
같은 에러 계속 난다. 다시 시도해줘.
```

## Agent behavior

1. **Circuit breaker (`build` skill, Principle 5)** detects:
   - Same error signature (`'id' does not exist on type 'Session["user"]'`) has appeared 3 times in the rolling session buffer.
   - Three distinct patches were applied and none reduced the error scope.
   - Threshold reached → **loop halt**. No 4th patch is attempted.
2. Instead of patching, the agent runs **root-cause triage**:
   - `grep -rn "next-auth"` — finds `next-auth@5.0.0-beta`.
   - `grep -rn "session.user.id"` — finds 6 call sites across 4 files.
   - Reads `types/next-auth.d.ts` — file does not exist.
   - Cross-checks against the `review` skill's NextAuth checklist → matches known pattern: "v5 + no module augmentation".
3. Reports:

   ```text
   [CIRCUIT BREAKER] TS2339 'id on Session.user' — 3 attempts, 0 progress.

   Root cause (single):
     next-auth v5 removes session.user.id from the default Session type.
     Module augmentation in types/next-auth.d.ts is required when using
     a custom adapter that persists `id`. Without it, every call site
     that reads session.user.id will fail in build.

   Fix (one patch, not three):
     1. Create types/next-auth.d.ts declaring module "next-auth" with
        Session { user: { id: string; email: string; name: string | null } }
     2. Add types/next-auth.d.ts to tsconfig include.
     3. Revert the three prior patches (@ts-expect-error, any, import swap).

   Not fixing: anything else. The 6 call sites are correct as-is once the
   type is augmented.
   ```
4. You accept. Agent writes `types/next-auth.d.ts`, updates `tsconfig.json`, and reverts the three prior patches in a single commit.
5. `npm run build` succeeds on first attempt.

## Output

Single commit with message:

```text
fix(types): augment next-auth Session with user.id (root cause)

- add types/next-auth.d.ts module augmentation for next-auth v5
- include types/next-auth.d.ts in tsconfig
- revert 3 prior band-aids (@ts-expect-error, any widening, import swap)

The 6 call sites reading session.user.id are correct; they were failing
because v5 removed the field from the default Session type. Module
augmentation restores it for the custom Supabase adapter path.
```

`npm run build` → exit 0.

## Pain reduced

**30 minutes lost to whack-a-mole patches where each fix creates two new errors.** The circuit breaker is the part that matters — it does not keep patching. It stops, diagnoses once, and applies the root-cause fix instead of the symptomatic one. On a typical day that is the difference between shipping and not shipping.

The second pain reduced: the three band-aid patches are **reverted in the same commit**, so `git log` stays clean and the next person (or the next session) does not inherit confusion about why `// @ts-expect-error` is scattered through the codebase.
