# Failure Classification

Common buckets when a deploy fails:

```text
- code/build error
- missing environment variable
- bad framework/deploy config
- dependency or package install issue
- migration or database mismatch
- auth / callback / domain mismatch
- external provider outage or platform issue
```

The point is to fix the right layer, not just change code because code is nearby.

When classifying, read the actual signal first. Do not guess blindly from the word "failed."

Look at:
- the specific line in the build log where the error occurred
- whether the error message is from your app or the platform
- whether this is a runtime error or a build-time error
- what changed in the commit or environment
