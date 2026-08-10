# Phase A2 — PrivateFPC fold (+ the override-mechanism bug fix)

## What shipped

1. **`aztec-runtime` stub-override fix** (`fix(pxe)`, own commit): `PxeService.simulateTx`'s
   stub path now mirrors upstream `EmbeddedWallet.buildAccountOverrides` — stub CLASS
   registered with the PXE, entries keep the account's REAL instance with only
   `currentContractClassId` swapped, and the map lands under the `contracts` key of
   `SimulationOverrides` (the historical top-level spread parked it where upstream never
   looked — B1 Finding 0, proven live). Missing instance now fails loudly instead of
   simulating unstubbed. Pinned by `stub-overrides.test.ts` (3 tests; `@vitest-environment
   node` — the jsdom runner corrupts bb.js mid-suite under heavy class hashing).
2. **`CollectingDiscoveryProbe`** (discovery-probe.ts): the concrete chain-bound extractor —
   `assertLiveChainIdentity` before hash derivation (lazy nodeInfo), first-sim-only,
   dedup within one extraction AND against pre-attached hashes, `collected` as executor
   bookkeeping. Crypto seam injected for unit tests (WASM stays e2e-only). 6 tests.
3. **Fold wiring**: `FeeStrategyContext.probe` (set exclusively by the estimator's fold
   routing) → `FpcStrategy` both branches probe-aware:
   - Two-pass (PrivateFPC + non-canonical): P1 runs STUBBED (+`skipTxValidation`) and
     doubles as discovery — discovered actions land AFTER originals (the standalone splice
     position), Pass 2 validated verifies the fresh witnesses. **dApp fpc estimate 3→2 sims.**
   - Canonical-Sponsored fast path: no effects ⇒ ONE stubbed sim; effects ⇒ validated
     rebuild + re-sim. **dApp Sponsored estimate 2→1 sims (no-authwit).** (Kind-level
     routing forces the fast-path fold into A2; B2's sponsored line-item collapses into it.)
   - `DiscoveryAwareEstimator` routing: fold only for `fpc` kind (fj added in B2) AND no
     pre-attached `add_private_authwit` of ANY content kind (F-4; intent/inner-hash ops
     never fold). Everything else keeps the classic choreography verbatim.

## Adversarial fixtures

- Sponsored-TYPED non-canonical row under a probe → two-pass only; the ONLY stubbed sim is
  the payload-FREE P1 — the payload-inclusive Pass 2 pinned validated (hard limit honored).
- F-4 pinned for `intent` AND `message_hash` content kinds at the estimator.
- Cross-chain-row bail re-enters the probed two-pass (existing bail test unchanged + fold
  ledger note).

## Gate result: PASS

- Unit: 3903 passed (+20 new), lint + typecheck:all clean.
- Structural: probe-free runs pinned byte-identical (existing option pins untouched);
  probed runs pinned at the option level (stub set on first sim only, validated second).
- Milestone e2e (network agent runner, proverless-armed):
  `tx-sendTx-default.test.ts` + `tx-sendTx-sponsoredFpc.test.ts` — **2/2 green** with the
  folded pipeline live.
