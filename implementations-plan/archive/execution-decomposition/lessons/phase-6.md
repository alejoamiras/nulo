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

## Slice 3: dapp-send-executor (commit `aec2e59`)

`estimateOperationFee` + `executeSendTransaction` + `executeAztecSendTx`
+ `executeNoFromSendTx` transplanted into
`execution/dapp-send-executor.ts`. `pickActionMethod` moved along (its
only caller). The lane interface here carries the full execution-lane
subset: `acquireSlot`, `claimOrCreateJournal`, `beginJournal`,
`markJournal` + the controller registry — facade wires them to its
existing helpers (which stay put for the phase-7 seam).

- The R1-M2 `no-slot-for-executeSendTransaction` pin retargeted from
  facade-private injection to the executor with a spy lane — the pin is
  now sharper: the path HAS `acquireSlot` available and provably never
  calls it.
- `feesettings-invariant.test.ts` retargeted at the executor (the
  facade methods are delegates; the invariant fires before any dep).
- New `dapp-send-executor.test.ts` (13): slot-before-claim order pin,
  release-on-all-exits, sentinel passthrough (no failed transition),
  embedded-fee discovery skip, NO_WAIT/wait split, **NO_FROM three-site
  scope assertions** (deferred here from phase 3) incl. the dedup
  quirk (`Map.set` ⇒ LAST duplicate instance wins — pinned as-is), the
  **V-01 chain-identity invocation pin** (asserted with live nodeInfo
  when offchain effects exist; skipped when none), Fr.ZERO + EXTERNAL
  history shape, and the estimate clone-don't-mutate contract.

## Slice 4: view-executor (commit `ff7f928`)

The read-only family (`executeSimulateTransaction`,
`executeSimulateUtility`, `executeAztecGet*`, `executeAztecSimulateTx`
+ Standard, `executeAztecExecuteUtility`, `executeAztecProfileTx`)
moved to `execution/view-executor.ts`. No lane deps by design — these
paths take no slot/journal/controller; service instances injected
directly. Register-family handlers + `executeAztecCreateAuthWit` stay
on the facade (they mutate PXE state and are thin already).

- Facade's orphaned imports swept via
  `biome lint --only=correctness/noUnusedImports --write --unsafe`.
- `view-executor.test.ts` (10): stub-account msgSender pin (real keys
  never enter PXE on dApp simulateTx), V-01 pin on getChainInfo,
  fast-path → standard fallback routing (split null / result null /
  verbatim non-null), metadata pxeOnly-vs-nodeBestEffort ladder,
  frozen "Wallet locked" / "Invalid `opts.from`" errors.
- Test-fixture gotcha: fast-path + profileTx wrap `accountAddress` via
  REAL `AztecAddress.fromString` — fixtures need full-length addresses.

## HARD GATE (A1)

`wc -l service.ts` = **967** ≤ 1,200 ✓ (2,302 at phase 0).

Slice gates: typecheck exit 0, `bun run lint` exit 0, full unit suite
**2,331 passed** (up from 2,308 pre-P6: +8 transfer, +13 dapp-send,
+10 view, −? consolidations).

## Phase gate (pending)

- codex parity review of `ba82b66..HEAD` — running (`/tmp` scratch;
  verdict to be quoted here).
- purged + idle `e2e:agent` run — queued after codex completes
  (machine-idle policy).

## Phase gate — CLOSED ✓

- **codex parity review** (`gpt-5.4`, xhigh, read-only, full `ba82b66..HEAD`
  diff): *"No findings. … PARITY CONFIRMED"* (97k tokens, verdict verbatim).
- **e2e:agent** (purged `.e2e-state` + `wallet_data_*`, machine idle,
  `VITE_NULO_FEE_MULTIPLIER=10`): **67 passed | 2 skipped (69), zero
  failures**, 790s — identical profile to the P3-P5 clean baseline.
- `bun run lint` exit 0; `bun run test` 2,331 passed; HARD GATE A1
  `wc -l service.ts` = 967 ≤ 1,200.

Phase 6 closed. Next: Phase 7 execution-lane seam.
