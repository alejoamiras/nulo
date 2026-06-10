# C4 — Crypto primitives (Codex xhigh Pass 1)

## Findings

### Finding 1 — `unlockPasskeyProfile` does not bind popup-supplied `credentialData.id` to the profile’s stored `credentialId`

**Title**: Path-A passkey unlock trusts caller-supplied `PasskeyCredentialData` strongly enough to open a session, but never checks that the supplied credential ID actually matches the target profile’s stored `credentialId`.

**Impact factors**:
- CIA+A: **Integrity** + **Availability**. The service can open profile `A` with a master secret derived from credential `B`; downstream account derivation then runs under the wrong root secret and can fail or operate against the wrong key material.
- Blast radius: passkey profiles unlocked through the popup-driven Path A flow.
- Exploitability: requires malformed or forged `PasskeyCredentialData` reaching the background service, so this is not a web-origin issue; realistic preconditions are a buggy/compromised popup, a malicious browser/WebAuthn stack, or another internal caller.

**Evidence confidence**: **high** — direct code trace, no speculative control flow.

**OWASP / CWE mapping**: A04:2021 Insecure Design, A07:2021 Identification and Authentication Failures — **CWE-345** (Insufficient Verification of Data Authenticity), **CWE-303** (Incorrect Implementation of Authentication Algorithm).

**Trace** (source → sink):
1. Popup auth flow fetches the stored credential ID and runs a targeted WebAuthn `get`, then forwards the resulting `credData` into `unlockPasskeyProfile(...)` at `packages/extension/src/popup/pages/auth.vue:72-74`.
2. `unlockPasskeyProfile` snapshots `snapshot.credentialId`, then passes caller-supplied `credentialData` into `acquireRecovery(...)` at `packages/extension/src/wallet/services/profile/service.ts:303-311`.
3. `acquireRecovery` takes the presence of `credentialData` as authoritative and routes straight to `passkeyCoordinator.recoverFromCredentialData(credentialData)` at `packages/extension/src/wallet/services/profile/service.ts:355-360`.
4. `recoverFromCredentialData` materializes the credential and derives the master secret, returning `{ credentialId: credential.id, secret, ... }` at `packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts:102-109`.
5. Phase 3 re-checks only that the profile row still stores the same credential ID as the earlier snapshot (`current.credentialId === snapshot.credentialId`) at `packages/extension/src/wallet/services/profile/service.ts:323-327`; it never checks `recovery.credentialId === snapshot.credentialId`.
6. Sink: `sessionManager.open(current, recovery.secret)` persists the session and makes the derived secret authoritative for later account/key derivation at `packages/extension/src/wallet/services/profile/service.ts:328-329`.

**Missing control**: Path A unlock needs the same credential-ID binding check that already exists in other passkey-sensitive entry points. `exportPlain` correctly rejects mismatched `credentialData` via `if (recovery.credentialId !== profile.credentialId) throw ...` at `packages/extension/src/wallet/services/profile/service.ts:641-660`; `unlockPasskeyProfile` lacks the equivalent guard.

**Exploit story**:
1. A user has passkey profile `P`, whose stored row is bound to credential ID `cred-P`.
2. A buggy or compromised popup produces `PasskeyCredentialData` for a different credential `cred-Q`, but still calls `unlockPasskeyProfile(P.id, credDataQ)`.
3. The background service derives the master secret from `cred-Q` and opens the session for profile `P` anyway.
4. Later account operations consume `ProfileService.getProfileSecret(P.id)` and derive account keys from `Q`’s secret, not `P`’s.
5. At best this bricks signing with “account address inconsistency”; at worst, if other wallet state is already tampered to align with `Q`, the wallet now operates under the wrong root key.

**Preconditions**:
- The target profile is passkey-backed.
- The caller reaches the Path A unlock surface (`unlockPasskeyProfile(id, credentialData)`).
- The supplied `credentialData` is for a different credential than the profile’s stored `credentialId`.

**Why mitigations fail**:
- The popup’s targeted `allowCredentials` request is a caller-side safeguard, not a service-side invariant.
- Phase 3’s “credential rotated during prompt” check only compares the profile row to its own earlier snapshot; it does not authenticate the supplied recovery result.
- There is no stored encrypted master secret for passkey profiles, so once the wrong `recovery.secret` is accepted, nothing else cross-checks it.

**Instances**:
- `packages/extension/src/popup/pages/auth.vue:72-74`
- `packages/extension/src/wallet/services/profile/service.ts:303-311`
- `packages/extension/src/wallet/services/profile/service.ts:323-329`
- `packages/extension/src/wallet/services/profile/service.ts:355-360`
- `packages/extension/src/wallet/services/profile/passkey-recovery-coordinator.ts:102-109`
- Contrast / intended pattern: `packages/extension/src/wallet/services/profile/service.ts:641-660`

---

### Finding 2 — `PasskeyCredential.create` accepts malformed, short, or degenerate PRF output without fail-closed validation

**Title**: The passkey master-secret chain treats any base64-decoded `prf` bytes as valid HKDF input, with no minimum length, fixed-length, or all-zero rejection before deriving the wallet master secret.

**Impact factors**:
- CIA+A: **Confidentiality** + **Integrity**. A malicious authenticator or forged internal caller can force the wallet to derive a predictable master secret.
- Blast radius: passkey create, unlock, import, and restore flows that materialize `PasskeyCredentialData`.
- Exploitability: high-impact but higher-precondition than a web bug; the attacker needs a malicious authenticator, compromised WebAuthn/browser layer, or forged internal `credentialData`.

**Evidence confidence**: **high** — exact data path is visible in code; the only inference is that malformed PRF outputs are possible from a hostile authenticator/caller.

**OWASP / CWE mapping**: A02:2021 Cryptographic Failures, A04:2021 Insecure Design — **CWE-330** (Use of Insufficiently Random Values), **CWE-20** (Improper Input Validation), **CWE-345** (Insufficient Verification of Data Authenticity).

**Trace** (source → sink):
1. Popup-side ceremony reads `ext.prf.results.first` and forwards it as base64 `credentialData.prf` at `packages/extension/src/popup/utils/passkey-ceremony.ts:102-105` and `:127-130`.
2. Path A materialization forwards that data straight into `PasskeyCredential.create(...)` via `PasskeyService.materializeCredential(...)` at `packages/extension/src/wallet/services/passkey/service.ts:76-78`.
3. `PasskeyCredential.create` decodes the PRF with `Buffer.from(params.prf, "base64")` and immediately imports it as HKDF keying material at `packages/wallet-crypto/src/passkey-credential.ts:36-43`.
4. No code checks decoded length, canonical encoding, or degenerate content before `importKey`.
5. `deriveMasterSecret` deterministically transforms that IKM into the wallet master secret at `packages/wallet-crypto/src/passkey-credential.ts:53-63`.

**Missing control**: `PasskeyCredential.create` should reject malformed inputs before `importKey`, at minimum:
- enforce exact PRF output length expected from the wallet’s ceremony contract,
- reject zero-length decode,
- reject all-zero material as a defense-in-depth sanity check,
- optionally validate that `id` also decodes to non-empty bytes.

**Exploit story**:
1. A malicious USB authenticator or compromised WebAuthn layer returns a fixed PRF output such as all-zero 32 bytes or a tiny attacker-chosen buffer.
2. The popup forwards that value as ordinary `credentialData.prf`.
3. `PasskeyCredential.create` accepts it and HKDF-derives a master secret from attacker-controlled input plus the public credential ID.
4. The wallet creates/imports/unlocks a passkey profile under a secret the attacker can recompute offline.

**Preconditions**:
- The attacker controls the PRF output source or can forge `PasskeyCredentialData`.
- The wallet is using a passkey flow that materializes credential data in software.

**Why mitigations fail**:
- The popup checks only presence of `ext.prf.results`, not output quality or size.
- HKDF itself is not a validator; it will happily derive output from weak or tiny IKM.
- The derivation chain has no later “known-good secret” cross-check for newly created/imported passkey profiles.

**Instances**:
- `packages/extension/src/popup/utils/passkey-ceremony.ts:102-105`
- `packages/extension/src/popup/utils/passkey-ceremony.ts:127-130`
- `packages/extension/src/wallet/services/passkey/service.ts:76-78`
- `packages/wallet-crypto/src/passkey-credential.ts:36-43`
- `packages/wallet-crypto/src/passkey-credential.ts:53-63`

---

### Finding 3 — Best-effort zeroization misses secret-bearing `Buffer.from(...)` clones on the way into `Fr`

**Title**: Several secret-handling paths zero the original `Uint8Array`/`ArrayBuffer`, but first create a separate `Buffer.from(...)` copy that is never wiped, leaving extra raw-secret allocations in the heap.

**Impact factors**:
- CIA+A: **Confidentiality** only.
- Blast radius: password-profile session open/restore and passkey master-secret derivation.
- Exploitability: local-memory attacker / crash dump / post-compromise forensic scenario only; not a storage-at-rest issue.

**Evidence confidence**: **high** — the unzeroized copies are explicit in code.

**OWASP / CWE mapping**: A02:2021 Cryptographic Failures — **CWE-244** (Improper Clearing of Heap Memory Before Release), **CWE-226** (Sensitive Information in Resource Not Removed Before Reuse).

**Trace** (source → sink):
1. `SessionManager.open` converts `secretBuffer` into `Buffer.from(secretBuffer)` and passes that into `Fr.fromBuffer(...)` at `packages/extension/src/wallet/services/profile/session-manager.ts:204-210`.
2. The caller later zeroizes `secretBuffer`, but the intermediate `Buffer` clone created inside `open()` is not retained or zeroized.
3. `SessionManager.restore` does the same with decrypted `secretBytes` at `packages/extension/src/wallet/services/profile/session-manager.ts:372-389`; only `secretBytes` is wiped in `finally`.
4. `PasskeyCredential.deriveMasterSecret` creates `Buffer.from(new Uint8Array(masterBits))` before `Fr.fromBufferReduce(...)` at `packages/wallet-crypto/src/passkey-credential.ts:53-68`; only `masterBits` is wiped, not the temporary `Buffer`.

**Missing control**: Every secret-bearing temporary copy needs ownership and explicit wiping, or the code should avoid allocating the extra copy in the first place if the upstream API can consume a view safely.

**Exploit story**:
1. User unlocks a password or passkey profile.
2. The service wipes the original `secretBuffer` / `secretBytes` / `masterBits`.
3. A local memory capture taken shortly after unlock still has a second raw-secret copy in a short-lived `Buffer` allocation that was never zeroized.
4. The stated “tightened window” from `zeroize(...)` is weaker than intended because the heap still contains unowned clones.

**Preconditions**:
- The attacker can read process memory or a crash dump.
- The secret-handling path has run recently enough that the GC has not reclaimed the temporary clone.

**Why mitigations fail**:
- `zeroize` only wipes the object it is handed; it cannot reach copies created by `Buffer.from(...)`.
- The relevant call sites zero the original buffers and document `Fr` copy semantics, but do not account for the extra JS-side clone created before `Fr` sees the bytes.

**Instances**:
- `packages/extension/src/wallet/services/profile/session-manager.ts:204-210`
- `packages/extension/src/wallet/services/profile/session-manager.ts:372-389`
- `packages/wallet-crypto/src/passkey-credential.ts:53-68`
- Supporting limitation already documented generically at `packages/wallet-crypto/src/zeroize.ts:15-20`

---

## Non-findings

- Verified: `array_equals` is non-constant-time at `packages/wallet-core/src/utils/arrays.ts:1-10`. I did **not** find a secret-data comparison in this cluster. The only live call site is `packages/wallet-crypto/src/password-secret-box.ts:171`, comparing decrypted `guard` bytes to the public constant `ENCRYPTION_GUARD`. Because AES-GCM tag failure already prevents wrong-key garbage from reaching that compare, and the constant is public anyway, I did not treat this as an exploitable timing leak here.

- Verified: `EncryptionKey.getPasshash(password)` is deterministic `SHA-256(UTF-8(password))` with no per-profile salt at `packages/wallet-crypto/src/encryption-key.ts:97-100`. I did **not** confirm the specific Phase 1 story that this is persisted in `chrome.storage.local`. Password-profile rows in `chrome.storage.local` store only encrypted `{guard, secret}` (`packages/extension/src/wallet/services/profile/spec.ts:18-29`, `packages/extension/src/wallet/services/profile/repository.ts:42-45`); `passhash` is only written to `chrome.storage.session` when `strictSecurityMode` is disabled (`packages/extension/src/wallet/config/config.ts:12-18`, `packages/extension/src/wallet/services/profile/session-manager.ts:201-205`). Default config ships with `strictSecurityMode = true`. Residual risk remains for lenient-mode live-session compromise, but the default `chrome.storage.local` rainbow-table story is not present.

- `EncryptionKey.decrypt` does check the version byte, not merely strip it. Nonzero version is rejected at `packages/wallet-crypto/src/encryption-key.ts:58-61`, so a future v1 ciphertext will fail closed under current code rather than being mis-decoded as v0.

- AES-GCM tag width is full-size in practice here. The code omits `tagLength` in `crypto.subtle.encrypt/decrypt` at `packages/wallet-crypto/src/encryption-key.ts:38` and `:67`, and there is no custom short-tag setting anywhere in this cluster.

- `salt = SHA-256(iv)` in `EncryptionKey.encrypt/decrypt` (`packages/wallet-crypto/src/encryption-key.ts:35-37`, `:65-66`) is unusual and redundant, but I did not find an attack enabled by it beyond the ordinary consequences of random-IV GCM.

- `EncryptionKey.fromPassword(password: string)` cannot zeroize the immutable JS string, but in this repo it is only used by tests/vector fixtures (`packages/wallet-crypto/src/encryption-key.test.ts`, `packages/extension/src/wallet/crypto/key-vectors.test.ts`). I did not find a production path retaining that string in a closure or persisting it.

- `getRandomHex` is backed by `self.crypto.getRandomValues` at `packages/wallet-core/src/utils/random.ts:13-15`, and I found no fallback to `Math.random` in the ID/IV/secret generation chain. `getRandomElement` does use `Math.random` at `packages/wallet-core/src/utils/random.ts:18-23`, but I found no call sites anywhere under `packages/`, so it is latent hygiene debt rather than an active CSPRNG flaw in this cluster.

- Mnemonic handling is BIP-39 compatible on the active wallet paths: the word list is the English list in `packages/wallet-core/src/utils/mnemonic.ts`, checksum validation is enforced in `getEntropy(...)` at `:2150-2156`, export derives words from a 32-byte master secret in `packages/extension/src/wallet/services/profile/service.ts:727-728`, and the import UI only enables mnemonic restore for 24-word input at `packages/extension/src/popup/pages/import.vue:127-130`. The helper itself is looser than strict BIP-39 on standalone length checks, but I did not find a live wallet path accepting 3/6/9-word mnemonics.

- `userHandle` being absent does not fail open cryptographically. The passkey master-secret derivation depends on PRF output plus credential ID, not `userHandle` (`packages/wallet-crypto/src/passkey-credential.ts:39-43`, `:53-63`). When `userHandle` is missing on import/create-adjacent paths, the service falls back to generating a profile ID; this affects profile linkage, not the derived wallet secret.
