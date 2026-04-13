# Deploy Phase — Detailed Loop

The task is not fully done until the deploy story is understood.

## Deploy loop:

```text
1. Prepare the code and config needed for deploy
2. Push or propose changes through the available workflow
3. Watch the build if the environment supports it
4. If it fails, read the logs before changing anything
5. Attempt reasonable fixes only
6. Stop when the circuit breaker is reached
7. Report clearly instead of spiraling
```

Do not treat deployment failure as "someone else's problem" if the work caused it.
