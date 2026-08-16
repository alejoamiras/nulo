# Consolidated bug findings — extension-mid (2026-08-16)

Reduced from 14 raw reports (b1-session-crypto, b2-transport, b3-pxe-offscreen, b4-execution,
b5-pollers, b6-storage-backup, b7-ui-state — Claude + Codex per cluster). 30 consolidated
findings survive dedup/refutation/re-anchoring. Density note: this run came in well above the
~1.2-findings/cluster planning heuristic (30 vs. an expected 6-10) — b7 (ui-state) and a single
recurring architectural gap (see Cross-cutting §1) account for most of the excess; nothing below
was kept without a concrete, independently-checked counter-example.

---

### [CRITICAL] B-01: Session persistence failures are swallowed before the requested in-memory transition, so unlock/lock RPCs report false success
**Severity:** Critical | **Repro confidence:** high | **Type:** wrong result / state invariant violation | **Found by:** both
**Instances:** `apps/extension/src/wallet/services/profile/session-manager.ts:202-233` (`open`), `:238-254` (`close`); `apps/extension/src/wallet/services/profile/service.ts:804-865` (`openSessionVerified`, no post-open `isActive` check — reached from `createProfile:260-292`, `unlockProfile:300-366`, `createPasskeyProfile:377-423`, `unlockPasskeyProfile:443-511`, `changeProfilePassword` reopen `:690-709`, `importPasswordProfile:1254-1276`, `importPasskeyProfile:1282-1319`, `finalizeRestore:1541-1607`); `service.ts:551-556` (`lockActiveProfile`), `:564-571` (`lockProfileIfActive`)
**Counter-example:** Mock `chrome.storage.session.set` to reject once (a realistic `QUOTA_BYTES` or MV3 SW-teardown-mid-write failure). Call `unlockProfile(id, pw)`. `SessionManager.open()` awaits `session.set(session)` (line 221) **before** `activeSession = {...}` (223); the write throw is caught+logged (230-232) and `open()` resolves normally — `activeSession` is never assigned, but `openSessionVerified` never re-checks `sessionManager.isActive()` afterward, so `unlockProfile` resolves a "success" `ProfileInfo` while the wallet is still actually locked (the very next `getActiveProfile()`/`getSecret()` throws "Profile locked"). Mirror case: mock `session.delete()` to reject and call `lockActiveProfile()` — `close()` catches the delete failure (251-253) before reaching `activeSession = undefined` (241-244), so "locked" is reported while the master secret stays live in memory.
**Violated invariant:** `session-manager.ts`'s own doc states a storage-write failure should still leave the in-memory secret usable — matching sibling `refresh()`, which mutates memory *before* the storage write. `open()`/`close()` invert that ordering.
**Failing path:** `unlockProfile`/`lockActiveProfile` → `openSessionVerified`/`SessionManager.close` → fallible storage write ordered before the in-memory mutation → catch swallows → caller resolves success.
**Recommended fix:** Reorder `open()`/`close()` to mutate `activeSession` first, then attempt the storage write (matching `refresh()`); have the facade assert post-call `isActive()` state before resolving success to the RPC caller.

---

### [CRITICAL] B-02: `executeSendTransaction` never acquires the ExecutionMutex slot, letting concurrent dApp sends interleave simulate/prove
**Severity:** Critical | **Repro confidence:** high | **Type:** race / state invariant violation | **Found by:** claude — codex's b4 report filed this as a non-finding ("the zero-slot behavior is explicitly pinned and documented as intentional"); **verified against source and found to be a mistaken conflation**, not honored. `dapp-send-executor.ts:6-14`'s own header states dApp sends *DO* take an execution slot, in the same breath contrasting it with the sibling `TransferExecutor`'s *actually*-intentional zero-slot exception (`transfer-executor.ts:14-17`, a different file/flow). Direct read of `dapp-send-executor.ts:373-460` confirms `executeSendTransaction` calls `beginJournal` → `buildAndEstimateValidated` → `coordinator.proveAndSend` with **no** `deps.lane.acquireSlot` call anywhere, while its two siblings `executeAztecSendTx` (line 493) and `executeNoFromSendTx` (line 660) both route through the shared `runInSlot()` helper that does acquire it.
**Instances:** `apps/extension/src/wallet/services/execution/dapp-send-executor.ts:373-460` (missing `acquireSlot`); `apps/extension/src/wallet/services/execution/service.ts:530-532` (dispatch, no wrapping lock); `service.ts:720-724` (RPC entry); `apps/extension/src/wallet/services/auth-registry/service.ts:200`, `:247` (UI callers of the same unprotected path — `revokeAuthwits`, `setRegistryEnabled`); `packages/wallet-bridge/src/dispatcher.ts:802-825` (`grantPublicAuthwit`, the dApp-reachable trigger)
**Counter-example:** A connected dApp calls the custom `grantPublicAuthwit` method twice quickly (or once, racing an in-flight `aztec_sendTx`/transfer on the same account). Both build a `{kind:"send_transaction"}` op that reaches `executeSendTransaction` with no lock — both can run `pxe.simulateTx`/`proveTx` concurrently against the same account/PXE, exactly the "two approved sendTx interleaving simulate/prove" scenario `execution-mutex.ts` exists to prevent.
**Violated invariant:** `dapp-send-executor.ts:6-14` — "Unlike the transfer flow, dApp sends DO take an execution slot... all live behind `deps.lane`" — plus `mark-failed-unless-cancelled.ts`'s header, which groups all three dApp-send pipelines as slot-protected.
**Failing path:** `dispatcher.ts:802-825` → `service.ts:530-532` → `service.ts:720-724` → `dapp-send-executor.ts:373-460` (no `acquireSlot`), contrasted with the correct pattern at `:493`/`:660` (`runInSlot`).
**Recommended fix:** Route `executeSendTransaction` through the same `runInSlot` scaffold its siblings use (acquire before the journal claim/any PXE work, release in `finally`).

---

### [CRITICAL] B-03: Boot reaper can fail a newly-started live operation on a cold service-worker start
**Severity:** Critical | **Repro confidence:** high | **Type:** race / state invariant violation | **Found by:** codex
**Instances:** `apps/extension/src/wallet/runtime.ts:267-268` (`reaper.start()` not awaited before request handling resumes); `apps/extension/src/wallet/services/operation-journal/reaper.ts:117-130` (unconditional boot sweep), `:168-200` (transition to `failed`); `apps/extension/src/wallet/services/execution/execution-lane.ts:362` (`markJournal` swallows the now-rejected transition)
**Counter-example:** On a cold SW start, delay `chrome.alarms.create()`. `createWalletRuntime.start()` launches `reaper.start()` without awaiting it and immediately installs the wallet-SDK handler. Start a transaction, creating its `pending` journal row, before `alarms.create()` resolves. When it resolves, the reaper's unconditional boot sweep includes that brand-new row (no "predates this worker" cutoff) and fails it, even though its pipeline is live in the *current* worker.
**Violated invariant:** `JournalReaper.start()`'s own comment asserts every non-terminal row it sees "by construction" predates the current worker — untrue when a new row is created during the startup race.
**Failing path:** `runtime.ts:267` → `reaper.ts:117/130` → `reaper.ts:168/200` → `execution-lane.ts:362` (subsequent cancellation/status updates against the now-failed record are silently rejected).
**Recommended fix:** Capture a boot cutoff timestamp before starting the reaper; the unconditional sweep only fails rows with `createdAt < cutoff`. Consider awaiting the initial sweep before publishing liveness/installing the SDK handler.

---

### [CRITICAL] B-04: Profile switch while a token-balance refresh is queued permanently jams that balance's sync (orphaned `pendingTasks` entry)
**Severity:** Critical | **Repro confidence:** high | **Type:** lost update / resource leak | **Found by:** both
**Instances:** `apps/extension/src/wallet/services/token-balance/balance-job-queue.ts:159-167` (task-start loop, outside `try`/`finally` — primary), `:238-242` (the `finally` skipped by the throw); `apps/extension/src/wallet/services/token/service.ts:361`, `:401-406` (`updateToken`, self-recovering lower-impact variant), `:541`, `:629-634` (`parseTokenInterface`, same pattern)
**Counter-example:** Profile A active; a balance event enqueues a refresh for `TokenBalanceRaw` id 42 (`BalanceJobQueue.enqueue` mints a `Pending` `TaskService` row, `pendingTasks.set(42, taskId)`). Before the next 1s tick, the user switches to profile B — `TaskService.onActiveProfileChanged` unconditionally clears **all** tasks, but `TokenBalanceService.onActiveProfileChanged` only rebuilds its own `tokens` map, never touching `BalanceJobQueue`'s `queue`/`pendingTasks`. The next tick dequeues balance 42 and calls `startTask(staleTaskId)`, which throws "Invalid task id" **before** `syncBatch`'s `try`/`finally` is entered, so the cleanup never runs — `pendingTasks[42]` is left pointing at a dead task forever. Every future `enqueue(42)` sees `pendingTasks.has(42)===true` and skips minting a fresh task, hitting the identical throw on every subsequent tick. Balance 42 never syncs again for the SW's remaining lifetime.
**Violated invariant:** `balance-job-queue.ts`'s own doc says `pendingTasks` "prevents double-creation of a TaskService record," assuming an entry always names a live task — untrue across `tasks.clear()` on profile switch. The sibling `IncomingTransferService.readTaskState` already defends against a vanished task id via `try/catch`; `syncBatch`'s task-start loop does not.
**Failing path:** as above.
**Recommended fix:** Have `TokenBalanceService.onActiveProfileChanged` also reset the queue's `pendingTasks`/`queue` (mirroring its own `tokens.clear()`); wrap `syncBatch`'s `startTask`/`startNewTask` calls in `try/catch` and mint a fresh task on failure instead of letting the exception escape before `finally` runs.

---

### [CRITICAL] B-05: `TokenBalanceService.onActiveProfileChanged` has no incarnation check, so a slow rebuild from an earlier profile switch can overwrite the current profile's token-ownership map with the wrong profile's tokens
**Severity:** Critical | **Repro confidence:** high | **Type:** race / wrong result | **Found by:** codex
**Instances:** `apps/extension/src/wallet/services/token-balance/service.ts:240-248` (`onActiveProfileChanged`, no generation guard around `tokens.clear()`+repopulate — verified in source), `:138-150` (`getTokenBalances` trusts that map for ownership filtering), `:103-107` (callback write/emit ownership checks)
**Counter-example:** Profile B unlocks; its `getTokensRaw(B)` read stalls. The user locks and unlocks profile C; C's read completes first, populating `tokens` with C's tokens. B's older read then completes and **repopulates the same shared map with B's tokens**. `this.profile` is still C, but `getTokenBalances()` now filters using B's token ids — B's balances can be returned inside C's session.
**Violated invariant:** `TokenBalanceService.tokens` is documented/used as an active-profile-only ownership map.
**Failing path:** `session-manager.ts:202-225` (profile transition) → `service.ts:148-153` (forwarded) → `token-balance/service.ts:240-248` (no incarnation check) → `:138-150` (unsafe ownership read).
**Recommended fix:** Add a monotonic profile-generation counter, captured synchronously at handler entry; populate into a temp map and commit only if the generation and current profile still match after the awaits.

---

### [CRITICAL] B-06: Two concurrent wallet-sdk sessions for the same `(origin, chainId)` can overwrite each other's verification hash, showing the WRONG emojis in a verify window
**Severity:** Critical | **Repro confidence:** high | **Type:** race / wrong result | **Found by:** codex
**Instances:** `apps/extension/src/wallet/services/wallet-sdk/background.ts:212`, `:220`, `:222`, `:247`; `apps/extension/src/wallet/services/dapp-session/service.ts:203`; `apps/extension/src/popup/windows/verify/index.vue:140`, `:149`, `:155`, `:77` (shared "Always trust" write)
**Counter-example:** Two tabs for the same `(origin, chainId)` complete key exchange close together, producing active sessions A and B with distinct hashes HA/HB. A stores HA and opens its verify window; before that window's data loads, B stores HB on the same shared `DappSession` row. A's window reads the shared row and displays B's emojis — clicking "Always trust" trusts the shared session having verified the WRONG channel.
**Violated invariant:** displayed emojis must derive from that exact session's own `verificationHash`; the code explicitly supports multiple live `ActiveSession`s sharing one stored `DappSession`.
**Failing path:** upstream SDK installs each session and invokes the callback → `background.ts:212/220/222` overwrites the shared hash → both windows read the shared `dappSession.id` (247) → `verify/index.vue` reloads that row and shows its current hash.
**Recommended fix:** Key verification state per active wallet-SDK session (`{activeSessionId, dappSessionId, verificationHash}`), not the tuple-level `DappSession.verificationHash`.

---

### [POTENTIAL CRITICAL] B-07: `openChainStore`'s 30s timeout doesn't cancel the underlying OPFS worker, so a same-chain retry can wedge that chain's PXE indefinitely
**Severity:** Potential Critical (downgraded from Critical — high impact but the triggering OPFS-hang condition is environment-dependent and not independently executable) | **Repro confidence:** moderate | **Type:** resource leak / bad retry-or-timeout | **Found by:** both
**Instances:** `packages/aztec-runtime/src/pxe/opfs-store.ts:56-95` (timeout race + fire-and-forget cleanup); `packages/aztec-runtime/src/pxe/chain-runtime.ts:140-174`, `:304-315` (unwrapped call sites); `packages/aztec-runtime/src/pxe/service.ts:842-849`, `:875-899` (chain guard released at the 30s mark regardless of the abandoned open)
**Counter-example:** `openChainStore` races the real `AztecSQLiteOPFSStore.open()` against a 30s timeout. When the worker's init protocol hangs (confirmed against the vendored `kv-store` worker: `installOpfsSAHPoolVfs` can hang on an exclusive OPFS SAH-directory lock a prior handle hasn't released), the timer wins, `openChainStore` throws, and schedules only a fire-and-forget `openPromise.then(s=>s.close())` — nothing bounds `openPromise` itself, so if it never settles the worker (and the SAH-pool lock) is never released. `ReadWriteGuard.write()`'s `finally` releases the per-chain lock at the 30s mark regardless, so a retry on the same chain spawns a second worker contending for the same exclusive lock — potentially hanging again, or forever.
**Violated invariant:** `opfs-store.ts`'s own comment says the abandoned open's eventual close prevents "permanently wedg[ing] every later open of this dir" — a guarantee that depends on `openPromise` eventually settling, which isn't guaranteed.
**Recommended fix:** Track/single-flight the in-flight (possibly abandoned) open per `chainDataDir` instead of racing a fresh worker against a zombie one; or make the underlying open cancellable (terminate the `Worker` on timeout) so the lock releases synchronously.

---

### [POTENTIAL CRITICAL] B-08: A forced (tx-settle) gas-balance refresh can be silently overwritten by a slow pre-trigger fetch once its bounded wait-out expires
**Severity:** Potential Critical (downgraded from Critical — the doc's own comment anticipates the bounded wait-out case, but the window requires an abnormally slow RPC leg) | **Repro confidence:** moderate | **Type:** lost update / silent corruption | **Found by:** claude
**Instances:** `apps/extension/src/stores/balances.store.ts:366-370`, `:379-397`, `:410`, `:413-436`, `:453-465` (the `forcedGasPending` transient counter used as a durability marker for a window that can outlive it)
**Counter-example:** `store.ensure(SCOPE_A,{legs:['gas']})` is in flight (abnormally slow RPC). A transaction settles → `onTransactionSettled` fires a forced `fetchGas` for the same key, marking `stale:true` + `forcedGasPending.set(key,1)`. The forced run waits for the pre-trigger flight up to `INIT_FETCH_TIMEOUT_MS` (20s); when that elapses it gives up, deletes the stale flight key, issues its own fresh RPC, commits the correct post-settlement balance, and its `finally` clears `forcedGasPending` — **before** the original pre-trigger RPC resolves. When that original RPC finally resolves with the stale pre-settlement balance, its `preTrigger` check (`opts.cause!=="forced" && forcedGasPending.has(key)`) now reads false (the map is empty), so the stale result is written `stale:false`, overwriting the correct fresh balance.
**Violated invariant:** `balances.store.ts:23-24` — "a non-forced success while ANY forced run is live carries PRE-trigger data... must not clear the stale-mark" — the `forcedGasPending` counter is transient and clears independently of whether the racer is still alive.
**Recommended fix:** Fence non-forced commits by `forcedGasSeq` (an epoch-style "last forced trigger seen" marker) instead of the transient pending counter, so any non-forced commit whose captured trigger-seq is behind the current `forcedGasSeq` is dropped.

---

### [POTENTIAL CRITICAL] B-09: "Select Profile" popup writes `appStore.profile` directly, bypassing the in-flight-send guard entirely
**Severity:** Potential Critical (downgraded from Critical — requires the specific Lock-Wallet-mid-send navigation sequence) | **Repro confidence:** moderate | **Type:** state invariant violation | **Found by:** claude
**Instances:** `apps/extension/src/popup/components/popups/SelectProfilePopup.vue:31` (unguarded scope mutation); `apps/extension/src/components/Header.vue:24-28` (`handleLockWallet` locks without checking `hasInFlightSend`, the enabling precondition)
**Counter-example:** ≥2 profiles exist; user is on `send.vue` for profile A with a send in flight (`appStore.hasInFlightSend===true`). `Header.vue`'s "Lock Wallet" button is visible on every page (always-mounted app shell) and `handleLockWallet` locks without checking `hasInFlightSend`, redirecting to `/popup/auth`. There the user opens `select_profile` and picks profile B — `handleSelectProfile` runs `appStore.profile=profile` directly, with no `hasInFlightSend` check and no `commitScopeChange` wrapper (unlike every other scope-mutating call site: `AccountsPopup.vue`, `settings/accounts/index.vue`, `NewAccountPopup.vue`, `networks/[id].vue`).
**Violated invariant:** `app.store.ts:265-286`'s own `commitScopeChange` contract — "no scope change while a send is in flight."
**Recommended fix:** Route `handleSelectProfile` through `appStore.commitScopeChange(() => { appStore.profile = profile })`, surfacing the same refusal toast as the other guarded call sites.

---

### [MAJOR] B-10: Zeroize-discipline gap — several crypto exit paths abandon locally-owned secret buffers when an exception fires before their owning `try/finally` is entered
**Severity:** Major | **Repro confidence:** high | **Type:** resource leak / state invariant violation | **Found by:** both (claude: F-007 instance; codex: setup-throw instances — same bug shape, merged)
**Instances:** `apps/extension/src/wallet/services/profile/service.ts:480-482` (`unlockPasskeyProfile`'s F-007 credential-mismatch throw fires **before** the `try{...}finally{zeroize(recovery.secret)}` starting at line 485 — the two sibling call sites of the identical check, `exportPlain` (`:1110-1117`) and `restore()`'s passkey branch (`:1451-1454`), both correctly zeroize on this exact mismatch); `packages/wallet-crypto/src/password-secret-box.ts:81` (`seal`), `:145` (`reseal` new passhash); `service.ts:262` (`createProfile`), `:323` (`unlockProfile`), `:1001` (`importEncrypted`), `:1040` (`importMnemonic`), `:1576` (`finalizeRestore`)
**Counter-example:** Call `unlockPasskeyProfile(id, credentialData)` where the recovered credential's id differs from the profile's stored `credentialId` (an explicitly anticipated case per the code's own comment — "Credential rotated during prompt"). The mismatch throw at `service.ts:480-482` fires before the `finally` at `:507-510` that would zeroize `recovery.secret` — the raw 32-byte WebAuthn-PRF master secret lingers until GC. Same shape for `importMnemonic`: pass an invalid mnemonic — `passhash` is derived (1040), `getEntropy()` throws (1041) before `importPasswordProfile` (and its finalizer) is ever entered.
**Violated invariant:** the package-wide "every exit path reaches `zeroize()`" discipline, which `SessionSecretBox.unwrap()` was explicitly restructured to enforce.
**Recommended fix:** start the owning `try/finally` immediately after each secret allocation; for `unlockPasskeyProfile` specifically, mirror `exportPlain`'s `try{if(mismatch)throw}finally{zeroize(recovery.secret)}` pattern.

---

### [MAJOR] B-11: Abandoned passkey full-backup restore leaves the recovered master secret parked un-zeroized in `pendingRestoreSecrets` for the rest of the SW's lifetime
**Severity:** Major | **Repro confidence:** high | **Type:** resource leak / state invariant violation | **Found by:** claude (codex's b1 non-finding — "worker teardown clears the in-memory map" — doesn't refute this: claude's own finding already scopes impact to "for the rest of the SW's lifetime," which codex's note confirms rather than contradicts; no counter-trace showing earlier cleanup was supplied)
**Instances:** `apps/extension/src/wallet/services/profile/service.ts:107` (field), `:1499-1500` (unzeroized stash — "The map takes ownership — DO NOT zero in finally"), `:1595-1605` (`finalizeRestore` — the only happy-path cleanup), `:919-923` (`deleteProfile` — the only abort-path cleanup, requires the caller to know to call it)
**Counter-example:** Start a passkey full-backup import via `useFullBackupImport.restoreBackup()`. `profileService.restore(...)`'s passkey branch writes the profile row and does `pendingRestoreSecrets.set(id, recovery.secret)` — deliberately not zeroized on this path. If the popup context is torn down (navigate away, extension UI dismissed) before `finalizeRestore()` or `deleteProfile()` ever runs for `id`, nothing throws, so `useFullBackupImport`'s own compensating `deleteProfile` cleanup never executes. No timeout, GC sweep, or SW-boot cleanup path exists for this entry.
**Violated invariant:** the "secrets are zeroized after their last legitimate use" discipline this package documents as its most audit-worthy pattern class.
**Recommended fix:** add a bounded staleness sweep for `pendingRestoreSecrets` (timestamp entries, zeroize+delete anything older than a short TTL on the next `restore()`/`finalizeRestore()`/`deleteProfile()` call).

---

### [MAJOR] B-12: A failed tombstone write leaves a live profile falsely reserved for the rest of the service-worker's life
**Severity:** Major | **Repro confidence:** high | **Type:** state invariant violation / bad error path | **Found by:** codex
**Instances:** `apps/extension/src/wallet/services/profile/service.ts:911` (`deleteProfile` phase 1); `apps/extension/src/wallet/services/profile/profile-deletion-state.ts:57` (`beginDeletion` reserves + bumps epoch); `apps/extension/src/wallet/services/profile/tombstone-repository.ts:43` (the write that can reject)
**Counter-example:** With profile `p1` present, make the tombstone `storage.local.set` reject. `deleteProfile("p1")` runs `beginDeletion("p1")` (reserves + increments epoch) then throws while writing the tombstone — no rollback runs. `getProfiles()` now hides `p1`, unlock rejects it as invalid, and another delete also rejects it, until the SW restarts.
**Violated invariant:** a reserved id is meant to represent a deletion backed by a durable, resumable tombstone — here the reservation exists with no backing record and no cleanup path.
**Recommended fix:** write the tombstone first, then reserve/hydrate in-memory state (commit-pair ordering); on an ambiguous rejection, read the tombstone back and restore the prior epoch/reservation if it didn't land.

---

### [MAJOR] B-13: `onSessionEstablished` isn't fully guarded — distinct failure branches each leave inconsistent state: a leaked `pendingVerification` entry, or an active session that skips required verification entirely
**Severity:** Major | **Repro confidence:** high | **Type:** resource leak / bad error path | **Found by:** both (claude: F-006 leak branch; codex: verification-write-failure branch — same ungarded callback, merged)
**Instances:** `apps/extension/src/wallet/services/wallet-sdk/background.ts:212-256` (the whole callback, no enclosing `try/catch/finally`); `:223-238` (F-006 branch — `DappSession` missing — `return` at 237 skips the `pendingVerification.delete` cleanup at 240-242); `:222` (`setVerificationHash` write, can reject with no local containment); `:244` (fire-and-forget `chrome.windows.create`, never awaited/caught); `apps/extension/src/wallet/services/dapp-session/service.ts:203-210`
**Counter-example (leak):** a dApp session is approved and `pendingVerification.add("O|C")` runs; before key exchange completes, the user disconnects that origin in settings, deleting the `DappSession` row. `onSessionEstablished`'s lookup returns `undefined`, the `else` branch logs+terminates+`return`s at line 237 — before the cleanup at 240-242 — so `"O|C"` survives in `pendingVerification` for the SW's remaining lifetime.
**Counter-example (unverified live session):** key exchange succeeds, but the signed `setVerificationHash` write (line 222) rejects (transient storage unavailability). The upstream handler already inserted the session into `activeSessions` and doesn't await this callback's promise, so the rejection is unhandled: cleanup and verification-window creation never run, and the session remains live — accepting messages — without ever presenting the verification UI.
**Violated invariant:** every `pendingVerification.add()` is assumed matched by a `delete()`; more broadly, a connection requiring verification must either finish setup or be terminated, never silently continue unverified.
**Recommended fix:** wrap the whole callback in `try/catch/finally` — clear `pendingVerification` in `finally`, await `chrome.windows.create`, and terminate the specific active session if verification persistence or popup creation fails.

---

### [MAJOR] B-14: `handleRequestCapabilities` persists an approved capability grant across multiple independently-locked writes with no re-verification, so a concurrent revoke or a second concurrent approval can silently lose the decision
**Severity:** Major | **Repro confidence:** high | **Type:** bad error path / lost update | **Found by:** both (claude: delete-mid-sequence variant; codex: concurrent-dispatch variant — same unguarded write sequence, merged)
**Instances:** `packages/wallet-bridge/src/dispatcher.ts:963-1042` (the unguarded write sequence: `updateDappSession`/`setAccountAliases` `~983-991` → `setCapabilityGrants` `1030` → `setCapabilityRejections` `1039` → reload `1042`), `:396`, `:876`, `:977-991`, `:1025-1039`; `apps/extension/src/wallet/services/dapp-session/service.ts:161-179`, `:169-171`, `:225-244`, `:228`, `:239`, `:253-261`, `:256`; `packages/wallet-bridge/src/services-contract.ts:88-96`
**Counter-example (delete mid-sequence):** after the popup approves a capability request, another window's "Disconnect" deletes that `DappSession` row while the multi-step persistence sequence is still running — whichever write executes next throws a plain `Error("Invalid id")`, propagating uncaught to `toWalletResponseError` and collapsing to the bare string `"Invalid id"`. The user's approval is discarded and the dApp sees a cryptic, unrelated error.
**Counter-example (concurrent approvals):** two tabs backed by the same stored `DappSession` approve different capabilities close together; both dispatches snapshot the row before either writes. Tab A writes its accounts/grants; tab B then writes arrays computed from its own stale (pre-A) snapshot, silently overwriting A's just-committed approval — both RPCs report success, but the final row contains only B's state.
**Violated invariant:** `dispatcher.ts:390-396`'s own "captured ONCE at dispatch entry" doc closes TOCTOU on reads but not on this multi-step *write* sequence, each step independently re-acquiring the lock.
**Recommended fix:** add one `applyCapabilityDecision` mutation that reacquires the latest row under the lock and merges the approved delta/accounts/aliases/rejections in a single write, instead of the dispatcher pushing precomputed whole-row arrays across several separately-locked calls.

---

### [MAJOR] B-15: RPC timeout does not cover connection establishment — a wedged transport can hang a request forever regardless of its configured timeout
**Severity:** Major | **Repro confidence:** high | **Type:** bad retry-or-timeout | **Found by:** codex
**Instances:** `packages/extension-messaging/src/core/base-client.ts:101-125`; `packages/extension-messaging/src/background/client.ts:45-63`, `:101-120`; `packages/extension-messaging/src/offscreen/client.ts:97-100` (same ordering gap)
**Counter-example:** an existing extension page calls an RPC after an extension update invalidates its context; `chrome.runtime.connect()` repeatedly throws "Extension context invalidated." Even with `requestTimeoutMs:500`, the request never rejects, because `base-client.ts` awaits `ensureTransportReady()` **before** creating the pending correlator entry — the timeout timer only installs after readiness succeeds — and `connect()` catches every failure and retries forever.
**Violated invariant:** `DEFAULT_RPC_TIMEOUT_MS` is documented as the upper bound protecting against a wedged service worker; readiness failure is part of the RPC lifecycle and must not bypass that bound.
**Recommended fix:** establish a total request deadline before awaiting readiness; pass the remaining deadline/an abort signal into connection waiting and reject with a typed timeout/disconnection error when readiness can't be achieved in time.

---

### [MAJOR] B-16: Queued discovery requests can vanish on service-worker restart, or be approved after the dApp has already stopped waiting
**Severity:** Major | **Repro confidence:** high | **Type:** bad retry-or-timeout / lost update | **Found by:** codex
**Instances:** `packages/wallet-bridge/src/discovery-queue.ts:5`, `:22`, `:39-55`, `:62-99`; `apps/extension/src/wallet/services/wallet-sdk/background.ts:324`, `:383-410`, `:486-498`
**Counter-example:** the wallet-sdk's default 60s discovery timeout means the dApp removes its response listener at t=60s. If the wallet is locked at t=0 and the user unlocks at t=61s, Nulo still treats the queued discovery as live (its own stale threshold is 5 minutes) and can open/approve a connection the dApp can no longer complete. Conversely, if the MV3 worker is reclaimed around t=30s and the user unlocks at t=40s, the in-memory-only queue has already vanished even though the dApp is still waiting.
**Violated invariant:** a queued discovery must remain available exactly while its requester can consume approval — neither lost on ordinary SW teardown nor processed after the producer's own timeout.
**Recommended fix:** give queued discoveries an explicit, SDK-compatible expiry (≤60s, not 5 minutes) and make the queue restart-safe (persist to `chrome.storage.session`, reconcile on SW boot).

---

### [MAJOR] B-17: Offscreen document lifecycle has three unfenced-continuation gaps — a late Firefox window-create can clobber the live tracked window, an initializing document is treated as request-ready, and timeout cleanup isn't joined before a successor pass is admitted
**Severity:** Major | **Repro confidence:** moderate-to-high (health-check readiness gap independently high-confidence; Firefox and timeout-join gaps moderate) | **Type:** resource leak / state invariant violation | **Found by:** claude (Firefox pass-fence) + codex (readiness + timeout-cleanup gates)
**Instances:** `apps/extension/src/wallet/utils/offscreen.ts:224-243` (Firefox `firefoxOffscreenWindowId` assignment has no `passId===passSeq` fence, unlike the Chromium branch at `:212`), `:160-177`, `:260-270`, `:57-61`; `apps/extension/src/offscreen/index.ts:12-19` (PING/PONG installed before PXE init), `:91-116` (READY not sent until init completes); `apps/extension/src/wallet/utils/offscreen.ts:123-146`, `:292-300` (`doEnsureOffscreenRunning` accepts any PONG as readiness); `:92-104`, `:283-314` (`onOffscreenTimeout`'s `closeOffscreen()` promise discarded before the single-flight gate clears)
**Counter-example (Firefox):** pass A's `chrome.windows.create()` doesn't resolve within the 10s ready timeout; `onOffscreenTimeout` fires but `firefoxOffscreenWindowId` is still `null` (a no-op close). Pass B creates fresh, sets `firefoxOffscreenWindowId=winB.id`, and completes. Pass A's original `create()` then finally resolves and — with no `passId===passSeq` guard, unlike the Chromium branch — unconditionally overwrites the tracked handle to `winA`, orphaning the actually-live `winB` (never closeable afterward).
**Counter-example (readiness):** the offscreen page installs its PING listener immediately, before `PxeService` is registered. If the SW restarts mid-init, `ensureOffscreenRunning` finds the existing document, its early PING listener returns PONG, and the caller proceeds to send a PXE RPC before `PxeService` exists — a missing-handler failure/timeout instead of a clean readiness wait.
**Counter-example (timeout-cleanup race):** pass A's 10s ready timeout fires `closeOffscreen()` without awaiting it, then clears the single-flight gate; pass B is admitted immediately and creates/adopts a document while A's `chrome.offscreen.closeDocument()` is still pending — A's late close can tear down B's document.
**Violated invariant:** the module's own `passSeq`/`offscreenPromise` fencing is documented to prevent "a timed-out pass's zombie continuation" from tearing down a successor's live document — each gap above is a structurally parallel case the fence doesn't cover.
**Recommended fix:** gate the Firefox branch's window-handle assignment behind the same `passId===passSeq` check as Chromium; keep an offscreen-local `servicesReady` flag and withhold PONG (or return a distinguishable "initializing" state) until PXE init completes; track the timeout's close as a shared promise and await/join it before clearing the single-flight gate or admitting a successor.

---

### [MAJOR] B-18: Chain purge can be followed by resurrection from an operation that entered during the erase
**Severity:** Major | **Repro confidence:** high | **Type:** race / state invariant violation | **Found by:** codex
**Instances:** `packages/aztec-runtime/src/pxe/service.ts:626-644` (`clearChainState` bumps the purge epoch before its awaited cleanup), `:828-848`, `:875-893` (`withPxeWrite`/`Read` capture the epoch); `packages/aztec-runtime/src/pxe/chain-runtime.ts:304-314` (`registry.ensure` recreates), `:140-169` (factory reopens the store)
**Counter-example:** runtime `(p1, 31337)` exists; `clearChainState` acquires the write guard and bumps the purge epoch 0→1 while it disposes/removes the store. An operation using previously-obtained `NetworkInfo` calls `withPxeWrite` during this window, captures epoch 1, and waits on the same guard. Once the purge releases the guard, the waiting operation's captured epoch (1) passes the equality check and `registry.ensure()` recreates the runtime and OPFS directory — the "network deletion" reports success while PXE state has been resurrected.
**Violated invariant:** `clearChainState`'s own comment says an overlapping operation must not recreate "a fresh OPFS store dir for a chain whose network row is gone."
**Recommended fix:** advance the epoch a second time at the *end* of the destructive section, immediately before releasing the guard, so operations that captured either the pre-purge or in-progress epoch fail, while genuinely-post-purge calls capture the stable final epoch.

---

### [MAJOR] B-19: `predictedWorstMinFees`'s generic "not found" substring match silently downgrades inclusion-safe fee prediction to a potentially-stale current fee
**Severity:** Major | **Repro confidence:** moderate | **Type:** bad error path / wrong result | **Found by:** codex (claude's b4 report separately reviewed this same function and called the regex "intentional and correctly conservative," but did not examine this specific "not found" mismatch scenario — not a true refutation of codex's independently-traced counter-example)
**Instances:** `packages/bridge-core/src/fee-juice.ts:39`, `:46`, `:50`
**Counter-example:** a node's `getPredictedMinFees()` rejects with `Error("Block 123 not found")` during a transient sync/reorg condition, while `getCurrentMinFees()` returns a lower fee. The catch's broad `/not found|.../` regex treats the unrelated "not found" text as proof the RPC method is unsupported and silently falls back to the current (potentially too-low) fee, instead of propagating the error.
**Violated invariant:** the function's documented contract says only old-node/unsupported-method failures may fall back; transient RPC failures must propagate since current fees aren't an inclusion-safe substitute.
**Recommended fix:** match a structured JSON-RPC method-not-found code (`-32601`) or an anchored, method-specific message naming `getPredictedMinFees`, not a generic substring.

---

### [MAJOR] B-20: A stale profile hydration can reinstall inactive-profile incoming-transfer pollers after a newer hydration already rebuilt the correct set
**Severity:** Major | **Repro confidence:** high | **Type:** race / state invariant violation | **Found by:** codex — verified in source: `hydrateSchedulers()` calls `bumpServiceEpoch()` only at its own entry (`incoming-transfer/service.ts:716`) and never re-checks a captured epoch before its own final scheduler-map commit (`:730-743`), unlike other operations in the same file that do gate their writes on `epochAtStart` (e.g. `:470`, `:499`, `:1015`, `:1219`, `:1651`, `:1713`)
**Instances:** `apps/extension/src/wallet/services/incoming-transfer/service.ts:291`, `:299`, `:334`, `:654`, `:680` (unguarded `hydrateSchedulers` call sites), `:715-729` (clears maps before the awaits), `:730-743` (stale commit), `:808-845` (`onTokenAdded` shares the same root cause)
**Counter-example:** unlock profile B and delay `tokenService.getTokensRaw(B)` inside `hydrateSchedulers()`. Lock B, unlock C — C's hydration completes and installs only C's schedulers. B's older hydration then resumes and appends B's private-note and public-event schedulers **after** C's clearing pass — they continue polling/scanning indefinitely while C is active.
**Violated invariant:** the scheduler maps are the polling surface for the current active profile; a lifecycle rebuild must converge to exactly that profile's networks/accounts/tokens.
**Recommended fix:** capture the epoch at hydration entry, build the desired scheduler set off-map, and commit only if the captured epoch still matches immediately before replacing the maps.

---

### [MAJOR] B-21: PriceService's kill-switch restart can clobber a newer refresh's single-flight promise AND hijack its abort-timeout, so an obsolete generation's cleanup silences protections it doesn't own
**Severity:** Major | **Repro confidence:** high | **Type:** race / bad retry-or-timeout | **Found by:** both — claude found the narrower `inflight`-clobber; codex additionally traced the `abortController`/timeout-ownership corruption, verified in source (both `refresh()`'s and `doRefresh()`'s `finally` blocks clear shared instance fields unconditionally, with no identity/generation check) — merged, same root cause
**Instances:** `apps/extension/src/wallet/services/price/service.ts:203-223` (kill-switch handler), `:273-283` (`refresh`, unconditional `this.inflight=undefined` in `finally`), `:297-301` (`doRefresh`'s timeout dereferences the shared `this.abortController`), `:314-316`, `:332-335` (`doRefresh`'s `finally` unconditionally clears `this.abortController`)
**Counter-example:** refresh A passes its generation check and stalls (e.g. in `await cache.set()`). "Show fiat values" is toggled off then immediately back on: the kill-switch bumps generation, aborts the shared controller, and sets `this.inflight=undefined`; re-enabling immediately starts refresh B with a *new* `AbortController`. When A's aborted fetch settles, its `catch` correctly no-ops on the stale generation, but the outer `finally` block still runs unconditionally — clearing `this.inflight` (now pointing at B) and `this.abortController` (now B's live controller). A third caller sees `inflight===undefined` and starts a duplicate concurrent fetch C; and if B's own 10s timeout later fires, its closure reads `this.abortController` — now cleared or reassigned — so B can lose its timeout protection entirely, or C gets aborted instead of B.
**Violated invariant:** `price/service.ts:273-275`'s documented "concurrent callers share one in-flight request," and the implicit requirement that each fetch's own timeout only ever aborts that fetch.
**Recommended fix:** capture the promise/controller identity locally and only clear `this.inflight`/`this.abortController` in `finally` if they still refer to the completing invocation; have each `doRefresh`'s timeout closure abort a locally-captured controller, not the shared field.

---

### [MAJOR] B-22: A migration-barrier recheck failure can hang every UI storage access indefinitely
**Severity:** Major | **Repro confidence:** moderate | **Type:** bad error path / resource leak | **Found by:** codex — verified in source: `migrationIdle()`'s re-check at `storage.ts:44` is `void chrome.storage.local.get(...).then((again) => {...})` with **no `.catch()`**, and `resolve()` is only ever called from that `.then()` or the change listener
**Instances:** `apps/extension/src/utils/storage.ts:30-49`, reached by `storageLocalGet` (`:53-55`), `storageLocalSet` (`:58-60`), `storageLocalRemove` (`:63-65`)
**Counter-example:** `migrationIdle()`'s first `chrome.storage.local.get()` observes the running marker. The migration clears the marker before the change listener is attached (no future `onChanged` event will ever arrive for this waiter). The recheck read fired right after subscribing then itself rejects (a transient storage error); this promise chain has no `.catch()`, so the rejection is unhandled — neither the listener nor the recheck ever calls `resolve()`, and the outer `Promise` returned by `migrationIdle()` never settles.
**Violated invariant:** the facade's own doc says every accessor "waits once no migration is running" and that the recheck exists specifically to close the check-then-subscribe race — a storage failure on that recheck must not turn an already-idle state into a permanent wait. (Distinct from the facade's own documented-and-accepted check-then-subscribe TOCTOU, which this is not — see Findings NOT pursued.)
**Recommended fix:** attach a rejection handler to the recheck that removes the listener and rejects the outer promise (or use a shared idempotent settle helper covering both the event and the recheck).

---

### [MAJOR] B-23: `EntityStorage`'s malformed-row cleanup is an unconditional, unversioned delete-by-id, so it can destroy a concurrent valid replacement written after the read snapshot
**Severity:** Major | **Repro confidence:** moderate (requires a pre-existing corrupted row as its starting condition, itself a rare precursor) | **Type:** lost update / race | **Found by:** codex — claude independently flagged the same shape as a plausible-but-unconfirmed lead requiring proof of a specific external caller pattern; codex supplies a self-contained counter-example entirely internal to `EntityStorage.get()`+`decodeRow()`, which does not need an external caller — verified in source
**Instances:** `packages/wallet-core/src/storage/entity_storage.ts:61-73` (`decodeRow`'s unconditional `void this.storage.remove(fullKey)` on JSON-parse failure), triggered from `get()` (`:91-95`), `getAll()` (`:106-114`), `getValues()` (`:126-134`)
**Counter-example:** storage holds a pre-existing malformed row (e.g. from a prior half-written mutation/crash) at key `users@a`. `get("a")` reads that malformed snapshot and yields before its continuation runs. A concurrent `set("a", validEntity)` successfully overwrites `users@a` with fresh valid JSON. The original `get()` resumes, `decodeRow()` fails to `JSON.parse` its stale snapshot, and fire-and-forget deletes `users@a` by key alone — destroying the valid replacement it never observed.
**Violated invariant:** the documented syntax-failure policy permits dropping an unrecoverable malformed byte; it does not permit deleting a newer valid row written after the read snapshot.
**Recommended fix:** don't auto-delete on the read path without an atomic compare-and-delete; the smallest safe change with the current storage API is to log+retain+hide malformed rows and leave deletion to an explicitly serialized repair path.

---

### [MAJOR] B-24: A failed compensating `deleteProfile` during full-backup-import rollback leaves a permanently orphaned, still-selectable, never-finalized profile
**Severity:** Major | **Repro confidence:** moderate-to-high | **Type:** bad error path / silent corruption | **Found by:** both
**Instances:** `apps/extension/src/composables/useFullBackupImport.ts:407-416`, `:539-551`, `:719-734` (three copy-pasted instances of the same unguarded rollback-delete pattern); `apps/extension/src/wallet/services/profile/service.ts:891-913` (`deleteProfile`'s own tombstone write, the thing that can fail); `service.ts:254-258` (`getProfiles` only filters tombstoned/reserved profiles, not never-finalized ones)
**Counter-example:** a full-backup restore creates the profile row (`profileService.restore(...)`, `createdProfileId` set) and then fails before `finalizeRestore` runs (e.g. zero networks restored, or any later throw reaching the outer `catch`). The rollback calls `profileService.deleteProfile(...)`; if *that* call also fails (e.g. its tombstone write rejects), the failure is swallowed to `console.error` only — no retry, no re-marking. The profile row remains, isn't filtered by `getProfiles()`, and appears as a normal, selectable entry despite never having opened a session/PXE state.
**Violated invariant:** the composable's own documented contract — "a restore failure AFTER the profile row landed but BEFORE finalize must delete the orphan" — doesn't account for the rollback's own delete failing.
**Recommended fix:** centralize rollback in one helper, retry the delete a bounded number of times, and on persistent failure surface a distinct, actionable "cleanup pending" error instead of the generic "import failed," and/or filter non-finalized rows out of the profile-picker UI.

---

### [MAJOR] B-25: Live token-balance additions crash the Send page — `tokenBalance.push is not a function`
**Severity:** Major | **Repro confidence:** high | **Type:** crash | **Found by:** codex — verified directly in source
**Instances:** `apps/extension/src/popup/pages/send.vue:107` (bug — calls `tokenBalance.push`, a `ComputedRef` declared at line 117 as `const tokenBalance = computed(...)`), contrast with the correct sibling handler at `:110-113` (`onBalanceUpdated`, which correctly writes `tokenBalances.value[idx] = balance`)
**Counter-example:** open Send for an account, then let the balance service emit `onTokenBalanceAdded` for that account (e.g. after importing a token or receiving its first balance). `onBalanceAdded` (line 104) filters by active account then calls `tokenBalance.push(balance)` at line 107 — `tokenBalance` is a `ComputedRef` with no `.push` method, so this throws `TypeError: tokenBalance.push is not a function` on every live balance-add event.
**Violated invariant:** balance-add events for the active account must update the page's `tokenBalances` collection without interrupting event processing.
**Recommended fix:** `tokenBalances.value.push(balance)` (the array ref, not the singular computed).

---

### [MAJOR] B-26: Double-clicking a trust decision silently dismisses the next queued prompt
**Severity:** Major | **Repro confidence:** high | **Type:** race / lost update | **Found by:** codex
**Instances:** `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:84-112` (no submitting latch on Allow/Block); `apps/extension/src/popup/components/popups/PopupManager.vue:82-104` (`dequeueNextPendingTrust`), `:297-302` (close watcher)
**Counter-example:** queue trust prompts A and B. While A is open, double-click Allow — this starts two `setTrustAllow(A)` requests since neither button disables on click. The first resolves: A closes and `PopupManager` opens B. The second (duplicate) A-completion then resolves and emits close again — closing B even though the user never made a decision for it.
**Violated invariant:** each distinct queued `(profileId, networkId, contract)` prompt must remain open until the user resolves *that* prompt; a completion belonging to A must never close B.
**Recommended fix:** add a shared `isSubmitting` latch covering both Allow and Block, set before the first `await` and disabling both buttons; snapshot the active payload key and only emit close if the currently-displayed key still matches it.

---

### [MAJOR] B-27: Import-timeout recovery can race the still-running bootstrap activation it's meant to replace, corrupting shared client state and mis-routing to "needs unlock"
**Severity:** Major | **Repro confidence:** moderate | **Type:** race / wrong result | **Found by:** codex (claude's b7 report independently inspected this same area and could not construct a counter-example "within the context budget" — not a refutation, just a shallower pass; codex's deeper trace supplies a concrete one)
**Instances:** `apps/extension/src/composables/completeImportWithRecovery.ts:52-62` (recovery trigger); `apps/extension/src/composables/useProfileBootstrap.ts:23-59`, `:67-117` (shared mutable bootstrap paths); `apps/extension/src/composables/waitForProfileActive.ts:30-38` (timeout stops only the local watcher); `apps/extension/src/popup/app.vue:132-135` (original bootstrap start)
**Counter-example:** the original `onActiveProfileChanged` bootstrap sets the imported profile and spends >30s in `getOrInitNetworks`. `waitForProfileActive` times out (`isLogined` hasn't been set yet) — but this only stops its own watcher, not the original bootstrap. `completeImportWithRecovery` immediately starts `hydrateKnownProfile`, which disconnects and replaces the same shared network/account clients the original bootstrap is still using. The original bootstrap resumes and disconnects/replaces a client recovery is mid-use of; recovery throws and routes to Auth ("needs-unlock") while the original bootstrap can subsequently finish and set `isLogined=true` underneath it.
**Violated invariant:** `completeImportWithRecovery` assumes a timed-out activation can no longer mutate bootstrap state — untrue, since the timeout only stops its own watcher, never cancels or joins the original chain.
**Recommended fix:** make profile bootstrap single-flight per profile id; have both the event handler and recovery await that one promise, generation-guarding any replacement/cancel path.

---

### [MINOR] B-28: Incoming-trust Allow/Reject success toast can show the wrong token label if the active identity switches mid-RPC
**Severity:** Minor | **Repro confidence:** moderate | **Type:** wrong result | **Found by:** claude
**Instances:** `apps/extension/src/popup/components/popups/IncomingTrustPopup.vue:84-100`, `:102-112`
**Counter-example:** trust popup open for triple T1; user clicks Allow, awaiting `cacheStore.incomingTrust.allow?.()` (can take a beat if the SW needs to wake). Before it resolves, the active identity changes elsewhere; `PopupManager`'s identity-switch watcher closes the popup and resets `cacheStore.incomingTrust={}`. When `allow()` then resolves `true`, `handleAllow` reads `tokenSymbol.value` from the now-cleared `cacheStore`, building a toast that reads generic "Token" instead of the real symbol.
**Violated invariant:** none of trust-flip *correctness* (the RPC closure was bound to the correct fixed triple at dequeue time) — only the toast's display value is stale, since it re-reads shared state instead of a value captured at handler-invocation time.
**Recommended fix:** capture `tokenSymbol.value` into a local variable before awaiting `allow()`/`reject()`.

---

### [MINOR] B-29: `activity.store`'s LRU eviction is blind to live, in-progress work referencing an evicted scope — it can drop an unresolved "awaiting" placeholder, and separately can reset a fetch's mutation-version fence, permitting an ABA stale-fetch commit
**Severity:** Minor | **Repro confidence:** moderate | **Type:** state invariant violation / lost update | **Found by:** both — claude found the awaiting-placeholder drop; codex found the mutation-fence ABA reset. Same function, adjacent-but-structurally-distinct bugs; kept as one entry with two instance groups since both stem from `evictIfNeeded` not accounting for a slice's live work, though their fixes differ
**Instances (placeholder drop, claude):** `apps/extension/src/stores/activity.store.ts:52-54` (`lastAccessedAt` only set at slice creation), `:146-154` (`updateSlice` never bumps it), `:160-171` (`evictIfNeeded` sorts oldest-`lastAccessedAt`-first), `:237-241` (`addAwaiting`)
**Instances (ABA fence reset, codex):** `activity.store.ts:169`, `:267`, `:275` (`mutationVersion` deleted alongside the slice on eviction); `apps/extension/src/stores/app.store.ts:348-359` (`syncTransactions` captures the version), `:364-370` (`setTransactions` accepts an ABA-reset version)
**Counter-example (placeholder drop):** a scope viewed once early, then never revisited, keeps receiving live transaction/awaiting writes in the background — its `lastAccessedAt` never moves. Once ≥32 other scopes are activated, `evictIfNeeded` picks this "cold-by-timestamp but hot-by-writes" scope for eviction ahead of merely-viewed-but-inert ones, silently dropping any unresolved `AwaitingTx` placeholder it holds (no durable-storage backing).
**Counter-example (ABA fence):** a fetch for scope A captures `mutationVersion` 0. A is evicted (deleting its version), a live transaction recreates A's slice and advances the version to 1, then A is evicted again (deleting the version back to implicit 0). The original pre-eviction fetch resolves with expected version 0 and is accepted, silently reverting the live transaction that arrived in between.
**Violated invariant:** LRU eviction is meant to approximate "least recently *used*" — a scope receiving continuous live writes is, definitionally, still in use; separately, a fetch started before a live mutation must never supersede it, which requires mutation versions to stay monotonic even across eviction.
**Recommended fix:** bump `lastAccessedAt` (or a separate `lastWrittenAt`) inside `updateSlice`, or exempt slices with a non-empty `awaiting` array from eviction (mirroring `balances.store.ts`'s existing `forcedGasPending` exemption); keep `mutationVersion` in a separate store-lifetime monotonic generation map that eviction never deletes.

---

### [MINOR] B-30: Service clients opened lazily by a page/window aren't disconnected on every early-exit/error path, leaking a live SW port for the remainder of that document's lifetime
**Severity:** Minor (downgraded from claude's Major — impact is bounded: the leaked port lives only until that popup/window closes, which happens on ordinary navigation) | **Repro confidence:** high | **Type:** resource leak | **Found by:** both — claude found `send.vue`'s missing `executionService` disconnect; codex found `execute/index.vue`'s account/network client leak on init error — same bug shape, different components, merged
**Instances:** `apps/extension/src/popup/pages/send.vue:252` (construction), `:493-516` (`onBeforeUnmount` disconnects every other client but not `executionService` — the only disconnect for it lives inside `executeTransfer`'s `.finally()`, which never runs unless Send was actually clicked); `apps/extension/src/popup/windows/execute/index.vue:191-192` (`AccountServiceClient`/`NetworkServiceClient` construction), `:199-204` (`getNetworkAndAccount` can throw), `:295-296` (success-only disconnect), `:322-325` (error catch skips it)
**Counter-example (send.vue):** open Send, pick a token/amount (this alone opens `executionService`'s connection via fee estimation), then navigate away without clicking Send — an extremely common flow. `onBeforeUnmount` runs but never disconnects `executionService`.
**Counter-example (execute window):** open an execute approval whose account was deleted after the request was created — `getNetworkAndAccount` throws "Account no longer exists," the outer catch shows the UI error, but neither locally-constructed client is disconnected; both ports stay live for the failed popup's lifetime.
**Violated invariant:** the codebase's own "construct in `script setup`, disconnect in `onBeforeUnmount`" convention.
**Recommended fix:** add `executionService.disconnect()` to `send.vue`'s `onBeforeUnmount` (guard against double-disconnect via a flag); wrap `execute/index.vue`'s post-construction work in `try/finally` with both disconnects in the `finally`.

---

## Cross-cutting observations

1. **Unfenced stale-continuation is the dominant recurring bug class in this run.** An async operation captured before a state transition (profile switch, chain purge, offscreen pass timeout, kill-switch toggle, LRU eviction) resolves *after* that transition and commits its result with no generation/epoch/identity check gating the commit. This exact shape recurs independently, with different failing operations and different affected state, in: B-04/B-05 (profile switch vs. balance-queue/token-ownership state), B-07 (OPFS worker timeout vs. retry), B-17 (offscreen pass fencing — three sub-gaps), B-18 (chain-purge epoch), B-20 (scheduler hydration), B-21 (price kill-switch), B-29 (activity-store LRU eviction). Per the audit brief's own instruction to keep distinct-fix findings separate, these are kept as separate entries — but the sheer recurrence suggests a shared root cause at the architecture level: this codebase has no single reusable "epoch-guard" utility (capture generation → await → compare-and-commit-or-drop), so each module reinvents its own epoch/generation variable, and several reinventions forgot the "compare before commit" half of the pattern. A shared helper would remove this entire class at the root rather than patching each instance individually.
2. **Zeroize-discipline gaps recur across b1** (B-10, B-11) — every module owning a raw secret buffer needs its zeroize path re-audited specifically for "exception fires before the owning `try/finally` is entered" and "an abandoned async flow has no sweep for its only cleanup call site."
3. **Multi-step, non-atomic persistence sequences** that read-then-write across several independently-acquired locks recur in `dispatcher.ts`'s capability-grant persistence (B-14) and profile-deletion's reserve-then-tombstone ordering (B-12) — both would benefit from a single "read latest under lock → merge → write once" helper instead of sequential dispatcher-level calls.
4. **Sibling-asymmetry bugs**: several findings are cases where two structurally parallel code paths diverged — one got a fix/guard, the other didn't — and the divergence is the bug: session `open()` vs. `refresh()` (B-01), the Chromium vs. Firefox branch of `createOffscreen` (B-17), and `onBalanceUpdated` (correct) vs. `onBalanceAdded` (broken) in `send.vue` (B-25). Worth a review habit of diffing sibling functions whenever one is touched.

## Findings NOT pursued (with reasoning)

**b1-session-crypto — claude non-findings:**
- `ProfileDeletionCoordinator.runFor`'s single-flight `inflight` Map (resume-vs-live-delete collision) — traced the full reservation chain; a live re-delete of an already-tombstoned id is rejected before it could reach `runFor` a second time in one SW lifetime; no counter-example.
- `SessionSecretBox.unwrap()`/`PasswordSecretBox.unsealInternal()` zeroize-on-every-exit — verified correctly wrapped on every branch including early `return`; this is the already-fixed pattern, confirmed fixed not broken.
- `AccountIntegrityCoordinator.verifyRestoredSessionOnce()`'s fire-and-forget boot verification vs. a concurrent unlock — extensively audited revalidation logic (epoch capture, `lockProfileIfActive`, stamp digest); no fresh counter-example.
- `SessionManager.refresh()`'s in-place mutation before the storage write — a write failure only causes the old TTL alarm to self-heal as stale, not a lock-loss or TTL bypass.
- `EncryptionKey`'s 1-byte version tag vs. `SessionSecretBox`'s unversioned framing divergence — the two types are never cross-decoded; no confusion path.
- `PasswordSecretBox.reseal()`'s `newPasshash` escaping un-zeroized — documented ownership-transfer contract; every call site zeroizes it in its own `finally`.

**b1-session-crypto — codex non-findings:**
- Session concurrency (alarm-driven close, TTL changes, bearer clearing) — all reach the injected facade `runExclusive`; no unlocked mutation race found.
- Profile-deletion single-flight — a live re-deletion can't introduce a different snapshot while the id is reserved; the `inflight` entry is removed before its promise resolves.
- `SessionSecretBox.unwrap()` — wrong-version/decode-failure/invalid-length/decrypt-failure/wrong-length-plaintext exits all reach the outer finalizer.
- `PasswordSecretBox.unseal()`/wrong-password `reseal()` — correctly reach their existing finalizers.
- `pendingRestoreSecrets` — successful finalize/delete consume+zeroize entries, pre-finalize import failures invoke deletion cleanup, and worker teardown clears the whole map. (Softens but does not refute the kept B-11 finding, which already scopes impact to the SW's lifetime — see B-11's "Found by" note.)
- Passkey Path B settlement failure — not reported; the preserved popup route has no production caller.

**b2-transport — claude non-findings:**
- `base-client.ts` pending-map/reconnect — `nextRequestId` never resets across a reconnect, `settle()` is idempotent + map-deletion-guarded; no reused-id counter-example.
- `background/service.ts` clients-array splice-by-indexOf and `sendEvent` fan-out failure — the window where a dead client survives is inherently short-lived; Chrome's `onDisconnect` eventually splices it via the existing listener.
- Offscreen `ServiceClient` uid routing — per-instance random uid, no code path constructs multiple simultaneously-live instances of the same client class; an SW restart wipes the whole singleton rather than leaving a stale second instance.
- `wallet-sdk/background.ts` `sessionQueues`/`decryptQueues` promise-chain batons — the stored value is always `.catch(()=>{})`-wrapped, so a rejected leg never propagates into the next message's `.then()`.
- `WindowManager` handles — `detach()` is always immediately followed by `settle()`/`cancel()` in every traced path; the `settled` flag + map deletion double-guard prevents double-settle.
- `DiscoveryQueue.drain()`'s re-queue-on-`false` — `snapshot.slice(i)` correctly re-includes the just-failed entry; a wallet-locked-mid-drain doesn't silently drop the discovery that triggered the abort.

**b2-transport — codex non-findings:**
- Base-client late-response/reconnect id reuse — monotonic counter + disconnect-clears-pending makes reuse impractical under normal operation.
- Background service `splice(indexOf(client))` — the `-1` case is guarded; a stale reference is only temporary before normal Port teardown delivers `onDisconnect`.
- Offscreen UID routing — the 64-bit random-uid collision is impractical, and old SW listeners don't coexist with a new instance after normal teardown.
- `sessionQueues`/`decryptQueues` rejection poisoning — rejection-swallowing promise tails + a `finally`-released baton mean a rejected leg doesn't block successors.
- `pendingVerification` cleanup considered alone — stale membership causes only an extra verification prompt, not an authority/suppression bug (superseded by the broader B-13 finding).
- `handleRequestCapabilities`'s rejection-record write before rethrow — intentional "previously denied" bookkeeping, not itself a bug (distinct from the real B-14 finding about the post-*success* write sequence).
- `data.addressBook`/`contractClasses` capability field widening — explicitly pinned by characterization tests as known-intentional drift.
- WindowManager close/result races — `detach`, map deletion, and idempotent settlement correctly prevent double resolution in every examined interleaving.

**b3-pxe-offscreen — claude non-findings:**
- `ArtifactRegistry.knownMemo`/`clear()` race — `clear()` is never called anywhere in production; unreachable. Separately, content-addressed class-ids mean even a hypothetical stale repopulation can't produce a wrong artifact.
- `chainGuards` never removed on `clearChainState` — intentional and documented; resurrection is independently fenced by `chainPurgeEpochs`.
- `offscreen.ts`'s `passSeq` fence + `Promise.race([creating, ready])` interleavings (Chromium path) — pinned by characterization tests and traced correctly; the one real gap is Firefox-only (kept as part of B-17).
- `pxe/client.ts`'s module-level `storeKeyProvider`/`generationProvider` SW-restart ordering — registration always runs synchronously before the earliest possible RPC dispatch; no reachable window found.
- `PxeServiceClientBase.request()`'s `PXE_STORE_KEY_MISSING` single-retry — re-sends identical args after an awaited provision completes; no duplicate-processing interleaving found.
- `withPxeRead`'s `purgeEpochAtEntry` captured once across its 3-attempt rebind loop — the intended "did a purge happen since I entered" semantics, not a stale-capture bug.
- `Promise.race([creating, ready])` not awaiting `creating` on the ready-win path — explicitly documented and accepted as a benign rare race.

**b3-pxe-offscreen — codex non-findings:**
- `ArtifactRegistry.clear()` undone by a late successful load — no production profile-delete path calls `clear()`; no concrete wrong result in the current wiring.
- Reusing `chainGuards` after a completed `clearChainState` — intentional/harmless by itself; the reportable problem is the epoch captured *during* the purge window (kept as B-18), not guard reuse.
- A late-resolving OPFS open closed by the existing fulfillment handler — only a *never*-settling initialization remains unowned (the kept B-07 finding).
- `Promise.race([creating, ready])` returning READY before `creating` settles — explicitly documented and accepted.
- Module-level PXE key/generation providers registered after client construction — client closures read current module variables and production registration precedes startup; no use-before-registration path.
- Profile deletion's generation lifecycle rejecting stale same-incarnation operations — not bypassed by the chain-purge race.

**b4-execution — claude non-findings:**
- `JournalReaper`'s 35-min `proving`-stage grace vs. the ExecutionMutex's "no force-release" — `PxeServiceClient`'s own 30-min client-side prove timeout always fires first with 5 minutes of margin; SW-restart-mid-prove is separately covered by the reaper's boot sweep.
- `ExecutionMutex.laneDepth`/`originDepth` counter drift on abort — the decrement is provably single-fire across every traced overlapping-abort/GC-key/chained-`finally` scenario; no drift found.
- `EstimateCancelRegistry` cancel-before-admit/after-settle/double-cancel — all three explicitly and correctly handled per the documented contract.
- `GasBalanceReader`/`TransferEstimateReuse`/`OperationEstimateReuse` TTL caches across profile/network switches — correctly keyed or actively invalidated; no stale-read path.
- `TransferExecutor`'s deliberate zero-execution-slot omission — explicitly documented intentional exception (distinct from B-02, which contradicts its *own* file's stated invariant rather than documenting one).
- `JournalGC`'s per-scope cap only evicting `succeeded` records — verified intentional, documented data-loss rationale.
- `EstimateCancelRegistry.sweep()` only running at the top of `admit()` — self-heals on the very next `admit()` call; no observable wrong-result window.

**b4-execution — codex non-findings:**
- ExecutionMutex counters don't drift on ordinary rejection/abort — increments occur after capacity checks; aborted waiters chain an idempotent release to the prior baton.
- The 35-minute live-proving reap marking an unusually slow operation `failed` — this threshold is explicitly characterized as intentional.
- `executeSendTransaction` and popup transfers "bypassing the execution mutex... explicitly pinned and documented as intentional" — **checked against source and found to be a mistaken conflation** of `DappSendExecutor.executeSendTransaction` (documented as slot-protected, and genuinely NOT slot-protected in code — kept as B-02) with the structurally different, actually-intentional `TransferExecutor` popup-transfer exception in a different file. Not honored as a refutation.
- Active/parked/post-settle/double estimate cancellation — correctly aborts/evicts exactly once each; unknown-token cancellation is a deliberate silent no-op.
- A cancel overtaking estimate admission — the normal popup path uses an ordered Port + serialized profile lookup; no moderate-confidence ordinary-use interleaving established.
- Gas-balance profile switching — fenced by `evictAll()` wired to `onActiveProfileChanged`, including stale in-flight write-back prevention.
- Estimate-reuse caches — bind profile, endpoint, pending-tx set, fee basis, and (operation cache) exact chain/FPC identity.
- `coerceAmount` accepting unsafe-integer-valued numbers — the rounding already occurred upstream before this function receives the value; no distinct in-function wrong result.

**b5-pollers — claude non-findings:**
- `incoming-transfer` `schedulers`/`publicSchedulers` `setInterval` leak on "stop" — no `Service.stop()` lifecycle exists; MV3 SW teardown discards the whole context; every traced lifecycle-clear path correctly pairs `clearInterval` with map deletion.
- `incoming-transfer` `polling`/`publicPolling` Set stuck `true` on a thrown poll — both `poll()`/`pollPublic()` delete the guard key in a `finally`.
- `token-balance` `invalidatedBalanceIds` TOCTOU fence — checked synchronously immediately before every `repo.set` write, matching the doc.
- `network` `transientNodes` serving a deleted network's connection via `getNodeForUrl` — explicitly documented design choice (submitted-tx endpoint pinning).
- `network` `transientNodes` failure counter never reset on success — occasional harmless node-object rebuild; no observable wrong behavior.
- `transaction` `droppedWatch`/`droppedNextCheckAt` never cleaned via another settle path — all writers traced; consistently kept in sync.
- `ClockTickerAdapter` overlapping tick fire — `running`/`pending` coalescing flags prevent concurrent `tick()`/`onAlarmTick()`, errors contained.
- `incoming-transfer` `getReceiptFee`'s `feeCache` populated after a concurrent clear — epoch-capture-before-write + `finally`-scoped re-evict closes the window.
- `incoming-dust` threshold helpers — verified fail-open behavior for non-finite/negative/unparseable inputs; no counter-example.
- `account/service.ts` `tupleLocks` map entries never removed — bounded key space, no correctness impact; routed to Quality handoffs instead.

**b5-pollers — codex non-findings:**
- `incoming-transfer` `polling`/`publicPolling` not stuck after scan failures — both removals are in `finally` blocks.
- `incoming-transfer` scheduler maps cleared by normal hydration/chain/profile cleanup — the reportable issue is specifically the stale-async-rebuild-commits-after (kept as B-20), not the ordinary clear itself.
- No general service `stop()` contract — the absence of an `IncomingTransferService.stop()` override is not independently reportable.
- Token-balance success/failure storage writes both synchronously consult `invalidatedBalanceIds` immediately before dispatch.
- Projector/storage failures after `BalanceJobQueue.syncBatch()` enters its `try` DO reach the existing `finally` — only task-startup/missing-ledger failures escape it (the kept B-04 finding).
- `NetworkService.getNodeForUrl()` continuing to use a removed endpoint — documented submitted-transaction endpoint-pinning behavior, not a cache-correctness bug.
- Transaction dropped-watch entries — removed on non-dropped settlement, purge/ambiguity handling, and resurrection-window expiry; all traced correctly.
- Ordinary simultaneous price-alarm + popup-refresh calls sharing `inflight` — the failure requires generation invalidation followed by a replacement refresh (the kept B-21 finding), not ordinary concurrency.

**b6-storage-backup — claude non-findings:**
- `Lock`'s `MAX_HOLD_MS` force-release → double-release corrupting queue state — a real mechanism, but explicitly characterization-pinned as today's intentional (not-fixed) behavior in `lock.test.ts`.
- `ReadWriteGuard` per-token force-release racing a writer's mid-flight writeback — no timer/ceiling exists for `writeActive`/`writeWaiters` at all; the lead's premise has no corresponding code path.
- `row-map-migration.ts` `remapValues`/`retype` prototype pollution via `__proto__` — the full pipeline (canonicalize/validate/clone/spread semantics/storage-key scheme) closes every injection path; pinned by dedicated tests.
- `EntityStorage` drop-vs-keep dual policy surfacing a codec-validation failure on a write-path read — would require a specific external caller pattern outside this cluster's file scope, not confirmed to exist.
- `Migrator`'s "NEVER throws" contract including journal-write failures mid-checkpoint — every path traced into `run()`'s outer `try/catch`; the one promising edge case is explicitly pinned as success-not-restore in `migrator.test.ts`.
- `apps/extension/src/utils/storage.ts`'s `migrationIdle()` check-then-subscribe TOCTOU — already documented/accepted design with the standard re-check mitigation. (The separate recheck-*rejection*-hangs-forever gap is the kept B-22 finding, not this TOCTOU.)
- `EntityStorage.decodeRow`'s fire-and-forget malformed-row delete racing a caller's immediate `set()` — flagged as plausible but claude required proof of an external read-then-write caller pattern outside scope; codex's independently-traced *internal* race supplied that proof (kept as B-23).
- `ServiceCollection.start()` partial-phase failure — `Promise.all`-per-phase fail-fast is a documented boot characteristic, not a data-corruption/wrong-result bug.

**b6-storage-backup — codex non-findings:**
- `Lock`'s original holder releasing a successor after force-release — explicitly characterization-pinned; excluded per audit instructions.
- `ReadWriteGuard` force-release expires reader tokens only, not active writers — orphaned readers' late completion can't release a writer or skew the reader count.
- `Migrator.run()` catches storage failures from every named step, returning `needs-recovery`; post-checkpoint cleanup failures deliberately avoid restoring committed data.
- Row-map `__proto__` transform targets/DSL data rejected, config projections use a null-prototype accumulator, root row ids prefixed before insertion — the proposed pollution paths are closed.
- Codec-validation failures in `EntityStorage` deliberately retain the persisted row while hiding it from typed reads — documented, characterization-tested.
- `migrationIdle()`'s remaining idle-check-to-access TOCTOU — explicitly documented as accepted pending the deferred route-all-UI-storage-through-the-SW follow-up.

**b7-ui-state — claude non-findings:**
- `ticker.ts` refcounted singleton unmount-during-tick/double-dispose — every call site invokes `useTicker` synchronously at top-level `script setup` with balanced increment/decrement; no counter-example constructible.
- `design/outside.ts`'s `useEvent`'s unconditional `removeEventListener(element.value)` — `useEvent` is only ever called internally by `useOutside` with the constant `document`, never a nullable ref; not reachable today.
- `design/Popover.vue`'s `removeOutside` null-call defect — real but out of this cluster's file scope and explicitly marked `(BUG PIN)`/preserved verbatim, a documented pinned defect.
- `completeImportWithRecovery.ts`'s "double-application" on SW-restart recovery racing the original activation — bootstrap chain looked re-entrant-safe on inspection; no counter-example within context budget (codex's independent, deeper trace of the same area found a concrete race — kept as B-27).
- `send.vue`'s `handleSend` double-click reentrancy — `isSending.value=true` is set synchronously before any `await`; no interleaving window.
- `execute/index.vue`'s `reject()` firing without awaiting before `closeWindow(true)` — message dispatch is synchronous; the skeleton is pinned by frozen-oracle tests; no concrete failure found.
- `MigrationBarrier.vue`/`AccountIntegrityBarrier.vue` snapshot-vs-event races — both correctly prioritize the latest event/generation over a late snapshot.
- `balances.store.ts` LRU eviction of a forced-pending key — explicitly exempted and covered by an existing test; working as designed.
- `PopupManager.vue`'s trust-queue — reviewed three documented defenses against additional interleavings; only the toast-label staleness (kept as B-28) produced a counter-example.
- `app.store.ts`'s other direct profile/network/account writes outside `commitScopeChange` — all are pre-login bootstrap, a full local-wipe flow, or a same-identity refresh, not user-driven mid-send scope escapes.

**b7-ui-state — codex non-findings:**
- Balances profile fencing — the synchronous departing-profile watcher and last-profile-subscriber release both increment the profile epoch; old gas/FPC legs can't commit across either fence.
- `forcedGasSeq` supersession — sequence authority is assigned synchronously before the first `await`; `mySeq!==currentSeq` correctly discards older forced runs, no off-by-one found.
- App-store guard bypasses — user-driven account/network switches are guarded; the direct profile writes found occur during locked/bootstrap flows or refresh the same scope. (This pass did not specifically examine `SelectProfilePopup`, which is the kept B-09 finding.)
- Ticker singleton — Vue invokes the registered unmount hook once, disposal guarded by the component lifecycle; neither underflow nor unmount-during-tick corruption is reproducible.
- Design `useEvent` cleared-ref removal — extension call sites always pass concrete `document`/element values; repeated `removeEventListener` calls are harmless.
- Design `Popover` null remover — explicitly marked and behavior-pinned in source; an intentional documented defect under this audit's rules.
- Import finalization retention — keeping a fully-written profile once `finalizeRestore` starts is documented; completion-handshake failure is intentionally isolated from rollback.

## Quality handoffs (for the quality audit)

- `SessionManager`'s `open()`/`refresh()`/`applyTtlChange()` all hand-roll near-identical "persist Session + reschedule alarm" sequences with slightly different ordering guarantees — a shared internal helper enforcing "mutate memory, then persist, then reschedule" consistently would remove the asymmetry class of bug (see B-01) at its root.
- `apps/extension/src/wallet/services/window-manager/window-manager.ts:103-106`: the post-subscribe `if (!this.handles.has(handleId)) {...}` check is unreachable dead code — nothing async happens between it and an identical check a few lines above.
- `ArtifactRegistry.clear()` (`packages/aztec-runtime/src/pxe/artifact-registry.ts:127-134`) is dead code — its doc claims it's called during `onProfileDeleted` but no call site exists anywhere in the repo.
- `apps/extension/src/wallet/services/account/service.ts:179-197` — `serializePerTuple`'s cleanup `finally` block is dead code (empty branch, comment admits it never removes the map entry); either implement real ref-counted cleanup or drop the vestigial `finally`.
- `apps/extension/src/wallet/services/backup/README.md`/`backup-migration-registry.ts` reference an `IMPORT_BLOCKING_ACK` mechanism used by `footprint-coverage.test.ts` that isn't itself in-scope for the b6 cluster — worth confirming it's still exercised now that `realMigrations` is empty.
- Cross-cluster: `runtime.ts`'s boot sequence runs the `Migrator` before `services.add(...)`, but the `PRICE_REFRESH_ALARM_NAME` alarm listener is registered synchronously at module scope in `src/wallet/index.ts`, before `runtime.start()` begins — recommend confirming that window is actually unreachable (i.e. the alarm handler no-ops until services are constructed).
- `MigrationBarrier.vue`'s `eventTouched` Set and `AccountIntegrityBarrier.vue`'s `refreshGeneration` counter solve the identical snapshot-vs-event race with two different mechanisms — worth consolidating into one shared guard.
- `useFullBackupImport.ts`'s three `deleteProfile(...).catch(deleteErr => console.error(deleteErr))` rollback blocks (see B-24) are copy-pasted verbatim three times — a shared `rollbackOrphanProfile()` helper would keep future fixes in one place.
