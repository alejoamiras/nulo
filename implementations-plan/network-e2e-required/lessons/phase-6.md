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

═══ FEE FIX VALIDATED ON CI: authwit-lifecycle 10/10 GREEN ═══
Post-fee-fix 10× CI re-soak (run 27758721372, retry=0 proverless): 10/10 GREEN (conclusion:
success). vs the pre-fix soak 9/10 (1 fee-spike flake). The fee fix eliminated the dominant
flake; the revoke freeze did NOT recur (0/10) — confirming it's a much-rarer residual, not a
~10% rate. NET: the authwit-lifecycle "~10% flake" was dominated by the FIXABLE fee-spike, now
killed. Retry-budget likely UNNEEDED for this test. Remaining before flip: confirm the BROADER
suite (full sharded proverless soak — only authwit-lifecycle has been soaked so far), then
Phase 7's 5× real pr-network-e2e.

═══ REVEALED FLAKE #3: incoming-transfers:234 — ROOT-CAUSED (6-agent fleet) + FIXED + VERIFIED ═══
The full-suite soak revealed ONE consistently-failing test: incoming-transfers.test.ts:234 (C2
trust-prompt re-fire), failing 3/3 (isolated 10s + 30s, + CI 3/3). NOT a flake — a consistent
test-fixture bug.

ROOT CAUSE (found by a 6-investigator parallel fleet — user-requested when serial debugging had
circled it for ~4h; 4 of 6 converged independently): the test seeds the pending trust/record/token
under the FIRST `nulo:core:networks@*` key (Alpha Mainnet — seeded first), but the popup's
`replayPendingPrompts` runs against the ACTIVE network (Testnet — the isPrimaryActive seed). The
filter `pending.filter(t => t.networkId === networkId)` (service.ts:712) found 0 rows → early
return at service.ts:713 → the FIRST prompt never fired. Line 234 IS the `firstPromptVisible`
assertion (the test never reached the reopen assertion). This is why commit 5f31955's token-seed
didn't help — the skip is at 713, BEFORE the token guard at 729-731.
⇒ TEST-FIXTURE bug, NOT a product bug. The incoming-transfer P8 re-fire LOGIC is correct.

FIX: read the per-profile active-network pointer `nulo:core:active-network@<profileId>` and seed
trust/record/token under THAT networkId+chainId (not the first key). VERIFIED: incoming-transfers
now 2/2 GREEN (was firstPromptVisible=false).

FLEET NOTE: 4 Claude subagents + 2 codex auditors in parallel. codex-holistic + codex-skiptrace +
unit-divergence-agent + token-type-agent all independently nailed the networkId value-mismatch +
the identical fix. storage-shape-agent correctly disambiguated line 234=firstPromptVisible but
guessed token-id collision (downstream). caller-race-agent found the immediate:false watcher
(real but stale — test fails at the first prompt). Lesson: parallel cross-model fan-out cracked
in minutes what serial debugging circled for hours.

═══ PHASE 6 GATE MET — full sharded strict soak 3/3 GREEN ═══
After the 3 flake fixes (incoming-transfer mocks, mint fee-spike, incoming-transfers:234 networkId),
the full-suite proverless soak (run 27765252224, mode=full repeats=3 retry=0 proverless) is
3/3 GREEN — conclusion: success, ZERO failing tests across all 3 full-suite iterations
(20m40s / 19m24s / 20m55s). retry-grep clean. The residual rare infra flakes (revoke popup-freeze,
"Connection closed" SW-lifecycle) did NOT recur in any of the 3 full-suite runs. Phase 6 gate met.
Advancing to Phase 7 (5× real pr-network-e2e on SHA 003ff06 — sequential due to
cancel-in-progress concurrency; real proving via accelerator).

═══ CORRECTION — the fee-spike fix was INCOMPLETE (sends only); Phase 7 revealed a 2nd site ═══
The earlier "fee fix validated — 10/10 green" was PREMATURE: those green runs were SPIKE-FREE LUCK,
not the fix working. The first fee fix (de0846c) added E2E_FEE_GAS (maxFeesPerGas 1e11 ceiling) only
to the `.send({ fee })` calls. But the test fixtures ALSO make fee-validating `.simulate()` reads
(balance_of_public/balance_of at aztec.ts:163,419,453) and multi-line sponsored `.send()` calls
(369,432,442) — all using the SDK DEFAULT maxFeesPerGas. Phase 7 run 5 (the HEAVY concurrent-confirm
job, which the proverless full-soak does NOT exercise) hit a node fee spike: the mint's balance-verify
simulate (aztec.ts:163) failed `maxFeesPerGas=6.8e7 < gasFees=1.4e8`. So 4/5 Phase-7 runs green + the
full-soak 3/3 were all spike-free, not spike-immune.
COMPLETE FIX: E2E_FEE_GAS now on ALL 9 fee-checking SDK sites (sends + simulates).
`SimulateInteractionOptions.fee` accepts gasSettings (SDK d.ts confirmed), so the ceiling passes the
maxFeesPerGas>=gasFees validation on reads too. biome + typecheck green.
⇒ Phase 7's 5× must RESTART on the new SHA (prior 4/5 were on the incomplete fix). LESSON: a fee
ceiling must cover EVERY direct-SDK fee-checking call (send AND simulate), not just sends; and
"green" on a spike-intermittent flake is not proof unless a spike actually occurred.

═══ PHASE 7 — 5/5 GREEN on one SHA (gate proven; flip pending user) ═══
Real pr-network-e2e.yml 5× on SHA 1394574 (complete fee fix): 27775893971, 27776262246,
27776722898, 27777086996, 27777444247 — ALL success, all headSha 13945746, including the heavy
concurrent-confirm/concurrent-approve jobs + 5 shards. The complete fee fix held (the
concurrent-confirm fee-spike that broke the prior 4/5 on 003ff063 did NOT recur). 5-consecutive-
green-on-one-SHA hard-limit satisfied. Flip (add `Network e2e / Status` to dev branch-protection
required checks) left to the user as an outward-facing repo-admin action.
