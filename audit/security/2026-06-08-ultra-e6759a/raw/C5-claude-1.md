# C5 — Profile + Session + Auth + Backup — Security Audit (Claude-1)

Cluster: C5 — Profile + session + auth + backup
Auditor: Claude (Opus 4.7)
Date: 2026-06-08
Branch / commit: `feat/onboarding-fees-history-arc`
Scope: `packages/extension/src/wallet/services/profile/*`, `packages/extension/src/wallet/services/passkey/service.ts`, `packages/extension/src/composables/useFullBackupImport.ts`, `packages/extension/src/popup/utils/passkey-ceremony.ts`, plus transitive auth/session paths.

---

## Finding C5-1 — Passkey unlock accepts ANY credential that the popup hands over (no service-side credentialId binding)

**Severity**: HIGH
**CVSS-ish**: 7.5 (Confidentiality/Integrity High, Local AV, High PR — popup-side compromise required; Scope unchanged within wallet)
**Category**: Auth-bypass / Privilege-confusion / Passkey re-binding
**Confidence**: HIGH
**File / lines**: `packages/extension/src/wallet/services/profile/service.ts:281-335` (`unlockPasskeyProfile`), interacting with `acquireRecovery` (`service.ts:355-370`)

### Summary

When unlocking a passkey-backed profile via PATH A (popup-driven), the service trusts the `credentialData` blob handed in by the caller WITHOUT verifying that the materialized `credentialId` matches the profile's stored `credentialId`. The Phase-3 revalidate only checks that the profile-on-disk's `credentialId` did not rotate under us — it does not check `recovery.credentialId === snapshot.credentialId`.

Compare with `exportPlain` (`service.ts:658-660`) and `restore` for passkey (`service.ts:916-919`) which BOTH explicitly perform that binding (`if (recovery.credentialId !== profile.credentialId)`). The unlock path is the only one missing it.

### Reproduction (logical, not yet weaponized)

1. User has two passkey profiles A (credentialId = credA) and B (credentialId = credB).
2. A compromised/buggy popup-script (e.g. an XSS in the extension popup surface, a maliciously installed companion script that taps a popup-injected `iframe`, or a future "I want to unlock profile A but the user picked the wrong key in the OS picker" bug):
   - Captures `credentialData` from a WebAuthn ceremony bound to credB.
   - Calls `profileService.unlockPasskeyProfile(profileA.id, credentialDataForB)`.
3. Service:
   - Phase 1: snapshots `snapshot.credentialId = credA`.
   - Phase 2: `acquireRecovery(...)` — because `credentialData` is provided, the entire `ceremony: "getById"` branch is bypassed and `recoverFromCredentialData(credentialDataForB)` is called. **The `opts.credentialId: credA` is silently discarded.**
   - Phase 3: re-fetches profile A, confirms `current.credentialId === snapshot.credentialId` (rotation check, both still credA). DOES NOT compare against `recovery.credentialId` (= credB).
   - Calls `sessionManager.open(profileA, recovery.secret)` where `recovery.secret` is HKDF-derived from credB's PRF output.
4. Session is now ACTIVE for profile A but the in-memory master `Fr` is credB-derived. `getProfileSecret(profileA.id)` returns the credB-derived `Fr`.
5. All subsequent operations on profile A (account derivation via `poseidon2Hash([master, chainId, type, index])` in `account/service.ts:191`) compute account secrets from the wrong master. Stored account addresses (computed earlier under credA's master) no longer match what the current session would derive — but the session is "unlocked" and the popup sees profile A's metadata.

### Impact

- **Direct exploit (popup compromise present)**: an attacker who controls the popup's WebAuthn flow can open a session for profile A using profile B's master secret. The downstream consequence depends on what the popup then does with that session — sign a tx for profile A using credB's keys, exfiltrate the session via a side channel, etc. The most concrete consequence: the popup's `appStore.profile` is profile A, all UI shows profile A, but `sendTx` and similar operations would derive accounts from credB's master and so submit signatures that DO NOT match profile A's recorded account contracts (likely tx failure / refusal at the contract level). HOWEVER if an attacker engineers a fresh "ghost" account under profile A using the credB-derived master, that account exists only in the attacker's view — they can authorize anything because the session-side ground truth (`getProfileSecret`) returns the credB-derived master.

- **Defense-in-depth gap**: the service must NOT trust popup-supplied `credentialData` to match the requested credentialId. The binding is the entire point of `getById` ceremony shape. Without it, the popup is a single point of failure for "you must touch the right authenticator for the right profile".

- **Contrast with `exportPlain`**: a parallel finding exists IF the popup-side modal allowed the user to pick a different credential than the one bound to the profile — but `exportPlain` explicitly catches it (`service.ts:658-660`). The unlock path is inconsistent.

### Fix

Add a single binding check in `unlockPasskeyProfile` Phase 3 (or right after `acquireRecovery`):

```ts
const recovery = await this.acquireRecovery({ ceremony: "getById", credentialId: snapshot.credentialId }, credentialData)
if (recovery.credentialId !== snapshot.credentialId) {
    zeroize(recovery.secret)
    throw new Error("Invalid profile id") // matches existing rotation-failure shape
}
```

Mirror the pattern from `exportPlain:656-666` / `restore:916-919`. Bonus: add a unit test asserting that supplying a `credentialData` whose `id` differs from the profile's `credentialId` throws.

### Pre-condition for exploit

Popup-side compromise OR a logic bug in the popup's `runCeremony` that picks the wrong credential. The popup CURRENTLY routes through `getPasskeyCredentialId(profile.id)` and uses `allowCredentials: [{ id: decodeBase64(credentialId) }]` to bind the OS picker, but that's POPUP-side enforcement only. Once that boundary is breached, the service-side binding is the last line of defense and it's missing.

---

## Finding C5-2 — Passkey backup `restore` for password backups silently drops corrupted/non-recoverable state

**Severity**: LOW
**CVSS-ish**: 3.7 (Integrity Low, Local AV, High PR)
**Category**: Backup-import / Error handling
**Confidence**: HIGH
**File / lines**: `packages/extension/src/wallet/services/profile/service.ts:889-898` (`restore` password branch catch)

### Summary

`restore`'s password branch catches ALL errors (including `seal()` failures) and returns `{...profile, restoreError: err.message}` — but it has ALREADY called `repo.set(id, newProfile)` BEFORE the failure point only if seal succeeded. Wait — re-read: `seal` runs BEFORE `repo.set`. So if `seal` throws, the catch fires, but no repo write happened, and `zeroize(plainSecret)` correctly runs. That's fine.

**But** if `repo.set(id, newProfile)` itself throws after `seal` succeeded (e.g. storage full, IO failure), the catch handler captures the error and returns the `restoreError` shape — but the half-written profile MAY or MAY NOT be on disk depending on the storage implementation. There's no explicit rollback in this branch.

Mitigation in `useFullBackupImport`: the orchestrator only relies on `newProfile.restoreError` to bail; if a half-written profile is left on disk, the user would see it on the next popup open and could delete it manually.

### Fix

Low-priority. Either (a) explicitly `repo.delete(id)` in the catch handler when `repo.set` may have partially landed, or (b) document the invariant that storage writes are atomic per-key.

---

## Finding C5-3 — Backup integrity check is unkeyed SHA-256 — no authenticity, no anti-substitution

**Severity**: MEDIUM (information disclosure & tamper-detection gap, not direct privilege escalation)
**CVSS-ish**: 5.4 (Integrity Medium, Network/Local AV depending on threat model)
**Category**: Backup tampering / Replay / Downgrade
**Confidence**: HIGH
**File / lines**: `packages/extension/src/popup/pages/settings/security/export/full.vue:143` (`backup.checksum = SHA-256(JSON.stringify(backup))`); `packages/extension/src/composables/useFullBackupImport.ts:226-235` (verify checksum)

### Summary

The backup file's `checksum` field is a SHA-256 hash of the JSON. This catches accidental corruption but provides **zero protection against intentional tampering**: an attacker who can modify the backup file can recompute the hash trivially.

The file also has **no machine identity**, **no timestamp**, and **no monotonic version counter** — so:

1. **Tamper attack**: attacker modifies any field in the backup (e.g., swaps the `data.account` array), recomputes the checksum, and the importer accepts it. The integrity check protects against transit/storage corruption, not against an adversary with file access.

2. **Cross-machine replay**: a backup taken on machine A can be imported on machine B verbatim. This is the *intended* purpose of a backup, but combined with point 1, an attacker who steals a backup can also create a "patched" backup that the user might accept as their own.

3. **Downgrade replay**: backup A (older state) and backup B (newer state, e.g. contains a recently added account) exist for the same wallet. An attacker who has both can substitute A for B and the user, upon restoring, loses access to the newer accounts (they're not in the imported state). This isn't catastrophic because the user can still re-derive accounts via the master secret, BUT if the wallet has accumulated state (auth-registry entries, contact list, tx history) those would be silently rolled back.

4. **Confidentiality**: a plain (unencrypted) backup contains the raw `master-key` (base64-encoded 32-byte secret) — anyone with the file has full custody of the wallet. This is documented to the user in the UI ("we strongly recommend to encrypt it"), so it's documented-risk, not undocumented vulnerability.

### What protects against tampering today

- **Encrypted backups**: AES-GCM provides integrity over the encrypted blob's content. An attacker without the encryption password CANNOT modify the inner payload without invalidating the GCM tag. So tamper resistance is restored AS LONG AS the user encrypts.

- **Plain backups**: no protection. The SHA-256 checksum is decoration.

### Fix

If tamper-resistance for plain backups is a goal:
1. Encrypted backups remain unchanged (AES-GCM already authenticates).
2. Plain backups should embed an **HMAC-SHA-256** over the JSON using a key derived from the master secret (e.g. HKDF(master, "nulo:backup:hmac:v1")). On import, the verifier re-derives the HMAC key (master is part of the backup, so this is self-verifiable) and checks the tag.
3. Document the verification semantics: "this signature proves the backup was created by someone holding the master secret — i.e., the user."

Alternatively, accept that plain backups are user-acknowledged-risk and document this explicitly. The current UI does mention encryption strongly; this is acceptable IF the team accepts the trade-off.

For replay/downgrade resistance: backups don't include a `created-at` timestamp or `version-counter` field. Adding `created-at` (epoch ms, embedded in the signed area for encrypted backups) gives the user something to inspect ("this backup is older than the one I made last week — am I sure I want this?"). NOT a server-enforced check (the wallet doesn't have a server-side counter), but defense-in-depth.

---

## Finding C5-4 — `EncryptionKey.encrypt` uses a deterministic-from-IV "salt" for PBKDF2 — atypical construction

**Severity**: LOW
**CVSS-ish**: 3.5 (no actual key-recovery weakness identified, but non-standard)
**Category**: Crypto-quality / Defense-in-depth
**Confidence**: MEDIUM
**File / lines**: `packages/wallet-crypto/src/encryption-key.ts:34-46` (`encrypt`, `decrypt`)

### Summary

```ts
const iv = crypto.getRandomValues(new Uint8Array(12))
const salt = await crypto.subtle.digest("SHA-256", iv)
const key = await this.deriveKey(salt)  // PBKDF2(passhash, salt, 600_000 iters)
```

The PBKDF2 salt is computed as SHA-256(iv) — meaning the "salt" is a deterministic function of the iv, which is stored IN THE CLEAR in the resulting ciphertext (the 12 bytes at offset 1). The PBKDF2 spec calls for a random salt stored alongside the ciphertext; the implementation effectively reuses the iv as the salt input.

### Impact analysis

- **Per-ciphertext salt uniqueness**: because `iv` is fresh random per `encrypt()` call, each ciphertext gets a unique salt. So this is NOT a "fixed salt" issue.
- **No multi-target weakening**: an attacker brute-forcing a password against a SINGLE ciphertext still needs to do 600,000 PBKDF2 iterations PER GUESS, because the salt changes per ciphertext.
- **No rainbow-table compatibility**: precomputed PBKDF2 tables for common passwords don't apply because the salt is unique.
- **Atypical construction**: This is non-standard. Cryptographic review would flag it as "you've reinvented salt derivation; the standard recipe is salt = fresh_random_per_encryption stored alongside the IV". The current scheme is *functionally* equivalent because both `iv` and `SHA-256(iv)` are fresh-random-per-encryption, but it's a code smell.

### Subtle risk

If an attacker can FORCE iv reuse (e.g. a fault attack or implementation bug that calls `encrypt` with the same iv twice — currently impossible because iv is generated inside the function), then both the AES-GCM IV and the PBKDF2 salt would collide, leading to key reuse for the same passhash. Standard recipe (random separate salt) would still tolerate iv collision for the PBKDF2 layer.

### Fix

Either:
1. Document this as an intentional design ("we conflate iv and salt because both are random-per-encryption — this is equivalent to standard PBKDF2 with a fresh salt"), OR
2. Switch to standard form: `salt = crypto.getRandomValues(new Uint8Array(16))`, store salt+iv+ct in the ciphertext, parse on decrypt.

Schema migration required if (2) — `EncryptionKey` is V2-vector-locked (`packages/extension/src/wallet/crypto/key-vectors.test.ts`). Probably (1) is the pragmatic path.

---

## Finding C5-5 — `passhash` persisted to `chrome.storage.session` is the raw SHA-256(password) — full offline attack from session-storage dump

**Severity**: MEDIUM (mitigated by Chromium's per-extension storage isolation + the `strictSecurityMode` opt-in)
**CVSS-ish**: 5.0 (Confidentiality Medium, Local AV, Adjacent Network)
**Category**: Session-bearer leakage / Cold-recovery risk
**Confidence**: HIGH
**File / lines**: `packages/extension/src/wallet/services/profile/session-manager.ts:192-220` (`open`), `packages/extension/src/wallet/services/profile/spec.ts:33-35` (`Session.passhash`)

### Summary

When `strictSecurityMode === false` (default), `SessionManager.open()` writes the base64-encoded `passhash` (= `SHA-256(password)`) to `chrome.storage.session` under `nulo:core:session`. This allows the wallet to silently restore the session after MV3 service-worker suspension.

Storage isolation in Chromium: `chrome.storage.session` IS isolated per extension — another extension with the `storage` permission CANNOT read this extension's `storage.session`. This is enforced by the browser's extension storage backend. Verified by Chromium docs + extension manifest model.

### Remaining risk surface

1. **Local disk dump of the browser profile**: if an attacker has filesystem read of the Chrome profile dir (Leveldb backing files for `chrome.storage.session` — typically `Local Extension Settings/<extId>/`), they can read the passhash from disk. While Chromium clears session storage on browser-process exit, a running browser holds the LevelDB state. An attacker with disk + running browser process can extract it.

2. **Combined with ciphertext access**: the encrypted secret + guard are in `chrome.storage.local` (`nulo:core:profiles@<id>`). With both the passhash (from session) AND the ciphertext (from local), the attacker bypasses the 600k-iteration PBKDF2 cost — they go directly:
   - `key = PBKDF2(passhash, SHA-256(iv), 600k iters)` — actually wait, this still requires 600k iterations EVEN WITH the passhash. So they still pay the PBKDF2 cost.
   - **But** they have the passhash, so they don't need to BRUTE-FORCE the password. They have a fixed `key = PBKDF2(passhash, SHA-256(iv), 600k iters)` directly — exactly the same key the wallet uses. **One PBKDF2 run per ciphertext, not per password guess.** This is a single-target cost, not a brute-force.

So having the persisted passhash + ciphertext **immediately gives full key recovery** — the PBKDF2 work factor protects only against password brute-force, not against direct passhash extraction.

### What protects today

- Strict mode (the user can opt in). Documented.
- Chromium per-extension storage isolation (other extensions can't read).
- The bearer is in `storage.session` which clears on browser close (per browser).

### What does NOT protect

- File-system-level extraction (e.g. malware on the user's machine that copies the Chrome profile).
- The user is unaware of this trade-off unless they read the security settings.

### Fix

This is a fundamental tension between cold-restore UX and offline-recovery resistance. The codebase already addresses it via `strictSecurityMode`. The improvement would be:

1. **Make strict mode the default**, with an explicit opt-in for "keep me unlocked across SW suspensions" (current behavior). The user makes the trade-off explicit.
2. **Document the threat model** in `SECURITY.md`: "a local-disk attacker can recover your wallet if strictSecurityMode is OFF; they cannot if it's ON".

The codebase already has `clearPasshash()` for mid-session toggle ON, with race-safe ordering — that's good.

---

## Finding C5-6 — `pendingRestoreSecrets` map has no TTL or cleanup on session-end

**Severity**: LOW
**CVSS-ish**: 3.0 (Confidentiality Low)
**Category**: Secret-lifetime / Memory hygiene
**Confidence**: HIGH
**File / lines**: `packages/extension/src/wallet/services/profile/service.ts:54` (`pendingRestoreSecrets`), `service.ts:940-947` (write), `service.ts:1029-1039` (consume)

### Summary

When a passkey backup is `restore()`d, the recovered master secret (`recovery.secret`) is stashed in the `pendingRestoreSecrets` Map keyed by profile id. It's consumed (and zeroized) by `finalizeRestore`, OR cleared if the profile is deleted (`deleteProfile`, `service.ts:543-547`).

But: if neither `finalizeRestore` NOR `deleteProfile` is ever called (e.g. the user aborts the import flow at the very last step, or the popup crashes between `restore` and `finalizeRestore`), the secret stays in memory until SW restart. There's no TTL, no idle-timeout.

### Impact

- The secret is the raw master secret (32 bytes). It lives in a `Map<string, Uint8Array>`.
- SW restart clears all in-memory state, so the residue does not persist across restarts.
- An attacker would need RCE in the SW process to read the Map. At that point, they'd just read everything else too.

### Fix

Low priority. Either:
1. Add a TTL (e.g. 10 minutes per entry); on TTL expiry, zeroize and delete.
2. Clear the map on `lockActiveProfile()` and on any `onActiveProfileChanged → undefined` event.
3. Document the intent: "pending restores are SW-scoped; trust that SW restart bounds the residue".

---

## Finding C5-7 — Profile id is 32 bits — birthday-collision is possible with thousands of profiles, but not exploitable at wallet scale

**Severity**: INFORMATIONAL
**CVSS-ish**: n/a
**Category**: ID space sizing
**Confidence**: HIGH
**File / lines**: `packages/extension/src/wallet/services/profile/repository.ts:30` (`PROFILE_ID_HEX_LENGTH = 8`), `packages/wallet-core/src/utils/random.ts:13-16` (`getRandomHex`)

### Summary

Profile ids are 8 hex chars = 32 bits = 4.3 billion id space. With `getRandomHex(8)` and birthday bound, collision becomes ~50% probable at ~65,000 ids. For a user with ≤10 profiles per wallet, collision probability is on the order of 1e-8 per id-generation — astronomically unlikely.

`ProfileRepository.generateUniqueId()` re-rolls on collision; `createPasskeyProfile` re-verifies under the lock and throws `ProfileIdConflictError` on race. So even if an extremely unlucky collision occurred, the system handles it gracefully.

### Risk

The bigger concern is the `userHandle` field in WebAuthn — passkey profile id == WebAuthn userHandle. If a sophisticated attacker can predict the next id (they can't — `getRandomHex` uses `crypto.getRandomValues`), they could conceivably target it. Not feasible.

### Fix

None required. Current implementation is adequate for the threat model. Documented in the repository's JSDoc.

---

## Finding C5-8 — `useFullBackupImport.decryptBackup` lacks ciphertext-format validation; truncated/short blobs fall through to opaque error

**Severity**: LOW
**CVSS-ish**: 2.0
**Category**: Robustness / Error-handling
**Confidence**: HIGH
**File / lines**: `packages/extension/src/composables/useFullBackupImport.ts:160-188`

### Summary

`decryptBackup`:
```ts
const passhash = await EncryptionKey.getPasshash(decryptionPassword.value)
const key = await EncryptionKey.fromPasshash(passhash)
const encryptedBytes = new Uint8Array(Buffer.from(selectedBackup.value?.backup as string, "base64"))
const decryptedBytes = await key.decrypt(encryptedBytes)  // <- can throw
```

If `encryptedBytes` is malformed (length < 13, wrong version tag), `EncryptionKey.decrypt` throws "Invalid payload length" / "Invalid payload format" — these flow into the catch and surface as "Decryption Failed - The provided password is incorrect or the backup file is corrupted".

The error message conflates wrong-password (HIGH likelihood) with format-corruption (LOW likelihood). For UX this is acceptable, but it also means a crafted backup file (e.g. one with version tag != 0) is treated the same as a wrong-password attempt — providing no information about why it failed.

### Impact

Not a security issue per se. A crafted backup file CANNOT cause unintended code execution — JSON.parse, base64 decode, AES-GCM decrypt all reject malformed inputs cleanly. The only sub-vulnerability would be a JSON-prototype-pollution attack if the parsed JSON were merged into a sensitive object — let me check.

### Sub-finding: JSON prototype pollution check

`JSON.parse(decodedJson)` does NOT pollute prototype because `JSON.parse` doesn't process `__proto__` as a setter. But the resulting object IS then merged into `selectedBackup.value` via spread, and the importer iterates `data` via `Object.keys` later. Worth verifying:

- `data.profile = { id, name, type }` — id/name/type used in `restore()` which is type-checked by the profile service.
- `data.account` (etc.) — passed to service `restore()` which validates inside.

No `Object.assign(prototype, data)` shape. Safe.

### Fix

Optional UX improvement: distinguish "format-invalid" from "decryption-failed" at the decryptBackup level by validating the byte 0 version tag explicitly before calling `key.decrypt`. Surface a different error message: "This file is not a Nulo encrypted backup."

---

## Finding C5-9 — `confirmProfileOperation` returns `true`/throws but does not produce a one-time receipt — TOCTOU between confirm and action

**Severity**: LOW (defense-in-depth)
**CVSS-ish**: 3.0
**Category**: Auth-flow / TOCTOU
**Confidence**: MEDIUM
**File / lines**: `packages/extension/src/wallet/services/profile/service.ts:473-519` (`confirmProfileOperation`)

### Summary

`confirmProfileOperation` is documented as point-in-time: "does this user know the password / still hold the passkey?". It returns `true` on success but does NOT issue a one-time token. The caller's downstream op runs its own lock + refetch.

For password profiles, this is OK because the downstream op requires the password too (`unlockProfile`, `changeProfilePassword`) — the password is the bearer.

For passkey profiles, the `confirm` succeeds if `passkeyCoordinator.confirm(snapshot)` does not throw — i.e., if `passkeys.getKey(credentialId)` returns a credential. **There is no downstream auth gate that re-runs the passkey ceremony** in some flows. Today this is only used by `ConfirmPopup.vue` callbacks; an attacker who hijacks the popup AFTER `confirm` returns `true` could orchestrate a sensitive action without re-prompting WebAuthn.

### Mitigation

The downstream actions (`exportPlain`, etc.) all require their own `credentialData` argument, so they re-validate independently. So in practice this is not exploitable for the high-risk paths. The risk surface is the `ConfirmPopup.vue` paths.

### Fix

Audit every consumer of `confirmProfileOperation`. If any consumer's downstream action does NOT independently auth (e.g. relies on `confirm` returning `true` and then immediately calls a sensitive method without re-binding), that's an exploit. The current README claims "Only UI-local ConfirmPopup callbacks currently consume the return" — verify this is still true.

---

## Finding C5-10 — Backup-import: `restore` for passkey profile keeps lock-acquisition AFTER the WebAuthn-credential-recovery step

**Severity**: LOW
**CVSS-ish**: 2.5
**Category**: Lock contention / Stuck-lock risk
**Confidence**: MEDIUM
**File / lines**: `packages/extension/src/wallet/services/profile/service.ts:902-960` (`restore` passkey branch)

### Summary

The passkey-branch of `restore` holds the Lock from `service.ts:923` (`await this.lock.enter()`) through the end of the function — including the `repo.set`, the `emit`, and the `pendingRestoreSecrets.set` writes. This is a short critical section, BUT it's INSIDE a Lock that has a 5-minute safety force-release (`packages/wallet-core/src/utils/lock.ts:4`).

This is consistent with the existing pattern (snapshot → unlocked prompt → revalidate-under-lock), and the unlocked Phase 2 (the WebAuthn prompt + `recoverFromCredentialData`) is correctly outside the lock. Good.

However, there's a subtle ordering issue: the Phase-2 recovery runs `recoverFromCredentialData` which calls `passkeys.materializeCredential(data)` — which itself calls `PasskeyCredential.create(data)` which runs HKDF. This is fast (<10ms), but the `if (recovery.credentialId !== masterKey)` binding check (line 916-919) — note: `masterKey` here is the backup file's recorded `credentialId` for the passkey-backup case — IS done BEFORE `this.lock.enter()`. So the binding check is done outside the lock.

That's correct (binding is a property of the credential, not of storage state). No issue here. Closing this finding as **not a real concern** after re-review — left in as an audit-trail note.

### Status

Closed: not a real finding.

---

## Cross-cutting observations (not separate findings)

### O-1: The dual PATH A / PATH B contract is well-documented but error-prone

The service supports two WebAuthn flows: PATH A (popup runs WebAuthn in-page, supplies `credentialData`) and PATH B (SW opens a window via `WindowManager`). PATH B is dead code in production (no callers; `createKey`/`getKey` are PATH B-only). The dispatch in `acquireRecovery` (`service.ts:355-370`) chooses on `credentialData !== undefined`. This makes the security checks PATH-dependent — and as Finding C5-1 shows, the unlock path's binding check is missing for PATH A.

Recommendation: either remove PATH B (it's unused, and removing it reduces the attack surface + simplifies the spec), or audit each PATH A / PATH B branch for parity of security checks. The current state has divergent checks (`exportPlain` and `restore` bind, `unlockPasskeyProfile` doesn't).

### O-2: The Lock implementation has a 5-minute safety force-release

`packages/wallet-core/src/utils/lock.ts:4` — `MAX_HOLD_MS = 5 * 60_000`. If a holder doesn't `leave()`, the Lock auto-releases after 5 minutes. This is a safety net for misbehaving code, but it ALSO means a worst-case 5-minute "stuck lock" period during which no other auth operation can run. The Lock is per-instance (per-ProfileService), so this affects only profile operations — not unrelated services. Acceptable.

But: if a WebAuthn prompt hangs for ~3 minutes (the WebAuthn timeout) AND happens to be inside the lock (it shouldn't be, per the design), the Lock would block other auth for ~3 minutes. The code carefully avoids this by holding only Phase 1 + Phase 3 under the lock; WebAuthn (Phase 2) runs unlocked. Verified.

### O-3: Strict-mode toggle race-handling looks correct

`SessionManager.clearPasshash()` (`session-manager.ts:280-299`) clears in-memory FIRST, then storage. This is the right order — a concurrent `refresh()` between the two ops can't re-persist the bearer.

The `restore()` path also rejects a stale lenient-passhash record if strict mode is now ON (`session-manager.ts:335-345`). Good.

### O-4: The `ENCRYPTION_GUARD` constant is fine

`packages/wallet-crypto/src/password-secret-box.ts:49` — fixed 8-byte plaintext that round-trips through AES-GCM. Used to distinguish wrong-password from corrupted-ciphertext. No security concern; the constant value doesn't need to be secret (the wallet's secret is `secret`, not `guard`).

### O-5: `chrome.storage.session` is the right choice for `passhash`

Compared to `chrome.storage.local`, `chrome.storage.session` is cleared on browser close. This bounds the persistence window. Right call.

### O-6: Profile RPC is internal-only (popup ↔ SW)

dApps reach the wallet only via the wallet-sdk surface (registered through `extension-messaging`). `ProfileService.Methods` are NOT exposed to dApps. This means `finalizeRestore`, `unlockPasskeyProfile`, etc. cannot be called by an external page — only by the popup. Good defense-in-depth.

---

## Summary table

| ID | Severity | Category | One-line |
|---|---|---|---|
| C5-1 | HIGH | Auth-bypass / Passkey rebinding | `unlockPasskeyProfile` doesn't bind popup-supplied credentialData to the profile's credentialId |
| C5-2 | LOW | Backup-import error handling | Half-write rollback gap in `restore` password branch |
| C5-3 | MEDIUM | Backup tampering | Unkeyed SHA-256 checksum; plain backups aren't tamper-resistant |
| C5-4 | LOW | Crypto-quality | PBKDF2 salt = SHA-256(iv) is atypical |
| C5-5 | MEDIUM | Session-bearer leakage | passhash in `storage.session` enables single-target offline recovery |
| C5-6 | LOW | Secret-lifetime | `pendingRestoreSecrets` has no TTL |
| C5-7 | INFO | ID-space sizing | 32-bit profile id is fine at wallet scale |
| C5-8 | LOW | UX / Robustness | `decryptBackup` conflates format-error with wrong-password |
| C5-9 | LOW | Auth-flow / TOCTOU | `confirmProfileOperation` is point-in-time (no token) |
| C5-10 | — | (Closed; not a real finding) | — |

## Top recommendation

**Fix C5-1 immediately.** It's a single 4-line patch in `service.ts:281-335` that mirrors the binding pattern already in place in `exportPlain` and `restore`. Add a regression test in `service.integration.test.ts` along the lines of:

```ts
test("unlockPasskeyProfile rejects credentialData for a different credential", async () => {
    const { service } = await makeService()
    const a = await service.createPasskeyProfile("A")
    await service.lockActiveProfile()
    const wrongCred = fakeCredentialData("cred-OTHER", a.id)
    await expect(service.unlockPasskeyProfile(a.id, wrongCred)).rejects.toThrow(/Invalid profile id/)
})
```

The existing test `exportPlain passkey rejects credentialData for a different credential` (`service.integration.test.ts:321-330`) is the template.
