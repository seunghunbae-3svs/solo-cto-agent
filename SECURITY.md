# Security

## Reporting

If you find a security issue, email security@your-org.com directly.

Do not open a public issue. I will respond within 48 hours.

## Scope

This repo contains skill files and a lightweight CLI. It does not run a server, store credentials, or make network requests on behalf of users (except the optional CI status check in `solo-cto-agent status`, which only reads public GitHub Actions data).

The `init` command writes files to `~/.claude/skills/solo-cto-agent/`. It does not modify system files or require elevated permissions.

## Dependencies

Runtime: none (Node.js built-ins only).
Dev: vitest, ajv (test-only, not shipped in the package).

## Things to watch for

- Skill files can contain instructions that an AI agent will follow. Treat SKILL.md files with the same caution as executable code.
- If you fork and add custom skills, review them before running with an agent that has file system or shell access.
