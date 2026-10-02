## B-01 — confirmed

**Severity:** Major · **Effort:** M, 1–2 days · **Final confidence:** high

**Independent read:** Constructed the pending-receipt counter-example before reading the explanation. Verification was by source inspection; no files were modified or tests executed.

**Tightened counter-example:**

1. A dApp sends with `wait: { waitForStatus: CHECKPOINTED }`.
2. `execution-coordinator.ts:354–357` broadcasts and records the transaction without waiting for inclusion.
3. [dapp-send-executor.ts:754](apps/extension/src/wallet/services/execution/dapp-send-executor.ts:754) distinguishes only `NO_WAIT`; line 757 reads one receipt and returns it even when pending. The default-entrypoint arm repeats this at lines 935–939.

**Guards checked:** The dispatcher returns the executor’s result directly. Installed SDK `base-wallet/base_wallet.ts:547–555` actually calls `waitForTx`. The existing executor test at `dapp-send-executor.test.ts:436–460` asserts one receipt read using an immediately successful fixture; it does not establish waiting semantics or document an intentional exception.

**Refined fix:** Share an upstream-compatible `waitForTx` adapter between both arms, preserving supplied options and `NO_WAIT`. Separate confirmation waiting from broadcast bookkeeping so a confirmation timeout cannot imply that nothing was submitted. Account for the remaining SDK request deadline.

**Test to add:** Parameterize both execution arms: return `PENDING` initially, then `CHECKPOINTED`; assert a checkpoint-waiting send remains unresolved until the latter.

**ELI5:** A dApp waiting for confirmation can continue while your transaction is still pending.

## B-02 — confirmed

**Severity:** Major · **Effort:** M, approximately 1 day · **Final confidence:** high

**Independent read:** Constructed expiration followed by successful rediscovery and terminal refusal.

**Tightened counter-example:**

1. An approval estimate discovers authorization `h` and stores its preview.
2. The user keeps the session active and confirms after 121 seconds.
3. [preview-snapshots.ts:52](apps/extension/src/wallet/services/execution/preview-snapshots.ts:52) returns `missing`.
4. `dapp-send-executor.ts:704–719` rebuilds, rediscovers `h`, and rejects through `preview-snapshots.ts:74`.
5. `dapp-interaction/service.ts:196–206` already handed execution off; `popup/windows/execute/index.vue:519` closes the approval window.

**Guards checked:** Interaction timeout is ten minutes (`dapp-interaction/service.ts:62`). There is no periodic preview renewal. Preview tests explicitly verify expiration and refusal, but never combine those behaviors with a still-live approval. Confirm also lacks an estimation-in-progress guard at `index.vue:479–495,689–696`; this independently permits premature approval.

**Refined fix:** Give authorization snapshots a lifecycle independent of the 120-second build cache. Retain them through approval handoff and execution queuing, then consume or evict on completion/cancellation. Gate both the button and handler while a required preview is pending. Preserve the authorization comparison.

**Test to add:** Complete an authorization-bearing estimate, advance beyond 120 seconds while keeping the interaction live, then approve; assert the unchanged authorization succeeds through rebuilding.

**ELI5:** Reading an approval for over two minutes can make Confirm fail after the window closes.

## B-03 — partially confirmed

**Severity:** Major · **Effort:** S, 2–4 hours · **Final confidence:** high

**Independent read:** Confirmed the omitted field, but found that the cited oracle returns `Option.none()` rather than throwing.

**Tightened counter-example:**

1. Profile a registered Token `transfer_to_private` from account A.
2. `view-executor.ts:403–407` supplies scopes beginning with A.
3. [PXE service.ts:621](packages/aztec-runtime/src/pxe/service.ts:621) forwards no `senderForTags`.
4. Installed PXE `src/pxe.ts:1138` forwards `undefined`; `private_execution_oracle.ts:195` returns `None`.
5. The installed Token artifact’s embedded Noir source reaches `uint-note/src/uint_note.nr:122–127`, then `messages/delivery/mod.nr:113,150–152`, where requiring the missing default sender **does** throw.

**Guards checked:** The artifact also contains an explicit-sender override path at `messages/delivery/mod.nr:149`. Therefore “any private-log-emitting transaction” is too broad. Existing `view-executor.test.ts:354–375` mocks profiling and checks scopes only.

**Refined fix:** Add `senderForTags: scopes[0]` at the runtime adapter, matching `proveTx` and `simulateTx` in the same file and upstream `BaseWallet.profileTx`.

**Test to add:** An opt-in real-node test profiling Token `transfer_to_private` through Nulo’s adapter and asserting a successful profile result.

**ELI5:** Profiling a normal private token transfer fails because the wallet omits its default message sender.

## B-04 — confirmed

**Severity:** Major · **Effort:** M, approximately 1 day · **Final confidence:** high

**Independent read:** Constructed a valid persisted balance being misclassified as absent after the active token map is cleared.

**Tightened counter-example:**

1. A recently refreshed balance shows 1; an incoming receipt changes it to 2 and creates an unanchored refresh marker.
2. `incoming-transfer/service.ts:2230–2234` captures profile A, then pauses during storage access.
3. Lock clears the token map synchronously at `token-balance/service.ts:455–465`.
4. The old drain resumes. `token-balance/service.ts:238–244` returns `missing` because its token map is empty.
5. [incoming-transfer/service.ts:2274](apps/extension/src/wallet/services/incoming-transfer/service.ts:2274) deletes the marker.

**Guards checked:** `isCurrent()` protects lock ownership, not session identity. Reconciliation only retries never-projected rows (`reconcile-pairs.ts:145`). Unlock does refresh balances, but only those at least 30 minutes old (`utils/core.ts:148–167`), so a recently projected stale balance survives. Existing outbox tests cover background profiles and transient exceptions, not a mid-drain lock.

**Refined fix:** Fence the entire drain with captured session/profile identity and recheck before mutations. Make `requestBalanceRefresh` return retryable status while its profile map is unavailable or rebuilding. Mirror the epoch checks in `commitPublicEventLocked`.

**Test to add:** Park a drain, lock while storage is pending, then resume; assert the marker survives and a subsequent unlocked drain refreshes the balance.

**ELI5:** Locking at the wrong moment can leave a newly received payment missing from your displayed balance.

## B-05 — confirmed

**Severity:** Critical · **Effort:** M, 1–2 days · **Final confidence:** high

**Independent read:** Constructed key material from A combined with later parameterless slices from B.

**Tightened counter-example:**

1. Window 1 exports A and obtains A’s key material at [full.vue:193](apps/extension/src/popup/pages/settings/security/export/full.vue:193).
2. Window 2 completes profile creation or restore. Direct activation replaces the active session and emits B without an intermediate lock: `profile/session-manager.ts:331–338`.
3. Window 1 remains mounted: `popup/app.vue:198–218` bootstraps B without routing away.
4. Later slices resolve the active profile independently, including `account/service.ts:664,750`.
5. `full-backup-helpers.ts:137–151` seals the mixed data with a valid checksum.

**Guards checked:** Export generation changes only on unmount (`full.vue:410–416`). Restore integrity checks can reject mismatched derived accounts; imported-account reconciliation can drop rows lacking usable keys (`account/service.ts:842–852`). Those guards prevent unsafe activation, but cannot recover omitted backup material.

**Severity rationale:** An apparently successful recovery artifact can be unusable or incomplete under realistic concurrent activation. That is conditional high impact; the live wallet remains intact.

**Refined fix:** Bind key material and every slice to one backend profile/session fence, rejecting drift. Also invalidate the UI run on profile changes and capture its filename. A frontend ID comparison alone misses delayed events and A→B→A switches.

**Test to add:** Pause between A’s account and imported-key slices, activate B without unmounting, resume, and assert export aborts without publishing a downloadable artifact.

**ELI5:** Creating another profile while exporting can produce a backup that cannot restore everything it claims to contain.

## B-06 — partially confirmed

**Severity:** Major · **Effort:** S, 3–6 hours · **Final confidence:** high

**Independent read:** Constructed task-registry clearing during an awaited prove/send, causing settlement to replace the operation’s result.

**Tightened counter-example:**

1. A’s transaction reaches `execution-coordinator.ts:302`; the node accepts it but its response is delayed.
2. Another window finishes creating B, directly replacing the session. `task/service.ts:241` clears A’s tasks.
3. The send resolves. [execution-coordinator.ts:303](apps/extension/src/wallet/services/execution/execution-coordinator.ts:303) calls `task.complete()`, which throws.
4. `task.fail()` at line 309 throws again. Execution never reaches `recordTransaction` at line 355.

**Guards checked:** The report’s claimed dApp-visible “Invalid task id” is incorrect: `profile-switch-teardown.ts:121–145` disconnects the old channel, and `background.ts:1240–1246` suppresses late responses. Nevertheless, the broadcast’s transaction record is skipped. `send-check.ts:166–171` can annotate the journal and refresh balances, but does not recreate that record.

The post-broadcast case does **not** require lock plus unlock within one RPC: direct profile creation replaces the session.

**Refined fix:** Make `WrappedTask.complete/fail/cancel` tolerate missing tasks, following `transaction/service.ts:246–255`. Preserve strict `TaskService` APIs and their invalid-ID tests.

**Test to add:** Delay a successful send response, switch profiles using the real task registry, then resolve it; assert transaction recording still runs.

**ELI5:** Changing profiles during a slow send can leave a successful payment without its normal transaction record.

## B-07 — confirmed

**Severity:** Minor · **Effort:** S, 2–4 hours · **Final confidence:** high

**Independent read:** Constructed closing the window after backend registration but before the UI installs its unload handler.

**Tightened counter-example:**

1. An approval window is created and its backend removal listener is registered at `window-manager.ts:156`.
2. Its initialization is still awaiting data; `useDappApprovalWindow.ts:123–124` has not installed `beforeunload`.
3. The user closes the window.
4. [window-manager.ts:259](apps/extension/src/wallet/services/window-manager/window-manager.ts:259) rejects with a string.
5. `dapp-interaction/service.ts:488–493` propagates it; `error-envelope.ts:197` converts it to the generic wallet failure.

**Guards checked:** Explicit Reject correctly constructs `UserRejectedError` at `dapp-interaction/service.ts:250`, mapped to 4001 at `error-envelope.ts:48–55`. The existing window-manager test at line 110 checks rejection text, not classification. No intervening conversion repairs user-close.

**Refined fix:** Give dApp approval handles a typed user-close rejection, matching `rejectInteraction`. Keep window-creation failures and timeout classification separate. Installing the unload hook earlier is insufficient because unload delivery remains fallible.

**Test to add:** Hold approval initialization, trigger backend `onRemoved`, and assert the resulting wire error is 4001 with `USER_REJECTED`.

**ELI5:** Closing a loading approval window tells the dApp that the wallet failed instead of that you declined.

## B-08 — confirmed

**Severity:** Minor · **Effort:** S, 2–4 hours · **Final confidence:** high

**Independent read:** Constructed a transient fee-check failure after cache consumption, bypassing rebuilding.

**Tightened counter-example:**

1. Confirm carries a valid estimate and preview.
2. `operation-estimate-reuse.ts:129` consumes the cached build.
3. Chain and identity checks pass, but [operation-estimate-reuse.ts:161](apps/extension/src/wallet/services/execution/operation-estimate-reuse.ts:161) receives a transient `block not found`.
4. The exception escapes `dapp-send-executor.ts:794`; rebuilding at line 833 never runs, even if the next fee read would succeed.

**Guards checked:** `predictedWorstMinFees` deliberately propagates this error (`packages/aztec-runtime/src/fee-juice.ts:25–32`). That behavior is correct: silently substituting current fees could underprice the transaction. Existing reuse tests exercise fee drift, not fee-read rejection.

**Refined fix:** Catch the cache-validation fee-read failure and return a miss, following `transfer-estimate-reuse.ts:196–210`. Retain session-ending errors as hard failures and leave the shared fee helper unchanged.

**Test to add:** Make cached validation’s fee read fail once, then allow a fresh build; assert confirm rebuilds and sends successfully.

**ELI5:** A brief network hiccup while checking a saved estimate can unnecessarily fail your approved transaction.

## B-09 — confirmed

**Severity:** Minor · **Effort:** S, 1–3 hours · **Final confidence:** high

**Independent read:** Constructed a local network using a valid non-default endpoint whose reported composite chain ID is nonzero.

**Tightened counter-example:**

1. Change Local Network’s primary URL to another local port, preserving its reported L1 identity.
2. `network/service.ts:647` accepts the update using `peek.kind`.
3. [network/service.ts:734](apps/extension/src/wallet/services/network/service.ts:734) probes without that hint.
4. `_probeChainIdentity` falls through to the nonzero XOR composite at line 1010; line 735 returns `InvalidChain`.
5. `account-state/service.ts:221–228` omits that network’s contracts and senders from backup.

**Guards checked:** `probeNodeStatus` correctly handles `kind === "local"` at line 753. Existing tests explicitly support custom-port local endpoints (`network/service.test.ts:826–852`) but do not follow through into `getNodeStatus`. The omission is logged; scope is limited to customized local networks.

**Refined fix:** Pass `network.kind` into `_getChainId`, matching endpoint mutation and bounded status probing.

**Test to add:** Update a local primary endpoint to a custom port with matching L1 and nonzero composite identity; assert both status methods report `Active`.

**ELI5:** Moving your local node to another port can make the wallet label it invalid and omit its recovery data.

## B-10 — confirmed

**Severity:** Minor · **Effort:** S, 4–6 hours · **Final confidence:** high

**Independent read:** Constructed lock closing one trust prompt and its close watcher opening the next against retained identity fields.

**Tightened counter-example:**

1. Trust prompt A is open; B is queued.
2. `locked-state.ts:20–27` closes popups and marks the wallet locked without clearing its profile/network/account triple.
3. [PopupManager.vue:293](apps/extension/src/popup/components/popups/PopupManager.vue:293) reacts to the closure; lines 76–101 reopen B without checking login state.
4. Allow/Block returns `false` from `incoming-transfer/service.ts:637–638,680–681`; `IncomingTrustPopup.vue:110` still closes it.
5. Same-profile unlock rebuilds the network, but `PopupManager.vue:177–180` retains the previous replay key and suppresses replay.

**Guards checked:** Triple guards prevent cross-profile prompts, not locked prompts. Backend trust fences correctly refuse changes; pending records survive. Reopening the popup or toggling visibility can recover them. Existing tests explicitly expect closing on `false`, appropriate for deleted-token refusals, and test replay deduplication without a lock cycle.

**Refined fix:** Gate ingress, dequeue, and replay on an unlocked session. Reset replay state on lock and replay once the unlocked triple is ready. Do not universally keep `false`-result prompts open: that would retain prompts for deleted tokens.

**Test to add:** Queue two prompts, lock, then unlock the same triple; assert none opens while locked and unresolved prompts replay afterward.

**ELI5:** Token trust prompts can appear while locked, ignore your choices, and disappear until you reopen the wallet.