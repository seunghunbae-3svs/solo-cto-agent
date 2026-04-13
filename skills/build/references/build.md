# Build Phase — Detailed Guidance

## When coding:

```text
1. Make the smallest safe change that solves the task
2. Keep imports real and local
3. Avoid unnecessary refactors unless they remove direct risk
4. Run type checks / build checks where appropriate
5. Record changed files and why they changed
```

## Practical rules:

* Prefer boring code that is easy to verify over clever code.
* Do not introduce new abstractions unless they pay for themselves immediately.
* If the environment cannot run a full build safely, do the highest-signal validation available and say so clearly.
* If a fix touches a risky area, leave a short risk note.
