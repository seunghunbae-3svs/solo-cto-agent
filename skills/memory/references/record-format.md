# Memory Record Format — Detailed Template

## Standard Memory Record Structure

A useful memory record should contain:

```text
- topic
- type: decision / pattern / preference / open-thread
- summary
- why it matters
- evidence or trigger
- when to revisit
```

### Example: Deploy Auth Callback Mismatch

```text
Topic: deploy auth callback mismatch
Type: pattern
Summary: auth-related preview failures are often callback URL mismatches, not code issues
Why it matters: saves debug time
Trigger: appears after domain or auth provider changes
Revisit: if auth provider or deploy platform changes
```

### Example: Framework Choice (Decision)

```text
Topic: Next.js as primary framework
Type: decision
Summary: chose Next.js 14+ with App Router for SSR + API routes
Why it matters: consolidates backend + frontend; reduces deploy complexity
Trade-off accepted: learning curve for App Router patterns; less flexible for pure static sites
Revisit: if project becomes primarily client-side or needs heavy server-side computation
```

### Example: User Preference

```text
Topic: approval gate for production changes
Type: preference
Summary: user wants explicit approval before any production deployments
Why it matters: prevents accidental live changes
Implementation: always ask for confirmation before git push/deploy
Revisit: if governance model changes
```

### Example: Open Thread (Known Gap)

```text
Topic: auth database schema cleanup
Type: open-thread
Summary: current schema has redundant user_profile table; needs migration but low priority
Why it matters: affects future user feature scaling
Status: acknowledged, deferred to phase 2
Revisit: when adding new user attributes or multi-tenant support
```

## Compression Principles

If the same thing comes up multiple times:

1. **Stop storing raw repetition** — don't keep five similar logs
2. **Compress into a general rule** — extract the underlying pattern
3. **Keep the shortest useful version** — memory should get sharper, not just larger

Example of compression:

**Bad (raw repetition):**
```
- Deploy 1: callback URL still pointed to localhost
- Deploy 2: callback URL still pointed to localhost
- Deploy 3: callback URL still pointed to localhost
```

**Good (compressed):**
```
Topic: pre-deploy callback URL check
Type: pattern
Summary: deploy auth failures are almost always callback URL mismatches before code issues
Trigger: any auth-related test failure after domain or provider change
Revisit: each deploy to new environment
```

## Anti-Patterns in Records

- ❌ Storing vague summaries with no future use
- ❌ Keeping raw noise instead of compressing lessons
- ❌ Treating temporary confusion as durable memory
- ❌ Remembering facts but not the reason behind them
- ❌ Re-asking the user something that was already settled clearly
