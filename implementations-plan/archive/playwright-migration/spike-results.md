# Spike results — Puppeteer → Playwright migration

**Date:** 2026-05-17
**Duration:** ~45 minutes (vs ~4–6h budget — concluded early on decisive data)
**Branch:** `spike/playwright-step-a` (no source changes merged; all spike edits reverted)
**Raw logs:** `spike-logs/{baseline,scope-flip,pool-forks,victims-isolated}.log`
**Status board (live during spike):** `spike-logs/STATUS.md`
**Codex implementation review:** session `019e37d5-3049-7602-a1c5-17f7b9b6b0dc`, response at `/var/folders/p9/.../codex-ZJoaueSu/response.md`. Verdict: marginally sound; direction is right but conclusions overstated. Corrections applied throughout this document; see §"Codex review corrections" at end.

## TL;DR — DO NOT MIGRATE TO FIX FLAKES (H2 untested)

The cumulative-load failure mode lives in **shared-run infrastructure**
that persists across the suite's 45 test files — most likely the Aztec
sandbox, possibly also anvil, the shared playground dev server, or
host-resource drift (browser FD count, RAM pressure). Three runs are
enough to **falsify two of the three cheap theories** (extension-side
and Node-process-side); confirming WHICH shared component is the
specific bottleneck requires one more cheap experiment (split-batch
fresh sandbox — see §follow-ups). A Puppeteer → Playwright migration
has zero leverage against any of the surviving candidates.

**Recommendation:** park the migration AS A FLAKE-RELIABILITY FIX.
The migration's secondary hypothesis (H2 — Playwright auto-wait
locators retire ~315 LOC of CDP workaround helpers) was **NOT tested
in this spike** and should be either (a) explicitly closed as
not-worth-the-effort, or (b) tested independently by porting one
representative smoke test. Don't conflate "won't fix flakes" with
"don't migrate, period".

The system's run-to-run "load roulette" (5–8 failures per run, mostly
different tests each run) is a property of accumulating state in some
shared component. Local-full-suite remains infrastructure-bound; CI
is fine (fresh containers per job). Pursue the split-batch follow-up
if/when local friction warrants investment.

## What was tested

| # | Configuration | Hypothesis tested | Cost |
|---|---|---|---|
| 1 | Baseline (status quo, dev branch) | Establish failure pattern | 12 min |
| 2 | `dappConnectedExtension` scope: `file` → `test` | Theory 1: extension/browser state pile-up | 13 min |
| 3 | `vitest.e2e.network.config.ts` add `pool: "forks"` + `isolate: true` | Theory 2: Node/vitest process state pile-up | 13 min |
| – | Isolation of suspected victims (control) | Confirm cumulative-load behavior vs real bugs | 1 min |

## Run-by-run results

### Run 1 — Baseline (file-scope, status quo)

```
Test Files:  5 failed | 38 passed | 2 skipped (45)
Tests:       5 failed | 54 passed | 2 skipped (61)   [89% pass]
Wall-clock:  745s
```

Failures (all verified from `spike-logs/baseline.log`):
- `meta-getAccounts-pregrant` — `Timed out after waiting 15000ms` (popup wait)
- `data-addressBook` — `Timed out after waiting 15000ms` (popup wait)
- `multi-account-from` — `Timed out after waiting 15000ms` (popup wait)
- `authwit-innerHash` (in `authwit-variants.test.ts` — file has 2 tests, only innerHash fails) — `Timed out after waiting 15000ms`
- `meta-getChainInfo` — `waitForFunction failed: frame got detached` (CDP-shaped, not a 15s timeout)

All five failures except meta-getChainInfo are the same 15s-timeout shape.

### Isolation check (1-min control)

- `meta-getAccounts-pregrant`: **PASSED alone** (8.3s) → cumulative-load
  confirmed for this test.
- `data-addressBook`: **FAILED alone** with `frame got detached` (not a
  timeout) → reclassified as a separate Puppeteer/CDP-shaped bug, NOT
  cumulative load.

### Run 2 — Scope-flip (Theory 1 test)

Edit applied to `packages/extension/tests/e2e/fixtures/extension.ts`:

```diff
- dappConnectedExtension: [
-     async ({ registeredExtension }, use) => { ... shared ctx ... },
-     { scope: "file" },
- ],
+ dappConnectedExtension: [
+     async ({}, use) => { ... fresh launchExtension per test ... },
+     { scope: "test" },
+ ],
```

Mirrors the existing `dappConnectedExtensionPerTest` semantics. All 34
files using `dappConnectedExtension` now get a fresh browser per test.

```
Test Files:  3 failed | 40 passed | 2 skipped (45)
Tests:       5 failed | 54 passed | 2 skipped (61)   [89% pass]
Wall-clock:  764s   (+2.5%)
```

Failures (completely different set from baseline):
- `fee-methods` × 3 (transfer pub FJ / transfer priv FJ / gas balance)
- `meta-getAccounts` — non-pregrant variant
- `tx-sendTx-multicall-chunked`

**Outcome:** same failure COUNT, completely different failure SET. This is
the canonical signature of a "load budget" — the system can tolerate ~5
failures' worth of load before something pops; which specific tests get
caught is luck of the order. **Theory 1 falsified: extension-side fixture
scope is not the bottleneck.**

### Run 3 — pool=forks (Theory 2 test)

Edit applied to `packages/extension/vitest.e2e.network.config.ts`:

```diff
  testTimeout: 30_000,
  hookTimeout: 300_000,
  fileParallelism: false,
+ pool: "forks",
+ poolOptions: {
+     forks: { singleFork: false, isolate: true },
+ },
```

Each test file gets its own forked Node worker process. Matches the
pattern smoke config has used since the parallel-isolation work
(`vitest.e2e.config.ts:28-33`).

```
Test Files:  6 failed | 37 passed | 2 skipped (45)
Tests:       8 failed | 51 passed | 2 skipped (61)   [84% pass — WORSE]
Wall-clock:  795s   (+6.7%)
```

Failures (different again, plus 3 more):
- `fee-methods` × 3
- `tx-sendTx-multicall` (different variant from run 2)
- `tx-sendTx-sponsoredFpc`
- `contracts-register`
- `meta-getAccounts-pregrant` (back to failing — load-roulette caught it again)
- `contacts-sender` edit-flip-OFF (this is the Cluster C wallet bug from triage)

**Outcome:** MORE failures (8 vs 5). The fork-per-file process isolation
adds re-init overhead per file (each worker re-imports modules, re-warms
the vitest module cache, etc.), which appears to push more tests over
timeout thresholds. **Theory 2 falsified as a fix:** host/Node process
isolation does not improve reliability and may hurt it. Note: this
result could also be partially explained by altered scheduling /
ordering effects rather than purely "more load", so the interpretation
needs the caveat that N=1 makes a single run insufficient for strong
causal claims. (See codex review correction in §end.)

## Cross-run failure shift (the smoking gun)

**Fourteen** unique tests across the three runs participated in the failure
roster at least once. Each individual run failed 5–8 tests, but the
OVERLAP between runs is small:

```
                                       Baseline   Scope-flip   pool=forks
authwit-variants                       FAIL       pass         pass
data-addressBook                       FAIL       pass         pass
meta-getAccounts-pregrant              FAIL       pass         FAIL
meta-getChainInfo                      FAIL       pass         pass
multi-account-from                     FAIL       pass         pass
─────────────────────────────────────────────────────────────────────
fee-methods · transfer public FJ       pass       FAIL         FAIL
fee-methods · transfer private FJ      pass       FAIL         FAIL
fee-methods · gas balance non-zero FJ  pass       FAIL         FAIL
meta-getAccounts (non-pregrant)        pass       FAIL         pass
tx-sendTx-multicall-chunked            pass       FAIL         pass
─────────────────────────────────────────────────────────────────────
tx-sendTx-multicall                    pass       pass         FAIL
tx-sendTx-sponsoredFpc                 pass       pass         FAIL
contracts-register                     pass       pass         FAIL
contacts-sender · flip OFF migration   pass       pass         FAIL
```

Notes:
- The `fee-methods` × 3 cluster failed in BOTH scope-flip and pool=forks
  but PASSED in baseline. That's the most consistent signal of the three
  runs: these tests are near-threshold and sensitive to ANY added setup
  overhead. The actual error shape is `Waiting failed: 60000ms exceeded`
  (a 60-second wait in `feeJuiceImportedExtension.scope` or similar
  fixture-setup polling) — **NOT** the `mdb_txn_begin: 22` LMDB error
  cited in `network-test-triage/plan.md` Cluster B (an earlier draft of
  this document conflated the two). The triage plan's Cluster A and B
  both involve 60s waits, so this failure is consistent with EITHER
  cluster being tickled by load, but the exact mapping was not verified
  in this spike.
- `contacts-sender · flip OFF` (Cluster C in triage) surfaced only in
  pool=forks. Plausible explanations: (a) slower setup gave the
  underlying race more chances to land, or (b) random run-to-run
  variance. With N=1 this single appearance is weak evidence either way.
- `meta-getAccounts-pregrant` is the cleanest cumulative-load case
  via isolation: passes alone, passes in scope-flip, fails in baseline
  AND pool=forks. The fact that it CAN pass under some perturbation
  (scope-flip) but fail under others (baseline, pool=forks) suggests
  ordering noise more than a deterministic load mechanism on this
  specific test — though the cumulative-load category is reinforced.

## Run 4 — Split-batch fresh-sandbox control (codex-recommended)

Ran the late-half files (baseline positions 23-45, 23 files) on a brand
new `bun run e2e:agent` invocation (fresh sandbox, no early-half tests
running before them). Goal: directly test whether the late-run failures
in baseline (data-addressBook, meta-getAccounts-pregrant) were caused by
shared-run accumulation. If they pass fresh, accumulation is confirmed.

```
Test Files:  3 failed | 18 passed | 2 skipped (23)
Tests:       3 failed | 18 passed | 2 skipped (23)   [78% pass]
Wall-clock:  265s
```

Failures (none overlap with baseline's late-half failures):
- `batch-mixed` (baseline position 31, baseline: PASS, here: FAIL 22s timeout)
- `cap-request-rerequest` (baseline position 23, baseline: PASS, here: FAIL 22s)
- `wallet-locked-mid-session` (baseline position 30, baseline: PASS, here: FAIL 22s)

Did the baseline's late-half victims pass in the fresh split-batch?
- `data-addressBook` (baseline: FAIL frame-detach): **PASS in fresh split-batch**
- `meta-getAccounts-pregrant` (baseline: FAIL timeout): **PASS in fresh split-batch**

**Outcome — this CONTRADICTS the strong "shared-run accumulation"
hypothesis.** A clean accumulation story would predict fewer failures
in the fresh split-batch than in baseline's late-half. Instead:
- Baseline late-half (positions 23-45 with accumulated early-half state):
  2 failures out of 23 files = 91% pass rate
- Split-batch (same 23 files, fresh sandbox, no early-half state): 3
  failures = 78% pass rate

More failures with LESS prior state. The failure set is completely
disjoint from baseline late-half. This is the signature of high-variance
popup-setup latency colliding with a tight 15s timeout — NOT monotonic
state accumulation.

## Revised interpretation (post-codex review + split-batch)

The bottleneck is **NOT a clean shared-run accumulation pattern**. The
data fits "high-variance popup setup latency catching a tight 15s
timeout" better than "state grows over time". Evidence:

1. Failure COUNT is roughly constant across runs (5-8 per run regardless
   of run length: 5 in 45-file baseline, 5 in 45-file scope-flip, 8 in
   45-file pool=forks, 3 in 23-file split-batch).
2. Failure SETS are nearly disjoint across all 4 runs (14 unique tests
   in the roster across the 3 full-suite runs, +3 more in split-batch).
3. Specific known-victim tests (`meta-getAccounts-pregrant`) DO pass in
   fresh sandbox runs, suggesting they ARE somewhat load-sensitive — but
   the load that catches them isn't a clean function of "prior test
   count" (the split-batch had 22 prior tests in this run and the test
   still passed at position 18).

Most plausible explanations remaining:

| Hypothesis | Support | Disconfirmation |
|---|---|---|
| **Pure popup-setup latency variance (the "wide tail")** | 4 runs, ~5-8 failures each, disjoint sets, all popup-timeout-shaped | None so far — best fit |
| **Mild shared-run accumulation overlaid with variance** | meta-getAccounts-pregrant passes alone+split-batch but fails in full run | Variance interpretation also fits |
| **Aztec sandbox accumulation (strong form)** | Fits architectural intuition | Contradicted by split-batch showing failures with much less state |
| **Aztec PXE per-request slowness (not accumulation)** | Fits the disjoint-failure pattern | Need direct PXE timing measurement |

The previous "Theory 3 wins by elimination" framing **was wrong**.
Eliminating Theory 1 and Theory 2 narrows the hypothesis space but
doesn't pin it on Theory 3-strong. The cleanest description of the data
is: "the popup-discovery / capability-grant flow has high latency
variance that the 15s timeout catches the tail of, with weak
additional sensitivity to prior in-suite work."

## Architectural breakdown (kept for reference, but no longer load-bearing)

The "what could possibly accumulate" table is still useful as a map of
candidates, even though the spike doesn't confirm any of them as the
bottleneck:

| Component | Lifetime | Is this the bottleneck? |
|---|---|---|
| Test files | each runs to completion serially | No (testbed) |
| Vitest Node process | one for the run (without pool=forks); one per file (with) | NO — pool=forks made it worse |
| Puppeteer browser | fresh per file (or per test with scope-flip) | NO — scope-flip didn't help |
| Extension IndexedDB | bound to browser user-data-dir; fresh per launch | NO (same as browser) |
| **Aztec sandbox PXE + LMDB** | spawned once at globalSetup, serves ALL files | **Strongest candidate** — state grows monotonically |
| Anvil L1 chain process | spawned once, serves ALL files | Possible — block count grows |
| Playground dev server (Vite) | spawned once, serves ALL files | Possible — module graph + HMR state |
| Browser FD / port pressure (host) | OS-level | Possible — re-launches accumulate sockets |
| /tmp filesystem state | OS-level (data dirs) | Unlikely — each launch uses fresh tmpdir |

The split-batch experiment (Run 4 above) actively WEAKENED this list:
even a fresh sandbox + small batch still produced 3 disjoint failures.
The accumulation candidates aren't ruled out, but they're not the
dominant story either. **Net: bottleneck is most likely intrinsic
variance in the popup-discovery flow under sandbox load, with weak
secondary sensitivity to prior work.**

## Decision

**Park the Playwright migration as a fix for full-suite flakes.** The
migration's secondary justification (H2 — helper-LOC reduction via
Playwright auto-wait locators) was NOT tested in this spike and remains
an open question.

Reasoning (updated after split-batch):
- The failure pattern is high-variance popup-setup latency, not browser
  state accumulation. A browser-automation library swap has no leverage
  against a latency-variance phenomenon — both Puppeteer and Playwright
  drive the same Chrome which drives the same wallet-extension which
  talks to the same Aztec sandbox.
- The cheap Theory-1 (scope flip) and Theory-2 (fork-per-file) fixes
  don't reduce failure count.
- The split-batch fresh-sandbox control shows that even fresh-state
  runs produce ~3 disjoint failures, so neither "fix the sandbox"
  nor "swap the runtime" will eliminate the failures alone.
- The 18 known failures in `network-test-triage/plan.md` are real
  wallet bugs and need separate investigation.

**Updated direction (recommended):**

1. Park the migration as a flake-reliability fix.
2. Decide explicitly on H2 (helper-LOC reduction): either close it
   ("the LOC savings aren't worth a multi-day port") OR port ONE
   representative test (e.g. `tests/e2e/registration.test.ts`) and
   measure the LOC delta. Cost: 1–2h.
3. Continue treating CI as the authoritative gate (fresh containers
   per job sidestep the whole phenomenon).
4. If local-full-suite reliability is desired, the most leverage is
   on the popup-discovery latency itself (wallet/extension side
   investigation), NOT on test infrastructure. Profile what's slow
   in `waitForPopup` discover/verify/capabilities under sandbox load.
5. As short-term mitigation, consider bumping the 15s `waitForPopup`
   timeout selectively for files that exhibit the load-shaped failures.
   This is goalpost-moving, not bug-fixing, but is reversible and
   cheap if local reliability matters.

**What this spike does NOT support:**
- "Migration is moot, period." Only the flake-fix justification is moot.
- "Theory 3 (Aztec) is the bottleneck." Even fresh-sandbox split-batch
  produced 3 disjoint failures. Sandbox-side is not the only or
  necessarily the dominant story.
- "The load budget is exactly 5 failures per run." N=1 per cell + the
  split-batch contradicting clean accumulation means this is a
  directional pattern (variance-shaped tail) not a fixed budget.
- "Shared-run state piles up monotonically." Split-batch fresh-sandbox
  failures rule out the strong form of this.

## Follow-ups (not for this PR; ranked by leverage)

Codex's review specifically recommended #1 as the highest-signal /
cheapest-cost confirmation. We deferred it but it is the canonical next
experiment.

1. **Split-batch fresh-sandbox control** (HIGHEST LEVERAGE, lowest cost,
   directly confirms shared-run accumulation). Run the late half of the
   suite alone against a fresh `e2e:agent` sandbox. If the "late-run
   victims" (the tests that fail when run after many others) PASS when
   run fresh, shared-run accumulation is directly confirmed. If they
   STILL fail fresh, they're not load-bound and need separate
   investigation. Estimated 30–60 min compute. Decisively confirms
   or refutes the H3-shaped conclusion.

2. **N=3 baseline reruns** (cheap noise floor). Run the current `dev`
   baseline 3× from cold sandbox each time. Compare failure overlap
   across the 3 runs. High overlap = real bugs; low overlap = "load
   roulette" confirmed. Estimated ~45 min compute. Together with #1,
   gives the spike enough statistical weight to support strong claims.

3. **Reset Aztec sandbox state every N files** (most direct fix IF #1
   confirms Aztec is the bottleneck). Requires global-setup to
   checkpoint + restore, OR to tear down + re-spawn the sandbox
   mid-run. Estimated 1–2 days. Risk: sandbox cold-boot is slow;
   total wall-clock could regress.

4. **Multiple Aztec sandboxes per worktree** (sharding). Spawn N
   sandboxes, partition test files across them. Each sandbox stays
   "small" because it only serves a slice of the suite. Estimated 2–3
   days. Risk: port allocation complexity, parallel-isolation
   regressions.

5. **Investigate the wallet bugs unmasked by these runs** — fee-methods
   × 3 (60s waits in feeJuiceImportedExtension scope, likely Cluster A
   or B in triage), `contacts-sender flip OFF` (Cluster C). The triage
   plan already buckets these; this spike just adds another data point
   that they're load-sensitive. Estimated 1–3 days. High
   test-suite-reliability ROI.

6. **Move the `data-addressBook` `frame got detached` bug** into a
   triage cluster. It reproduces in isolation with a non-timeout shape,
   so it's a separate Puppeteer/CDP-shaped bug, not cumulative-load.

7. **Test H2 (Playwright helper-LOC reduction) independently of the
   flake fix.** Port `tests/e2e/registration.test.ts` to `playwright`
   (no `@playwright/test`, just the package) and measure helper LOC
   savings vs the Puppeteer original. ~1–2 hours of work. Output: a
   data point to either close H2 ("savings too small to justify
   migration") or revive the migration plan with a NEW primary
   hypothesis ("maintainability, not flake-fixing").

8. **`protocolTimeout`-style adjustments** to `waitForPgResult` under
   sandbox load. Goalpost-moving, not bug-fixing. Avoid unless 1–7 are
   too expensive.

## What the v2 plan got right and wrong

Right:
- Codex's central insight (the 2×2, not the 1×2): if I'd run the original
  Mode A / Mode B design, I would have observed Mode B passes the victim
  (because scope-flip happens to clear that test under one ordering) and
  concluded "Playwright fixes it". The 2×2 — even partially completed —
  exposed the same number of failures with a different set, killing the
  "Playwright fresh fixes it" reading immediately.
- Pre-flight Phase 0 wasn't strictly needed (triage plan was already
  clear that 18 known failures are wallet bugs), but the 5-minute read
  was right-sized.
- Single test tree (vs the v1 dual-tree) — proven correct in retrospect.
  We needed minimal source churn to do the spike; the spike used 2
  edits, both fully reverted.

Wrong (or under-specified):
- The plan implicitly assumed the cumulative-load was browser-side
  enough that scope-flip would meaningfully test it. In fact for our
  population (all 1-test-per-file in the `dappConnectedExtension`
  cohort), scope-flip was a behavioral no-op. The phase-4-survey
  caught this BEFORE the experiment ran, but the plan didn't
  pre-suggest the survey. Future plans should include this kind of
  pre-experiment sanity check in the structure, not as a "by the way"
  step.
- The plan didn't list `pool: "forks"` as a Theory-2 control to run
  alongside the scope-flip. It belonged in the spike, not as a
  Phase-4 afterthought. The smoke config has used this pattern since
  the parallel-isolation work; we should have lifted that
  pre-existing fix-shape to test as a cheap H2 alternative.

## Artifacts left behind

```
implementations-plan/playwright-migration/
├── plan.md                      ← needs an update: park the migration
├── plan-v1-now-superseded.md   (was renamed if you want history)
├── claude-plan.md              (Claude's original independent pass)
├── agent-plan.md               (subagent's original independent pass)
├── pre-flight-findings.md      (Phase 0 writeup)
├── spike-results.md            ← THIS FILE
└── spike-logs/
    ├── STATUS.md               (live status board kept during spike)
    ├── baseline.log
    ├── scope-flip.log
    ├── pool-forks.log
    ├── victims-isolated.log
    ├── scope-flip.diff.md      (the edit applied + reverted)
    └── pool-forks.diff.md      (the edit applied + reverted)
```

All source edits were reverted at end of spike. Working tree is clean
relative to `dev` other than these planning artifacts.

## What I'd send to Codex if doing this again

The single biggest finding is the failure-set shift across configurations
with constant failure count. That's the actual evidence. Future spikes
of this shape should:

- ALWAYS run with two distinct cheap controls (here: scope-flip + pool-forks)
  even if the test hypothesis is "only one of these matters". The cheap
  control on the wrong variable is what falsifies the assumed mechanism.
- ALWAYS compute the failure-set delta across runs, not just the count.
  Two runs with the same count but disjoint failure sets is the load-budget
  signature; with overlapping sets is real-bug signature. The plan didn't
  call this out as a metric; should.
- ALWAYS include N≥3 baseline reruns to establish noise floor before
  drawing causal conclusions from N=1 experiment cells.
- ALWAYS include at least one DIRECT confirmation test for the surviving
  hypothesis (here: split-batch fresh-sandbox). Elimination is not proof;
  it narrows the hypothesis space but the survivor still needs verification.

## Codex review corrections (applied to this document)

Codex's review of the original spike-results.md flagged these issues; all
have been corrected. Logging the corrections here for transparency:

| Original claim | Correction |
|---|---|
| "Theory 3 wins" (Aztec confirmed) | First softened to "shared-run infra, Aztec leading candidate". After split-batch contradicted accumulation, further revised to "high-variance popup-setup latency, accumulation is at most a secondary effect". |
| "12 unique tests" | 14 — recounted. |
| Multi-account-from + authwit-variants "assertion" | Both are 15s timeouts (verified in baseline.log). |
| Fee-methods × 3 → "Cluster B LMDB" | Actual shape is `Waiting failed: 60000ms exceeded` in fixture setup, NOT `mdb_txn_begin: 22`. Could be Cluster A or B, not specifically B. |
| "Migration is moot" | Softened to "moot as flake fix"; H2 (helper-LOC reduction) wasn't tested. |
| "Load budget" framed as fact | Reframed as directional pattern. Split-batch's disjoint failure set destroyed the clean-budget reading. |
| pool=forks → "more load" causation | Acknowledged scheduling/startup overhead as alternative. |
| Spike conclusion (post-codex top-3) | Ran the split-batch experiment per codex recommendation. Its results (above) further softened the interpretation. |
