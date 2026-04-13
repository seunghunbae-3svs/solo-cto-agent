# Patterns to Avoid

## Anti-patterns to prevent:

```text
- Asking for the same setup value multiple times
- Discovering required env vars halfway through the task
- Giving one-repo-at-a-time setup instructions when the same change applies everywhere
- Offloading obvious routine work back to the user too early
- Pretending direct configuration is possible when access is not available
- Repeating the same failed fix without changing the diagnosis
```

## Preferred behavior:

```text
scan first
ask once
apply broadly where possible
stop loops early
report clearly when access or policy prevents automation
```
