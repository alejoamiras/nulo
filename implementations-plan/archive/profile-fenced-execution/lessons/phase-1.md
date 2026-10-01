# Phase 1 — capture, thread, assert, check in the broadcast tick

## What landed

- **Lane.** `registerInFlight(journalId, serial, controller): { live }` is the only writer of the
  controller map, whose values are now `{ controller, serial }`. `acquireSlot(networkId,
  queuedJournalId, fence, onEnqueued?, originKey?)` registers the waiting record in its synchronous
  prefix, then awaits `assertFence`, then keys the mutex on `${fence.profileId}:${chainId}`. A dead
  serial fails the record `session_ended` and throws before any assert, key or acquire. A
  `SessionEndedError` from the assert fails the record the same way.
- **Claim helper.** All three registration sites go through `registerInFlight` with the fence
  serial. A refusal fails the row the helper owns and throws.
- **Builder and strategies.** `buildStandard` and `buildNoFrom` take a required fence, assert it
  first and resolve the account from `fence.profileId`. The four strategies pass `ctx.fence`.
  `ViewExecutor` captures at the entry of its three builds. `buildForDiscovery` runs under the
  estimate's fence.
- **Reuse caches.** Both `tryConsume(…, fence)` throw `SessionEndedError` for an entry stashed
  under another profile, and neither reads the active profile any more.
- **Executors.** The dApp-send executor threads the fence through the slot, the claim, every
  build, the reused branch (assert, then the fence's account), NO_FROM and the post-send record.
  Its estimate and preview entries capture through a `captureExecutionFence` dep. The transfer
  executor stamps the journal with the fence's profile and epoch, registers under the fence
  serial, compares reuse against the fence, asserts in the reused arm and builds fresh under it.
- **Coordinator.** `assertAuthorization` is awaited right after the post-prove cancel check.
  `assertLive` is the statement before `node.sendTx` inside `sendTxTask`'s `try`. The cancel check
  before the send is untouched. `fenceChecks(profile, fence)` builds both for every send path.
- **Classification.** `failureKind` maps `DuplicateInitializationError` and `SessionEndedError` for
  both the dApp-send catch and the transfer catch. `SessionEndedError` rides the code channel.
- **Entries.** `executeOperations` throws for a DAPP origin without a fence. Both send arms use
  `authorizedFence ?? capture`. `executeSendTransaction` takes an optional fence and captures only
  without one. `silentInteraction` captures atomically, compares and passes the fence. The auth
  registry's `revokeAuthwits` and `setRegistryEnabled` capture before their first read and forward
  the fence.

## Decisions and deviations

1. **`registerInFlight` checks the serial only.** It must stay synchronous and cheap. The profile
   and the deletion epoch are covered by `assertFence` in `acquireSlot` and the builder, and by
   `isFenceLive` in the broadcast tick.
2. **A deletion-epoch error from `acquireSlot`'s assert is not terminalized there.** Only
   `SessionEndedError` fails the queued record. The deletion cascade purges the profile's journal
   rows (`purgeForProfile`), so a terminal write would race a row about to vanish. The epoch error
   still propagates and the caller's scaffold cleans the controller.
3. **The transfer journal stamp gains `profileEpoch`.** The journal's create fence then refuses a
   row for a profile deleted between the capture and the create, as the dApp path already did. The
   transfer's liveness check at that point is the synchronous registration. The awaited check is
   the build's or the reused arm's `assertFence`.
4. **`buildForDiscovery` threads the estimate's fence instead of capturing a new one.** A fresh
   capture after a session end would observe the successor session and discover under it.
   Threading makes the discovery build refuse with `SessionEndedError`. The estimator's identity
   pin had to change, because the discoverer now receives a closure.
5. **`sendTxTask`'s `assertLive` is a required positional parameter**, so no send path can omit
   the broadcast-tick check.
6. **Estimate entries capture through an executor dep, not a parameter.** The public estimate RPC
   signatures stay unchanged.
7. **The estimate stashes still stamp `profileId` from the active profile.** Recon marked this
   correct: an estimate is pre-authorization. Any cross-profile consume is refused by `tryConsume`
   with `SessionEndedError`, and the reused arms resolve the account from the confirm's fence.
8. **The `send_transaction` dispatch arm now captures explicitly.** It used to rely on
   `executeSendTransaction`'s fallback. The capture happens at the same point, inside the arm, but
   every production caller now names a fence, which the source pin enforces.
9. **`acquireSlot` rose to cognitive complexity 16.** The waiting-record registration moved into
   `registerWaitingRecord`. It runs in the call's synchronous prefix, so the registration still
   precedes every await; the lane's ordering pin still passes.
10. **`OperationEstimateReuse.tryConsume` lost its complexity acceptance.** Its signature change
    moved the accepted declaration's anchor, and CI refuses an anchor move unless the owner applies
    the `baseline:move-approved` label. The FPC identity check moved into `fpcIdentityDrift`, with
    the same reasons in the same order. The function now fits the budget, its directive is gone,
    and `bun run baseline:complexity` regenerated the manifest: 28 acceptances became 27.

## Existing pins edited

Signature changes named by the gate:

- **`acquireSlot`** (fence third): 15 calls in `execution-lane.test.ts`, including the capacity
  pin; the originKey index 3 → 4 in the dApp-send `(B-02 PIN)`; the two direct calls in
  `service.composition.test.ts`.
- **`registerController` → `registerInFlight`**: three calls in `execution-lane.test.ts`; both
  cancelJob pins in `service.characterization.test.ts`; the registration pin and the
  cancel-before-pipeline lane in `transfer-executor.test.ts`; both cancel-window pins; the
  `claim-helper.test.ts` harness, whose map became a `registerInFlight` spy; the key removed from
  the lane mocks in the dApp-send, feesettings-invariant and characterization tests.
- **`buildStandard` / `buildNoFrom`** (fence second): the builder pins' calls. The "locked wallet
  throws the frozen string before anything else" pin became "an ended session throws
  `SessionEndedError` before anything else", because the builder's first check is now the fence
  assert and `"Wallet locked"` moved to the capture. 13 payment-method index pins in
  `strategies-structural.test.ts` moved from `[1]` to `[2]`.
- **Both `tryConsume`** (fence third): 19 calls in `operation-estimate-reuse.test.ts`, whose
  "profile drift misses" pin now expects `SessionEndedError`; 20 calls in
  `transfer-estimate-reuse.test.ts`, whose two profile pins ("different active profile",
  "no active profile") became one `SessionEndedError` pin; the dApp-send CONSUME-HIT
  `toHaveBeenCalledWith` gained the fence.

Edits that follow from other signatures the plan requires:

- **The fence inserted into `buildAndEstimate*`**: argument indices in
  `discovery-aware-estimator.test.ts` (validated, folded, the probe) and its `toBe(buildForDiscovery)`
  identity pin, now an invocation pin; the probe index in the dApp-send discovery helper; the
  signal index `[3]` → `[4]` in `transfer-executor.test.ts`.
- **`sendTxTask(node, tx, assertLive, …)`**: five coordinator calls gained `() => {}`.
- **Required fences on `execute`, `executeSendTransaction` and `executeAztecSendTx`**: call sites in
  the dApp-send, feesettings-invariant, characterization and transfer tests; the dApp-send
  `claimOrCreateJournal` pin's last argument `undefined` → the fence.
- **`executeOperations` requiring a fence for DAPP origin**: the two DAPP-origin calls in
  `service.composition.test.ts` pass the harness capture.
- **`ExecutionFence.session`**: the F11 pin in `dapp-interaction/service.test.ts` gained
  `session: 1`.
- **The transfer journal stamp moving to the fence**: "wallet locked at journal creation" became
  "journal creation failing". An absent active profile no longer fails the create, so the pin
  keeps its subject (no journal, no controller, the flow completes) through a failing create.

Harness-only additions, no assertion changed: fence fakes in `fast-path.test.ts`,
`view-executor.test.ts`, the auth-registry harness and the execution composition harness.

## New pins

- **Lane**: `registerInFlight` live, dead and locked; registration before the first await; a dead
  serial or a failed assert fails the queued record `session_ended` with no key and no acquire;
  the key uses the fence's profile while another is active; the claim creates under the fence's
  profile and epoch and registers its serial.
- **Claim helper**: each of the three sites passes the fence serial; each refusal fails the row
  and throws.
- **Builder and strategies**: the fence's account, never the active one's, on both builds; an
  ended session throws before any lookup; every strategy passes `ctx.fence` (fj, fjwc, embedded,
  FPC two-pass, FPC sponsored).
- **View executor**: three builds under the captured fence; a failed capture builds nothing.
- **Coordinator**: the full order; `assertAuthorization` rejecting means no `toTx` and no send; a
  cancel at the pre-send check never reaches `assertLive`; `assertLive` throwing means no
  `node.sendTx` and the step fails; a session end while `node.sendTx` is pending still records.
- **Classification**: `SessionEndedError` gets the `session_ended` kind synchronously, and rides
  the code channel with a lossless rebuild.
- **dApp-send executor**: the reused branch asserts, then resolves the fence's account, never the
  active one's; an ended session there fails `session_ended`; `tryConsume` refusing means no fresh
  build; all three arms bind slot, journal, build and send checks to the fence; estimate and
  preview capture at entry, and a locked wallet builds nothing.
- **Transfer executor**: journal, registration, build and send checks answer to the fence; a dead
  registration runs nothing and fails `session_ended`; reuse compares against the fence and the
  reused arm asserts first; a refused `tryConsume` never rebuilds; without a journal the transfer
  runs uncancellable and a session end still stops it at the build's assert; `estimateFee`
  captures at entry.
- **Facade** (`service.fence-entry.test.ts`): a DAPP batch without a fence throws before any task,
  capture or dispatch; a DAPP batch sends under its fence and a UI batch captures at dispatch;
  `executeSendTransaction` captures only without a fence; a source pin requires every production
  facade call to pass a fence that is not declared optional. Reverting the dispatch arm to pass
  `authorizedFence` fails that pin. The pin is textual, so aliasing can defeat it.
- **`silentInteraction`**: a lock and same-profile re-unlock after the compare dispatches under
  the compared fence, which the send refuses, with exactly one capture.
- **Auth registry**: both sends capture before their first read and send under that capture; a
  re-unlock while the authwit read is parked is refused at the send and never re-captured.

## Validation gate

| Command | Result |
|---|---|
| `cd apps/extension && bun --bun vitest run src/wallet/services/execution src/wallet/services/dapp-interaction src/wallet/services/auth-registry` | exit 0: 51 files passed, 1 skipped; 699 tests passed, 7 todo |
| `bun run typecheck:all && bun run lint` | exit 0; biome clean on the touched files (30 warnings, all pre-existing elsewhere); complexity-baseline check OK |

The first full run found two harness fakes without `captureExecutionFence`
(`fast-path.test.ts`, the auth-registry harness) and the F11 fence-shape pin; all three are listed
above. Lint found `acquireSlot` over budget and the moved `tryConsume` anchor, handled in
decisions 9 and 10.
