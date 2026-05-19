# M2.2 plan — general-purpose agent audit

Run date: 2026-04-22. Plan file: `plan.md`. Reviewer: general-purpose agent (parallel to codex xhigh).

## Verdict: **Go with 3 must-fix clarifications**

No blockers on extraction granularity or sub-PR ordering.

## Must-fix before M2.2-b starts

1. **`FeeEstimateResult` widened** to include `{ nonce, txCalls, node, pxe, account, network, feePaymentMethod }` — today's `buildAndEstimateTxRequest` returns an 8-tuple that every caller destructures. Plan's current shape captures only 3 of those; coordinator would re-fetch node/pxe/account wastefully.

2. **NoFrom/DefaultEntrypoint must not be folded into `FeeStrategy.Embedded`**. Two distinct pipelines share the `"embedded"` payment-method name but not the code path: normal embedded uses `buildAndEstimateTxRequest`'s `case "embedded"` branch; `default_entrypoint` short-circuits to `executeNoFromSendTx` with its own discover/simulate/finalize loop. Make NoFrom either a standalone pipeline inside `TxRequestBuilder` or a 5th FeeStrategy (`NoFromStrategy`).

3. **M2.2-g parallel-run scope**: plan must say explicitly "parallel-run diffs `TxExecutionRequest` **only**; proving/sending uses the selected pipeline exclusively." Running prove+send on both pipelines double-charges fees + flakes e2e.

## Per-question findings (plan's Q1-Q10)

| Q | Status | Notes |
|---|---|---|
| Q1 | **Concern** | FeeEstimateResult too thin (see must-fix #1). |
| Q2 | OK | Ordering `a → b, c → d → e → f → g` correct. Possible parallelization: a and c by two devs. |
| Q3 | OK | Zero mid-flow popup reads of registry state. Current code double-writes on FPC's 2-pass — moving to post-send is a bug-fix side-benefit. Document. |
| Q4 | OK (nit) | Facade keeps RPC binding + `ensureInitialized` + delegation. Nit: split the 22-arm switch into `dispatchNuloOp` / `dispatchAztecOp` / `dispatchPassthrough` maps. |
| Q5 | OK | GasBalanceCache inside `execution/` is right. `#computeGasBalances` re-enters `executeSimulateViews` — coupling justifies location. |
| Q6 | **Concern** | See must-fix #2. |
| Q7 | **Concern** | 22 × 4 = 88 overkill. Concrete minimum: ~24 fixtures (4 fee strategies × 7 representative op variants + 4 degenerate cases). Document matrix in M2.2-g. |
| Q8 | **Concern** | See must-fix #3. |
| Q9 | OK | Add `execution.errors.test.ts` — assert exact `error.message` via snapshot. |
| Q10 | **Concern** | Plan misses: prove/send loop repeated 4 times (`executeTransfer / executeSendTransaction / executeAztecSendTx / executeNoFromSendTx`). All do `proveTx → toTx → sendTx → addTransaction → txHash`. Coordinator must consolidate — call out explicitly. `addTransaction` bookkeeping (feePaymentMethod/txCalls/gasDetails/nonce/estimatedFee) must also move to coordinator. |

## Extra audit checks (reviewer-added)

**Extraction granularity** [OK]: 7 is right. Don't merge planner+builder; don't split FeeStrategy into 4 PRs. Optional nudge: ship FJ+Embedded first, FJWC+FPC second if the first lands cleanly.

**Parallel-run dual-cost** [Blocker-lite]: see must-fix #3.

**Journal + coordinator ownership** [OK]: coordinator-owned is right. Decorator layer would duplicate state-transition knowledge.

**buildAndEstimateTxRequest mutation** [OK]: line 1787 clones up-front. FPC preserves `originalActions` and `splice`s — document in FPC JSDoc so future refactor doesn't break the 2-pass invariant.

**Integration-test matrix** [Concern]: add `execution.matrix.test.ts` — fake PXE, {transfer × 4 types} + {aztec_sendTx vanilla, with-authwit, no-from-embedded} × {FJ, FJWC, FPC, Embedded} where legal. ~20 table-driven cases as backstop.

## Top-3 risks

1. **Parallel-run cost ambiguity (M2.2-g)** — if "parallel" is interpreted as prove+send-both, fees double. Plan must say TxExecutionRequest-only.
2. **NoFrom/Embedded conflation** — one strategy silently forking internals is a maintenance trap. Separate them.
3. **8-tuple return drift** — every existing caller needs 8 fields; plan's `FeeEstimateResult` has 3.
