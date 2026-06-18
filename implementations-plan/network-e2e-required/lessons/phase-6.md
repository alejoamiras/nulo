# Phase 6 — De-flake the revealed retry-masked set

The Phase-2 de-retry exposed the true flaky set. Result: it is much smaller than
feared — the removed `retry:1/2` overrides were over-cautious, not masking real
flakes.

## Evidence
1. **De-retry soak** (27715586770, the 8 de-retried files ×7, retry=0): 6/7 green;
   the 1 red was an INFRA boot failure (sentinel exit 86 + retried, double-boot),
   NOT an app flake. ⇒ the 8 de-retried files have no observed app flake.
2. **C2 (incoming-transfers)** — un-quarantined in Phase 2, fixture fixed in this
   phase (seed the missing `nulo:core:tokens` row so `replayPendingPrompts`
   doesn't skip). CONFIRMED green: the full sharded run 27719222383 (commit
   5f31955, which includes the C2 fix) was 7/8 jobs green and incoming-transfers
   ran on a GREEN shard (shard 1 — the only red — contained cancel-mid-prove,
   authwit-lifecycle, tx-sendTx-multicall, NOT incoming-transfers).
3. **Full sharded strict run** (27719222383, retry=0): heavy/fee-methods ✓,
   heavy/concurrent-confirm ✓, canary/real-proving ✓, shards 2/3/4/5 ✓ — only
   shard 1 red, and its sole failure was **authwit-lifecycle** (F1,
   `1 failed | 11 passed`). So the ENTIRE suite is green at retry=0 EXCEPT F1,
   which the Phase-4 PXE-barrier fix (ed5b49a) targets.

## `grep -rnE "retry:\s*[12]" tests/e2e/network` → empty (verified Phase 2).

## Remaining for Phase 6 done
- F1 (authwit-lifecycle) stable: Phase-4 re-soak 27719585565 (10/10, with the PXE
  barrier) — IN PROGRESS.
- One full sharded strict run all-green on the barrier commit (ed5b49a) — pending
  the re-soak confirmation.

LESSONS_FILE=implementations-plan/network-e2e-required/lessons/phase-6.md

═══ REVEALED FLAKE: authwit-lifecycle revoke "freeze" — ROOT-CAUSE PROGRESS ═══
Symptom: `Error: Waiting failed` Caused by `ProtocolError: Runtime.callFunctionOn timed out` on
the popup's pure-DOM `waitForFunction` at the revoke settle ⇒ the popup PAGE PROCESS loses CDP
responsiveness (not a task reject — that stays responsive).

NOT the Phase-5 cutover code (THREE independent exonerations):
  1. codex ×2 (sessions bn67m59dw, 019eda56) + static: revoke emits no cutover events; reconcile
     "mined" has no emit; useEntityCrud is incremental (no refresh-loop); popup/page code is
     UNCHANGED vs the green baseline 6b2075e (only data-testid attrs differ).
  2. 10× CPU-throttle of the POPUP renderer during the post-submit wait (SW target unaffected) ⇒
     2/2 reached-revoke runs PASSED (95s, 97s). If the popup were busy-looping or doing
     main-thread work post-submit, 10× would amplify it into a freeze. It did NOT ⇒ the popup is
     genuinely IDLE post-submit (just awaiting the SW). Rules out popup busy-loop AND popup-CPU
     starvation.
  3. The earlier syncAuthwit task-wedge fix (real latent bug, kept) took the rate from 3/3 RED
     (pre-fix) to ~1/10 (9 green / 1 red post-fix).

Flake characterization: RARE (~10% on a beefy Mac; 7 consecutive green in one batch), and
DIVERSE — also observed a `Connection closed during registerProfile` SW-lifecycle SETUP flake
(distinct from the revoke ProtocolError). Both are cross-process / resource / lifecycle infra
flakes, consistent with BRIEF Class-B resource-starvation: rare on a many-core Mac, expected
WORSE on 2-core CI. Local reproduction is too rare to CPU-profile efficiently; the flake is
environment-sensitive, so CI (the real pr-network-e2e) is the representative measurement surface.

CONCLUSION: Phase-5 cutover CODE is correct/complete (exonerated 3 ways + 7 unit pins). The
authwit-lifecycle soak flake is a Phase-6 INFRA/resource flake, not a cutover bug. Next: either
(a) reduce the cutover's SW-side per-tx-update work (lock+getValues on every onTransactionUpdated
→ cheap no-op skip) as a contention-reducing optimization, and/or (b) characterize on CI where
the flake is more frequent + representative.

═══ REVEALED FLAKE #2: mint fee-spike (CI soak iter 9) — ROOT-CAUSED + FIXED ═══
The 10× CI soak (run 27756356928) on authwit-lifecycle: 9 green / 1 red = ~10%. CRUCIAL: the 1
red was NOT the revoke freeze (that was 0/10 on CI — far rarer than the local ~10%). It was a
GAS-FEE-SPIKE rejection at the MINT setup (authwit-lifecycle.test.ts:47 → mintPublicTokensForAccount):
  `Error: maxFeesPerGas.feePerL2Gas must be >= gasFees.feePerL2Gas, but got
   maxFeesPerGas.feePerL2Gas=55650000 and gasFees.feePerL2Gas=111700000`
ROOT CAUSE: the test SDK helpers send with only `{ paymentMethod: SponsoredFeePaymentMethod }` and
no gasSettings. Aztec.js then pins maxFeesPerGas to the ESTIMATION-time gas fee with NO spike
headroom (there is no `baseFeePadding` in this SDK version; padding via `estimatedGasPadding`
covers gas LIMITS, not fee-per-gas). When the network L2 fee rose ~2× between estimate and
inclusion, the tx was rejected.
FIX (Phase 6, root-cause not retry): added a generous `maxFeesPerGas` ceiling (`new GasFees(1e11,
1e11)`) to the 4 SponsoredFPC setup sends (deployTestToken, mintPublicTokens, mintPrivateTokens,
claimFeeJuice) via a shared `E2E_FEE_GAS` const. The SponsoredFPC pays the ACTUAL network fee and
maxFeesPerGas is only a ceiling, so a high cap can't overpay — it only stops spike-rejection. (de0846c)

INSIGHT for the retry question: the "~10% flake" is NOT one irreducible floor — it's a MIX of
distinct rare flakes (fee-spike [FIXED], revoke popup-freeze [0/10 CI, very rare], "Connection
closed" SW-lifecycle, transient RPC). Phase 6 = fix the fixable ones (fee-spike done) + size a
minimal retry-budget ONLY for the genuinely-irreducible residual. Re-soak pending to confirm the
fee flake is gone + measure the true residual rate.
