# Recovery Loop

Use a bounded loop when attempting to fix a deploy failure:

```text
1. inspect logs
2. identify likely root cause
3. apply the smallest safe fix
4. redeploy or retry
5. compare outcome
6. stop if the same failure repeats
```

### Key rules

- Do not make unrelated cleanup changes inside a deploy-fix loop.
- Stop immediately if the same error repeats without new evidence.
- If one fix creates multiple new failures, stop and escalate (circuit breaker).
- Each iteration should have a specific hypothesis, not a blind retry.
- Track what you've changed so you can clearly report it.
