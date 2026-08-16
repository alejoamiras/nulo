# Verified findings — bugs 2026-08-16-extension-mid

Phase 4 verifier pass, medium effort: top 5 by severity bucket (all Critical). Each verifier re-read the source blind and stated its own conclusion BEFORE reading the claim (anchoring guard). B-06 (also Critical) and everything below it fell outside the medium cap — treat as consolidated-only. B-02 was a cross-model dispute (codex scan leg had dismissed it); the verifier's blind trace CONFIRMED the finding and located codex's error (conflating transfer-executor's documented no-slot exception with dapp-send-executor).

| Finding | Verdict | Confidence |
|---|---|---|
| B-01 session open/close false success | CONFIRMED | high |
| B-02 executeSendTransaction mutex bypass | CONFIRMED (dispute resolved) | high |
| B-03 boot reaper races cold-start op | CONFIRMED | high |
| B-04 profile switch jams balance sync | CONFIRMED | high |
| B-05 token-map rebuild generation race | CONFIRMED | high |

## B-01 verification — VERDICT: CONFIRMED (final confidence: high)

**Own blind conclusion:** `open()` wraps `session.set()` (:221) and the `activeSession` assignment (:223) in ONE try/catch (203-232) with the storage write FIRST — a rejection jumps to the catch and the in-memory assignment never executes, directly contradicting the doc comment ("a broken chrome.storage write at unlock time still leaves the in-memory secret usable"). `close()` mirrors it (delete :240 before clear :241-244 → rejecting delete leaves the session ACTIVE while close() resolves). `refresh()` (259-278) is genuinely memory-first — the asymmetry is real.

**Corrections:** none substantive. Verified additionally: `ValueStorage.set/delete` pass the storage-area promise straight through (the rejection genuinely reaches the swallow); `openSessionVerified` post-open checks only deletion state, never `isActive` (:859); `unlockProfile` returns ProfileInfo unconditionally; all 9 `openSessionVerified` call sites real (280/357/415/504/699/1269/1313/1585/1600); NO test exercises a set/delete rejection on open/close — the doc's "the facade's test coverage pins it" references coverage that does not exist, which STRENGTHENS the finding.

**Minimal counter-example (refined):** inject a BrowserApi whose `storage.session.set` rejects once → `unlockProfile` resolves a valid ProfileInfo → immediate `getActiveProfile()`/`getSecret()` throws "Profile locked". Symmetric: reject `remove` once → `lockActiveProfile()` resolves void with the live secret still in memory.

**Smallest safe fix:** memory-first ordering in open()/close() (mirroring refresh()), the storage write in its own non-gating try/catch; plus a post-open `isActive` check in `openSessionVerified` (and post-close check in `lockActiveProfile`) so persistence failure surfaces as an RPC error, not silent false success.

## B-02 verification — VERDICT: CONFIRMED (final confidence: high) — cross-model dispute resolved AGAINST codex

**Own blind conclusion:** `executeAztecSendTx` (~:493) and `executeNoFromSendTx` (~:660) route through `runInSlot` (first line `await deps.lane.acquireSlot`); `executeSendTransaction` (:373-460) never calls `runInSlot`/`acquireSlot` — straight from `beginJournal` to `buildAndEstimateValidated` to `proveAndSend` on the same pxe/account handles the slot protects. The file header's blanket "dApp sends DO take an execution slot" contradicts the code for one of its three pipelines. `transfer-executor.ts:14-17`'s "NO execution slot" note is a scoped exception for a DIFFERENT file (popup transfers) — codex's dismissal conflated the two files.

**Corrections:** none — the blind trace matches the finding exactly (call sites, line numbers, missing-slot claim, transfer-executor distinction).

**Minimal counter-example:** dApp calls `grantPublicAuthwit` twice back-to-back (or once overlapping an in-flight `aztec_sendTx`/UI transfer on the same account/chain) → both become `send_transaction` ops → concurrent `simulateTx`/`proveTx` against the same PXE+account → the exact stale-private-note interleaving `execution-mutex.ts`'s header documents (double-spent nullifier / on-chain-rejected tx).

**Smallest safe fix:** wrap `executeSendTransaction`'s body in the existing `runInSlot` scaffold (slot before journal claim and any PXE work, release in finally) — no new mechanism.

## B-03 verification — VERDICT: CONFIRMED (final confidence: high)

**Own blind conclusion:** on a cold MV3 wake, `reaper.start()` is fired without await (`runtime.ts:268`) and `initWalletSdkHandler` (:295) goes live in the same tick — the RPC listener starts essentially concurrently with the boot sweep. `reap()`'s `getOperations({isTerminal:false})` snapshot has NO age/liveness cutoff when unconditional, so it sweeps a row `createOperation` just wrote for the very request that woke the SW. The pipeline's later `markJournal` hits `assertCanTransition("failed", next)`, throws, and is swallowed at `execution-lane.ts:366-367` — the op keeps executing (can succeed on-chain) while the journal permanently shows `failed`.

**Corrections:** none substantive. Strengthening nuance: the root unsynchronized primitive is `getOperations` NOT taking `transitionLock` (service.ts:450-463) while `createOperation` does (:214).

**Minimal counter-example:** slow `alarms.create()`; before it resolves a wallet-sdk request lands a `pending` journal row; the sweep reads all non-terminal rows including it and flips it `failed`; the live pipeline's next transition is silently rejected.

**Smallest safe fix:** capture `bootCutoff = Date.now()` before `reaper.start()`; the boot sweep only fails rows with `createdAt < bootCutoff`.

## B-04 verification — VERDICT: CONFIRMED (final confidence: high)

**Own blind conclusion:** the task-start loop (`balance-job-queue.ts:159-167`) runs BEFORE the try/finally (169/238-242); after a profile switch cleared TaskService's map, `startTask(staleId)` throws outside any try/finally, cleanup never runs, and since `enqueue()` gates fresh-mint on `!pendingTasks.has(id)`, every future enqueue coalesces onto the dead entry — a PERMANENT jam for that balance id, not self-healing. Nothing else touches the queue's `pendingTasks`.

**Corrections:** one nuance only — `TaskService.onActiveProfileChanged` is gated (profile defined + differing), not literally unconditional; but once the switch fires it clears the ENTIRE tasks map with no per-profile filtering, so the finding's phrasing is accurate in context.

**Secondary instances:** confirmed correctly labeled self-recovering lower-impact (`updateToken`/`parseTokenInterface` mint fresh tasks per call; the stale-task race only masks THAT call's real error — `task.fail` itself throws "Invalid task id" before the original `throw error`).

**Smallest safe fix:** wrap the task-start loop per item in try/catch (mint fresh task on stale-id failure) AND have `TokenBalanceService.onActiveProfileChanged` reset the queue's `pendingTasks`/`queue` — defense at both ends.

## B-05 verification — VERDICT: CONFIRMED (final confidence: high)

**Own blind conclusion:** the race is real. `onActiveProfileChanged` (service.ts:240-248) synchronously clears + then AWAITS `getTokensRaw(profile.id)` before repopulating, with no generation guard. `EventHandler.invoke` fires callbacks synchronously without awaiting their async continuations, and the profile facade's `runExclusive` serializes only the EMIT, not the subscriber's async tail — so rapid switches produce overlapping handler runs; whichever `getTokensRaw` resolves LAST wins the map regardless of the active profile. `getTokenBalances` (138-150) and the write/emit gates (103-107) both trust that map.

**Corrections:** none — all cited line ranges verified exactly; failing path confirmed (`session-manager.ts:202-225` onChange at :224 → `profile/service.ts:151` emit → `token-balance/service.ts:240-248`).

**Minimal counter-example:** unlock B (its getTokensRaw stalls) → lock → unlock C (resolves first, map = C's tokens) → B's stale read resolves and overwrites map with B's tokens while `this.profile === C` → `getTokenBalances()` serves B's balances inside C's session; live balance emits gated by B's token ids.

**Smallest safe fix:** capture a monotonic profile-generation counter synchronously at handler entry; build into a local temp map; commit into `this.tokens` only if the captured generation is still current after the await.
