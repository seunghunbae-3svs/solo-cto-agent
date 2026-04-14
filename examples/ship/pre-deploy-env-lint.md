# Pre-deploy env var lint

Tier: Builder · Agent: Cowork · Mode: Semi-auto

## Input

You are about to deploy a Next.js app to Vercel for the first time this week. The codebase has picked up two new integrations since the last deploy: Stripe and Resend.

```bash
solo-cto-agent ship --target vercel --dry-run
```

## Agent behavior

1. **`ship` skill** scans the repo for service signals:
   - `package.json`: `next`, `next-auth`, `@prisma/client`, `@supabase/supabase-js`, `stripe`, `resend`
   - File structure: `prisma/schema.prisma` present, `app/api/webhooks/stripe/route.ts` present
   - Emits a detected-services table:

     ```text
     DETECTED SERVICES
       next-auth    → NEXTAUTH_URL, NEXTAUTH_SECRET
       supabase     → NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
       prisma       → DATABASE_URL, DIRECT_URL
       stripe       → STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
       resend       → RESEND_API_KEY
     ```
2. Queries Vercel for the current project's env (via `vercel env ls --environment=production`):
   - Finds `NEXTAUTH_*`, `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL` already present.
   - Missing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `RESEND_API_KEY`.
3. Emits a status table and paste-ready commands:

   ```text
   STATUS
     ✓ 5 required vars present
     ✗ 4 required vars missing

   MISSING — paste-ready commands:

     # Stripe
     vercel env add STRIPE_SECRET_KEY production
     vercel env add STRIPE_WEBHOOK_SECRET production
     vercel env add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY production

     # Resend
     vercel env add RESEND_API_KEY production

     # (same, for preview + development if you want parity)
     for env in preview development; do
       vercel env add STRIPE_SECRET_KEY $env
       vercel env add STRIPE_WEBHOOK_SECRET $env
       vercel env add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY $env
       vercel env add RESEND_API_KEY $env
     done
   ```
4. Also writes a `.env.example` diff if the file is missing any of the detected vars (does not overwrite user-written comments).
5. **Does not** trigger the actual deploy in `--dry-run`. You run the 4 commands, then re-run without `--dry-run`:

   ```bash
   solo-cto-agent ship --target vercel
   ```

   On the real run, the env check passes, and the agent triggers `vercel --prod`.

## Output

Terminal table (trimmed):

```text
DETECTED SERVICES         5
REQUIRED ENV VARS         15
PRESENT (Vercel prod)     11
MISSING                    4

MISSING VARS
  STRIPE_SECRET_KEY                   (stripe)
  STRIPE_WEBHOOK_SECRET               (stripe)
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  (stripe)
  RESEND_API_KEY                      (resend)

NEXT ACTION
  Run the 4 `vercel env add` commands printed above, then re-run without --dry-run.
```

Also written: `.env.example` updated to include the 4 new vars with inline `# from stripe / # from resend` comments (no values).

## Pain reduced

**The production deploy that fails at runtime because a single secret was not set.** The classic sequence is: push → Vercel builds fine (build-time doesn't need the key) → first real request hits `/api/webhooks/stripe` → 500 → 15 minutes of dashboard hunting to figure out which of 14 env vars was missing.

Here every missing secret is named before the deploy, with a command you can paste. If the deploy is fully green on env, the dry-run says so and the real run is a single `vercel --prod` call.

Secondary pain: `.env.example` drift. When a service gets added (`npm install stripe`), `.env.example` usually does not get updated, so the next engineer or the next machine has to reverse-engineer the list. This pass keeps `.env.example` in sync automatically.
