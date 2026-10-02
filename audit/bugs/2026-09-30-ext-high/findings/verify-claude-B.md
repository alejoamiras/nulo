# Phase 4 verification, claude leg B (B-06 .. B-10)

Method: code read first from each finding's failing path, own counter-example written, then compared with the finding. All five reproduce by reading; none were executed.

## B-06 — confirmed

**Severity:** Minor
**Own counter-example (before reading the finding):** `TaskService.tasks` is cleared on a profile switch (`task/service.ts:238-241`), and `completeTask/failTask/cancelTask` all go through `getTaskById`, which throws `Invalid task id` (`:178-181`). Any long-lived holder of a `WrappedTask` therefore throws from a settlement call once the registry is cleared.
**Tightened counter-example:**
1. A dApp `sendTx` is proving (`execution-coordinator.ts:~262`, `await pxe.proveTx`).
2. The user locks, then unlocks a different profile. `onActiveProfileChanged` clears the registry (`task/service.ts:241`). `execution/service.ts:249` runs `abandonDeadSessions`, which journals the row `cancelled` and aborts the controller (`execution-lane.ts:225-239,253`).
3. `proveTx` rejects (abort) or completes. `task.fail(error)` / `task.complete()` (`execution-coordinator.ts:271,273`) throws `Invalid task id`. That throw replaces the abort error. In `classifyOperationCatch`, `task.cancel()` / `task.fail()` (`rpc-cancel.ts:78,81`) throw again, so the dApp receives a raw "Invalid task id: ..." instead of the 4001 cancellation.
4. Rare variant: a switch during `node.sendTx` makes `task.complete()` (`:303`) throw after the broadcast. `recordTransaction` is skipped. This needs lock plus unlock inside one RPC (assertLive refuses a locked session before the send), so it is unrealistic. Agree with Minor.
**Existing guards:** `WrappedTask.exists` and `hasTask` are used only by `transaction/service.ts:250` and `balance-job-queue.ts:272`. Nothing guards the execution pipeline, and no test pins the throw.
**Refined fix:** in `wrapped-task.ts`, make `complete/fail/cancel` no-ops when `!this.exists` (the `waitForTx` idiom). Leave `start/startSubtask` throwing, since those are invariant violations at creation. Keep the guard inside `WrappedTask` rather than at call sites.
**Test to add:** `wrapped-task.test.ts` — build a TaskService and a task, call `tasks.clear()` via a profile-change emit, then assert `complete()`, `fail(e)` and `cancel()` do not throw. Add a coordinator-level test: a prove that rejects after a registry clear surfaces the original error.
**Effort:** S
**Final confidence:** high
**ELI5:** You lock and unlock as another profile while a dApp send is proving, and the dApp gets a garbled "Invalid task id" error instead of "cancelled".

## B-07 — confirmed (broader than stated)

**Severity:** Minor
**Own counter-example:** `_settleUserClose` rejects with a bare string (`window-manager.ts:259`). Nothing between that and `toWalletResponseError` converts a string, so it falls to `UNCLASSIFIED_ERROR_MESSAGE` (`error-envelope.ts:~197`). The only thing that turns a close into a 4001 is the page's `beforeunload` -> `options.reject()` RPC. That listener is installed at the end of `start()` (`useDappApprovalWindow.ts:124`), after the session wait, after the `!isLogined` early return (`:118-121`) and after `await options.init()`.
**Tightened counter-example (three paths, the finding lists one):**
1. Window closed during `init()` loading: no listener, so a generic failure.
2. Window opened while the wallet is locked (the auth route, `return` at `:121` before the listener is added): the user closes the lock screen and the dApp gets a generic failure. This is the most common variant and the finding does not name it.
3. Post-init: the unload RPC races `windows.onRemoved` (crash, browser quit). The same outcome applies.
Path: `window-manager.ts:156,259` -> `dapp-interaction/service.ts:466-493` (`pending` rejects) -> `background.ts:1211-1216` -> `error-envelope.ts:197`.
**Existing guards:** none. The string is also consumed by `passkey/service.ts:119`, the other `openAndAwait` caller, so the change must not break it.
**Refined fix:** add an optional `onUserClose?: () => Error` (or `closeError`) to `OpenAndAwaitOpts`. `dapp-interaction/service.ts:466` passes `() => new UserRejectedError("Window closed by user.")`. The passkey caller keeps its current behaviour. Update the `.rejects.toMatch` window-manager tests.
**Test to add:** `dapp-interaction/service.test.ts` — open an `execute` interaction, fire the fake `windows.onRemoved` for its window, and assert the `pending` promise rejects with `UserRejectedError` (envelope code 4001).
**Effort:** S
**Final confidence:** high
**ELI5:** You close a dApp's approval window, especially while the wallet is locked, and the dApp shows a generic failure instead of "user rejected".

## B-08 — confirmed (low likelihood)

**Severity:** Minor
**Own counter-example:** `tryConsume` pops the entry first (`operation-estimate-reuse.ts:129`), then awaits `getNetwork`, `getNode` and `predictedWorstMinFees(node)` (`:141,159-161`) with no try/catch. `predictedWorstMinFees` deliberately rethrows transient errors (`fee-juice.test.ts:8-19`), and any throw escapes through `dapp-send-executor.ts:794` and skips the rebuild at `:833`.
**Tightened counter-example:** the user confirms a popup sendTx with a valid `estimateId`. The node returns "block not found" (or times out) on the base-fee read, the send fails terminally, and the popup has already closed. Retrying works.
**Caveat (lowers real impact):** the rebuild path also calls `predictedWorstMinFees` (`fee/fee-strategy.ts:289`, `fpc-strategy.ts:177`) milliseconds later. A blip that persists that long fails both paths. The fallback only helps when the blip clears between the two reads, so this is a narrow window. The same asymmetry exists against `transfer-estimate-reuse.ts:196-207`, which wraps the read in try/catch and rejects softly.
**Refined fix:** wrap `:159-166` in try/catch that returns `this.reject(...)`, as the transfer twin does. Do not wrap `SessionEndedError` (`:139`), which must stay a throw. Leave `getNetwork`/`getNode` failures as they are: a missing network is a real failure and the rebuild would throw as well.
**Test to add:** `operation-estimate-reuse.test.ts` — stub `getNode` to return a node whose fee read rejects, call `tryConsume`, and assert it resolves `undefined` (not rejects) and the entry is consumed.
**Effort:** S
**Final confidence:** high (the defect), moderate (that users ever hit it)
**ELI5:** A one-off node hiccup while you confirm a send fails the send, where a quick rebuild would have worked.

## B-09 — confirmed

**Severity:** Minor
**Own counter-example:** `probeNodeStatus` (`service.ts:751-753`) applies the local carve-out (`kind === "local"` -> chain id 0). `getNodeStatus` (`:734`) calls `_getChainId(primary.rpcUrl)` with no kind hint, so it only zeroes the id when the URL equals the seed (`:1009`). Edit the endpoint and the probe returns the XOR composite, which is not 0, so it yields `InvalidChain`. `addEndpoint`/`updateEndpoint` do pass the hint (`:600,647`), so the edit itself is accepted.
**Tightened counter-example:**
1. Settings: edit the Local Network endpoint to `http://localhost:18080` (the edit is accepted).
2. `app.store.ts:495-499` shows an InvalidChain status dot.
3. A full backup runs `account-state/service.ts:221`: `!== Active`, so `continue` with a warn log, and that chain's contracts and senders are omitted (sender export also skips it, `:101`).
Reach: Local Network is seeded in production builds (`:125`). The backup omission is warn-logged, not silent.
**Existing guards:** none for `getNodeStatus`. `probeNodeStatus` has the carve-out (this is the sibling that does it right).
**Refined fix:** `_getChainId(primary.rpcUrl, network.kind)` at `:734` (one argument), or share the `effective` computation between the two methods.
**Test to add:** `network/service.test.ts` — seed the local network, `updateEndpoint` to a non-seed URL, and assert `getNodeStatus` returns `Active` with a mock node reporting `l1ChainId=31337`.
**Effort:** S
**Final confidence:** high
**ELI5:** You move your Local Network to a different port and the wallet says the chain is invalid and leaves it out of backups.

## B-10 — confirmed (queue-drain half; the lost-prompt half is broader than stated)

**Severity:** Minor
**Own counter-example:** lock runs `seal()` -> `closePopups()` -> `popupStore.closeAll()` (`locked-state.ts:19-21`, `app.vue:177`). The `isOpened("incoming_trust")` watcher (`PopupManager.vue:293-298`) fires on true->false regardless of why the popup closed and calls `dequeueNextPendingTrust()`. That function has no login check, and `payloadMatchesLiveTriple` passes because lock does not clear `appStore.profile/network/account`. `PopupManager` is mounted unconditionally (`app.vue:461`). Only `SelectTokenPopup` is gated on `isLogined` (`:337`).
**Tightened counter-example:**
1. Prompt A is open and B is queued (two contracts pending).
2. Auto-lock fires. A closes, the watcher dequeues B, and B opens over `/popup/auth`.
3. The user clicks Allow. `setTrustAllow` -> `captureTrustFence` throws in `captureExecutionFence` -> `undefined` -> returns `false` (`incoming-transfer/service.ts:620-638`). `decide` (`IncomingTrustPopup.vue:103-110`) gets `false`, shows no toast, and `emit("onClose")` still runs, so the prompt vanishes and the queue drains.
4. After unlock `initNetworks` sets `appStore.network = undefined` then the same network (`useProfileBootstrap.ts:56,71`). The triple watcher purges the queue (`PopupManager.vue:196-199`), and `replayedForKey` still equals the old key (`:177-180`), so `tryReplayForTriple` no-ops. Contracts stay `pending` until the popup reopens.
**Broader than stated:** step 4 also hits a SINGLE open prompt A closed by the lock (no queue needed). Its re-prompt after unlock is suppressed by the same stale `replayedForKey`. This is user-visible only as a missed prompt, and the state self-heals on the next popup open.
**Existing guards:** none found. The service-side fence correctly refuses the decision while locked, so there is no security impact, just a dead prompt.
**Refined fix:** (a) `if (!appStore.isLogined) return` at the top of `dequeueNextPendingTrust`. (b) Reset `replayedForKey = null` when `appStore.isLogined` goes false (or in the triple watcher whenever the triple becomes incomplete). (c) In `decide`, keep the prompt open when `ok === false` from a fence refusal only if the popup should survive. Given (a), (c) is optional and could be skipped, since it changes UI (owner sign-off rule applies to any visible change).
**Test to add:** `PopupManager.test.ts` — with two pending payloads, emit lock (`isLogined=false` + `closeAll`) and assert `incoming_trust` does not open. Then flip `isLogined` back to true with the network cycling undefined -> same, and assert `replayPendingPrompts` is called again.
**Effort:** S
**Final confidence:** high (flow), moderate on the exact unlock ordering in step 4, which was read, not run
**ELI5:** Your wallet auto-locks with two "trust this token?" prompts waiting, the second pops up on the lock screen, does nothing when clicked, and both are forgotten until you reopen the popup.
