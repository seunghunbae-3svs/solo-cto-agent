# Reporting Format

A good deploy report includes:

```text
- target environment
- status
- preview URL (if available)
- likely cause
- attempted fixes
- remaining blocker
- next recommended action
```

## Example

```text
Deploy target: preview
Status: failed
Likely cause: missing STRIPE_WEBHOOK_SECRET
Attempted fixes: verified build logs, confirmed env reference, no secret found
Preview URL: not generated
Recommendation: add secret, redeploy, re-check checkout callback flow
```

## Key points

- Be specific about what failed, not vague.
- List what you tried and what you learned.
- Distinguish between "preview looks good" and "production is safe".
- If rollback is being recommended, say why and which version/commit to roll back to.
