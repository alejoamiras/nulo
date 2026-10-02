# b01-execution-send — claude

Scope read: `apps/extension/src/wallet/services/execution/{execution-coordinator,dapp-send-executor,transfer-executor,service,execution-lane,execution-mutex,claim-helper,operation-estimate-reuse,transfer-estimate-reuse,estimate-reuse-shared,estimate-cancel-registry,preview-snapshots,operation-fingerprint,discovery-aware-estimator,rpc-cancel,mark-failed-unless-cancelled,tx-request-builder (build path),README}.ts`, `execution/fee/{fee-strategy,fee-juice-strategy,fee-juice-with-claim-strategy,embedded-strategy,embedded-fpc-cap,fpc-strategy,build-fee-strategies}.ts`, `operation-journal/{service,reaper,gc,send-check,spec (stage helpers)}.ts`, `transaction/{service,receipt-status,spec}.ts`, `task/{service,wrapped-task}.ts`, `fpc/service.ts`, `utils/in-flight-send.ts`, `profile/session-manager.ts` (expiry deferral only). Handoff edges read: `popup/windows/execute/index.vue` (approve / estimate wiring), `composables/useFeeEstimation*.ts`, `composables/internal/fee-estimation-engine.ts`, `dapp-interaction/service.ts` (`executeAndResolve`), `auth-registry/service.ts` (`waitForTx` callers), `@aztec/wallet-sdk` `base_wallet.js` (`sendTx` wait semantics).

## b01-execution-send-C-1: [Major] A popup-approved `aztec_sendTx` / NO_FROM that needs wallet-signed private authwits hard-fails at confirm whenever its preview snapshot is gone (120 s TTL, or Confirm clicked while an estimate is (re)running)

- **Severity**: Major
- **Repro confidence**: high (code-path trace; all guards and timers read directly)
- **Type**: bad error path / bad retry-or-timeout (secondary: state invariant violation)
- **Counter-example**:
  1. A dApp sends `aztec_sendTx` for a call that needs a private authwit from the user's account (token `transfer_in_private` by a DEX/escrow/bridge contract), fee kind `fj` or `fpc`. The execute popup opens; `estimateOperationFee` runs, discovery finds one authwit, and `writePreview` stashes `{discoveredHashes:[h]}` under `previewId = estimateId` in `PreviewSnapshots` (TTL 120 s, `ESTIMATE_REUSE_TTL_MS`).
  2. The user reads the approval card for 121 s (the dApp-side interaction timeout is 10 min) and presses Confirm.
  3. `approveInteraction` carries `previewId`. `takeStandardPreview` → `PreviewSnapshots.take` returns `{kind:"missing"}`: the per-entry `setTimeout(ttl+1)` already deleted it, and `take` also re-checks `builtAt`. `reuseId` becomes `undefined`, so a fresh discovery build runs, finds authwit `h`, and `assertWithinPreview({kind:"missing"}, [h])` throws `ESTIMATE_INCOMPLETE_MESSAGE` ("Fee estimate did not complete — retry the estimate").
  4. The popup has already called `closeWindow(true)`. The dApp receives a failure, the journal row is `failed`, and there is no window in which to "retry the estimate".
  - Second trigger, no timeout needed: change the fee priority, or click Confirm right after the default fee is auto-selected. `FeeEstimationEngine.schedule` immediately does `onResult(key, null)` and debounces 500 ms. `approve()` reads `feeEstimates[index]` as `undefined`, so the delta carries `estimateId/previewId: undefined`. The Confirm button is disabled only for `needsFeeSelection`/init/metadata/cancelled, not while `estimatingOps[i]` is true (`popup/windows/execute/index.vue` `:confirm-disabled`). Same `missing` → same hard failure for authwit-bearing ops.
  - NO_FROM (`default_entrypoint`) is identical: `previewOperationAuthwits` stashes a snapshot with the same TTL, and `addDiscoveredNoFromAuthwits` → `enforcePreview` throws on `missing` when discovery finds a witness.
- **Violated invariant**: the preview snapshot is the security baseline for "never sign a witness the card did not show". Its documented contract covers `missing` only as "Confirm is reachable after a **failed** estimate". The 120 s TTL was chosen for the reuse cache (bounding retained signed requests in SW memory) and was reused for the baseline. The baseline must live as long as the approval window can (10 min); a healthy, completed estimate must not degrade into the failed-estimate branch.
- **Failing path**: `dapp-send-executor.ts:704-705` (`takeStandardPreview` → `missing`, `reuseId` undefined) → `:719` `assertWithinPreview(preview, discoveredHashes)` (`preview-snapshots.ts:74`) throws; TTL deletion at `estimate-reuse-shared.ts:29` and `preview-snapshots.ts:52`; no refresh timer in `execute/index.vue` or `fee-estimation-engine.ts` (only the 500 ms debounce); NO_FROM at `dapp-send-executor.ts:1031`.
- **Expected vs actual**: expected, a confirm after a long read or a fast click still signs exactly the authorizations the card listed, or waits for the in-flight estimate. Actual, the operation is rejected with an internal-sounding message after the window has closed, and the dApp request is dead. Ops with no discovered witness pass (recomputed set is empty), so only authwit-bearing dApps are hit.
- **Recommended fix**: (a) keep `PreviewSnapshots` on its own TTL of at least the interaction timeout (10 min), or until the interaction settles. The reuse cache keeps 120 s, since a preview is hashes only. (b) Disable Confirm while `estimatingOps[i] || previewingOps[i]` for any `aztec_sendTx`. Both are small.
- **Instances**: `apps/extension/src/wallet/services/execution/preview-snapshots.ts:30,52` (shared TTL); `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:413-421,704-719,1031`; `apps/extension/src/popup/windows/execute/index.vue` (`approve` delta construction, `:confirm-disabled`).

## b01-execution-send-C-2: [Major] Non-`NO_WAIT` dApp sends return a single immediate (PENDING/DROPPED) receipt instead of waiting for inclusion, so reverts and drops are invisible to the dApp

- **Severity**: Major
- **Repro confidence**: moderate-high (upstream contract read from `base_wallet.js`; the test pins the single read; the consumer-visible effect is inferred from aztec.js usage, not executed)
- **Type**: wrong result
- **Counter-example**: a dApp calls `wallet.sendTx(payload, {from})` with no `wait` (the default in aztec.js `.send()`), and the call is approved. After `proveAndSend` returns (the tx was just broadcast), `executeAztecSendTx` does `const receipt = await node.getTxReceipt(txHash)` once, and `{receipt}` is returned. That receipt reads PENDING (or DROPPED on a load-balanced replica that has not seen the hash; `TransactionService` debounces exactly this, the dApp path does not). The dApp's `await` resolves "successfully" with no block, no fee and no `executionResult`. If the tx later reverts (`REVERTED` receipt) or is dropped, no error ever reaches the dApp.
- **Violated invariant**: `@aztec/wallet-sdk` `BaseWallet.sendTx` (the reference contract of `WalletSchema.sendTx`): "Otherwise, wait for the full receipt (default behavior on wait: undefined)" via `waitForTx(node, txHash, {…})`, which throws on revert unless `dontThrowOnRevert`. The extension's own comment in the any-ERC-20 bridge lessons records "the extension's dApp executor honours only `NO_WAIT` and reads the receipt ONCE, immediately" and works around it in one consumer; no doc declares it intended, and the test pins the call count without a `(BUG PIN)` or rationale.
- **Failing path**: `dapp-send-executor.ts:754-758` (standard) and `:935-939` (NO_FROM): `op.opts.wait === "NO_WAIT"` → txHash; else one `node.getTxReceipt`. `TransactionService.waitForTx`/the sync worker already own the inclusion signal but are not consulted.
- **Expected vs actual**: expected, resolve once mined, or throw on revert, or honor `wait` options. Actual, a pending receipt is returned immediately.
- **Recommended fix**: smallest safe change is to await the `TransactionService` pending → mined transition (it has the DROPPED debounce and the resurrection window), then return the receipt. That is bounded by the caller-supplied `wait.timeout`, or a default, with `TxConfirmationTimeoutError`. Alternatively document and pin the degraded contract.
- **Instances**: `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:757`, `:938`; pinned by `dapp-send-executor.test.ts` ("NO_WAIT returns txHash; wait returns receipt", `getTxReceipt` called once).

## b01-execution-send-C-3: [Minor] After a profile switch, every `WrappedTask` call in an in-flight send throws `Invalid task id`, so the dApp gets a raw internal error instead of the cancellation, and a broadcast tx can go unrecorded

- **Severity**: Minor
- **Repro confidence**: moderate (trace is straight-line; not executed)
- **Type**: bad error path (secondary: lost update)
- **Counter-example**: a dApp `aztec_sendTx` is proving. The user locks, picks profile B on the lock screen and unlocks it. `TaskService.onActiveProfileChanged` runs `this.tasks.clear()` (`this.profile` was A, the open event is B). `abandonDeadSessions` has already journaled the row `cancelled` and aborted its controller, but the PXE call cannot be interrupted. When it returns, `proveTxTask` runs `task.complete()` → `getTaskById` throws "Invalid task id: …". The `catch` then calls `task.fail(error)`, which throws the same error again. The original result (or `JobCancelledSentinel` at the next checkpoint) never surfaces. In `executeOperations`, `classifyOperationCatch` calls `task.cancel()`/`task.fail()` on the cleared root task from inside the catch, so `executeOperations` rejects instead of returning `{status:"cancelled"}`. `executeAndResolve` then cancels the dApp handle with the message "Invalid task id: …". The execution README promises "a swept send ends `cancelled` (the dApp gets the cancellation error)". The e2e `profile-switch-sweeps-transfer` asserts only the journal row and the feed, not the RPC error.
  - Worse window: if the clear lands during `node.sendTx` (`sendTxTask`: `await node.sendTx(tx); task.complete()`), the broadcast succeeded but `task.complete()`/`task.fail(classified)` throw, so `recordTransaction` (`addTransaction`) never runs. The tx is on the network with no activity row (the journal's `failed/from:submitting` + send-check later answers "sent"). The window is the RPC duration only, hence Minor.
- **Violated invariant**: `TaskService` is documented as bookkeeping that must never replace an operation's outcome. `waitForTx` and `balance-job-queue` guard with `task.exists`/`hasTask`; the execution pipeline's task calls do not.
- **Failing path**: `task/service.ts:241` (clear) → `execution-coordinator.ts:271,303,309` (`task.complete()`/`task.fail()` throw) and `rpc-cancel.ts:56,78,81` (`task.cancel()`/`task.fail()` before the structured result).
- **Expected vs actual**: expected, the cancel/failed result is returned with the task update best-effort. Actual, the raw `Invalid task id` replaces it.
- **Recommended fix**: make `WrappedTask.complete/fail/cancel` no-ops when `!this.exists`. That is one guard in `wrapped-task.ts` and the same idiom `waitForTx` already uses.
- **Instances**: `apps/extension/src/wallet/services/task/wrapped-task.ts:32-40`; `apps/extension/src/wallet/services/execution/execution-coordinator.ts:271,303,309`; `apps/extension/src/wallet/services/execution/rpc-cancel.ts:56,78,81`; `apps/extension/src/wallet/services/execution/transfer-executor.ts` catch (`transferTask.fail`).

## b01-execution-send-C-4: [Minor] `OperationEstimateReuse.tryConsume` lets a transient node error escape instead of returning `undefined` (confirmed quality-run lead q01)

- **Severity**: Minor
- **Repro confidence**: moderate
- **Type**: bad error path
- **Counter-example**: Confirm a popup `aztec_sendTx` holding a valid `estimateId` while the node's `getPredictedMinFees` throws a transient "block not found" (which `predictedWorstMinFees` deliberately rethrows). The entry is already popped, and `operation-estimate-reuse.ts:161` (`predictedWorstMinFees(node)`) has no try/catch (neither do `getNetwork`/`getNode`). The error passes `resolveStandardBuild` (no catch) → `runInSlot` catch → journal `failed`, and the dApp gets the raw node error. The documented contract is "a failed validation returns `undefined` and the caller rebuilds". A rebuild, a moment later, would re-query and likely succeed. The sibling `TransferEstimateReuse.tryConsume` wraps the same call and rejects softly (`:205-208`).
- **Violated invariant**: the ladder's "any check that cannot be verified ⇒ miss, never abort" (see the transfer sibling and the chain-identity/FPC steps in this same function, which do catch).
- **Failing path**: `operation-estimate-reuse.ts:159-166` → `dapp-send-executor.ts:794` (`resolveStandardBuild`).
- **Expected vs actual**: expected, miss and rebuild. Actual, terminal failure of a popup-approved send (the popup has closed).
- **Recommended fix**: wrap lines 159-166 in `try { … } catch (e) { return this.reject(\`base fee fetch failed: ${getErrorMessage(e)}\`) }`, mirroring the transfer cache.
- **Instances**: `apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:159-166` (also the unguarded `getNetwork` at `:141`; the transfer cache's unguarded `getNetwork`/`getNode` at `transfer-estimate-reuse.ts:182,196` share the shape, at lower likelihood).

## Leads adjudicated

- `q01` `operation-estimate-reuse.ts:169-175` (`tryConsume` fee fetch): confirmed, as b01-execution-send-C-4 (Minor; real line is 161).
- `q13` `transaction/spec.ts:223` (`TxConfirmationTimeoutError` loses identity over RPC): rejected. Nothing matches on the class (grep: only the throw site); the sole callers are `auth-registry` `waitForTx` paths, and the message text ("not confirmed … may still complete") survives the flattening. No wrong result.
- `q13` `account/spec.ts:68` and `q11` `queued-journal.ts:143`: not in this cluster, not adjudicated here.

## Routed to security

- none.

## Non-findings considered

- Zero-slot popup transfers (no execution mutex; concurrent transfers or a transfer racing a dApp send can select the same notes): documented and pinned in `execution/README.md` ("do not harmonize").
- Embedded-FPC cap at `getCurrentMinFees()` ×1.0 (a base-fee rise before inclusion drops the tx): documented in `embedded-fpc-cap.ts` as deliberate to satisfy the dApp's FPC budget.
- FPC two-pass finalizes gas limits from pass-1 measurement and the fee payload `maxFee` from pass-2 pre-padding: byte-parity frozen and e2e-pinned; no concrete failing input derivable from reading.
- Reaper grace windows vs long stages (`simulating` 10 min, `proving` 35 min, `submitting` 5 min): heartbeat covers mutex waiters; only a `node.sendTx` taking more than 5 min would be mis-reaped, which is not a normal-operation condition.
- Boot sweep failing `submitting` rows whose tx was broadcast: handled by `failedFrom` carrying the hash and `SendCheck` answering `sent`/`reverted`.
- Failure between `commitSubmitting` and the send (Terms re-acceptance or a storage error in `legal.assertCurrent()`) leaves a `submitting`-origin `failed` row that send-check treats as possibly-sent and eventually marks `unconfirmed`: very rare and self-resolving, no wrong financial outcome.
- `ExecutionMutex` abort/GC/capacity accounting: traced the aborted-waiter chaining (`prior.finally(release)`), the tail GC and the single decrement path; consistent.
- Claim-vs-cancel, refile-in-place and pre-claim controller registration in `claim-helper.ts`/`execution-lane.ts`: serialized by the journal transition lock; no interleaving found that loses a cancel.
- `transitionIfStage` CAS, `touchOperation`, `setSendCheck`: all take the transition lock and re-read; no lost update found.
- Estimate reuse vs fee/priority/FPC/endpoint/chain-identity changes: fingerprint binds fee settings, full `FeeOptions`, mode and `from`; ladder re-checks endpoint, pending set, chain pair, FPC identity and base fee. A miss always falls to rebuild (except C-4).
- `TransactionService` worker: DROPPED debounce, object-identity fence and resurrection window are consistent; a hung `getTxReceipt` blocking the `Promise.allSettled` tick is bounded by node-client timeouts I did not read (network cluster).
- `FpcService.updateFpcAddress` reads `existing` outside the lock (lost update against a concurrent rename): needs one user to rename and re-address the same row simultaneously; unrealistic.
- `JournalGC` evicts only `succeeded` rows; no data-loss path.

## Cross-rebuttal (claude on codex)

### 1. Codex findings, re-traced from source

- **X-1 (dApp send ignores wait options)**: agree, same as my C-2. Codex's severity (Major, high) matches mine. Codex adds that `{waitForStatus: CHECKPOINTED}` is ignored as well, which is correct, since only `NO_WAIT` is branched on (`dapp-send-executor.ts:754-757`, `:935-938`). Codex's fix (reuse upstream `waitForTx`) is simpler than mine, but it bypasses `TransactionService`'s DROPPED debounce. Partial on the fix only.
- **X-2 (cleared tasks after broadcast skip recording)**: agree on the mechanism. It is my C-3, re-traced: `sendTxTask` calls `task.complete()` after `node.sendTx` (`execution-coordinator.ts:303`), and its catch calls `task.fail()` (`:309`). Both go through `WrappedTask` with no `exists` guard (`wrapped-task.ts:32-40`), and `task/service.ts:241` clears the registry on a profile change. Partial on severity. The exposure window is one `node.sendTx` RPC, and the send has to be in flight when the active profile changes. The test at `execution-coordinator.test.ts:332` only fakes a session end, not a cleared registry. Codex's claim of a "missing transaction row" is correct. I keep Minor to Major-low. Codex's extra instances (`transfer-executor.ts:216,225`, `service.ts:702`) are worth adding to the fix scope, and I did not list them.
- **X-3 (`updateFpcAddress` stale write)**: agree that it is real. `existing` is read at `fpc/service.ts:330` and written at `:376-377` after PXE awaits (`:350-364`), and only the write is inside the lock. A concurrent rename restores the old name, and a concurrent delete resurrects the row. I had dismissed this as unrealistic, and I now reject my dismissal on the code, since the code confirms both races. Partial on severity: it needs two popup windows editing the same custom FPC inside one PXE validation window, and the damage is cosmetic (a name) or an FPC row the user can delete again. I rate it Minor, not Major.
- **X-4 (receipt persistence mutates state before `txs.set`)**: agree. `transaction/service.ts:478-486` mutates `tx.status` on the object held in `pending` before `await this.txs.set`. If the write throws, the next poll hits `status === tx.status` at `:463` and returns early. The pending entry is never removed or re-emitted until a worker restart. This is real, and I missed it. It needs a transient storage failure, so Minor is right.
- **X-5**: agree. It is my C-4, and both reports confirm q01.
- q13 `TxConfirmationTimeoutError`: both reports rejected it, so no re-decision is needed.

### 2. What Codex missed that the Claude report found

- **C-1 (preview snapshot TTL of 120 s, or a Confirm click while an estimate is re-running, hard-fails authwit-bearing sends)**: I stand by it. Codex's non-findings do not mention `PreviewSnapshots` at all. The trace is `preview-snapshots.ts:52` (TTL) → `dapp-send-executor.ts:704-719` (`missing` with a discovered hash throws).
- **C-3's RPC-error half** (the dApp sees `Invalid task id` instead of the cancellation): Codex covers only the post-broadcast half (X-2).

### 3. What both missed

None that I can support with a concrete counter-example and file:line.
