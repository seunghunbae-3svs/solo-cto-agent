# Architect Phase — Detailed Guidance

## Before changing code:

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

## Questions to resolve early:

* Is there a migration involved?
* Is there a new environment variable?
* Is there a new dependency?
* Is there a platform or webhook configuration change?
* Is the build command still valid after this change?
* Is there a deployment risk that should be surfaced before coding?

If the answer is yes, handle it early.
