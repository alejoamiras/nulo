# Cluster C1 — session manager / profile service / auth-registry (lock & ordering lens)

> Scanner: general agent, 2026-08-22.

## C1-1 — `createAccount` writes an unfenced profile-scoped row racing `deleteProfile`; the purge can never reclaim it

**Severity:** Major | **Repro confidence:** moderate (mechanism certain; needs delete landing inside a live account-creation window — wide on custom networks, narrow on seeded ones) | **Type:** Lost update / incomplete deletion (check-then-write across two lock acquisitions without epoch fence)

**Counter-example.**
1. Popup bootstrap for active profile X fires ensureDefaultAccount(X, chain) (app.vue:125). createAccountInternal passes its single liveness gate — profileService.getProfileSecret(X) (account/service.ts:205 → service.ts:1888-1893, checks isReserved under facade lock) — and releases the lock. For a custom network it now spends seconds in resolveVerifiedL1ChainId's live probe (network/service.ts:320).
2. User confirms delete of X. deleteProfile phase 1 acquires facade lock: delegate.snapshot(id) harvests current addresses (service.ts:1223), beginDeletion reserves+bumps (:1225), row deleted, session closed, tombstone written.
3. Step 1 resumes, derives address, await this.storage.set(...) (account/service.ts:229) and emits onAccountAdded — no re-check of reservation/epoch. Downstream handlers amplify: IncomingTransfer hydrates poll schedulers for dead address, TokenBalance queues work.
4. Phase 2 purges ONLY the snapshot addresses (coordinator.ts:119-127); new address isn't in tombstone. resumePendingDeletions replays same persisted snapshot (service.ts:1353-1358) — the orphan converges never.

**Violated invariant.** D13 discipline: every durable write bearing profileId must re-validate deletion epoch immediately before commit, atomically with authorization. TransactionService honors it (addTransaction → assertCurrent, transaction/service.ts:181); account creation checks once at entry, writes later unfenced.

**Expected vs actual.** Expected: write authorized pre-delete landing post-snapshot rejected. Actual: row lands silently and survives every purge forever — violating deleteProfile's atomic/privacy-erasing contract with leftover derived-address rows tied to erased profile.

**Smallest safe fix.** Atomically capture secret + epoch (getSecretWithFence returning {master, epoch} from one locked section), then deletionState.assertCurrent(profileId, epoch) immediately before storage.set/emit in createAccountInternal — mirroring transaction/service.ts:180-184.

**Instances:** account/service.ts:199-231 (primary). Same unfenced-after-gate shape lower reachability: imported-key import path gated at account/service.ts:515; network/token/contact writers gated by requireActiveProfile.

## C1-2 — `revokeAuthwits`/`setRegistryEnabled` hang indefinitely when the session locks before the tx settles

**Severity:** Minor | **Repro confidence:** high | **Type:** Unbounded wait / stuck task
runWorker polls only if active profile exists (transaction/service.ts:325-326) → returns early forever while locked → tx never leaves this.pending → caller's waitForTx loop while(this.pending.has(hash)) sleep(100) (:221-227) spins with no ceiling and no task-cancellation check → revokeAuthwits (auth-registry/service.ts:217) and setRegistryEnabled (:266) never return; task stays open until unlock or SW death. Self-heals on next unlock; no data damage.
**Fix:** bound waitForTx (timeout → honest failure) and/or check parent-task cancellation each iteration.
**CONVERGED with C2 scanner.**

## C1-3 — `AuthRegistryService.restore()` performs no `(account, hash)` dedupe — cloning a backup beside its live source doubles every tracked authwit

**Severity:** Minor | **Repro confidence:** high | **Type:** Duplicate state / invariant drift
restore() (auth-registry/service.ts:438-456) allocates fresh ids and writes every row unconditionally — unlike TransactionService.restore's create-only contains guard (transaction/service.ts:543-545). Twin rows per grant → assertWithinCap double-counts against 255 cap (service.ts:128-137); revoking one id leaves phantom claiming dead grant until manual syncRegistry prunes by chain truth. Converges via sync; no fund impact.
**Fix:** skip (or record as restoreError) rows whose (account, hash) already exists.

## Verified clean (highlights)

- Deletion state machine: all failure points leave durable tombstone → idempotent resume; tombstone-write rejection does raw read-back before releasing (:1236-1248); torn reap retains deliberately; double-delete blocked by reservation; resume vs live delete benign.
- Unlock/export vs delete: all three-phase unlocks and four export paths revalidate existence + isReserved + isCurrent(epoch) after unlocked crypto/WebAuthn — incl. full delete→same-id-restore cycles. Password-change interleave caught by ciphertext-equality or full serialization.
- Lock discipline: WebAuthn ceremonies + PBKDF2 phases outside facade lock; openSessionVerified only under it; marker writers/readers facade-locked; alarm/TTL/config closes serialize via runExclusive; refresh check-and-mutate await-free; memory-first orderings verified.
- Reservation windows: random 32-bit ids + locked re-verification + reserved-set seeding from RAW keys; no usable-twice window beyond documented burns.
- Event ordering: session closed before onProfileDeleted; emits sync-dispatch fire-and-forget — no listener re-enters facade lock.
- auth-registry locking: all row writers share one Lock; reconcile-vs-record race needs sub-ms post-send tail vs ≥1s ticks — unreachable.
