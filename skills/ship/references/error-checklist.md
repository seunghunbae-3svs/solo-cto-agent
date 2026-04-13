# Build/Deploy Error Checklist

Before applying fixes, check:

```text
□ Is the failure from the app or the platform?
□ Did the task introduce a new env var or callback?
□ Did the build command change?
□ Did package versions change?
□ Did a migration or DB expectation change?
□ Is the project root / framework preset correct?
□ Is the preview URL actually for the right branch/build?
```

These questions help classify the root cause and point you to the right fix layer.
