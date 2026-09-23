# Cluster F2a — Account export/import + full-backup import (async/stage-machine lens)

> Scanner: general agent, 2026-08-22.

## F2-1 — Full-backup export stage machine is unprotected: no entry latch, Enter re-fires mid-progress, slice loop has no error cleanup

**Severity:** Major | **Repro confidence:** high | **Type:** Re-entrancy / stage transition skips cleanup
**CONVERGED with F2b Finding 1 (independent double-discovery).**

**Concrete counter-examples:**

1. *Password profile, pre-progress window:* click Create Backup → handleBackup runs; backupStatus stays "" through the exportBackupMaterial RPC (~0.5s PBKDF2). Double-click, or Enter during the window, starts a second concurrent handleBackup. Both iterate the same setup-scoped client instances (full.vue:63-82); one run's client.disconnect() (full.vue:195) rejects the other's in-flight request with plain Error(CLIENT_DISCONNECTED_MESSAGE). Loser's loop throws → unhandled rejection, remaining clients never disconnected, no UI signal.
2. *During progress:* Enter handler's switch (full.vue:248-258) routes every status except "finished"/"encrypted" — including "progress" — to handleBackup(), which has NO guard (full.vue:102). Enter while "Creating your backup…" deterministically re-enters.
3. *Passkey profile:* agree auto-fires handleBackup; Enter while ceremony modal open runs second one whose runCeremony rejects with plain Error("A passkey ceremony is already in flight") (usePasskeyCeremony.ts:41-43). Catch at full.vue:112-128 treats anything non-UserRejectedError as auth failure → toast "Failed to authenticate by passkey" + router.go(-1) — user bounced off page mid-ceremony with misleading message.
4. *Any single client.backup() throw* (SW restart mid-loop; 60s RpcTimeoutError on PXE-heavy account-state leg): loop full.vue:193-198 has no try/catch/finally → remaining clients leak ports for popup lifetime (onBeforeUnmount only removes keydown listener, full.vue:264-266), rejection unhandled, backupStatus sticks at "progress" forever: spinner never resolves, CTAs stay disabled (:452-467), no error surfaced, plaintext master key/entropy/DEK sit unreachable in module-level backup.

**Violated invariant:** every stage machine must latch re-entry at entry and guarantee teardown on every exit path — exactly what sibling consumer implements (useFullBackupImport.ts:497 guard; whole-loop try/finally :833-842; per-run finally disconnects :980-983).

**Failing path:** full.vue:245-259 → full.vue:102 (no latch) → full.vue:164 ("progress" set only after awaits) → full.vue:193-198 (unguarded shared-client loop) → base-client disconnect rejects siblings.

**Smallest safe fix:** first line of handleBackup: `if (backupStatus.value === "progress" || backupStatus.value === "encrypting") return`; wrap backupServices loop in try/finally disconnect-all with catch that toasts + resets status; restrict keydown default branch to !backupStatus.value.

**Instances:** full.vue:102 · full.vue:118-128 (concurrent-ceremony rejection misclassified → navigate-away) · full.vue:193-198 · full.vue:245-259.

## F2-2 — Composable rollback races still-running SW-side slice writes after timeout-classified failures

**Severity:** Minor | **Repro confidence:** moderate (mechanism certain; trigger needs >60s slice restore) | **Type:** Ordering / rollback coverage vs uncancellable remote work

**Counter-example:** import backup whose transaction slice is huge/slow. TransactionServiceClient.restore exceeds 60s ceiling → popup sees RpcTimeoutError. Not disconnect-classified → outer catch (useFullBackupImport.ts:947-963) takes IMMEDIATE rollback path with no liveness/tombstone protection → deleteProfile runs all three phases incl. phase 3 (tombstone cleared, reservation released, service.ts:1298-1301). But SW-side restoreRows loop (restore-rows.ts:27-34) still alive and keeps writing tx rows for the dead profileId — slice restores deliberately don't consult deletion state, exact hazard torn-sweep solves by RETAINING tombstone (service.ts:1288-1293). Result: permanent orphan rows under deleted profile id (invisible storage junk; retry mints fresh id so no functional collision).

**Violated invariant:** compensation must not complete while the work it compensates can still land new writes.

**Failing path:** useFullBackupImport.ts:929-978 (non-disconnect ⇒ skip gate) → service.ts:1191-1303 (plain deleteProfile releases) ⇄ still-running restore-rows writes.

**Smallest safe fix:** route composable rollbacks through tornGuard-style deletion (retain tombstone one boot cycle), or fence slice-restores on deletion epoch before each set().

**Instances:** useFullBackupImport.ts:963 · :691,773 (same immediate-rollback shape; lower risk).

## F2-3 — Backup/account file readers have no input size cap (asymmetric with the 64 KB account-export cap)

**Severity:** Minor | **Repro confidence:** high (cap absence certain) | **Type:** File edge case / resource exhaustion
**CONVERGED with F2b Finding 2.**

**Counter-example:** user mis-picks a 1–2 GB file (or small gzip bomb named .gz) in full-backup picker. readBackupFile does await file.text() with no bound (full-backup-helpers.ts:35), pickFile's auto-decompress streams full inflated blob into memory (files.ts:104, decompressData :249-273) — popup renderer spikes/OOMs and reloads. Sibling account-file importer caps at 64 KB (account/service.ts:660). detectBackupType also base64-decodes entire body just to read byte 0 (full-backup-helpers.ts:21). Impact limited to recoverable popup crash — hence Minor.

**Violated invariant:** untrusted input bounded before materialization (repo's own precedent account/service.ts:660).

**Failing path:** pickFile (files.ts:79-115) → readBackupFile (full-backup-helpers.ts:34-36) → renderer heap.

**Smallest safe fix:** check file.size against sane cap (e.g. 64 MB) in pickBackupFile before reading; cap decompressed output in decompressData.

**Instances:** full-backup-helpers.ts:35 · :21 · files.ts:104.

## Verified clean (checked, no finding)

- reconcileImportedAccounts after disconnect(): Port transport auto-reconnects when idle-disconnected — works.
- Stale active-pointer write in account import (accounts/import.vue:112): consumption validates membership + falls back; double isStale() fencing correct.
- Rollback cascade coverage: coordinator purges contacts/sessions/fpcs/journal/accounts/tokens/networks (profile-deletion/coordinator.ts:123-129); networks.purgeForProfile removes per-profile active-network key — pre-finalize rollback leaves nothing user-visible behind.
- Popup closed mid-import: restore-pending marker brands row; unlock refused with typed RestoreTornError + dedicated explain/delete UX (auth.vue:40-43,94-97); 7-day aged reap w/ generation pin + exact-marker CAS.
- Marker-cleared-at-entry in finalizeRestore: documented deliberate choice; survivors remain unlock-later recoverable.
- Liveness gate (background-liveness.ts): dual causal observers, post-subscribe re-read, every exit tears down timers/listener, errors + ceiling fail CLOSED to cleanup-pending.
- runImportChainSync/preflight: single absolute deadline, single-record sink guarantee, SW-enforced duplicate deadline; losers never touch error log.
- completeImportWithRecovery: bounded, never throws, honest needs-unlock terminal.
- Export pages account.vue/seed.vue: generation fences around every await, busy latches, secrets scrubbed on unmount; Enter paths guarded by isBusy.
- Password-field mutation mid-restore: new-profile password inputs unmount once restoreStatus flips (ImportFullBackupForm.vue:110), freezing value between restore() and finalizeRestore().
- full.vue download filename sanitization gap not reachable — profile names pass sanitize Input prop at both entry points.
