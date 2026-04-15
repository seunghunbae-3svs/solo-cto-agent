# codex-main setup on a live project

Tier: CTO - Agent: Cowork + Codex - Mode: Full-auto

> Repo name, org name, and absolute paths below are anonymized. The numbers are from a real private project run on Windows PowerShell.

## Input (real, anonymized)

A private commerce app ("Project Alpha") with:

- Next.js 14
- NextAuth
- Prisma
- Vercel

The goal was to install the full codex-main pipeline without touching production.

```powershell
solo-cto-agent setup-pipeline --org your-org --tier cto --repos C:\work\project-alpha
solo-cto-agent setup-repo C:\work\project-alpha --org your-org --tier cto
```

## Agent behavior

1. Creates a local orchestrator repo scaffold:
   - `.github/workflows/`
   - `ops/agents/`
   - `ops/scripts/`
   - `ops/orchestrator/`
2. Installs the CTO-tier product workflows into the project repo.
3. Scans the actual project for service signals from `package.json`, file structure, and ORM config.
4. Prints paste-ready secret setup commands instead of waiting for the first failed run.

## Output (real)

```text
Pipeline setup complete

Orchestrator:
  24 workflows

Product repo:
  8 workflows (dual/triple-agent)

Detected services:
  next-auth -> NEXTAUTH_SECRET, NEXTAUTH_URL
  prisma    -> DATABASE_URL

One-shot secret setup:
  gh secret set NEXTAUTH_SECRET -R project-alpha
  gh secret set NEXTAUTH_URL -R project-alpha
  gh secret set DATABASE_URL -R project-alpha
  gh secret set ORCHESTRATOR_PAT -R project-alpha
  gh secret set ANTHROPIC_API_KEY -R project-alpha
  gh secret set OPENAI_API_KEY -R project-alpha
```

Installed product workflows on the live-project copy:

```text
claude-auto.yml
codex-auto.yml
comparison-dispatch.yml
cross-review-dispatch.yml
cross-review.yml
preview-summary.yml
rework-dispatch.yml
telegram-notify.yml
```

## Pain reduced

**Manual CI wiring on a real repo.** Without this, full-auto setup is a sequence of hand-copied workflow files, guessed secret names, and one or two failed runs before the missing pieces become obvious. Here the pipeline install and the secret inventory came from the real codebase up front.
