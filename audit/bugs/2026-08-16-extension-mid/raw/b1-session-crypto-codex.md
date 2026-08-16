<!-- codex session 01a00a8a-153e-7d81-82a8-0064f91f8690 -->

### Finding: Session persistence failures are swallowed before the requested in-memory transition

1. **Title:** Session persistence failures make unlock/lock report success without changing the active session.
2. **Severity:** Critical.
3. **Repro confidence:** High.
4. **Type:** wrong result; secondary: bad error path.
5. **Counter-example:** Configure `chrome.storage.session.set` to reject, then unlock profile B while no profile is active. `unlockProfile(B)` resolves successfully, but `getActiveProfile()` remains `undefined`. Similarly, if profile A is active and `chrome.storage.session.remove` rejects, `lockActiveProfile()` resolves successfully while A and its master secret remain active.
6. **Violated invariant:** `SessionManager.open()` promises to enter the session even when persistence fails—its comment explicitly says storage failure should “still leave the in-memory secret usable.” `close()` promises to clear persisted and in-memory state. Both methods swallow errors, so callers rely on those transitions having occurred.
7. **Failing path:**  
   Open: `ProfileService.openSessionVerified()` → `SessionManager.open()` at `apps/extension/src/wallet/services/profile/service.ts:858` → `ValueStorage.set()` at `apps/extension/src/wallet/services/profile/session-manager.ts:221` rejects → catch swallows at `session-manager.ts:230` before `activeSession` assignment at `session-manager.ts:223`.  
   Close: `ProfileService.lockActiveProfile()` at `profile/service.ts:551` → `SessionManager.close()` at `session-manager.ts:238` → `ValueStorage.delete()` at `session-manager.ts:240` rejects → catch swallows at `session-manager.ts:251` before clearing `activeSession` at `session-manager.ts:241`.
8. **Expected vs actual:** Expected: unlock either activates the requested profile or reports failure; lock either removes access to the master secret or reports that durable locking failed. Actual: both RPCs can resolve successfully while the active-session state remains unchanged.
9. **Recommended fix:** Commit the in-memory transition independently of persistence. For `open`, construct and assign `activeSession` before the fallible persistence step, matching the documented fallback. For `close`, clear `activeSession` and emit the close in a `finally`-protected path; propagate or otherwise explicitly surface failure to remove the persisted bearer because it may restore after a worker restart.
10. **Instances:**  
    `apps/extension/src/wallet/services/profile/session-manager.ts:202` (`open`, especially lines 221–232)  
    `apps/extension/src/wallet/services/profile/session-manager.ts:238` (`close`, especially lines 240–253)

### Finding: A failed tombstone write leaves a live profile falsely reserved

1. **Title:** Deletion reserves the profile before durable deletion has begun and never rolls back on tombstone failure.
2. **Severity:** Major.
3. **Repro confidence:** High.
4. **Type:** state invariant violation; secondary: bad error path.
5. **Counter-example:** With profile `p1` present, make the tombstone `storage.local.set` reject. Calling `deleteProfile("p1")` executes `beginDeletion("p1")`, then throws while writing the tombstone. The profile row remains, but `getProfiles()` hides it, unlock rejects it as invalid, and another delete also rejects it until the service worker restarts.
6. **Violated invariant:** A reserved ID represents a deletion backed by a durable tombstone that can be resumed. Here the profile is reserved despite there being no durable deletion record and no cleanup to resume.
7. **Failing path:** `ProfileService.deleteProfile()` enters phase 1 at `apps/extension/src/wallet/services/profile/service.ts:896` → `ProfileDeletionState.beginDeletion()` reserves and increments the epoch at `profile/service.ts:911` / `profile-deletion-state.ts:57` → `TombstoneRepository.write()` rejects at `profile/service.ts:912` / `tombstone-repository.ts:43` → no release or rollback runs → reads hide the still-present row at `profile/service.ts:254` and subsequent operations reject it at `profile/service.ts:898`.
8. **Expected vs actual:** Expected: if the first durable deletion write fails, deletion fails without changing profile availability. Actual: deletion fails but the live profile becomes inaccessible for the remainder of the worker lifetime.
9. **Recommended fix:** Treat tombstone persistence and in-memory reservation as a commit pair. Compute the prospective epoch, write the tombstone, then reserve/hydrate the in-memory state. To handle an ambiguously rejected storage write safely, read the exact tombstone back: continue/reserve if it landed; otherwise restore the prior epoch and reservation state.
10. **Instances:**  
    `apps/extension/src/wallet/services/profile/service.ts:911`  
    `apps/extension/src/wallet/services/profile/profile-deletion-state.ts:57`  
    `apps/extension/src/wallet/services/profile/tombstone-repository.ts:43`

### Finding: Secret-buffer cleanup starts after fallible setup operations

1. **Title:** Several crypto paths strand locally owned secret buffers when setup throws.
2. **Severity:** Minor.
3. **Repro confidence:** High.
4. **Type:** resource leak; secondary: bad error path.
5. **Counter-example:** Call `ProfileService.importMnemonic()` with an invalid mnemonic. It derives `passhash`, then `getEntropy()` throws before ownership reaches `importPasswordProfile()` and before any `finally`; the password-equivalent buffer remains live until garbage collection. Likewise, if Web Crypto rejects `fromPasshash()` or encryption after `PasswordSecretBox.seal()` derives its passhash, no caller ever receives or zeroizes that buffer.
6. **Violated invariant:** The package’s documented buffer-lifecycle convention requires locally owned passhash/master-secret buffers to be zeroized on every success, throw, and early-return path. Ownership can transfer only after the callee successfully returns.
7. **Failing path:** `ProfileService.importMnemonic()` derives `passhash` at `apps/extension/src/wallet/services/profile/service.ts:1040` → `getEntropy()` throws at `profile/service.ts:1041` → `importPasswordProfile()` is never entered, so its finalizer at `profile/service.ts:1272` cannot wipe the passhash. Package-level equivalent: `PasswordSecretBox.seal()` derives passhash at `packages/wallet-crypto/src/password-secret-box.ts:82` → key import/encryption throws at lines 83–84 → the method exits without a finalizer.
8. **Expected vs actual:** Expected: locally allocated password-equivalent and master-secret buffers are overwritten on every exit. Actual: these exceptional paths abandon them to opaque GC timing.
9. **Recommended fix:** Start the owning `try/finally` immediately after each secret allocation. Track whether ownership successfully transferred or the buffer escaped in a return value; wipe it in `finally` otherwise. In `reseal`, similarly wipe `newPasshash` when key import or encryption fails, but not after a successful return.
10. **Instances:**  
    `packages/wallet-crypto/src/password-secret-box.ts:81` (`seal`)  
    `packages/wallet-crypto/src/password-secret-box.ts:145` (`reseal` new passhash)  
    `apps/extension/src/wallet/services/profile/service.ts:262` (`createProfile` master secret before `seal`)  
    `apps/extension/src/wallet/services/profile/service.ts:323` (`unlockProfile` secret before passhash derivation)  
    `apps/extension/src/wallet/services/profile/service.ts:1001` (`importEncrypted` passhash before key import)  
    `apps/extension/src/wallet/services/profile/service.ts:1040` (`importMnemonic` passhash before mnemonic validation)  
    `apps/extension/src/wallet/services/profile/service.ts:1576` (`finalizeRestore` secret before passhash derivation)

## Non-findings considered

- Session concurrency: alarm-driven close, TTL changes, bearer clearing, and facade-facing session mutations all reach the injected facade `runExclusive`; no unlocked mutation race was found.
- Profile-deletion single-flight: a live re-deletion cannot introduce a different snapshot while the ID remains reserved, and the `inflight` entry is removed before its promise resolves.
- `SessionSecretBox.unwrap()`: wrong-version, decode failure, invalid-length, decryption failure, and wrong-length plaintext exits all reach the outer token/salt finalizer.
- `PasswordSecretBox.unseal()` and wrong-password `reseal()` correctly reach their existing passhash/secret finalizers.
- `pendingRestoreSecrets`: successful finalization and deletion consume and zeroize entries; ordinary pre-finalize import failures invoke deletion cleanup. Worker teardown clears the in-memory map, so no permanent retention path was established.
- Passkey Path B settlement failure was not reported because the preserved popup route currently has no production caller.