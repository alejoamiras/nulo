# Recon — lock-ownership (batch 4 of audit-448-remediation)

Base: dev `8710518d`. Three read-only recon sweeps (lock infrastructure; N-11 witness + N-12 trap; N-17 note-CS). Condensed findings; every claim carried a file:line in the sweep reports.

## Lock infrastructure (`packages/wallet-core/src/utils/lock.ts`, 124 lines)

- Single export `Lock`. `constructor(name?, logger?, maxHoldMs = MAX_HOLD_MS)` — `MAX_HOLD_MS = 5*60_000` is module-private (README's "`Lock.MAX_HOLD_MS`" is doc drift; no such static). `maxHoldMs: null` disables the watchdog.
- `enter()` (:29-74): FIFO queue + `dispatch()`; post-grant bookkeeping is best-effort under a hardened "never reject after ownership transferred" invariant. Watchdog armed per-grant (:56-73); on fire it calls the SAME unconditional `leave()` as everyone else.
- `leave()` (:92-106): **no caller identity of any kind** — clears the (single!) `forceReleaseTimer` field, unlocks, dispatches. The double-release hazard: watchdog frees a wedged holder → W2 granted (arms ITS timer into the same field) → the original holder's late `finally leave()` clears W2's timer and unlocks → W3 admitted while W2 still runs. Exactly what proof `p1-1` pins RED.
- `withLock` (:83-90): `enter/try/finally-leave`. **KeyedLock only ever calls `withLock`** (keyed-lock.ts:50).
- The deliberate-deferral pin to rewrite: `lock.test.ts:249-287` ("force-release interplay is identical to a hand-rolled frame" — asserts the BUG as today's behavior, "deliberately NOT fixed in this arc"). Adjacent pins: double-leave idempotency (:100-105), leave-before-enter (:161-164), enter-reject invariant (:216-233 — its comment cites a `token/service.ts` `holdsLock` boolean that no longer exists), non-reentrancy (:310-327).

## Caller inventory (the "~16")

- **16 files** import `Lock`/`KeyedLock` (all `apps/extension/src/wallet/**` + `config/store.ts`); **18 construction sites**; **100% of usage is `withLock`-style** (incl. wrappers `runExclusive`, `withServiceLock`, `withScope`/`withSource`). **ZERO raw split `enter()`/`leave()` callers in application code.** The owner ticket can thread entirely inside `lock.ts` — the caller surface is already insulated.
- The one real split call site in the repo is on the SIBLING primitive: `ReadWriteGuard.enterWrite()/leaveWrite()` in `packages/aztec-runtime/src/pxe/service.ts:682/:719` (`clearProfileState`) — tight try/finally, baton-pass `releaseWrite` (rw-guard.ts:138-151) means no cross-holder release exists there today. **Orthogonal flag**: ReadWriteGuard's WRITER path has NO watchdog at all — a wedged `clearProfileState` blocks every future PXE op for the profile forever. Out of N-11's scope; logged as follow-up.
- `TokenSeeder.markerLock` (seeder.ts:84) is a hand-rolled promise-chain mutex outside `Lock` — untouched by this batch.
- Naming collision risk: `ReadWriteGuard` already uses "readerTokens" for force-release AGING (rw-guard.ts:59-68) — the new ownership concept needs a distinct name (ticket/holder).

## N-11 harm witness (adjudication-corrected)

`NetworkService.deleteNetwork` (network/service.ts:407-433) holds `this.lock.withLock` across `purgeChain` (:424 → :730-754), whose LAST leg `pxeServiceClient.clearChainState` deliberately carries the **30-minute prove-tx envelope** (aztec-runtime pxe/client.ts:94-103, `PROVE_TX_TIMEOUT_MS = 30*60_000` — it drains behind an in-flight proof's write barrier). The 5-min watchdog therefore fires mid-cascade BY DESIGN; any queued network mutator (addNetwork :375, setActiveNetwork :453, restore :781, …) is admitted concurrently, and the late `finally leave()` then admits a third. 16 caller files inherit the fix through the one class.

## N-12 (session TTL close) — trap confirmed

- `SessionManager.getActive()` (profile/session-manager.ts:174-184) calls `await this.close()` UNWRAPPED on TTL expiry. `close()` (:308-336): zeroize DEK → drop `activeSession` → emit → `await session.delete()` (:323) → `await clearLockAlarm()` (:332 → chrome.alarms.clear of the ONE global name `"nulo:core:session:ttl"`).
- Caller split: `getActiveProfile` (service.ts:339-346) and `captureExecutionFence` (:355-364) reach it from INSIDE `runExclusive` (facade `Lock`, non-reentrant — naive wrap = self-deadlock, the runbook TRAP); `deriveDappSessionMacKey` (:838-858) reaches it OFF-lock on essentially every dApp-session read; init tail (:332-335) is pre-ready and benign.
- Harm (proof `f1-1` RED): A's close suspended at the delete gate; B opens + schedules B's alarm; A's resumed close clears B's alarm (and the delete leg races B's row) → B's lazy auto-lock is dead.
- In-repo precedent for the fix: the alarm-identity gate `onAlarmFired` already applies (`alarm.scheduledTime === expectedLockedAt`, :730-731), and the epoch-fence idiom (see below).

## N-17 (note-CS) — foreclosure + residual

- Note-CS = per-note `withServiceLock` closure, incoming-transfer/service.ts:1043-1126. ONE `serviceEpoch` check at entry (:1047); PXE-bound `blockTimestampFor` await at :1104; durable writes :1117-1118 with NO re-check; existing-record backfill write :1066 after a PXE await :1064, same gap.
- The audit's 5-min-stall trigger is foreclosed: `getBlockTimestamp` rides the offscreen default `DEFAULT_REQUEST_TIMEOUT_MS = 90_000` (extension-messaging offscreen/client.ts:19), far under the 300 s watchdog. Residual value: drift insurance (a future slower await/lowered watchdog silently reopens it) + the invariant should hold on its own terms (seeder precedent re-checks after every await). Adjudication: "opportunistic, S".
- `serviceEpoch`/`bumpServiceEpoch` (service.ts:165-216) is the right primitive; no new machinery.
- N-17 has NO executing proof (report says "recipe") — the new pin mirrors `service.scenarios.test.ts` (composition harness; `makeNoteStub.getBlockTimestamp` is already a vi.fn — swap in a deferred, purge mid-flight, assert no resurrection).

## Reusable idioms (owner/epoch shapes already in-repo)

`ExecutionFence {profileId, epoch}` + capture/assertCurrent (profile-deletion-state.ts); `PxeLifecycleCoordinator.bump/current/assertUnchanged`; `IncomingTransferService.serviceEpoch`; `TokenSeeder.epoch`; `trackProfileSwitchEpoch` (batch 3). Owner-token-in-Lock is in-genre — the scope-creep risk is trying to unify all epoch fences in this batch (DON'T).

## Proofs to adopt

- `p1-1-lock-double-release.proof.test.ts` — real Lock, 25 ms watchdog, asserts `w3Entered === false` (RED today). Colocate the rewrite in `lock.test.ts`.
- `f1-1-session-ttl-alarm-cancel.proof.test.ts` — real SessionManager vs FakeBrowserApi, gated `session.delete`, asserts zero clears of `"nulo:core:session:ttl"` (RED today). Colocate next to session-manager.
