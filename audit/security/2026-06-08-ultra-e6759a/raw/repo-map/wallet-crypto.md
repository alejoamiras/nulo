# Security Map: packages/wallet-crypto

**THIS IS THE CRYPTO PACKAGE.** Highest-leverage security surface in the entire repo. ~750 LOC.

## Module inventory

| File | Path | Purpose | LOC |
|------|------|---------|-----|
| `encryption-key.ts` | `src/` | PBKDF2-SHA256 (600k iterations) + AES-GCM key derivation and framed ciphertext encryption/decryption | 116 |
| `password-secret-box.ts` | `src/` | Password-based wrapping around `EncryptionKey` with `ENCRYPTION_GUARD` round-trip check and passhash fast-path | 199 |
| `passkey-credential.ts` | `src/` | WebAuthn PRF → HKDF-SHA256 master-secret derivation chain (credential ID + PRF label + HKDF info labels) | 71 |
| `zeroize.ts` | `src/` | Defense-in-depth buffer zeroing for `Uint8Array`, `ArrayBuffer`, Node `Buffer`, and subarray views | 49 |
| `constants.ts` | `src/` | `PASSKEY_PRF_LABEL` ("nulo:profile:v1") domain-separator for WebAuthn PRF extension | 10 |
| `index.ts` | `src/` | Public API re-exports | 22 |
| **Unit tests** | `src/*.test.ts` | `encryption-key.test.ts`, `password-secret-box.test.ts`, `zeroize.test.ts` | 253 |
| **Integration vectors** | (external) | `packages/extension/src/wallet/crypto/key-vectors.test.ts` — 9 test vectors (V1–V9, P1) | 150+ |

## Entrypoints (public API)

### `EncryptionKey.fromPassword(password: string): Promise<EncryptionKey>`
- **Algorithm**: PBKDF2-SHA256, **600,000 iterations** (OWASP 2023 minimum), salt = SHA-256(IV), 256-bit AES-GCM key
- **Backend**: WebCrypto (`crypto.subtle.deriveKey`)

### `EncryptionKey.encrypt(payload: Uint8Array): Promise<Uint8Array>`
- **Algorithm**: AES-GCM-256, 12-byte random IV from `crypto.getRandomValues`, deterministic salt = SHA-256(IV)
- **Output format**: `[version:1B][IV:12B][ciphertext:n][tag:16B]`
- **IV source**: Cryptographically secure RNG

### `EncryptionKey.decrypt(payload: Uint8Array): Promise<Uint8Array>`
- Throws if payload malformed or AEAD tag invalid

### `EncryptionKey.getPasshash(password: string): Promise<ArrayBuffer>`
- Pure SHA-256 hash; used as bearer for silent session restore
- **Algorithm**: SHA-256, input = UTF-8(password)
- **Output size**: 32 bytes, hex-encoded in `Session` record

### `PasswordSecretBox.seal(password, secret): Promise<Sealed>`
- Returns `{ passhash, encrypted: { guard: base64, secret: base64 } }`
- Runs `EncryptionKey.getPasshash(password)` + two `EncryptionKey.encrypt()` calls (guard + secret, independent IVs/tags)
- **Invariant**: `ENCRYPTION_GUARD` (8 frozen bytes: `[6,11,20,20,22,4,20,22]`) encrypts first; unseal decrypts and compares byte-for-byte to detect wrong password

### `PasswordSecretBox.unseal(password, encrypted): Promise<Uint8Array | null>`
- Returns `null` on wrong password or corruption (does NOT throw)
- **Guard check**: Non-constant-time (uses `array_equals` loop with early-exit on mismatch) ⚠️

### `PasswordSecretBox.unsealWithPasshash(passhash, encrypted): Promise<Uint8Array | null>`
- Fast path using pre-computed passhash (avoids PBKDF2 re-run)

### `PasswordSecretBox.reseal(oldPassword, newPassword, encrypted): Promise<Sealed | null>`
- Re-encrypts under new password

### `PasskeyCredential.create(credentialData): Promise<PasskeyCredential>`
- **Input**: `{ id: base64, prf: base64, userHandle?: hex }`
- **Algorithm**: `importKey(prf, "HKDF")` → `deriveBits(HKDF-SHA256, salt, info)` → `Fr.fromBufferReduce`
  - **Salt**: SHA-256(label || credentialId) where label = `"nulo:kdf:v1"` (locked)
  - **Info**: `"nulo:master:v1"` (module-private, locked by V3 vector)
- **Backend**: WebCrypto HKDF, Aztec `Fr` for field-reduction

### `PasskeyCredential.deriveMasterSecret(): Promise<Buffer<ArrayBuffer>>`
- Derives 256-bit master secret via HKDF
- **Output**: 32-byte `Fr` element (Grumpkin scalar field)

## Trust boundaries + crypto-specific risks

### Key Material Generation & Storage

**Password-based**:
- Password → SHA-256 hash → PBKDF2-derived key (opaque WebCrypto `CryptoKey`)
- **Passhash bearer**: Derived once in `seal()`, cached in `Session` record (plaintext, base64-encoded) to enable session restore without re-prompting
- **Master secret**: 32 bytes, encrypted under `EncryptionKey`, persisted base64-encoded as `EncryptedProfileSecret.secret`
- **Storage**: Profile row in `chrome.storage.local`; Session record in `chrome.storage.session` (survives SW suspension, cleared on browser close)
- **Zeroization**: `zeroize()` called explicitly in `finally` blocks; `ArrayBuffer` views returned from Web Crypto are zeroed after use

**Passkey-based**:
- **PRF input**: WebAuthn platform generates; wallet receives base64-encoded 32-byte IKM from popup
- **PRF is non-portable**: Tied to browser context (Chromium FrameTreeNode scope per spec); cross-extension export/import not supported
- **Master secret**: Derived via HKDF once, not cached; each derivation re-runs HKDF
- **Buffer ownership**: `PasskeyCredential.deriveMasterSecret()` returns a fresh `Fr.toBuffer()` allocation; caller must `zeroize()` it

### Password Hashing

- **KDF**: PBKDF2-SHA256, **600,000 iterations** (OWASP 2023 minimum for SHA256)
- **Salt**: 12-byte random IV from `crypto.getRandomValues()`, input to SHA-256 for salt derivation (2x HMAC per iteration = 1.2M HMAC-SHA256 ops per unlock)
- **Salt size**: 12 bytes IV → 32-byte SHA-256 salt (adequate entropy, no reuse across passwords)
- **Iteration count**: Frozen in `src/encryption-key.ts` as constant `PBKDF2_ITERATIONS = 600_000`; incrementing requires storage-version bump
- **Dictionary-attack resistance**: Passhash is deterministic SHA-256(password), no salt — two users with same password have same passhash. **Intentional** (silent session restore requires determinism). An attacker with a profile row can precompute SHA-256 rainbow tables offline. Mitigated by PBKDF2 being expensive; an attacker must iterate 600k times per guess.

### Encryption

- **Scheme**: AES-256-GCM (authenticated encryption, no padding oracle)
- **IV generation**: 12-byte random from `crypto.getRandomValues()` per encryption (no reuse risk within Web Crypto's RNG period)
- **IV handling**: Prepended to ciphertext as bytes 1–12; IV → salt via SHA-256(IV); salt is input to PBKDF2
- **Associated data**: None explicitly set; GCM operates on ciphertext + 16-byte auth tag
- **Version framing**: 1-byte version tag (currently 0); future format migrations can be coexistent

### Mnemonic / Seed Phrase

**Not implemented in wallet-crypto**. Passkey and password are the only derivation paths. Mnemonic import/export lives in `extension/services/profile`.

### Comparison / Timing

**⚠️ RISK**: `array_equals` in `wallet-core/utils/arrays.ts` is **NOT constant-time**:
```typescript
for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) {
        return false  // <-- early exit on mismatch
    }
}
```
- **Impact**: Wrong-password detection in `PasswordSecretBox.unsealInternal` leaks timing about GUARD plaintext byte-by-byte position
- **Severity**: Low in practice (GUARD is fixed 8-byte constant, timing window ~microseconds, attacker needs local timing access + many samples) but violates cryptographic constant-time discipline
- **Mitigation**: None in scope; would require constant-time comparison (not exposed by Web Crypto API)

### Side-Channels

- **Branch timing**: `decrypt()` checks version byte first, then validates length; not on secret paths
- **Table lookups**: AES-GCM is hardware-accelerated; PBKDF2 and SHA-256 also hardware-accelerated in Web Crypto
- **Cache timing**: Web Crypto designed to be cache-resistant
- **No key-dependent branches**: PBKDF2 iteration loop, HKDF, AES-GCM all have constant data flow

### Cryptographic Agility

- **Version byte in ciphertext**: `[0][IV][CT+tag]` → future formats can be discriminated
- **Label versioning**: `PASSKEY_KDF_LABEL = "nulo:profile:v1"` and internal labels `"nulo:kdf:v1"`, `"nulo:master:v1"` allow future v2/v3 chains
- **Storage migration**: `packages/extension/src/wallet/storage/migrate.ts` handles destructive wipes; no forward-compatibility mode

## Dependency graph

### Workspace imports
- **Incoming**: `wallet-crypto` imported by extension (profile service, passkey ceremony, backup import, key-vectors test)
- **Outgoing**: `wallet-crypto` depends on `@nulo/wallet-core` for `array_equals` utility ONLY
- **Layering**: ✓ PASS — doesn't import from extension, aztec-runtime, wallet-bridge, or extension-messaging

### External crypto dependencies
- **None**. All crypto via:
  - `WebCrypto` (browser / jsdom built-in): PBKDF2, SHA-256, AES-GCM, HKDF
  - `@aztec/foundation/curves/bn254` v4.2.0 (for `Fr`)
  - `@aztec/stdlib/keys` v4.2.0 (for `deriveSigningKey`)

### Consumers
- **Direct**: `extension`
- **Indirect**: All extension services that depend on `ProfileService`

## Frameworks in use
WebCrypto, Aztec Foundation Fr. No other crypto libraries (no `@noble/hashes`, `@noble/ciphers`, `libsodium.js`, `tweetnacl`).

## Test surfaces

### Unit tests
- **`encryption-key.test.ts`** (38 LOC) — round-trip, IV entropy, wrong-key AEAD validation
- **`password-secret-box.test.ts`** (139 LOC) — seal/unseal, wrong password returns null, corrupted ciphertext returns null, ENCRYPTION_GUARD bytes pinned (tripwire)
- **`zeroize.test.ts`** (76 LOC) — Uint8Array zero, ArrayBuffer zero, Node Buffer, subarray, `Fr.fromBuffer` copy semantics

### Integration vectors (extension-side)
`packages/extension/src/wallet/crypto/key-vectors.test.ts` (150+ LOC):
- **V1**: SHA-256(password) fixture
- **V2a/V2b**: PBKDF2-SHA256 + AES-GCM round-trip with fixed IV (committed ciphertext)
- **V3**: Passkey HKDF-SHA256 with fixture
- **V6**: `getHashHex` (backup checksum)
- **V7a**: `deriveSigningKey` (Aztec upstream)
- **V8**: `PASSKEY_PRF_LABEL` spec constant
- **V9**: `AccountType.Nulo_v1 === 0` enum canary
- **P1**: RFC 5869 Appendix A.1 (HKDF-SHA256 reference vector)

**Coverage**:
- ✓ KAT (known-answer tests) for password hash, PBKDF2+AES-GCM, passkey HKDF
- ✓ RFC reference (RFC 5869 HKDF A.1)
- ✓ Negative tests (wrong password, corrupted ciphertext)
- ✓ **No Barretenberg/Poseidon2 coverage** (V4, V7b, V10, P2 deferred due to jsdom WASM crash)

## Generated / vendored / dev-only
None. `wallet-crypto` is core crypto machinery; no code generation, no vendored deps.

---

**Summary**: 741-LOC security-critical package implementing PBKDF2-SHA256 (600k iterations) + AES-GCM for password-based secrets and WebAuthn PRF → HKDF-SHA256 for passkey master-secret derivation. All crypto primitives via Web Crypto + Aztec Foundation. Carefully layered (no workspace dependencies except wallet-core), extensively vector-locked. **One constant-time comparison risk** exists in `array_equals` (early-exit on guard mismatch).
