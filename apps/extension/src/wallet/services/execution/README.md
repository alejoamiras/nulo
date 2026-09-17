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
| `execution-lane.ts` | The execution-lane state machine: cancel-controller registry, each controller tagged with its session serial (`registerInFlight`), per-(profileId, chainId) FIFO `ExecutionMutex`, queued-wait heartbeats, `acquireSlot`, queued-record claim wrapper, `cancelJob`, the ended-session sweep (`abandonDeadSessions`). Frozen invariants documented in its docblock. |
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

## Authorization fence

A send runs under the `ExecutionFence` (`profile/profile-deletion-state.ts`) captured when it was
authorized: `{ profileId, epoch, session }`. `epoch` is the profile's deletion epoch. `session` is
the serial `SessionManager` stamps on each session it publishes (`open`, `restore`); serials only
increase and a rolled-back publication burns its own, so neither a lock and re-unlock of the same
profile nor A → B → A matches an older fence.

- **Capture.** dApp work captures at authorization: `executeAndResolve` after the approval popup,
  `silentInteraction` at entry (`dapp-interaction/service.ts`). The auth registry's
  `revokeAuthwits` and `setRegistryEnabled` capture before their first read; estimates, previews
  and popup transfers capture at entry.
- **Two entry contracts.** `executeOperations` throws for a DAPP-origin batch holding a send or a
  token commit without `authorizedFence`, since a capture at dispatch would bind whatever session
  is live when the operation runs. The wallet-sdk dispatcher's reads, registrations, simulations
  and silent authwits omit `authorizedFence`, and their dispatch arms never consume it.
  `executeSendTransaction` captures when `fence` is absent, which is correct only for a caller
  that awaited nothing between the user's action and the call.
- **`assertFence`** (`ProfileService`, awaited under the facade lock) throws `SessionEndedError`
  unless the fence's session is the live one, then the deletion error if a delete has begun.
  Sites: `acquireSlot` before the mutex key (built from the fence), both builders, both
  estimate-reuse arms (they throw rather than rebuild), and `proveAndSend` right after the
  post-prove `checkCancelled`.
- **`isFenceLive`** is the same question answered synchronously. It follows the account lookup on
  the send paths (both builders, both reuse arms) and is the statement before
  `node.sendTx` in `sendTxTask`; `close()` clears the session from memory before its first await,
  so no session end lands between the answer and the call. The post-`submitting` `checkCancelled`
  stays ahead of it: a cancel and a session end are separate questions. An issued `node.sendTx`
  is the point of no return.
- **Registry.** `ExecutionLane.registerInFlight(journalId, serial, controller)` is the only writer
  of the controller map. It is synchronous, so a caller registers before its next await, and it
  refuses a serial that is not live: the caller fails the record `session_ended` and throws
  `SessionEndedError`.
- **Sweep.** Each `onActiveProfileChanged` (a close or an open) runs `abandonDeadSessions`, which
  reads liveness per record as it reaches it. A record of an ended session at
  `queued|pending|simulating|proving` is cancelled journal-first, then aborted; one at `submitting`
  or later is left to the broadcast check; a session opened mid-sweep keeps its records. A swept
  send ends `cancelled` (the dApp gets the cancellation error), a refused one ends
  `failed/session_ended` (`SESSION_ENDED`).
- **Limits.** Work without a journal record is not registered (a send before its record is
  created, or whose creation failed), so no sweep reaches it; the checks still stop it at the next
  site and before broadcast. A PXE call already issued is not interrupted, including a store-key
  recovery, which reads the keys of whichever session of that profile is open; the post-prove
  assert and the broadcast check stop its result.
- **Auto-lock.** `ExecutionService.init` registers the expiry-deferral check: an expired session
  stays open while its profile has a send at `pending|simulating|proving`, within a per-session
  budget (`profile/session-manager.ts`).

## Testing

Colocated `*.test.ts` per module (unit pins, mocked seams). The
execution-wide behavioral safety net is the network e2e suite
(`bun run e2e:agent`), including the heavy shards `cancel-mid-prove`,
`concurrent-sendtx`, `concurrent-sendtx-confirm`. The fence's races run
in-process in `service.composition.test.ts`; live, `lock-cancels-dapp-send`,
`auto-lock-defers-while-proving` and `profile-switch-sweeps-transfer`.
