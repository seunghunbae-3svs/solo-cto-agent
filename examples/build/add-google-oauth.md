# Add Google OAuth to a Next.js app

Tier: Builder (default) · Agent: Cowork (+ optional Codex) · Mode: Semi-auto

## Input

In Cowork (or terminal) from inside a Next.js 14 app on the `main` branch:

```text
build Google OAuth login using NextAuth. Store user in Supabase.
```

The repo has:

- `next@14`, `@supabase/supabase-js@2`
- No existing auth
- A `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- A Vercel project wired to the repo

## Agent behavior

1. **`spark`** locks scope in one short exchange:
   - "Confirming: Google OAuth only (not email + magic link)? → yes"
   - "Session in Supabase `auth.users` or custom `profiles` table? → profiles"
   - "JWT session or database session? → database"
2. **`build`** runs its pre-flight pass **before writing code**:
   - Scans `package.json` → no `next-auth`. Flags as install.
   - Scans `.env.local` → missing `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Flags as required.
   - Scans `supabase/migrations/` → no `profiles` table. Flags as migration needed.
   - Reports the missing pieces to you **as a single checklist**, not mid-implementation.
3. You paste the 4 env values (Google console + a generated `NEXTAUTH_SECRET`). Agent writes them to `.env.local` and updates `.env.example`.
4. Agent writes:
   - `app/api/auth/[...nextauth]/route.ts`
   - `lib/auth.ts` (`authOptions` with `GoogleProvider`, custom Supabase adapter)
   - `supabase/migrations/<timestamp>_create_profiles.sql`
   - `app/login/page.tsx`, `app/logout/route.ts`
   - Updates `middleware.ts` to gate `/dashboard/*`
5. **`ship`** (dry-run) runs the env-var precheck before you commit:
   - Compares `.env.example` against the Vercel project's env vars
   - Emits a paste-ready block of `gh secret set` / `vercel env add` commands for the 4 new vars
6. **`review`** runs over the staged diff:
   - 10 checklists (import / Prisma / NextAuth / Supabase / TS / error / secret / deploy / Next version / Tailwind version)
   - Verdict: `APPROVE` with one `NIT` on `session.user.id` typing
7. You commit and push. Vercel preview build passes because the env vars were set **before** push, not after the first failed deploy.

## Output

```text
$ solo-cto-agent review --staged --markdown
[VERDICT] APPROVE
[ISSUES]
  - [NIT] lib/auth.ts:42 — next-auth session.user.id type narrowing missing; add to types/next-auth.d.ts
[SUMMARY] 1 migration, 5 new files, 2 modified. Env additions documented in .env.example. Supabase adapter wired; middleware gate active on /dashboard/*.
[NEXT ACTION] git push; wait for Vercel preview; verify Google consent screen on /login.
```

Generated files (actual):

- `app/api/auth/[...nextauth]/route.ts`
- `lib/auth.ts`
- `supabase/migrations/20260414_create_profiles.sql`
- `app/login/page.tsx`
- `app/logout/route.ts`
- `.env.example` (4 new rows)
- `middleware.ts` (updated)

## Pain reduced

**"Please manually add these env vars to your Vercel dashboard"** — that note usually appears **after** the first preview deploy fails, costing one deploy cycle and a context switch. Here the missing env vars are flagged in step 2, before any code is written, and the deploy just works.

Secondary pain: the migration file, the `.env.example` update, and the `types/next-auth.d.ts` nit are things that normally get forgotten and caught in review later. All three are surfaced in a single pass.
