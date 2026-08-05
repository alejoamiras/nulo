# Execution service

The service-worker subsystem that builds, estimates, simulates, proves,
and submits Aztec transactions — for both popup-initiated transfers and
dApp RPC operations. `ExecutionService` (`service.ts`) is a thin RPC
facade: it owns the wire surface (`Methods`), `executeOperations`
dispatch, and collaborator wiring; the work lives in focused modules.

## File map

| Module | Owns |
|---|---|
| `service.ts` | RPC facade, `executeOperations` dispatcher, register-token/contract/sender handlers, `executeAztecCreateAuthWit`, `beginDappExecuteJournal`, collaborator wiring, gas-balance event subscriptions. |
| `execution-lane.ts` | The execution-lane state machine: cancel-controller registry, per-(profileId, chainId) FIFO `ExecutionMutex`, queued-wait heartbeats, `acquireSlot`, queued-record claim wrapper, `cancelJob`. Frozen invariants documented in its docblock. |
| `transfer-executor.ts` | Popup transfer flow: `execute` + `estimateFee`, estimate-reuse fast path, transfer-only activity-record shape. Takes NO execution slot (controller registry only) — preserved quirk, pinned. |
| `dapp-send-executor.ts` | dApp send flows: `executeSendTransaction`, `executeAztecSendTx`, NO_FROM/DefaultEntrypoint path, `estimateOperationFee`. Slot-bearing lane deps; slot-before-claim ordering frozen. |
| `view-executor.ts` | Read-only dApp RPC family: simulate (fast path + standard), utility, profile, contract/class metadata, chain info, address book. No lane deps by design. |
| `execution-coordinator.ts` | Shared prove → send → record → journal pipeline (`proveAndSend`) + the three task-lifecycle wrappers (`simulateTxTask`, `proveTxTask`, `sendTxTask`). |
| `tx-request-builder.ts` | `buildStandard` / `buildNoFrom` — payload → `TxExecutionRequest` with account entrypoint wiring. Returns `BuiltStandardTx` / `BuiltNoFromTx`. |
| `operation-planner.ts` | `TransferRequest` → `SendTransactionOperation` (token transfer-fn resolution) + aztec.js payload processing. |
| `contract-resolver.ts` | Instance/artifact resolution cascade (PXE → node → known bundle) + `ensureContractsRegistered` + function lookup helpers. |
| `authwit-discoverer.ts` | Offchain-effect-driven private authwit discovery for dApp sends. |
| `fee/` | Fee strategies (`fj`, `fjwc`, `fpc`, `embedded`) behind `FeeStrategy`; gas-limit shaping (`suggestGasLimits` / `finalizeGasLimits`); embedded-FPC gas cap. FPC is two-pass — byte-parity-sensitive, see `strategies-structural.test.ts`. |
| `transfer-estimate-reuse.ts` | One-shot estimate→confirm reuse cache (fingerprint-validated snapshot; fj/fpc only). |
| `gas-balance-reader.ts` | TTL + single-flight FeeJuice balance readout; the two legs (public direct-to-node, private via PXE) run as concurrent independent invocations with per-leg failure isolation; `peek` serves last-known values (stale-marked, never deleted) for stale-while-revalidate display; invalidation epoch + primitives called by the facade's event subscriptions. |
| `tx-fee-details.ts` | `getEstimatedFee` / `getGasDetails` projections from finalized gas settings. |
| `execution-mutex.ts` | FIFO mutex with abort + capacity caps. No timeout/force-release by design. |
| `claim-helper.ts` | Queued-journal claim decision tree (cancel-during-claim safety). |
| `rpc-cancel.ts` | The ONLY conversion point from `JobCancelledSentinel` to RPC-boundary errors. |
| `fast-path.ts` | Mixed-payload simulate fast path (public-static prefix via node). |
| `coerce-amount.ts`, `helpers/`, `utils/`, `models.ts`, `spec.ts` | Amount coercion, batched view simulation, fee detection, wire types. |

## Invariants worth knowing before editing

- **Zero-slot transfer quirk**: the popup transfer flow never touches the
  execution mutex. Pinned in `service.characterization.test.ts`
  ("no-slot-for-executeSendTransaction") — do not harmonize.
- **Slot-before-claim** on dApp sends; the session-FIFO baton releases
  inside `acquireSlot` via `onEnqueued`. See `execution-lane.ts`.
- **cancelJob transitions the journal first, aborts second**; an FSM
  rejection drops the cancel silently.
- **`JobCancelledSentinel` never crosses RPC** — `rpc-cancel.ts` is the
  boundary.
- **FPC fee strategy is two-pass byte-parity-sensitive** — structural
  fixtures in `fee/strategies-structural.test.ts` pin the choreography.
- **Chain identity** (`assertLiveChainIdentity`) is asserted at every
  sink that derives chainId/version from a live node (V-01).

## Testing

Colocated `*.test.ts` per module (unit pins, mocked seams). The
execution-wide behavioral safety net is the network e2e suite
(`bun run e2e:agent`), including the heavy shards `cancel-mid-prove`,
`concurrent-sendtx`, `concurrent-sendtx-confirm`.
