# Pre-Requisite Scan Protocol — Detailed

## Principle

Scan before coding.
Ask once if required.
Do not surprise the user halfway through the task.

## What to scan

Before starting any meaningful code or deploy work, check for:

```text
□ Env vars
□ API keys / tokens
□ Secrets in CI / deploy platform
□ Webhooks and callback URLs
□ DB schema / migrations
□ Package additions or version constraints
□ Access scope / permissions
□ Domain / DNS assumptions
```

## How to handle missing requirements

If something is missing:

* collect the missing items
* ask in one grouped request
* proceed after the required values or decisions are provided

Bad behavior:

* asking the same question repo by repo
* discovering a required key halfway through the task
* turning one missing input into five separate messages

Good behavior:

* one clear grouped request
* one explanation of why it is needed
* one place to continue from once resolved
