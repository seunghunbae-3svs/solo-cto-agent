# Release with idempotent npm publish

Tier: Builder / CTO - Agent: Cowork - Mode: Semi-auto (tag) + Full-auto (CI publish)

## Input

You have unreleased work in `main`. You want to cut `v1.2.0`, publish to npm, and create a GitHub release ->and you want the whole thing to be safe to re-run if CI fails halfway.

```text
release v1.2.0
```

## Agent behavior

1. **`ship` skill** confirms pre-release state:
   - `main` is clean.
   - Tests green on latest CI run (`gh run list --limit 1 --workflow test.yml` ->success).
   - `package.json` version is `1.1.3` (one minor behind).
2. Agent drafts a CHANGELOG entry by parsing commits since the last tag (`git log v1.1.3..HEAD`), grouping by conventional-commit prefix, and producing:

   ```markdown
   ## [1.2.0] ->2026-04-14

   ### Added
   - examples/ directory with real-world usage flows (#64)
   - docs/claude.md primary tool entry point (#64)

   ### Changed
   - README restructured around tool entry points (#64)
   - wizard default editor ->cowork (#64)

   ### Fixed
   - validate-package.js: drop removed legacy rule files (#64)
   ```

   Shows the draft. You confirm (L2 ->execute on confirm).
3. Agent runs:

   ```bash
   # bump
   npm version 1.2.0 --no-git-tag-version

   # stage + commit
   git add package.json package-lock.json CHANGELOG
   git commit -m "release: v1.2.0"

   # tag
   git tag v1.2.0 -m "Release v1.2.0"

   # push branch + tag in one operation
   git push origin main
   git push origin v1.2.0
   ```
4. The `v1.2.0` push triggers `.github/workflows/release.yml`:
   - Checkout, setup-node with `registry-url: https://registry.npmjs.org`.
   - `npm install --no-audit --no-fund` (no committed lockfile).
   - **Version parity check** ->refuses to publish if `package.json` version does not match the tag.
   - `npm test`.
   - **Idempotent publish**:

     ```bash
     if npm view "solo-cto-agent@1.2.0" version >/dev/null 2>&1; then
       echo "already published ->skipping."
     else
       npm publish --access public
     fi
     ```
   - `softprops/action-gh-release@v2` creates the GitHub release using the CHANGELOG `[1.2.0]` section as the body.
5. CI runs green. Agent reports:

   ```text
   RELEASE v1.2.0 ->SHIPPED
     npm           https://www.npmjs.com/package/solo-cto-agent/v/1.2.0
     github        https://github.com/seunghunbae-3svs/solo-cto-agent/releases/tag/v1.2.0
     run           https://github.com/seunghunbae-3svs/solo-cto-agent/actions/runs/<id>
   ```

## Output

Committed artifacts:

- `package.json` bumped to `1.2.0`
- `CHANGELOG` with a new `[1.2.0]` section
- Tag `v1.2.0`
- npm package `solo-cto-agent@1.2.0` live
- GitHub release `v1.2.0` published

## Pain reduced

**The re-run failure mode.** `npm publish` fails the second time it is invoked for the same version ->usually because CI flaked on a later step (GitHub release creation, a secondary artifact upload). Without the idempotent pre-check, you have to either bump the version (`1.2.1` with no real content) or manually skip the publish step. This release step is safe to re-run via `workflow_dispatch` ->it will no-op on npm and retry everything downstream.

Secondary pain: **CHANGELOG drift.** Writing the entry by hand is what gets skipped when you are tired, which is exactly when you should not skip it. Generating it from conventional-commit history keeps the log honest and reviewable, and you can still edit the draft before the commit.

Tertiary pain: **tag / package.json mismatch.** Pushing `v1.2.0` while `package.json` says `1.1.3` is a common silent bug. The version parity check in `release.yml` fails the CI run instead of publishing the wrong version.

