# Phases 4–5 (PR-4 cancel/fee + PR-5 close-out) — lessons

## Retry census (plan PR-2 phase d, run before certification)

Two full ARMED smoke runs with retries enabled + the RetryErrorReporter active:
25 files / 88 tests each, **ZERO retry-passes in both** — no masked flake anywhere in the
smoke suite post-A1. The certification campaign starts from a retry-clean inventory (the
previous campaign discovered the appearance flake only THROUGH certification resets; this
census front-loads that discovery).

## Gate evidence

PR-4: units 4035; pin suites (dapp-interaction 20, windows 126, composable 15, overlay 6);
full armed smoke 25 files (3 chunks); full solo network sweep 65/87 attempt-1 zero retries.
The duplicate-aggregator merge trap hit #364 exactly as documented (empty-commit remedy);
ledgered as the CI follow-up.

## Notable review saves (full table in codex-iteration.md)

The A5 execute-flow exercise was a RACE not coverage (unfunded fixture, fee methods disabled
at zero balance) — dropped for the funded fee-methods path through the shared selector. The
disabled-binding pin was tautological until the enabled→cancelled→disabled recipe; a pin that
passes with its guarded term deleted pins nothing. The window half of refusal parity
(discover/capabilities classification) came from the quality lens after the service half
shipped — parity claims need both ends verified.

## Post-impl codex audit fold (conditional approve → conditions closed)

Codex's post-impl audit on the stack's net diff returned conditional approve with three
findings, all folded on `deflake-r2/close-out`:

- **High — stale post-restart liveness gates.** `chrome.storage.session` RETAINS the dead
  worker's `nulo:liveness` heartbeat, so truthy-only post-kill gates pass before the
  replacement worker boots — the next UI wait then races SW boot (this was the REAL mechanism
  behind the #364 canary red first misread as load flake). Fixed causally in
  `frozen-account-canary` + `sw-restart-network` (snapshot pre-kill, require strictly-newer;
  bounds unchanged). The sweep found three more truthy gates in the all-skipped
  `sw-resilience.test.ts` — fixed with the same pattern, plus its file comment claiming
  session storage "is wiped" on SW kill corrected (its own regression pin at the bottom of the
  file documents the opposite). Fixture truthy gates (`extension.ts`, `popups.ts`,
  `check-derivation-parity.ts`) are cold-boot/non-restart contexts — truthy is causal there,
  left alone.
- **Medium — missing race pins.** Discover + capabilities `JobCancelledError` classification
  branches now pinned (raced approve → cancelled overlay, no error banner). Capabilities
  needed a minimal `{ params: { delta: [], existingGrants: [] } }` payload — its `initComplete`
  bails without one, and the throw-before-init guard rejects `approve()`. Composable edges
  pinned: a FAILED replay read cannot fail an otherwise-good load; disposal mid-replay
  surfaces as the disposed error.
- **Low — timeout diagnostics.** `waitForFreshBalanceRow`'s thrown message now names the
  private leg when `expectedPrivateRaw` is set. NOTE: the first attempt at this fix (PR-3
  review round) silently no-oped — the python patcher's target string didn't match and nothing
  asserted it did. Same failure class as the pr5-ledger.py anchor no-op: **every scripted
  text-patch needs an `assert old in s`.**

Verification: rebased onto dev (#363 home-refresh landed mid-fold; index.md both-add conflict),
typecheck + 145 window/composable tests green, sw-restart-network solo retry=0 green (12.6s),
frozen-account-canary solo retry=0 PASSED (2 tests, 128.5s) on the per-worktree network runner.
