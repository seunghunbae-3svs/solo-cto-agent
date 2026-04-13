# Batch Automation Guidance

When access is available, apply configuration directly.

## Examples:

* env vars on the deploy platform
* local `.env` updates
* CI secret insertion where the environment allows it
* repeated config across multiple repos

## When access is not available:

* ask once
* state exactly what is missing
* group the required setup into one batch
* avoid vague "please configure this somewhere" guidance

## Preferred summary format:

| target | item           | action            | status  |
| ------ | -------------- | ----------------- | ------- |
| repo-a | `DATABASE_URL` | set in deploy env | done    |
| repo-b | `DATABASE_URL` | waiting on access | blocked |
