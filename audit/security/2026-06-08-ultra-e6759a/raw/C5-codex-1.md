# C5 — Profile + session + auth + backup (Codex xhigh Pass 1)

## Findings

### Finding 1 — `unlockPasskeyProfile` does not bind popup-supplied `credentialData` to the target profile’s stored `credentialId`

**Title**: The PATH A passkey unlock flow accepts caller-supplied `PasskeyCredentialData` and opens the session with the derived secret, but never checks `recovery.credentialId === snapshot.credentialId`. A wrong or synthetic passkey payload can therefore unlock profile A with a master secret not bound to A.

**Impact factors**:
- CIA+A: **Integrity** + **Authorization**. The active session for profile A can be opened with the wrong passkey-derived master secret.
- Blast radius: passkey-backed profiles on the popup-driven PATH A unlock flow. The result is a wrong-secret session, not a cross-extension remote compromise.
- Exploitability: AV:Local / AC:Low once an internal caller can supply arbitrary `credentialData` (buggy popup logic, compromised popup page, future caller drift).

**Evidence confidence**: **high** — direct control-flow trace.

**OWASP / CWE mapping**: A07:2021 Identification and Authentication Failures — **CWE-287** (Improper Authentication), **CWE-345** (Insufficient Verification of Data Authenticity).

**Trace** (source → sink):
1. Normal popup unlock targets the right credential in UI space by fetching `credentialId` and calling `runCeremony({ mode: "get", credentialId })` at `packages/extension/src/popup/pages/auth.vue:68-74`.
2. `ProfileService.unlockPasskeyProfile` snapshots `snapshot.credentialId` under the auth lock at `packages/extension/src/wallet/services/profile/service.ts:284-299`.
3. It then calls `acquireRecovery({ ceremony: "getById", credentialId: snapshot.credentialId }, credentialData)` at `service.ts:311`.
4. If `credentialData` is present, `acquireRecovery` ignores `opts.credentialId` and routes straight to `recoverFromCredentialData(credentialData)` at `service.ts:356-370`.
5. `PasskeyRecoveryCoordinator.recoverFromCredentialData` materializes whatever JSON the caller supplied and derives the master secret from it at `packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts:102-109`.
6. `PasskeyCredential.create` uses caller-supplied `params.id` and `params.prf` as the HKDF inputs at `packages/wallet-crypto/src/passkey-credential.ts:36-43`, and `deriveMasterSecret()` turns that into the session master at `passkey-credential.ts:53-63`.
7. Phase 3 re-fetches the profile and only checks `current.credentialId !== snapshot.credentialId` (rotation) at `service.ts:313-327`; it never compares `recovery.credentialId` to `snapshot.credentialId`.
8. The service then opens the session with `recovery.secret` at `service.ts:328`.

**Missing control**: Before `sessionManager.open`, the service should reject unless `recovery.credentialId === snapshot.credentialId`. `exportPlain` and passkey `restore` already implement that exact binding check at `packages/extension/src/wallet/services/profile/service.ts:656-677` and `service.ts:910-919`.

**Exploit story**:
1. User has passkey profiles A and B.
2. A buggy or compromised popup collects `credentialData` for B but calls `unlockPasskeyProfile(A.id, credentialDataForB)`.
3. The background snapshots A’s `credentialId`, but PATH A recovery ignores it and derives a master secret from B’s payload.
4. Phase 3 only proves that A’s stored `credentialId` did not rotate during the prompt.
5. The wallet marks A as unlocked, while `getProfileSecret(A.id)` now returns a master secret not bound to A’s real credential.
6. Subsequent account derivation / authwit / tx work runs against the wrong secret until the session is closed.

**Preconditions**:
- The unlock uses PATH A (`credentialData` passed in).
- An internal extension caller can supply incorrect or forged `PasskeyCredentialData`.
- The target profile is passkey-backed.

**Why mitigations fail**:
- The targeted `allowCredentials` guard exists only in popup UI code (`auth.vue`), not in the service.
- PATH B (`recoverByCredentialId`) is bound correctly by the browser, but PATH A bypasses that browser-side binding once the popup hands JSON to the background.
- Sibling flows already hardened this (`exportPlain`, passkey `restore`), but `unlockPasskeyProfile` was left behind.

**Instances**:
- `packages/extension/src/wallet/services/profile/service.ts:281-329`
- `packages/extension/src/wallet/services/profile/service.ts:356-370`
- `packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts:102-109`
- `packages/wallet-crypto/src/passkey-credential.ts:36-63`

---

### Finding 2 — Locking or deleting a profile does not revoke already-started execution; in-flight txs can still prove and submit with stale keys

**Title**: `lockActiveProfile()` and `deleteProfile()` only close future session access. They do not abort active execution jobs, and profile-deletion cleanup is dispatched through fire-and-forget async event handlers. A tx that already fetched the profile secret can continue to prove and broadcast after the user locks or deletes the profile.

**Impact factors**:
- CIA+A: **Integrity** + **Authorization**. User intent to revoke access by locking/deleting the profile does not stop an already-approved transaction.
- Blast radius: any in-flight execution for that `(profileId, chainId)` once the job has progressed past the initial session check.
- Exploitability: AV:Network / AC:Low after the user already approved a dApp action. The dApp does not need a second prompt; it benefits from revocation not taking effect retroactively.

**Evidence confidence**: **high** — direct trace across profile, execution, and PXE cleanup code.

**OWASP / CWE mapping**: A01:2021 Broken Access Control — **CWE-613** (Insufficient Session Expiration), **CWE-367** (TOCTOU Race Condition).

**Trace** (source → sink):
1. `TxRequestBuilder.buildStandard` checks that some profile is active at `packages/extension/src/wallet/services/execution/tx-request-builder.ts:97-100`.
2. It immediately derives the account contract from the active profile’s master secret at `tx-request-builder.ts:101-104` via `AccountService.getAccountContract`.
3. `AccountService.getAccountContract` derives the account secret from `profileService.getProfileSecret(profileId)` at `packages/extension/src/wallet/services/account/service.ts:178-191`.
4. After that point, the execution pipeline keeps working with the already-built `account`, `txRequest`, `node`, and `pxe` handles; the prove/send path at `packages/extension/src/wallet/services/execution/service.ts:1901-1995` does not re-check active-session ownership.
5. `lockActiveProfile()` only calls `sessionManager.close()` at `packages/extension/src/wallet/services/profile/service.ts:372-378`. It never touches execution controllers.
6. `deleteProfile()` deletes the profile row and emits `onProfileDeleted` before closing the session at `packages/extension/src/wallet/services/profile/service.ts:531-537`.
7. `EventHandler.invoke` is synchronous fire-and-forget: async listeners are started but not awaited at `packages/wallet-core/src/utils/event-handler.ts:22-27`.
8. The network cleanup listener eventually calls `purgeChain()` / `clearChainState()` at `packages/extension/src/wallet/services/network/service.ts:659-675` and `packages/aztec-runtime/src/pxe/service.ts:409-424`.
9. `clearChainState()` explicitly runs under the same per-chain write lock as prove/simulate, so it waits for in-flight chain work to drain instead of aborting it (`pxe/service.ts:405-414`).
10. The only codepath that aborts execution is `cancelJob()` at `packages/extension/src/wallet/services/execution/service.ts:825-865`; neither `lockActiveProfile()` nor `deleteProfile()` calls it.

**Missing control**: Profile/session revocation should abort all active execution controllers for that profile, or at least that profile+chain, before closing the session and before scheduling purge. A second line of defense is to re-check session ownership at prove/send stage boundaries.

**Exploit story**:
1. A malicious dApp convinces the user to approve a send.
2. The wallet starts the execution pipeline and derives the account secret.
3. The user realizes the mistake and immediately locks the wallet or deletes the profile, expecting that to revoke the operation.
4. The session is closed for future calls, but the already-running job keeps its derived account contract and continues through prove and submit.
5. Chain purge waits for the in-flight job instead of interrupting it.
6. The tx can still broadcast successfully after the profile is “deleted.”

**Preconditions**:
- An execution job for the profile is already in flight.
- The job has already crossed the initial session/secret fetch boundary.
- The user revokes by lock/delete rather than explicit `cancelJob()`.

**Why mitigations fail**:
- Session closure only affects future `getProfileSecret()` calls.
- `onProfileDeleted` cleanup is not awaited.
- PXE cleanup is deliberately serialized after in-flight work, not used as a cancellation barrier.
- The execution service’s abort surface is job-centric (`cancelJob`), not profile-centric.

**Instances**:
- `packages/extension/src/wallet/services/profile/service.ts:372-378`
- `packages/extension/src/wallet/services/profile/service.ts:521-551`
- `packages/wallet-core/src/utils/event-handler.ts:22-27`
- `packages/extension/src/wallet/services/execution/tx-request-builder.ts:97-104`
- `packages/extension/src/wallet/services/account/service.ts:178-191`
- `packages/extension/src/wallet/services/execution/service.ts:1901-2005`
- `packages/extension/src/wallet/services/execution/service.ts:825-865`
- `packages/extension/src/wallet/services/network/service.ts:575-589`
- `packages/extension/src/wallet/services/network/service.ts:659-675`
- `packages/aztec-runtime/src/pxe/service.ts:409-424`

---

### Finding 3 — Full-backup import creates persistent profile state before validating the remaining backup slices, and generic failures do not roll it back

**Title**: `restoreBackup()` validates only schema version and checksum up front, then persists the profile immediately via `profileService.restore(...)`. Later slice failures can throw after the profile already exists, and the generic outer catch does not delete it. For passkey backups, the background may also retain a `pendingRestoreSecrets` entry until manual cleanup or SW restart.

**Impact factors**:
- CIA+A: **Integrity** + **Availability**. The UI can report “Import failed” while leaving a new profile and partial restored state behind.
- Blast radius: password and passkey full-backup imports. Passkey imports add temporary secret-retention risk because late activation stashes the recovered master in memory.
- Exploitability: AV:User-assisted / AC:Low. A crafted, checksum-valid backup file is sufficient.

**Evidence confidence**: **high** — direct trace and no rollback on the generic-failure path.

**OWASP / CWE mapping**: A04:2021 Insecure Design — **CWE-841** (Improper Enforcement of Behavioral Workflow), **CWE-754** (Improper Check for Unusual or Exceptional Conditions).

**Trace** (source → sink):
1. `restoreBackup()` checks only `schema-version === 2` and `checksum === SHA256(JSON.stringify(backup))` at `packages/extension/src/composables/useFullBackupImport.ts:216-235`.
2. It does not validate that `data.network`, `data.account`, `data.token`, etc. have the expected array shape before side effects begin.
3. It persists the profile first by calling `profileService.restore(...)` at `useFullBackupImport.ts:285-287`.
4. For password backups, `ProfileService.restore` writes the new profile row and returns success without opening a session at `packages/extension/src/wallet/services/profile/service.ts:861-888`.
5. For passkey backups, `ProfileService.restore` writes the profile row and stashes the recovered secret into `pendingRestoreSecrets` at `service.ts:923-949`.
6. Only two later failures explicitly roll back: “no networks restored” at `useFullBackupImport.ts:309-317` and `"Duplicate address"` at `useFullBackupImport.ts:341-353`.
7. Any other exception falls into the outer catch at `useFullBackupImport.ts:425-428`, which surfaces `"Import failed"` but never calls `profileService.deleteProfile(newProfile.id)`.
8. A checksum-valid file with malformed or unexpected later slices can therefore leave an orphan profile and partial side effects even though the import flow is reported as failed.

**Missing control**: Validate all top-level backup slices before persisting the profile, or wrap the whole import in a compensating rollback that deletes the just-created profile on every failure before `finalizeRestore()` succeeds.

**Exploit story**:
1. Attacker gives the user a checksum-valid “backup” whose `data.profile` is well-formed but whose later slices are malformed or designed to trip a downstream restore throw.
2. The importer passes schema/checksum and creates the new profile.
3. A later restore call throws after some side effects have already landed.
4. The UI reports “Import failed”.
5. The new profile remains on disk anyway; for passkey imports, the late-activation secret may also remain cached in the service worker.
6. On retry, the user now interacts with a partially-created profile state that the failure UI did not acknowledge.

**Preconditions**:
- The user imports a crafted or corrupted backup file whose outer checksum is still valid.
- The failure occurs after `profileService.restore(...)` and outside the two explicit rollback branches.

**Why mitigations fail**:
- Checksum only proves the user got exactly the file they selected, not that its inner shapes are semantically safe for every downstream restore call.
- The importer assumes downstream restore methods will mostly return `restoreError` rows, but some paths can still throw.
- The generic outer catch reports the failure but does not unwind earlier writes.

**Instances**:
- `packages/extension/src/composables/useFullBackupImport.ts:195-235`
- `packages/extension/src/composables/useFullBackupImport.ts:285-317`
- `packages/extension/src/composables/useFullBackupImport.ts:330-357`
- `packages/extension/src/composables/useFullBackupImport.ts:425-428`
- `packages/extension/src/wallet/services/profile/service.ts:821-949`

---

### Finding 4 — Plain full backups have no authenticated provenance, and even encrypted backups are replayable/downgradeable

**Title**: The full-backup format uses an unkeyed SHA-256 checksum over plaintext JSON. That detects accidental corruption, not attacker tampering. If the user does not choose backup encryption, the file also contains the raw password-profile master secret in plaintext. If the user does encrypt, AES-GCM authenticates the inner blob, but there is still no timestamp/counter/origin binding to detect stale-backup replay.

**Impact factors**:
- CIA+A: **Integrity** primarily. A replaced backup file can roll the wallet back to older metadata/state; plaintext backups also expose full custody by design.
- Blast radius: every full-backup import. Plain backups are fully readable/tamperable; encrypted backups are tamper-evident but still replayable.
- Exploitability: AV:User-assisted / AC:Low. The attacker only needs the user to import a substituted file.

**Evidence confidence**: **high** — format construction and validation are explicit.

**OWASP / CWE mapping**: A02:2021 Cryptographic Failures — **CWE-345** (Insufficient Verification of Data Authenticity), **CWE-354** (Improper Validation of Integrity Check Value).

**Trace** (source → sink):
1. Full-backup export builds a JSON object containing `"master-key"` and all service data at `packages/extension/src/popup/pages/settings/security/export/full.vue:127-141`.
2. It then computes `backup.checksum = SHA256(JSON.stringify(backup))` at `full.vue:143`.
3. For password profiles, the `"master-key"` value comes from `exportPlain(...)`, which returns the raw base64 master secret at `packages/extension/src/wallet/services/profile/service.ts:687-700`.
4. For passkey profiles, `exportPlain(...)` returns the credential id instead of the master secret at `service.ts:641-677`.
5. Optional backup encryption wraps the whole JSON string in AES-GCM at `full.vue:161-165` using `EncryptionKey.encrypt(...)` (`packages/wallet-crypto/src/encryption-key.ts:34-46`).
6. Import verifies only `checksum === SHA256(JSON.stringify(backup))` at `packages/extension/src/composables/useFullBackupImport.ts:226-233`.
7. No keyed MAC/signature exists for plaintext backups, and no creation time / monotonic version / origin binding is checked for either plaintext or encrypted imports.

**Missing control**:
- If plaintext backups remain supported, add an authenticity mechanism that is not attacker-recomputable.
- If replay/downgrade detection matters, include signed metadata such as `createdAt` and a user-visible backup identity/version marker in the protected blob.

**Exploit story**:
1. User exports a plaintext full backup.
2. Attacker modifies `data.*` fields or swaps in an older backup and recomputes the checksum.
3. Import passes integrity validation because the checksum is unkeyed.
4. The user restores attacker-chosen or stale state without any provenance signal.

Encrypted variant:
1. User keeps encrypted backups A (new) and B (old).
2. Attacker cannot tamper with A’s ciphertext, but can replace it wholesale with B.
3. The importer accepts B because AES-GCM authenticates B’s own contents and there is no anti-replay metadata check.
4. The wallet rolls back to older contacts/authwits/networks/state.

**Preconditions**:
- The attacker can replace the backup file the user imports.
- For the plaintext branch, the user exported or received an unencrypted backup.

**Why mitigations fail**:
- The checksum is attacker-recomputable.
- `wallet-version` / `aztec-version` are informational only and are not enforced on import.
- AES-GCM protects ciphertext integrity, but not “freshness” or provenance relative to another valid encrypted backup blob.

**Instances**:
- `packages/extension/src/popup/pages/settings/security/export/full.vue:127-165`
- `packages/extension/src/composables/useFullBackupImport.ts:226-233`
- `packages/extension/src/wallet/services/profile/service.ts:641-700`
- `packages/wallet-crypto/src/encryption-key.ts:34-69`

## Non-findings

- **Session-restore startup race does not appear to activate the wrong profile.** `ProfileService.init()` awaits `sessionManager.restore(...)` before the service is marked initialized (`packages/extension/src/wallet/services/profile/service.ts:69-84`, `packages/extension-messaging/src/background/service.ts:33-36`). Restore is intentionally silent, so the popup hydrates via `getActiveProfile()` snapshot rather than racing an early `onActiveProfileChanged`.

- **Auth-lock coverage across profile/session mutations is broadly complete.** The profile facade takes `this.lock` around create, unlock, passkey create/unlock phase-1/3, lock, rename, password change, delete, import, restore, and finalize paths. Slow PBKDF2/WebAuthn work is intentionally outside the lock and followed by under-lock revalidation. I did not find an uncovered create/unlock/delete/password-change/finalize mutation path in this cluster.

- **`chrome.storage.session` is not readable by a cohabiting extension just because that other extension has the `storage` permission.** Chrome’s storage API is extension-specific, and the repo never calls `chrome.storage.session.setAccessLevel(...)`, so the session area remains limited to trusted contexts by default. This makes the “passhash bearer leak to another extension” concern a non-finding under Chrome’s documented storage model.

- **Strict security mode is ON by default now.** `packages/extension/src/wallet/config/config.ts:13-18` sets `strictSecurityMode = true`, and disabling it requires an explicit warning-confirmed opt-out in `packages/extension/src/popup/pages/settings/security/index.vue:73-94`. The older “default bearer persistence” concern is therefore outdated for current builds.

- **Encrypted full backups do protect confidentiality/integrity of the inner payload.** The entire JSON blob is wrapped in AES-GCM (`packages/extension/src/popup/pages/settings/security/export/full.vue:161-165`, `packages/wallet-crypto/src/encryption-key.ts:34-69`). For passkey profiles, the backup’s `"master-key"` is the credential id, not the raw passkey-derived master secret (`packages/extension/src/wallet/services/profile/service.ts:641-677`).

- **Wrong-password / corrupt encrypted-backup failures are fail-fast before profile creation.** `decryptBackup()` only mutates `selectedBackup` after successful decrypt + parse (`packages/extension/src/composables/useFullBackupImport.ts:157-180`). A wrong decryption password does not itself dirty profile/network/account state.
