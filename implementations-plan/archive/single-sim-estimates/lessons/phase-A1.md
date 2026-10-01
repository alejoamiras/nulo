# Phase A1 — Inert decorator extraction

## What shipped

- **`discovery-aware-estimator.ts`** (new): `DiscoveryAwareEstimator` — the single owner of discover-then-estimate for dApp sends, replicating the inline choreography exactly (cloned-op discovery → stage-boundary cancel check → splice-after-originals → validated pipeline; `detectedFee` folding preserved). `DiscoveryProbe` declared chain-bound (`extractEffects(sim, {node, network})` — ledger-#11 fence in the doc header); no strategy consumes it yet.
- **Dependency separation (audit H2)**: `DappSendExecutorDeps.buildAndEstimate` → `buildAndEstimateValidated` (probe-free; `executeSendTransaction`, embedded confirm branch) + new `estimateWithDiscovery: DiscoveryAwareEstimator` (aztec_sendTx/send_transaction estimate + aztec confirm-miss ONLY). The unused `authwit` dep dropped from the executor — probe-forbidden routes cannot reach discovery by construction.
- **Both inline discovery call sites replaced**; the confirm-miss embedded-skip became an explicit probe-free branch. The `preDiscoveryActions` snapshot untouched (fingerprint normalization point).
- **Assertion-surface migration** (planned, deliberate): the executor test harness now builds a REAL decorator over the same mocks (`authwit` + `buildAndEstimateValidated` exposed as harness handles, overridable), so every discovery-count pin retains meaning. New `discovery-aware-estimator.test.ts`: 5 inertness pins (clone semantics, splice order, fee folding, cancel-between-stages, signal/task forwarding).

## Inertness proof (the gate's option-level requirement)

- All count pins unchanged in value: 393/393 execution tests green with zero pin edits beyond the surface migration; `strategies-structural.test.ts` untouched entirely — its exact-object sim-options assertions (`toEqual({simulatePublic, skipFeeEnforcement, scopes})`) prove no strategy sim gained `stubAccountAddresses` or `skipTxValidation` (toEqual rejects extra keys — the OPTION pin comes free from the existing sentinel idiom).
- Send-path-no-probe: structural — `TransferExecutorDeps` has no discovery/decorator field (compile-visible), and the service constructs the decorator only inside the dApp executor's deps.

## Gate result: PASS

`bun run lint` 0 errors · `bun run typecheck:all` 13/13 · `bun run test` 3883 passed (+5 new).
