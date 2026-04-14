# Drive-Run Benchmarks — Empirical Proof of the Self-Loop Thesis

> The thesis: same-model + same-user + same-diff produces correlated blind spots. External contact (running the tool against repos it was not developed in) is the only reliable way to surface those blind spots. The numbers below are the raw evidence.

---

## Setup

- **Tool version**: `solo-cto-agent@1.0.0-dev` (HEAD of `main` at time of each drive-run)
- **Internal loop**: 236 tests passing on the development machine, CI all-green, self cross-review enabled
- **External contact**: four live repos outside the `solo-cto-agent` working tree, each checked out from GitHub and reviewed with the CLI as a real user would

| Target repo | Stack | Default branch | Root layout |
|---|---|---|---|
| Tribo Store | Next.js 14 + Prisma + Supabase | `master` | `package.json` at root |
| palate-pilot | Next.js 15 monorepo | `main` | `package.json` under `apps/web/` |
| 3stripe-event | Next.js + Firebase | `main` | `package.json` at root |
| golf-now | Next.js 14 + Supabase | `main` | `package.json` at root |

---

## Drive-Run #1 — Tribo (master-default repo)

**Invocation**
```bash
cd tribo-store
solo-cto-agent review --staged --markdown
```

**Outcome before PR-F1**

| Bug ID | Surface | Who caught it |
|---|---|---|
| B1 | `git diff main...HEAD` — hardcoded `main` base branch, fatal on Tribo's `master` | External drive-run only. 236 internal tests missed. |
| B2 | No `--target <base>` override — can't diff against `develop` or any other base | External drive-run only. |
| B3 | `--dry-run` suppressed the self-loop warning (SELF-LOOP notice gated on API call path) | External drive-run only. |
| B4 | README documented flags (`--diff`, `--output`, `--file review.md`) that did not exist | External drive-run only. |
| B5 | `review --json \| jq .verdict` broken — banner polluted stdout, jq parse error | External drive-run only. |

**Internal loop bugs found**: 0 (all 236 tests were green).
**External loop bugs found**: 5.

### T2 live signal on Tribo
- Dependencies scanned: **20 of 37**
- Major version behind: **2**
- Minor version behind: **2**
- Deprecated: **1**
- Fetch latency: ~1.3s

### Self-cross-review on Tribo
- Primary pass: 3 SUGGESTION, 2 NIT, `verdict: COMMENT`
- Devil's advocate pass: found `thum.io` external image service exposed in new code — upgraded to BLOCKER
- Cross verdict: `PARTIAL`, final verdict upgraded to `REQUEST_CHANGES`
- Observation: the devil's advocate pass caught a security-relevant issue the primary pass did not. Same model family, different persona. This is T1 operating within a single model by bias split — weaker than peer-model T1 but non-zero.

---

## Drive-Run #2 — palate-pilot (nested package.json)

**Invocation**
```bash
cd palate-pilot
COWORK_EXTERNAL_KNOWLEDGE=1 solo-cto-agent review --staged --markdown
```

**Outcome — the F2-A bug**

The env flag was set. The review output reported `Active external signals: 1/3`. Inspection of the saved review JSON showed no `externalKnowledge` payload. The scanner looked at the repo root for `package.json`, found none (it is under `apps/web/package.json`), and silently returned no data. The review summary nonetheless counted T2 as active.

**This is the worst possible failure in an honesty system — a lie about its own coverage.** It was invisible to every internal test in the repo because every internal test ran from a root-level `package.json`.

**Bug classification**: F2-A — silent T2 no-op with false-positive active-count.
**Who caught it**: External drive-run only. Internal test suite (now 236 tests, 21 files) had no fixture for missing / nested `package.json`.

---

## Drive-Run #3 — 3stripe-event

**Invocation**
```bash
cd 3stripe-event
COWORK_EXTERNAL_KNOWLEDGE=1 solo-cto-agent review --staged --markdown
```

Confirmed F2-A independently. No additional bugs surfaced beyond F2-A class.

---

## Drive-Run #4 — golf-now (clean-case control)

**Invocation**
```bash
cd golf-now
COWORK_EXTERNAL_KNOWLEDGE=1 solo-cto-agent review --staged --markdown
```

### T2 live signal on golf-now
- Dependencies scanned: **6 of 6**
- Major version behind: **1**
- Minor version behind: **1**
- Deprecated: **1**
- Fetch latency: ~0.4s

Outcome: T2 fully operational. No new bugs surfaced. This establishes that PR-E2 (T2 fetch) works end-to-end against a clean-case repo, confirming that F2-A is specifically a root-layout assumption bug, not a general T2 failure.

---

## Aggregate — Internal vs External Loop

| Metric | Internal loop only | Internal + External loop |
|---|---|---|
| Total bugs detected in PR-F series | 0 | **6** |
| Critical issues surfaced | 0 | 2 (B1, F2-A) |
| Test coverage gaps identified | 0 | 4 (non-`main` default, pipe-safety, dry-run signal, nested layout) |
| Documentation bugs identified | 0 | 1 (B4) |
| Time to surface all 6 bugs from zero | ∞ (never) | ~10 minutes per drive-run × 4 repos |

**Internal loop detection rate for bugs present at commit of v1.0.0-rc**: 0 / 6 = **0%**.
**External contact detection rate**: 6 / 6 = **100%**.

The internal loop was not lazy — 21 test files, 247 tests, CI-gated, self cross-review enabled, full-coverage review of every PR. It simply could not see these bugs because they were all failures of its own working assumptions, and the tests encoded the same assumptions.

---

## What this demonstrates

1. **A single-model review loop cannot find its own structural blind spots.** This is not a claim about Claude specifically — any single-model setup inherits its own biases into its reviewer.
2. **External contact is cheap and high-yield.** Four repos, forty minutes, six bugs, two of them critical. Cost per bug: approximately 7 minutes of human time.
3. **Honesty systems themselves must be tested externally.** The F2-A bug was a *dishonest* honesty system — it lied about its own coverage. No internal test could have caught it because no internal test ran without `package.json` at root.
4. **The three-tier framework is not optional.** T1 (peer model), T2 (external knowledge), T3 (ground truth) each surfaced bugs that the others could not. Removing any tier reduces the detection surface.

---

## Reproducibility

All four target repos are private, so this benchmark is not externally reproducible by third parties without access. However:

- The CLI commands above are exact and verbatim
- The F2-A bug has an added regression test in `tests/signal-honesty.test.mjs` (11 new cases) since PR-F2
- The B1-B5 bugs have regression tests in `tests/drive-run-fixes.test.mjs` (11 new cases) since PR-F1
- Anyone with two or more of their own repos running on Vercel + any Node stack can reproduce the external-signal validation

**Call to action**: if you run `solo-cto-agent review` against your own repos and find a case that the internal loop missed, open an issue labelled `drive-run`. The next benchmark will be yours.

---

## Methodology notes

This benchmark is deliberately low-sample (n=4 repos) and biased (all repos are authored by the same engineer as the tool). The claim is not "we have measured AI review quality in general." The claim is narrower and falsifiable: **this specific tool, at HEAD of main before PR-F1 and PR-F2, had six bugs that its internal loop did not surface and external contact did surface.** That claim is verifiable against the commits and regression tests listed above.

Bigger claims require bigger samples. If the community is interested in that, the infrastructure is in place — `benchmarks/` is a directory, not a ceiling.
