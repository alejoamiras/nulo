<!-- codex session 01a00a90-0a83-7641-93ae-b3cd1a1e3539 -->

### Finding: Live token-balance additions throw instead of updating the Send page

1. **Severity:** Major
2. **Repro confidence:** High
3. **Type:** crash
4. **Counter-example:** Open Send for account `0xA`, then let the balance service emit `onTokenBalanceAdded` for `0xA`—for example, after importing a token or receiving its first balance update. `onBalanceAdded` calls `.push()` on the computed `tokenBalance` ref rather than the `tokenBalances` array and throws `TypeError: tokenBalance.push is not a function`.
5. **Violated invariant:** Balance events for the active account must update the page’s `tokenBalances` collection without interrupting event processing.
6. **Failing path:** `TokenBalanceServiceClient.onTokenBalanceAdded` subscription at `apps/extension/src/popup/pages/send.vue:102` → `onBalanceAdded` at `apps/extension/src/popup/pages/send.vue:104` → active-account filter at `apps/extension/src/popup/pages/send.vue:105` → invalid `tokenBalance.push(balance)` at `apps/extension/src/popup/pages/send.vue:107`.
7. **Expected vs actual behavior:** Expected: append the new balance to `tokenBalances.value`, making it available to the selected-token computed state. Actual: an uncaught TypeError aborts the listener, and the new balance does not appear.
8. **Recommended fix:** Replace `tokenBalance.push(balance)` with `tokenBalances.value.push(balance)`. Consider deduplicating by balance ID, matching the update handler’s identity logic.
9. **Instances:** `apps/extension/src/popup/pages/send.vue:107`
10. **Certificate scope:** Directly reproducible on the normal live-add event path; no hostile input is required.

### Finding: Double-clicking a trust decision silently dismisses the next queued prompt

1. **Severity:** Major
2. **Repro confidence:** High
3. **Type:** race; secondary: lost update
4. **Counter-example:** Queue prompts A and B. While A is open, double-click Allow. This starts two `setTrustAllow(A)` requests because neither button is disabled. Resolve the first request: A closes and `PopupManager` opens B. Resolve the second request: A’s second handler emits `onClose` again, closing B even though the user never chose Allow or Block for B.
5. **Violated invariant:** Each distinct queued `(profileId, networkId, contract)` prompt must remain open until the user resolves that prompt. A completion belonging to A must not close B.
6. **Failing path:** `IncomingTrustPopup.handleAllow` at `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:84` → duplicate async calls at `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:92` → first completion emits close at `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:99` → `PopupManager` close watcher at `apps/extension/src/popup/components/popups/PopupManager.vue:297` → `dequeueNextPendingTrust` opens B at `apps/extension/src/popup/components/popups/PopupManager.vue:82` and `apps/extension/src/popup/components/popups/PopupManager.vue:103` → second A completion emits close again at `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:99`.
7. **Expected vs actual behavior:** Expected: one decision request for A, followed by an independently actionable B prompt. Actual: two A requests run, and the late completion closes B without a decision.
8. **Recommended fix:** Add a shared `isSubmitting` latch covering both Allow and Block, set it before the first await, and disable both buttons while set. Also snapshot the active payload key and only emit close if the currently displayed key still matches that snapshot.
9. **Instances:** `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:84-112`; queue advancement exposed at `apps/extension/src/popup/components/popups/PopupManager.vue:82-104` and `apps/extension/src/popup/components/popups/PopupManager.vue:297-302`
10. **Certificate scope:** Applies equally to double Allow, double Block, or one rapid Allow followed by Block.

### Finding: Failed import rollback is swallowed while a partial profile remains

1. **Severity:** Critical
2. **Repro confidence:** High
3. **Type:** bad error path; secondary: silent corruption
4. **Counter-example:** Restore creates profile `new-id`, then no network restores successfully. During rollback, the deletion tombstone write rejects—for example, because `chrome.storage.local` transiently fails. `deleteProfile(new-id)` throws before deleting the profile row, but the nested catch only logs the error. The UI reports that import failed and permits a retry while `new-id` and any already-written child data remain.
5. **Violated invariant:** The composable explicitly promises that a pre-finalize failure deletes the orphan so a retry starts clean. A failed rollback must not be presented as a cleanly failed import.
6. **Failing path:** `restoreBackup` creates the profile at `apps/extension/src/composables/useFullBackupImport.ts:379-387` → rollback path calls `deleteProfile` at `apps/extension/src/composables/useFullBackupImport.ts:408-412`, `apps/extension/src/composables/useFullBackupImport.ts:539-544`, or `apps/extension/src/composables/useFullBackupImport.ts:725-730` → profile deletion can throw while writing its durable tombstone at `apps/extension/src/wallet/services/profile/service.ts:891-913` → composable swallows the rollback error and presents the original import failure.
7. **Expected vs actual behavior:** Expected: either complete rollback, or an explicit cleanup-pending state that prevents a supposedly clean retry. Actual: rollback failure is console-only; partial imported state can survive and collide with or be duplicated by a retry.
8. **Recommended fix:** Centralize rollback in one helper and never swallow its failure. Retry deletion a bounded number of times, then surface a cleanup-specific blocking error containing the created profile ID. Do not reset to a retryable import state until deletion is acknowledged or durable deletion recovery is confirmed.
9. **Instances:** `apps/extension/src/composables/useFullBackupImport.ts:408-412`, `apps/extension/src/composables/useFullBackupImport.ts:539-544`, `apps/extension/src/composables/useFullBackupImport.ts:725-730`
10. **Certificate scope:** The counter-example uses a failure before the tombstone is persisted, so the service’s restart-time tombstone recovery cannot repair it.

### Finding: Import timeout recovery can race the still-running activation it is meant to replace

1. **Severity:** Major
2. **Repro confidence:** Moderate
3. **Type:** race; secondary: wrong result
4. **Counter-example:** The original `onActiveProfileChanged` bootstrap sets the imported profile and spends over 30 seconds in `getOrInitNetworks`. `waitForProfileActive` times out because `isLogined` has not yet been set. Recovery starts `hydrateKnownProfile`, replacing the shared network/account clients. The original bootstrap then resumes and replaces/disconnects a client recovery is using. Recovery throws and returns `"needs-unlock"`; the page routes to Auth, while the original bootstrap can subsequently finish and set `isLogined = true`.
5. **Violated invariant:** `completeImportWithRecovery` assumes that a timed-out activation is no longer capable of mutating bootstrap state. In reality, the timeout stops only its watcher; it does not cancel or join the original bootstrap.
6. **Failing path:** `popup/app.vue:onActiveProfileChanged` starts `bootstrapActiveProfile` at `apps/extension/src/popup/app.vue:132-135` → bootstrap awaits shared-client initialization at `apps/extension/src/composables/useProfileBootstrap.ts:67-78` → `waitForProfileActive` times out and stops only its Vue watcher at `apps/extension/src/composables/waitForProfileActive.ts:30-38` → `completeImportWithRecovery` immediately invokes recovery at `apps/extension/src/composables/completeImportWithRecovery.ts:52-62` → `hydrateKnownProfile` runs a second `initNetworks`/`initAccount` at `apps/extension/src/composables/useProfileBootstrap.ts:98-107`, whose disconnect-and-replace operations race the original calls at `apps/extension/src/composables/useProfileBootstrap.ts:23-30` and `apps/extension/src/composables/useProfileBootstrap.ts:53-59`.
7. **Expected vs actual behavior:** Expected: recovery either joins the existing activation or starts only after it is definitively abandoned. Actual: two bootstrap chains mutate and disconnect the same global clients, allowing false “needs unlock” routing and inconsistent transient state.
8. **Recommended fix:** Make profile bootstrap single-flight per profile ID and have both the event handler and recovery await that promise. If a retry is required, invalidate/cancel the prior generation before replacing clients and generation-guard every continuation.
9. **Instances:** Recovery trigger at `apps/extension/src/composables/completeImportWithRecovery.ts:52-62`; shared mutable bootstrap paths at `apps/extension/src/composables/useProfileBootstrap.ts:23-59` and `apps/extension/src/composables/useProfileBootstrap.ts:67-117`
10. **Certificate scope:** This requires a slow but still-live bootstrap crossing the configured activation timeout; an MV3 reconnect or slow network/account initialization is sufficient.

### Finding: Activity eviction resets the mutation fence and permits an ABA stale-fetch commit

1. **Severity:** Minor
2. **Repro confidence:** Moderate
3. **Type:** race; secondary: lost update
4. **Counter-example:** A fetch for scope A captures mutation version `0`. Switch away, then populate enough newer scopes to evict A, which deletes A’s version. A live transaction for A recreates its slice and advances the version to `1`. Further scope churn evicts A again, deleting the version back to implicit `0`. The original pre-event fetch now resolves with expected version `0`; `setTransactions` accepts it and recreates A without the live transaction.
5. **Violated invariant:** A fetch started before a live mutation must never overwrite or supersede that mutation. Mutation versions must be monotonic for the lifetime of any outstanding fetch, even when the cached slice is evicted.
6. **Failing path:** `app.store.syncTransactions` captures the version at `apps/extension/src/stores/app.store.ts:348-359` → `activity.store.evictIfNeeded` deletes both slice and version at `apps/extension/src/stores/activity.store.ts:160-170` → `ingestTransaction` recreates and mutates A at `apps/extension/src/stores/activity.store.ts:226-235` → later eviction deletes its version again → original fetch calls `setTransactions` through `apps/extension/src/stores/app.store.ts:364-370` → equality check accepts the ABA-reset version at `apps/extension/src/stores/activity.store.ts:207-216`.
7. **Expected vs actual behavior:** Expected: the original fetch is rejected as predating A’s live event. Actual: the version returns to `0`, so the stale result is accepted and the event disappears from the cached feed until a later successful refresh.
8. **Recommended fix:** Do not delete `mutationVersion` while a fetch can still reference the key. The smallest robust pattern is a store-lifetime monotonic generation map separate from the LRU data cache; eviction may remove rows but must advance, not reset, that generation.
9. **Instances:** Version deletion at `apps/extension/src/stores/activity.store.ts:169`, `apps/extension/src/stores/activity.store.ts:267`, and `apps/extension/src/stores/activity.store.ts:275`. The LRU-triggered instance at line 169 creates the stated race; explicit clear operations should likewise advance generations if outstanding fetches are allowed to survive them.
10. **Certificate scope:** Requires more than 32 recently used scopes and two evictions of A during one slow fetch, so impact is limited but the interleaving is concrete.

### Finding: Execute-window initialization leaks account and network service clients on resolution errors

1. **Severity:** Minor
2. **Repro confidence:** High
3. **Type:** resource leak; secondary: bad error path
4. **Counter-example:** Open an execute approval whose referenced account was deleted after the request was created. `getNetworkAndAccount` connects both local clients, finds no account, and throws `"Account no longer exists"`. `init` catches the error and leaves the error window open, but neither local client is disconnected.
5. **Violated invariant:** Every service client constructed by a page/window must disconnect on both success and failure. The window’s main disposal list cannot clean these two function-local clients.
6. **Failing path:** `init` constructs `AccountServiceClient` and `NetworkServiceClient` at `apps/extension/src/popup/windows/execute/index.vue:191-192` → `getNetworkAndAccount` performs requests and throws at `apps/extension/src/popup/windows/execute/index.vue:199-204` → outer catch handles the UI error at `apps/extension/src/popup/windows/execute/index.vue:322-325` → success-only disconnects at `apps/extension/src/popup/windows/execute/index.vue:295-296` are skipped.
7. **Expected vs actual behavior:** Expected: the popup may remain open to show the error, but all initialization-only ports/listeners are released. Actual: both clients remain connected for the lifetime of the failed popup document.
8. **Recommended fix:** Wrap all work after constructing the two clients in `try/finally`, moving both disconnect calls into the `finally`, matching the client-lifecycle pattern already used in `useFullBackupImport`.
9. **Instances:** `apps/extension/src/popup/windows/execute/index.vue:191-192`, with missed cleanup at `apps/extension/src/popup/windows/execute/index.vue:295-296`
10. **Certificate scope:** Any thrown network resolution, CAIP parse, missing-account, or operation-materialization error after client construction reaches the same leak.

## Non-findings considered

- **Balances profile fencing:** The synchronous departing-profile watcher and last-profile-subscriber release both increment the profile epoch; old gas/FPC legs cannot commit across either fence.
- **`forcedGasSeq` supersession:** Sequence authority is assigned synchronously before the first await, and `mySeq !== currentSeq` correctly discards older forced runs; no reproducible off-by-one commit was found.
- **App-store guard bypasses:** User-driven account and network switches are guarded. Direct profile writes found in the scoped UI occur during locked/bootstrap flows or refresh an object for the same scope, so no concrete mid-send scope escape was established.
- **Ticker singleton:** Vue invokes a registered unmount hook once, disposal is guarded by the component lifecycle, and JavaScript cannot interleave an unmount inside the interval callback; neither underflow nor unmount-during-tick corruption was reproducible.
- **Design `useEvent` cleared-ref removal:** Extension call sites pass concrete `document` or element values to `useOutside`; its internal target ref therefore does not clear before removal. Repeated `removeEventListener` calls are harmless.
- **Design `Popover` null remover:** The open→close-before-`nextTick` throw is explicitly marked and behavior-pinned in the source, so it is an intentional documented defect under this audit’s rules.
- **Import finalization retention:** Keeping a fully written profile once `finalizeRestore` starts is documented, and completion-handshake failure is intentionally isolated from rollback.
