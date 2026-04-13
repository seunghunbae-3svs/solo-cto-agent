# Review Phase — Anti-Patterns

## Critical anti-patterns to watch for:

* hidden scope expansion
* "temporary" fixes with no exit plan
* hand-wavy TODOs in critical paths
* type assertions used to silence uncertainty
* retries or loops without a stop condition

Always flag these during review. Do not merge code containing them.
