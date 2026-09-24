# Codex audit — private-fuel-fee-fix

## Round 1 (session 019ee67b) — REJECT

`reject (blocking findings: the plan’s core leeway decision is wrong/incomplete; it conflates FPC budget-fit with protocol inclusion-fit, and its stated validation gate does not exercise the embedded path that actually regressed.)`

Tight-per-claim `maxFeesPerGas = 1.0× getCurrentMinFees()` is not sufficient on its own. The protocol requires committed `maxFeesPerGas >= live gasFees` at execution time (`node_modules/@aztec/stdlib/src/fees/transaction_fee.ts`), and Aztec’s own wallet logic normally prices against predicted future min fees, not just current ones (`node_modules/@aztec/wallet-sdk/src/base-wallet/base_wallet.ts`). Your plan only covers budget drift by enlarging bridged FJ; it does not cover inclusion-time fee drift after finalize/prove/send. Those are two different risks:
- Budget-fail: `amount < committed getFeeLimit()`; fixed by larger bridged amount and/or smaller committed ceiling.
- Inclusion-reject: committed `maxFeesPerGas < live min fee` at submission/inclusion; fixed only by more fee-cap headroom or repricing/rebuild, not by larger bridged FJ.

**Core design**
- The user’s instinct partially wins. Some headroom must live in committed `maxFeesPerGas` unless you can prove claim build→inclusion always stays within the oracle lag window. Your own sources cut against that: fee updates can activate after 2 slots and proving is much longer than that (`node_modules/@aztec/stdlib/src/gas/README.md`, `packages/extension/src/wallet/services/execution/execution-coordinator.ts`, `packages/bridge-core/scripts/fuel-testnet.ts`).
- “Keep per-claim tight because higher ceiling forfeits more to the FPC” is economically true, but it is the wrong primary objective. The right objective is smallest reliable cap, not smallest cap. Today the plan chooses a cap that may simply be invalid by inclusion time.

**Assumptions / causality**
- Fact 7 is overstated: `fee-methods.test.ts` does not exercise `EmbeddedStrategy`; it covers regular transfer fee methods, not the embedded `feePayer` claim path. The closer embedded e2e is `tx-sendTx-feePayer.test.ts`, and that only checks popup state, not successful settlement.
- I2 is unsafe. You have not shown drift is the dominant inflator. The failing quantity is `gasLimit * maxFeesPerGas`; the private path’s two-call setup may be the main driver. Phase 2 needs to log both components separately, not just `getFeeLimit` and actual fee.
- I3 is likely false for production reliability. A 1.0× current-min cap can become underpriced after finalize; `minFuelFj` cannot rescue that.
- I4 is incomplete. Calibrating against ceiling is necessary for the FPC assert, but insufficient unless the chosen ceiling itself is inclusion-safe.

**Phase 1 / regression**
- Option (b) is safer than mutating `fee.maxFeesPerGas`; option (a) is more invasive and fights the readonly `FeeOptions` shape.
- Any fix must be explicitly gated on `embeddedFeePayment`; otherwise `finalizeGasLimits` could start treating pre-sim txRequest fees as authoritative on non-embedded paths.
- Required missing validation: an e2e that actually sends an embedded `feePayer` tx to completion and asserts the committed `maxFeesPerGas` / `getFeeLimit` used on-chain.

**Adversarial / operational**
- A stale-fee race is real, not residual theory. A griefer only needs fees to rise after claim construction to strand retries. The oracle lag helps, but your proving window is much longer than 2 slots.
- Overfunding still matters, but the fix is: choose explicit/predicted fee caps for reliability, then calibrate `minFuelFj` against that larger committed ceiling.
## Round 2 (resumed 019ee67b) — CONDITIONAL APPROVE

`conditional approve (conditions: Phase 2 must not rely on a 3-run empirical sweep alone; the plan must clarify retryability is only for pre-inclusion/dropped failures, not consumed claims; and it should explicitly record the public-fjwc inclusion-risk as a deferred compatibility tradeoff, not imply that path is structurally safe.)`

The corrected two-risk split is now basically right. The important fix is real: `minFuelFj` covers budget-fit, while committed `maxFeesPerGas` headroom covers inclusion-fit. Scoping explicit headroom to the private claim path is also the right containment boundary for this fix.

**Blocking conditions**
- `RELIABILITY_MULT` methodology is still too weak. “Smallest multiplier that settles across >=3 runs” is not a durable basis by itself; it is highly sensitive to the fee conditions during those runs. The codebase/protocol already acknowledges predicted fees (`getPredictedMinFees`). The plan should use a protocol-informed upper bound or predicted-fee snapshot as the primary candidate, then validate empirically. Empirical runs alone are not enough.
- The stale-fee section overstates retryability. A rebuild/reprice is available only when the tx is pre-inclusion or conclusively dropped. Once a claim attempt is included/consumed, the same leaf is not repriced and replayed; the flow moves to “consumed” handling / FPC-balance recovery. That distinction needs to be explicit in the plan.
- I4 remains unsafe as written. “FJ recoverable via the FPC balance, no loss” is not true for every failure class:
  - underpriced/dropped: FJ is still unconsumed, not “at the FPC balance”;
  - included/consumed: the leaf is gone, and only the credited remainder is recoverable through future FPC use.
  The plan should state these separately.

**Scope decision**
- Keeping headroom scoped to the private fuel claim is correct for this plan. The public `fjwc` path has the same protocol-level inclusion-risk in principle, but not the same FPC upfront budget gate, and broadening the general embedded cap would risk breaking dApps that budget at `1.0x`. So: correct local fix, but the plan should explicitly call public `fjwc` a deferred reliability follow-up, not “safe.”

**Inference check**
- I1: still open; reasonable hypothesis, not proven.
- I2: improved materially; decomposing gasLimit vs cap is the right test.
- I3: acceptable only if the plan explicitly says public `fjwc` still carries latent inclusion-risk.
- I4: needs the correction above.

**Tier**
- This is no longer `light`. It spans wallet fee construction, faucet claim flow, live fee-reliability calibration, and a new settling network e2e on the regressed path. That is `mid`.