# Plugin API v2 — Draft Specification

> **Status:** DRAFT (PR-G6) · **Target release:** v0.9.0
> **Owners:** solo-cto-agent core
> **Supersedes:** none (v1 was implicit — skill directories only)

---

## 1. Why

Today the only extension point is **dropping a skill folder** under
`skills/`. This works for prompt-only additions but breaks down when an
author needs to:

1. Contribute a **new CLI subcommand** (e.g. a domain-specific reviewer)
2. Hook a **pre/post review callback** (e.g. redact PII before sending
   to the model, or mirror results to a bug tracker)
3. Register an **external-signal provider** (a new T2 / T3 source —
   Sentry runtime errors, Datadog APM, Stripe revenue data)
4. Ship a **scheduled-task plugin** (e.g. nightly failure-pattern
   digest to Slack)
5. Depend on runtime code that is **not** safe to execute from every
   Cowork session (permission scoping, sandbox limits)

Plugin API v2 defines a stable contract so the first four of those
become one-file drop-ins. The fifth is handled by the **capability
manifest** (§4) which the runtime enforces before loading any plugin
code.

---

## 2. Non-goals

- **Cross-agent plugin portability** is NOT promised by v2. A plugin
  declares which agents it supports (`claude`, `codex`, `cowork`,
  `headless`) and the runtime refuses to load it elsewhere. v3 may
  revisit once we have more data.
- **Dynamic code signing** is out of scope. v2 relies on
  lock-file-pinned `npm` packages + SRI hash over the loaded files. A
  signing authority can be layered on top without API change.
- **Web UI** for plugin management is out of scope. Installation stays
  CLI-first; any GUI lives in a separate package.

---

## 3. Package layout

A v2 plugin is an **npm package** whose `package.json` contains a
`soloCtoAgent` section. Example:

```jsonc
{
  "name": "sca-plugin-sentry",
  "version": "1.0.0",
  "main": "dist/index.js",
  "soloCtoAgent": {
    "apiVersion": 2,
    "displayName": "Sentry ground-truth provider",
    "description": "Pulls last 24 h of Sentry issues for T3 ground truth.",
    "agents": ["claude", "codex", "cowork"],
    "capabilities": ["env:SENTRY_AUTH_TOKEN", "net:sentry.io"],
    "contributes": {
      "groundTruthProviders": ["./dist/sentry-provider.js"],
      "cliCommands": [
        { "name": "sentry-pull", "module": "./dist/sentry-cli.js" }
      ]
    },
    "entry": "./dist/index.js"
  }
}
```

Installation:

```bash
solo-cto-agent plugin add sca-plugin-sentry
solo-cto-agent plugin list
solo-cto-agent plugin remove sca-plugin-sentry
```

The installer writes to `~/.solo-cto-agent/plugins.json` (a lock-like
manifest) and **never** pulls code at runtime — all loads are
file-system reads against the pinned package.

---

## 4. Capability manifest

Every plugin declares every capability it needs. The runtime rejects
loads that request undeclared capabilities.

| Capability | Meaning | Example |
|---|---|---|
| `env:<NAME>` | Read a single env var | `env:SENTRY_AUTH_TOKEN` |
| `net:<domain>` | Fetch from a specific host | `net:api.sentry.io` |
| `fs:read:<glob>` | Read files matching a glob (repo-relative) | `fs:read:logs/*.json` |
| `fs:write:<glob>` | Write under a glob | `fs:write:.solo-cto-agent/plugins/sentry/**` |
| `cli:<name>` | Register a new CLI subcommand | `cli:sentry-pull` |
| `hook:<event>` | Attach a pre/post review hook | `hook:pre-review` |
| `schedule:<name>` | Register a scheduled task | `schedule:sentry-digest` |

The runtime enforces these using a lightweight wrapper: `env` reads go
through a gated accessor, `fetch` is monkey-patched to reject
non-declared hosts, `fs` calls are intercepted in the wrapper. No
general-purpose sandbox — we keep v2 honest: **v2 is scoping, not
isolation.** A malicious plugin can still crash the process or abuse
declared capabilities; we rely on the install-time review.

---

## 5. Contribution points

### 5.1 CLI commands

```js
// dist/sentry-cli.js
module.exports = {
  apiVersion: 2,
  name: "sentry-pull",
  description: "Fetch last 24 h of Sentry issues",
  flags: [
    { name: "--project", required: true },
    { name: "--hours", default: 24, type: "number" },
  ],
  async run({ flags, ctx }) {
    const data = await ctx.fetch(`https://api.sentry.io/api/0/projects/${flags.project}/issues/`);
    ctx.output.json(await data.json());
  },
};
```

The runtime merges these into `solo-cto-agent <plugin-cmd>` at
startup. Name collisions with core commands are refused.

### 5.2 Review hooks

```js
module.exports = {
  apiVersion: 2,
  event: "pre-review",      // or "post-review"
  async handle({ diff, ctx }) {
    // redact anything matching a secret pattern
    return { diff: diff.replace(/sk_live_[A-Za-z0-9]+/g, "sk_live_***") };
  },
};
```

Hooks are **pure functions** from input → patched input (pre) or
input → side-effect (post). Return values are shallow-merged into the
upstream context. Pre-review hooks are run in declaration order;
post-review hooks are run in parallel.

### 5.3 Ground-truth / external-knowledge providers

```js
// T3 ground-truth provider
module.exports = {
  apiVersion: 2,
  tier: "T3",               // or "T2"
  name: "sentry",
  async fetch({ env, since }) {
    const token = env("SENTRY_AUTH_TOKEN");       // gated accessor
    // ... returns normalized {events, summary} payload
  },
  formatContext(payload) {
    // returns markdown for prompt injection
  },
};
```

The runtime adds a new key (`sentry`) to the T3 payload alongside
`vercel` / `supabase`. `formatExternalKnowledgeContext` (or a new
`formatGroundTruthContext` pathway) concatenates the plugin's
rendered block.

### 5.4 Scheduled tasks

```js
module.exports = {
  apiVersion: 2,
  name: "sentry-digest",
  cron: "0 9 * * *",        // 09:00 daily
  async run({ ctx }) { /* ... */ },
};
```

The runtime writes these into
`~/.solo-cto-agent/scheduled-tasks.yaml` and hands them to the
existing `scheduled-tasks` MCP.

---

## 6. Context object (`ctx`)

Every plugin entry point receives a `ctx` with these methods (scoped
by declared capabilities):

| Method | Capability required | Returns |
|---|---|---|
| `ctx.env(name)` | `env:<name>` | `string \| null` |
| `ctx.fetch(url, opts?)` | `net:<host>` | `Response` |
| `ctx.fs.read(relPath)` | `fs:read:<glob>` | `Buffer` |
| `ctx.fs.write(relPath, data)` | `fs:write:<glob>` | `void` |
| `ctx.output.json(obj)` | — | prints to stdout |
| `ctx.output.text(str)` | — | prints to stdout |
| `ctx.log.info/warn/error(msg)` | — | logs via standard channel |
| `ctx.review.addNote(note)` | `hook:pre-review` / `hook:post-review` | appends to review metadata |

Anything else (e.g. direct `process.env`, raw `https`) is
unsandboxed — the runtime does not prevent it but surfaces a warning
in `solo-cto-agent doctor`.

---

## 7. Lifecycle & versioning

- `apiVersion: 2` is required at every entry point. A plugin without
  it is refused.
- Plugins declare `"agents": [...]` — runtime checks against the
  current agent identity (see `buildIdentity`) and refuses mismatches.
- Breaking changes bump `apiVersion`. v1 implicit-skill directories
  remain supported indefinitely.
- Plugin packages should carry an `engines.solo-cto-agent` field for
  compat bounds. Out-of-range plugins get a visible warning but are
  still loaded (until the next major release, when they're refused).

---

## 8. Marketplace story

Not part of v2 core, but the manifest is forward-compatible with a
marketplace:

- Discoverability: plugins that list a `soloCtoAgent.category` (one of
  `"external-signal"`, `"review-hook"`, `"cli"`, `"scheduled"`) show
  up in `solo-cto-agent plugin search`.
- Trust: `solo-cto-agent plugin add` computes SRI over the on-disk
  files and compares to an optional `integrity` field in the manifest.
- Distribution: plain `npm` registry. No custom server.

---

## 9. Migration path for existing code

| Today | v2 |
|---|---|
| `skills/<name>/SKILL.md` (prompt-only) | unchanged — v1 keeps working |
| Ad-hoc T3 fetcher patched into `cowork-engine.js` | provider plugin (§5.3) |
| PR-review bash wrapper that calls `solo-cto-agent review --local` | CLI plugin (§5.1) |
| Hand-rolled `redact.sh` piped before `review` | pre-review hook (§5.2) |
| Cron job that runs `review` on a repo | scheduled task plugin (§5.4) |

For each migration, the new form is strictly additive — no existing
feature is removed.

---

## 10. Open questions

1. **Multi-agent test harness.** How do we CI-run `agents: ["claude"]`
   plugins without a real Claude API key? Current thinking: provide a
   mock `ctx` that stubs `fetch` and asserts capability checks, shipped
   in `@solo-cto-agent/plugin-testkit`.
2. **Hot-reload during dev.** A plugin author changes their file —
   should the watcher pick it up? Leaning YES for `pre-review` hooks
   (cheap), NO for providers (cache warming).
3. **Per-project vs global plugins.** Should a repo-local
   `.solo-cto-agent/plugins.json` override the user-global one? Most
   likely yes for reproducibility, but it needs a merge rule.
4. **Telemetry / feedback loop.** Do we measure plugin performance
   (error rates, latency, contribution-to-false-positive rate)? Candidate
   for PR-G8.

---

## 11. Next steps

- **Before v2 is cut into code:** land PR-G6-impl which adds
  `plugin list / add / remove` scaffolding (filesystem-only, no
  runtime loading yet) so the API shape can be exercised.
- Solicit one external plugin author (Sentry or Datadog T3) to
  stress-test §6 and §5.3 against a real payload.
- Freeze the manifest shape by v0.8.0; cut v2 at v0.9.0.

Feedback welcome via GitHub issues tagged `plugin-api-v2`.
