CLUSTER: crypto-core

## Findings

### [1] Passkey HKDF output is copied into an uncleared temporary Buffer

**Impact factors**: Confidentiality violation for a single user's passkey-backed wallet master secret material. Data sensitivity is wallet master-secret-equivalent material. Exploitability: local attack vector, high attack complexity, high privileges required, user interaction required to trigger a passkey ceremony.

**Evidence confidence**: high

**OWASP / CWE mapping**: OWASP A02: Cryptographic Failures; CWE-226 Sensitive Information in Resource Not Removed Before Reuse; CWE-316 Cleartext Storage of Sensitive Information in Memory.

**Trace**:
- Secret PRF material enters as `PasskeyCredentialData.prf`: `packages/wallet-crypto/src/passkey-credential.ts:7`
- It is decoded into `ikm`: `packages/wallet-crypto/src/passkey-credential.ts:37`
- HKDF key is imported from that IKM: `packages/wallet-crypto/src/passkey-credential.ts:41`
- `deriveMasterSecret()` derives 256 bits from HKDF: `packages/wallet-crypto/src/passkey-credential.ts:53`
- The derived bits are copied into an inline `Buffer.from(new Uint8Array(masterBits))` for `Fr.fromBufferReduce`: `packages/wallet-crypto/src/passkey-credential.ts:60`
- Only the original `masterBits` buffer is zeroized: `packages/wallet-crypto/src/passkey-credential.ts:68`

**Missing control**: The intermediate `Buffer` copy of `masterBits` is not assigned to a variable and zeroized in a `finally` block after `Fr.fromBufferReduce` copies it.

**Exploit story / violation scenario**:
1. User unlocks, creates, imports, or exports a passkey-backed profile.
2. `deriveMasterSecret()` derives HKDF output and copies it into a Node-style `Buffer`.
3. The original `ArrayBuffer` is zeroized, but the copied `Buffer` remains in the JS heap until GC/reuse.
4. A local over-privileged actor with extension-process debugging, heap snapshot, or memory-read capability after the ceremony recovers the lingering buffer.
5. The actor applies the same `Fr.fromBufferReduce(...).toBuffer()` transformation and obtains the master secret bytes needed to derive wallet keys.

**Preconditions**: A passkey-backed profile path must run, and the attacker must have local/high-privilege memory inspection of the extension process after the passkey operation.

**Why mitigations fail**: `zeroize(masterBits)` covers only the original `ArrayBuffer`; the package's own zeroize caveat says copies such as `Buffer.from(...)` are unaffected (`packages/wallet-crypto/src/zeroize.ts:17`). Caller-side zeroization of the returned master secret does not reach the temporary inline `Buffer`.

**Instances**:
- `packages/wallet-crypto/src/passkey-credential.ts:60`

### [2] `EncryptionKey.fromPassword()` leaves a password-equivalent passhash uncleared

**Impact factors**: Confidentiality violation for a single user's password-derived encryption keys and ciphertexts protected by that password-derived `EncryptionKey`. Data sensitivity is password-equivalent KDF input. Exploitability: local attack vector, high attack complexity, high privileges required, user interaction depends on the caller path.

**Evidence confidence**: high

**OWASP / CWE mapping**: OWASP A02: Cryptographic Failures; CWE-522 Insufficiently Protected Credentials; CWE-226 Sensitive Information in Resource Not Removed Before Reuse.

**Trace**:
- Production caller derives a recovery encryption key from a user signature via `EncryptionKey.fromPassword(...)`: `packages/bridge-core/src/recovery-crypto.ts:50`
- `fromPassword(password)` accepts the secret string: `packages/wallet-crypto/src/encryption-key.ts:77`
- It derives `passhash`: `packages/wallet-crypto/src/encryption-key.ts:78`
- `getPasshash()` computes SHA-256 over the password bytes: `packages/wallet-crypto/src/encryption-key.ts:97`
- `fromPasshash()` imports that passhash as the PBKDF2 base key: `packages/wallet-crypto/src/encryption-key.ts:88`
- `fromPassword()` returns without zeroizing the local `passhash`: `packages/wallet-crypto/src/encryption-key.ts:79`

**Missing control**: `fromPassword()` should wrap `fromPasshash(passhash)` in `try/finally` and call `zeroize(passhash)` after the WebCrypto import completes.

**Exploit story / violation scenario**:
1. A user performs a flow that calls `EncryptionKey.fromPassword()`, such as bridge recovery key derivation.
2. The method computes a SHA-256 passhash that is sufficient input to `EncryptionKey.fromPasshash()`.
3. The passhash is imported into a non-extractable `CryptoKey`, but the original `ArrayBuffer` remains uncleared in JS heap.
4. A local over-privileged actor with heap/memory access recovers the passhash.
5. The actor uses `EncryptionKey.fromPasshash(recoveredPasshash)` to decrypt ciphertexts sealed under that password-derived key.

**Preconditions**: A production path must call `fromPassword()`, and the attacker must have local/high-privilege memory inspection after the key derivation.

**Why mitigations fail**: `CryptoKey` non-extractability protects the imported key object, not the pre-import `ArrayBuffer`. Other PasswordSecretBox paths explicitly zero passhashes (`packages/wallet-crypto/src/password-secret-box.ts:109`), but `fromPassword()` hides this buffer from callers and does not clear it internally.

**Instances**:
- `packages/wallet-crypto/src/encryption-key.ts:78`
- `packages/wallet-crypto/src/encryption-key.ts:79`