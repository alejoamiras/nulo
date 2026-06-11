# Phase 6 — executor split (transfer / dapp-send / view)

## Slice 1: tx-fee-details projections (commit `3014a8a`)

`getEstimatedFee` / `getGasDetails` moved off the facade into
`execution/tx-fee-details.ts` so all three upcoming executors share one
copy. Validated: typecheck clean, execution suite 233 passed. No test
file of its own — the projection math is already pinned by the
structural fee fixtures, and both functions are exercised by every
executor test.

## Slice 2: transfer-executor (commit `7a7470d`)

`executeTransfer` + `estimateTransferFee` transplanted verbatim into
`execution/transfer-executor.ts` (`TransferExecutor.execute` /
`.estimateFee`). Facade methods are now thin delegates that keep the
wire-boundary concerns (`ensureInitialized`, `coerceAmount`) and build
the `TransferRequest` before handing off.

Decisions worth recording:

- **Lane-shaped deps from day one (CC6).** The deps interface exposes
  `lane: { registerController, deleteController }` — the controller
  registry subset only. The facade wires it to `activeControllers`.
  Phase 7 swaps the wiring, not the executor. The preserved quirk
  (transfer takes NO execution slot, only the controller registry) is
  documented in the module docblock and pinned by the harness shape:
  the deps interface has no `acquireSlot`.
- **Journal deps are two narrow closures** (`createJournalOperation`,
  `transitionJournal`) rather than the whole `OperationJournalService` —
  `transitionJournal` returns `Promise<unknown>` because the service
  returns the record and `Promise<OperationRecord>` is not assignable
  to `Promise<void>`.
- **Service lookups passed as closures** (`getActiveProfile`,
  `getNetwork`, `getNode`, `getPXE`, `getAccountContract`,
  `getPendingForAccount`, `addTransaction`, `buildAndEstimate`) so the
  executor has zero knowledge of service-client classes. `getPXE` takes
  the `Network` object; the facade closure applies `networkInfoFrom`.
- **Milestone-vocabulary comments dropped during the move** ("Phase 2
  FSM", "plan-v4 Branch 5", "M1.1") per the repo comment rules — the
  WHY content of each comment was kept verbatim.

Tests (`transfer-executor.test.ts`, 8): rebuild path (planner +
buildAndEstimate + transfer-only activity record + `scopes ===
[account.address]`), reuse path (planner/build skipped, snapshot shapes
the record), wallet-locked journal-less flow, build-failure path
(failed transition + task.fail + controller cleanup), cancel path
(JobCancelledError, NO failed transition), and the estimateFee stash
ladder (fj stash + fingerprint, embedded ineligible, stash-throw
best-effort).

Gate for the slice: typecheck exit 0, `bun run lint` exit 0, full unit
suite 189 files / 2,308 tests passed.

Facade line count after slice 2: **1,767** (from 2,302 at phase 0;
hard gate ≤ 1,200 lands after the dapp-send + view executor slices).

## Remaining

- `dapp-send-executor.ts` (~520 lines: executeSendTransaction,
  executeAztecSendTx, executeNoFromSendTx, estimateOperationFee) — incl.
  NO_FROM three-site scope assertions + chain-identity invocation pins
  deferred from phase 3.
- `view-executor.ts` (~300 lines: simulate/utility/profile/metadata
  families).
- `wc -l service.ts ≤ 1200` hard gate, then the phase-6 parity review +
  purged idle e2e gate.
