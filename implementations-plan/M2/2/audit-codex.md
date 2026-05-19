# M2.2 plan — codex xhigh audit

Run date: 2026-04-22. Plan file: `plan.md`. Tool: `codex exec -s read-only -c model_reasoning_effort=xhigh`. Tokens: 100,737.

## Verdict: **No Go** — blockers require a plan rewrite before execution.

## Findings

**BLOCKER — sub-PR dependency cycle**
`FeeStrategy` (plan M2.2-b) depends on `TxRequestBuilder`; `TxRequestBuilder` (M2.2-d) depends on `AuthwitDiscoverer` (M2.2-e). Current order `a → b, c → d → e → f → g` cannot ship as written. Fix: reorder to **`a || c` → `e` → `d` → `b` → `f` → `g`**. Alternative: split `b` into `b-interface/helpers` (ships early) + `b-impl` (waits for d).

**BLOCKER — `FeeEstimateResult` too small**
Current callers need `node`, `pxe`, `account`, `network`, `nonce`, `txCalls`, and the post-estimation `feePaymentMethod` (service.ts:340, 663, 1280). Plan's shape captures only `txRequest / simulatedTx / gasDetails / prependedActions`. Fix: return a full prepared bundle.

**MEDIUM — error-string contract drifting**
Plan says artifact misses throw `"Contract artifact not found"`, but the live builder path throws `"Contract artifact not found for class ${classId}"` (service.ts:2419). Fix: preserve exact strings **by call site**, not by collaborator-wide normalization.

**MEDIUM — GasBalanceCache ownership**
`getGasBalances` is a public facade RPC (spec.ts:41) — not part of the prove/send pipeline. Plan puts `GasBalanceCache` under `ExecutionCoordinator`. Coordinator is the wrong boundary. Fix: make it a **facade-owned helper** in `execution/`; coordinator calls `invalidateForAccount` or shares the same helper.

**MEDIUM — preview/shared-builder consumers missed**
Plan has no home for `executeSimulateTransaction` (service.ts:690-701), `executeAztecSimulateTx` (1182), `executeAztecProfileTx` (1230). They reuse normalization, request building, and gas handling but are NOT send-pipeline ops. Also: internal `executeSendTransaction` (660-688) is called directly by `AuthRegistryService` — ownership unclear. Fix: add explicit "preview/shared builder consumers" section assigning these to the correct collaborator (likely TxRequestBuilder + a thin "PreviewService" or coordinator read-only path).

## Per-question answers

**Q1 — FeeStrategy interface completeness**: No. `FeeStrategyContext` expresses FPC two-pass operationally, but `FeeEstimateResult` can't carry the post-estimation bundle. Must also encode `buildMode: "standard" | "no_from"` OR include `aztec_send_tx_no_from` in the context type.

**Q2 — Cross-sub-PR ordering**: No. Minimal order is **`a || c` → `e` → `d` → `b` → `f` → `g`**. Clean parallelization: `a` and `c`. Splitting `b` into interface-first/impls-later can move `b-interface` earlier.

**Q3 — AuthwitDiscoverer timing change**: Safe enough. No mid-flow reads of tracked authwit state inside execution. Observable change: `onAuthwitAdded` fires after send, not during assembly. Acceptable; test it explicitly.

**Q4 — `executeOperations` dispatcher**: Facade still owns `ensureInitialized`, RPC binding, and the public method. Becomes a thin delegator: `return coordinator.executeBatch(...)`. Specify what happens to internal `executeSendTransaction` — `AuthRegistryService` calls it directly.

**Q5 — GasBalanceCache location**: `execution/` directory right; coordinator ownership wrong. Make it facade-owned (see MEDIUM finding above).

**Q6 — DefaultEntrypoint split**: `TxRequestBuilder.buildNoFrom` + `FeeStrategy.Embedded` is cleaner than embedding DefaultEntrypoint in a strategy. But the plan must also assign the no-from-specific discovery/scope logic from service.ts:1358-1405 — builder alone isn't enough.

**Q7 — Golden fixture coverage**: Not 4 × 22. Must-cover pipeline shapes are **9**:
1. `send_transaction` + `fj`
2. `send_transaction` + `fjwc`
3. `send_transaction` + `fpc` private
4. `send_transaction` + `fpc` public
5. `aztec_sendTx` account mode + non-embedded
6. `aztec_sendTx` account mode + embedded `fjwc`
7. `aztec_sendTx` account mode + embedded `fpc`
8. `aztec_sendTx` default_entrypoint + embedded
9. One transfer integration fixture (end-to-end planner coverage)

Read-only/pass-through (`get_*`, `register_*`, `simulate_*`, `aztec_createAuthWit`) is redundant for golden request fixtures.

**Q8 — Parallel-run performance**: Yes, if both pipelines awaited before prove/send, users feel it. In `parallel` mode, one pipeline is authoritative; shadow pipeline stops at build/estimate and runs asynchronously. Comparator hashes/canonicalizes first; computes detailed diff only on mismatch.

**Q9 — Error-string drift points**:
1. `"Unauthorized"` vs `"Wallet locked"`
2. `"Contract artifact not found"` vs `"Contract artifact not found for class ..."`
3. DefaultEntrypoint strings
4. `"Invalid authwit content kind"`
5. `"Invalid \`opts.from\`"`
6. `"Only send_transaction and aztec_sendTx operations support fee estimation"`
7. `"Invalid fee payment method"`
8. `"Method not found"`
9. `"Contract not found"` / `"Contract instance not found"`

Artifact-string mismatch already in plan — fix before implementation.

**Q10 — Plan gaps**: Preview/shared-builder responsibility missed (see MEDIUM finding). Secondary: internal `executeSendTransaction` ownership unclear.

## Verdict summary

**If you fix**:
1. Sub-PR sequencing → `a || c, e, d, b, f, g`
2. `FeeEstimateResult` → full prepared bundle
3. Preview/internal-send method ownership assigned
4. GasBalanceCache facade-owned, not coordinator-owned
5. Error-string contract preserved by call site (exact strings)

**Then Go.**
