### Finding: Forced (tx-settle) gas-balance refresh can be silently overwritten by a slow pre-trigger fetch once its bounded wait-out expires

**Severity:** Critical
**Repro confidence:** moderate
**Type:** lost update / silent corruption (secondary: race)

**Counter-example:**
1. `store.ensure(SCOPE_A, {legs:['gas']})` is in flight — its raw RPC (`execution.getGasBalances`) is pending and abnormally slow (a degraded RPC endpoint, a real condition this module's own retry/backoff machinery exists to handle).
2. A transaction for the same account settles → `onTransactionSettled` (`balances.store.ts:602-611`) fires a **forced** `fetchGas` for the same key. It marks the entry `stale:true` and registers `forcedGasPending.set(key,1)` / `forcedGasSeq.set(key,1)` (`balances.store.ts:366-370`).
3. The forced run waits for the pre-trigger's raw flight to settle, but only up to `INIT_FETCH_TIMEOUT_MS` (20s) (`balances.store.ts:385-397`). The pre-trigger RPC still hasn't resolved when that bound elapses, so the forced run gives up waiting, deletes the stale flight key, and issues its **own fresh** RPC.
4. The forced run's fresh RPC returns quickly and commits: `verified`/`display` updated to the correct post-settlement balance, `stale:false` (`balances.store.ts:413-436`). Its outer `finally` then decrements `forcedGasPending` back to 0 and deletes the map entry (`balances.store.ts:453-465`) — **before** the original pre-trigger RPC has resolved.
5. The original (very slow) pre-trigger RPC finally resolves with the **pre-settlement** balance. Its commit path computes `preTrigger = opts.cause !== "forced" && forcedGasPending.has(key)` (`balances.store.ts:417`) — but `forcedGasPending` is now empty, so `preTrigger` is `false`. The stale, pre-settlement result is written into `gas.verified`/`gas.display` with `stale:false` (`balances.store.ts:418-436`), silently overwriting the correct, fresh, post-settlement balance and presenting it as verified/current.

**Violated invariant:** the module's own documented contract (`balances.store.ts:23-24`): "FORCED refreshes never join a raw flight that predates the trigger... a non-forced success while ANY forced run is live carries PRE-trigger data... it must not clear the stale-mark" (`balances.store.ts:414-417`). This guard is a *transient* counter that is cleared as soon as the forced run itself finishes, but a pre-trigger run can legitimately outlive the forced run's entire lifecycle once the bounded wait-out (an explicitly anticipated case, per the comment at `balances.store.ts:380-384`) is exercised.

**Failing path:** `onTransactionSettled` (602) → `fetchGas(cause:"forced")` (356) → bounded wait-out timeout (387-395) → own fresh RPC + commit + `finally` clears `forcedGasPending` (453-465) → original pre-trigger `fetchGas(cause:"ensure")`'s `run` resumes → commit at 411-436 with `preTrigger` false at 417.

**Expected vs actual:** Expected — once a forced (settlement-triggered) refresh has committed the authoritative post-settlement balance, no older in-flight read may ever overwrite it. Actual — an old, pre-settlement balance can silently replace it and be shown as fresh/verified, which the store's own docs call "the ONLY gating-grade data" for balance-dependent UI (fee/balance gating in `GasBalanceCard.vue`/`FeeSettingsCard.vue`).

**Recommended fix:** don't rely on the transient `forcedGasPending` counter (which the timeout path clears independently of whether the racer is still alive); instead fence non-forced commits by `forcedGasSeq`/an epoch-style "last forced trigger seen" marker so any non-forced commit whose captured trigger-seq is behind the current `forcedGasSeq` value is dropped, mirroring the existing supersession check already used for forced-vs-forced ordering at line 410.

**Instances:** `apps/extension/src/stores/balances.store.ts:366-370`, `379-397`, `410`, `413-436`, `453-465` (all one root cause: the `forcedGasPending` transient counter is used as a durability marker for a window that can outlive it).

---

### Finding: "Select Profile" popup mutates `appStore.profile` directly, bypassing the in-flight-send guard entirely

**Severity:** Critical
**Repro confidence:** moderate
**Type:** state invariant violation (secondary: race)

**Counter-example:** Wallet has ≥2 profiles. User is on `send.vue` for profile A with a send in flight (`appStore.hasInFlightSend === true`, tracked via the durable `OperationJournalServiceClient`). `Header.vue` is part of the always-mounted app shell (`popup/app.vue:271`), so its "Lock Wallet" button is visible on every page including Send; `handleLockWallet` (`Header.vue:24-28`) sets `appStore.isLogined = false` and calls `managers.profile.lockActiveProfile()` **without checking `hasInFlightSend`**. The router guard (`popup/index.ts:73`) then redirects to `/popup/auth`. There the user clicks the profile pill (`auth.vue:162`) → opens `select_profile` (mounted globally by `PopupManager.vue:326`) → picks profile B → `handleSelectProfile` runs `appStore.profile = profile` (`SelectProfilePopup.vue:31`) with **no `hasInFlightSend` check and no `commitScopeChange` wrapper at all**.

**Violated invariant:** `app.store.ts:265-286`'s own documented contract for `commitScopeChange`: "no scope change while a send is in flight... only a check with no suspension point before the write can [enforce this]." Every other scope-mutating call site in the codebase (`AccountsPopup.vue:36`, `settings/accounts/index.vue:36`, `NewAccountPopup.vue:68-70`, `networks/[id].vue:54-57+68`) routes through `commitScopeChange`/checks `hasInFlightSend` first; `SelectProfilePopup.vue:31` is a direct, unguarded write to the same ref.

**Failing path:** `Header.vue:24 handleLockWallet` (no guard) → router redirect to `popup-auth` (`popup/index.ts:73`) → `SelectProfilePopup.vue:30 handleSelectProfile` → `appStore.profile = profile` (`SelectProfilePopup.vue:31`, `app.store.ts` returned `profile` ref, no setter). Downstream: `balances.store.ts:622-628`'s `flush:'sync'` watcher immediately fences/clears profile A's balance entries; `app.store.ts:309`'s `flush:'sync'` watcher swaps `activity.store`'s active scope away from A while A's send is still outstanding and its `addAwaitingTransaction` placeholder (added against A's `activeScope` at submit time, `app.store.ts:314-316`) is orphaned in A's now-inactive slice.

**Expected vs actual:** Expected — profile/account/network can only change via `commitScopeChange`, which refuses while a send is in flight. Actual — `appStore.profile` is a plain writable Pinia ref; `SelectProfilePopup.vue` writes it directly, so the entire guard is bypassed for the one popup whose whole job is switching identity.

**Recommended fix:** route `handleSelectProfile` through `appStore.commitScopeChange(() => { appStore.profile = profile })`, mirroring `AccountsPopup.vue`'s pattern for account switches; surface the same "finish or cancel your pending transaction first" toast on refusal.

**Instances:** `apps/extension/src/popup/components/popups/SelectProfilePopup.vue:31` (the scope mutation); enabling precondition at `apps/extension/src/components/Header.vue:24-28` (locks without checking `hasInFlightSend`).

---

### Finding: `send.vue` never disconnects its `ExecutionServiceClient` unless a transfer is actually submitted

**Severity:** Major
**Repro confidence:** high
**Type:** resource leak

**Counter-example:** User opens Send, picks a token/amount (this alone triggers fee estimation via `executionService.estimateTransferFee`/`cancelEstimate`, `send.vue:271,274`, which lazily opens the client's connection), then navigates back/away **without** clicking Send. `send.vue`'s `onBeforeUnmount` (`send.vue:493-516`) explicitly disconnects `contactService`, `tokenBalanceService`, `tokenService`, and `priceService` — but never `executionService`. The only disconnect for `executionService` is inside the `.finally()` of the `executeTransfer(...)` promise chain (`send.vue:343-361`), which never runs unless `handleSend` was actually invoked.

**Violated invariant:** the same "construct-in-`<script setup>`, disconnect in `onBeforeUnmount`" convention the codebase follows elsewhere for this exact client — e.g. `popup/windows/execute/index.vue:169-173`'s `disconnectServices()` explicitly disconnects its own `ExecutionServiceClient` on teardown regardless of whether the interaction was approved/rejected.

**Failing path:** `send.vue:252` (client construction) → `scheduleFeeEstimate`/`useFeeEstimation` → `executionService.estimateTransferFee` (271) opens the connection → user navigates away → `onBeforeUnmount` (493) runs and disconnects every other service client but not `executionService`.

**Expected vs actual:** Expected — leaving the Send page always tears down every service client it opened, matching every sibling page in scope. Actual — a live port/connection to the SW is left open for the remainder of the popup's lifetime every time a user browses to Send and leaves without sending, an extremely common, fully ordinary flow, accumulating one leaked connection per visit.

**Recommended fix:** add `executionService.disconnect()` to `onBeforeUnmount` (guard against double-disconnect if a send is also in flight, e.g. via a small `disconnected` flag, mirroring `execute/index.vue`'s pattern).

**Instances:** `apps/extension/src/popup/pages/send.vue:252` (construction), `493-516` (`onBeforeUnmount`, missing disconnect), contrast with the correct pattern at `apps/extension/src/popup/windows/execute/index.vue:169-173`.

---

### Finding: `useFullBackupImport` rollback leaves a permanently orphaned, still-selectable, non-finalized profile if the compensating `deleteProfile` itself fails

**Severity:** Major
**Repro confidence:** moderate
**Type:** silent corruption / bad error path

**Counter-example:** A full-backup restore creates the new profile row (`newProfile = await profileService.restore(...)`, `useFullBackupImport.ts:379`, `createdProfileId = newProfile.id` at 387) and then fails before `finalizeRestore` runs (e.g., zero networks restored — `useFullBackupImport.ts:407-416` — or any later throw reaching the outer `catch` at 719-734). The rollback then calls `profileService.deleteProfile(...)`; if *that* RPC itself also fails (transient SW hiccup, storage error), the failure is swallowed to `console.error` only (`deleteErr` at 410-412, 542-544, 728-730) — no retry, no re-marking, no user-facing indication that cleanup failed. The profile row remains in storage and is **not** filtered by `ProfileService.getProfiles()` (`wallet/services/profile/service.ts:254-258` only excludes tombstoned/deletion-*reserved* profiles, not never-finalized ones), so it appears as a normal, selectable entry in `SelectProfilePopup`/`auth.vue`'s profile list despite never having run `finalizeRestore` — i.e., a profile whose session/PXE state was never opened.

**Violated invariant:** the composable's own documented contract (`useFullBackupImport.ts:320-323`): "a restore failure AFTER the profile row landed but BEFORE finalize must delete the orphan." This is violated whenever the compensating delete itself fails — the code anticipates the primary failure but not the failure of its own rollback.

**Failing path:** `restoreBackup` (208) → `profileService.restore(...)` succeeds, `createdProfileId` set (379-387) → a later step throws (e.g. `createdNetworks.length === 0`, 407) → rollback `profileService.deleteProfile(newProfile.id)` (409) throws → caught at `catch (err) { console.error(err) }` (410-412) → function returns with `restoreStatus:"failed"` but the orphan profile persists.

**Expected vs actual:** Expected — a failed import leaves zero trace, or an explicit, recoverable/visible broken-import marker. Actual — a genuinely broken (never-finalized) profile silently persists and is presented to the user as a normal profile to select/unlock.

**Recommended fix:** on a failed compensating delete, at minimum surface a distinct, actionable error (not just the generic "Import failed") and/or have `getProfiles()`/the profile-list UI filter out or badge non-finalized rows so the user isn't offered to "unlock" a half-restored profile.

**Instances:** `apps/extension/src/composables/useFullBackupImport.ts:407-416`, `539-551`, `719-734` (three independent instances of the same unguarded rollback-delete pattern).

---

### Finding: Incoming-trust "Allow"/"Reject" success toast can show the wrong token label if the active identity switches mid-RPC

**Severity:** Minor
**Repro confidence:** moderate
**Type:** wrong result

**Counter-example:** Trust popup is open for triple T1 (`cacheStore.incomingTrust` populated at `PopupManager.vue:92-102`). User clicks Allow → `handleAllow` awaits `cacheStore.incomingTrust.allow?.()` (`IncomingTrustPopup.vue:92`, an RPC that can take a beat if the MV3 SW needs to wake). Before that RPC resolves, the active `(profile, network, account)` triple changes (e.g., another popup switches account) — `PopupManager.vue`'s identity-switch watcher (`191-224`) detects the mismatch, closes the popup and resets `cacheStore.incomingTrust = {}` (`216-218`). When the original `allow()` RPC then resolves `true`, `handleAllow` reads `tokenSymbol.value` (computed from `cacheStore.incomingTrust.tokenSymbol ?? "Token"`, `IncomingTrustPopup.vue:55`) to build the toast label — but `incomingTrust` is now `{}`, so the toast reads "Now showing receives for Token" instead of the real symbol.

**Violated invariant:** none of trust-flip *correctness* (the RPC closure was bound to the correct, fixed `(profileId, networkId, contract)` at dequeue time, `PopupManager.vue:92-101`, so the actual trust state change is applied correctly) — only the toast's *display* value is stale because it re-reads shared, since-cleared `cacheStore` state instead of a value captured at handler-invocation time.

**Failing path:** `IncomingTrustPopup.vue:84 handleAllow` → `await cacheStore.incomingTrust.allow?.()` → (concurrently) `PopupManager.vue`'s triple watcher (191) clears `cacheStore.incomingTrust` (217) → `handleAllow` resumes, reads `tokenSymbol.value` (55) → toast built with fallback "Token".

**Expected vs actual:** Expected — the confirmation toast names the token the user just allowed/blocked. Actual — it can read "Token" generically if identity switched during the confirm RPC.

**Recommended fix:** capture `tokenSymbol.value` (and any other display fields) into a local variable before `await`ing `allow()/reject()`, rather than re-reading the computed afterward.

**Instances:** `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:84-100`, `102-112`.

---

### Finding: `activity.store`'s LRU eviction uses a write-stale `lastAccessedAt`, so a slice actively receiving live updates can be evicted ahead of a merely-viewed one, dropping an unresolved `awaiting` placeholder

**Severity:** Minor
**Repro confidence:** moderate
**Type:** state invariant violation (secondary: lost update)

**Counter-example:** `lastAccessedAt` is only ever set at slice creation (`newSlice`, `activity.store.ts:52-54`) and re-stamped by `activateScope` (185-198); it is **not** touched by `ingestTransaction`, `addAwaiting`, `removeAwaiting`, or `settleAwaiting` (`updateSlice`, 146-154, performs no such bump). A scope that was viewed once early in a session, then never revisited, but keeps receiving live transaction/awaiting writes in the background, keeps the oldest `lastAccessedAt` of all cached slices. Once the user has touched `MAX_CACHED_SLICES` (32) other scopes, `evictIfNeeded` (160-171) will pick this "cold-by-timestamp but hot-by-writes" slice for eviction ahead of slices that were merely viewed more recently but are otherwise inert — and if that slice currently holds an unresolved `AwaitingTx` placeholder (added via `addAwaitingTransaction` while it was still the active scope, `app.store.ts:314-316`), the placeholder is dropped silently (`evictIfNeeded` deletes the whole slice, `activity.store.ts:167-170`) since it has no durable-storage backing (unlike settled transactions, which the module's own doc frames as a recoverable cache).

**Violated invariant:** the module's LRU is meant to approximate "least *recently used*" for eviction priority, but a scope receiving continuous live writes is, definitionally, still in active use — the store's own doc for `evictIfNeeded` only reasons about lost *transactions* being safely re-fetchable (166: "the rows are durable"), not about the non-durable `awaiting` array.

**Failing path:** `addAwaiting` (237-241, via `app.store.ts:315`) writes a placeholder into scope S's slice while S is active → user switches away, S's `lastAccessedAt` stays fixed → ≥32 other scopes get `activateScope`d → `evictIfNeeded` (167-170) evicts S because it sorts oldest-`lastAccessedAt`-first with no write-recency signal → the placeholder is gone from `slices.value` with no trace.

**Expected vs actual:** Expected — a scope with a still-open optimistic "sending…" placeholder should not be evicted purely because it hasn't been *viewed*. Actual — it can be, since only `activateScope` refreshes recency.

**Recommended fix:** bump `lastAccessedAt` (or a separate `lastWrittenAt` folded into the eviction sort) inside `updateSlice`, or exempt slices with a non-empty `awaiting` array from eviction the same way `balances.store.ts` already exempts `forcedGasPending` keys (`balances.store.ts:239-242`).

**Instances:** `apps/extension/src/stores/activity.store.ts:52-54`, `146-154`, `160-171`, `237-241`.

## Non-findings considered

- `ticker.ts` refcounted singleton (unmount-during-tick / double-dispose): every call site (`usePrices.ts:24`, `TokensView.vue:51`, `send.vue:217`) invokes `useTicker` synchronously at top-level `<script setup>`, so Vue's `onUnmounted` always attaches to a real, single component instance with balanced increment/decrement; no call site invokes it outside a component context or more than once per unmount path — could not construct a counter-example, dropped per instructions.
- `packages/design/src/composables/outside.ts`'s `useEvent` `remove` closure calling `removeEventListener(element.value)` unconditionally (map-flagged as reachable-if-ref-clears): confirmed `useEvent` is only ever invoked internally by `useOutside` (`outside.ts:28`), always with the constant `document`, never a ref that can become null; grepped the whole extension + design package and found zero direct callers of the re-exported `useEvent` despite it being auto-import-visible — not reachable today.
- `packages/design/src/ui/Popover.vue`'s `removeOutside` null-call defect: real, but out of this cluster's file scope and explicitly marked `(BUG PIN)` / "preserved verbatim" — a documented, intentional, pinned defect per the negative list.
- `completeImportWithRecovery.ts` "double-application" on SW-restart recovery racing the original activation: traced `useProfileBootstrap.ts`'s `bootstrapActiveProfile`/`hydrateKnownProfile` and `initTransactionService` (which disconnects any prior client before reconnecting, `utils/core.ts:166-173`) — the inspected bootstrap chain looks re-entrant-safe; could not build a concrete duplicated-write counter-example within the context budget.
- `send.vue`'s `handleSend` double-click reentrancy: `isSending.value = true` is set synchronously before any `await`, so no interleaving window exists for a same-tick double-invocation.
- `execute/index.vue`'s `reject()` firing `rejectViaInteractionService(...)` without awaiting before `closeWindow(true)`: message dispatch is synchronous at call time and `closeWindow`'s actual window removal itself round-trips async via `chrome.windows.getCurrent`/`remove`; this skeleton is explicitly documented as pinned by frozen-oracle tests in `useDappApprovalWindow.ts` — no concrete failure found.
- `MigrationBarrier.vue`/`AccountIntegrityBarrier.vue` snapshot-vs-event races (`eventTouched` set, `refreshGeneration` counter): both correctly prioritize the latest event/generation over a late snapshot; no counter-example found.
- `balances.store.ts` LRU eviction of a forced-pending key: explicitly exempted (`evictIfNeeded`, line 242) and covered by `balances.store.test.ts:520` — working as designed.
- `PopupManager.vue`'s trust-queue: reviewed all three documented defenses (ingress live-triple check, dequeue-time re-check, identity-switch purge) against several additional interleavings (queue/`cacheStore` desync during watcher-deferred close, replay-vs-dequeue ordering); only the toast-label staleness above produced a concrete counter-example — the trust-flip RPC targeting itself is always correct regardless of interleaving.
- `app.store.ts`'s other direct writes to `profile`/`network`/`account` outside `commitScopeChange` (`useProfileBootstrap.ts`, `popup/app.vue`'s bootstrap watchers, `settings/security/reset.vue`, `networks/[id].vue`'s `refreshNetworks`): all are either pre-login bootstrap (no send can be in flight yet), a full local-wipe flow, or a same-identity data refresh (re-pointing to a fresh object for the *same* already-active id) — not scope switches.

## Quality handoffs

- `MigrationBarrier.vue`'s `eventTouched` Set and `AccountIntegrityBarrier.vue`'s `refreshGeneration` counter solve the identical snapshot-vs-event race with two different mechanisms — worth consolidating into one shared guard.
- `useFullBackupImport.ts`'s three `deleteProfile(...).catch(deleteErr => console.error(deleteErr))` rollback blocks (407-416, 539-551, 719-734) are copy-pasted verbatim three times — a shared `rollbackOrphanProfile()` helper would keep future fixes (including the one above) in one place.