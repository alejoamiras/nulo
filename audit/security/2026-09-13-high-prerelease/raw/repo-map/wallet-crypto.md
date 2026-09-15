# Map: `packages/wallet-crypto`

All paths repo-relative. Package: `@nulo/wallet-crypto` (`packages/wallet-crypto`), private, version `0.1.0`. Pure derivation/encryption library — no `chrome.*`, no Node I/O, only Web Crypto (`globalThis.crypto` / `crypto`) + `@aztec/foundation` math + `@nulo/wallet-core/utils`. Non-test LOC ≈ 1404 (1425 incl. `globals.d.ts`).

## 1. Module inventory

| File | Purpose | LOC (non-test) |
|---|---|---|
| `packages/wallet-crypto/src/index.ts` | Public export surface (barrel). | 56 |
| `packages/wallet-crypto/src/constants.ts` | `PASSKEY_PRF_LABEL` — the WebAuthn PRF `eval` input, V8-vector-frozen. | 10 |
| `packages/wallet-crypto/src/nulo-separators.ts` | NULO-ACCOUNT-KDF v2 domain separators (`NULO_ACCOUNT_SEED_SEP`, `NULO_SIGNING_ROOT_SEP`) + their source labels. | 23 |
| `packages/wallet-crypto/src/derive-account-seed.ts` | The one account-seed derivation (Poseidon2 over master/l1ChainId/type/index) + chain-id canonicality guard. | 31 |
| `packages/wallet-crypto/src/pxe-store-key.ts` | Per-profile PXE/SQLite-OPFS store key (HKDF off the master). | 34 |
| `packages/wallet-crypto/src/account-derivation.ts` | seed → Schnorr signing key (root) → Aztec `secretKey` (privacy key), the v2 signing-key-root model. | 40 |
| `packages/wallet-crypto/src/wallet-fingerprint.ts` | One-way plaintext duplicate-recovery-phrase detector (`sha256(label‖master)`). | 42 |
| `packages/wallet-crypto/src/zeroize.ts` | Best-effort buffer-wipe helper used throughout the package and by extension callers. | 49 |
| `packages/wallet-crypto/src/mnemonic-master.ts` | BIP-39 mnemonic → 64-byte seed (PBKDF2-HMAC-SHA512) → 32-byte master (`Fr.fromBufferReduce`). | 62 |
| `packages/wallet-crypto/src/imported-keys-dek-box.ts` | Generates + seals/unseals the per-profile "imported-keys DEK" under a credential-derived AES-GCM key. | 73 |
| `packages/wallet-crypto/src/imported-account-key-box.ts` | Seals/unseals an imported (external) account's Grumpkin signing key under `HKDF(dek, chainId‖address)`. | 77 |
| `packages/wallet-crypto/src/entropy-mac.ts` | `computeEnvelopeMacV3`/`verifyEnvelopeMacV3` — HMAC over the whole sealed-profile envelope + row identity. | 112 |
| `packages/wallet-crypto/src/secret-types.ts` | Branded (nominal, zero-runtime) secret + wire-encoding types and their `as*` mint functions. | 117 |
| `packages/wallet-crypto/src/passkey-credential.ts` | `PasskeyCredential` — WebAuthn PRF → HKDF master-secret / DEK-wrap key. **No colocated test file.** | 118 |
| `packages/wallet-crypto/src/encryption-key.ts` | `EncryptionKey` — PBKDF2-SHA256(600k) + AES-256-GCM framed ciphertext, the package's base primitive. | 140 |
| `packages/wallet-crypto/src/session-secret-box.ts` | `SessionSecretBox` — silent-restore bearer: random-token-wrapped `master‖dek` pair for `chrome.storage.session`. | 155 |
| `packages/wallet-crypto/src/password-secret-box.ts` | `PasswordSecretBox` — password-based wrap of `{secret, entropy}` around `EncryptionKey`, with the `ENCRYPTION_GUARD` round-trip check. | 265 |
| `packages/wallet-crypto/src/globals.d.ts` | Ambient `Buffer` type declaration (build-tooling shim, not logic). | 21 |

Docs: `packages/wallet-crypto/README.md`, `packages/wallet-crypto/ATTACK-SURFACE.md` (threat model + cost-to-invert table), `packages/wallet-crypto/vectors/PROVENANCE.md`.

## 2. Entrypoints (public exports) — per-function detail

Pure library, no handlers/ports/listeners. Every export in `src/index.ts:18-56` is an "entrypoint."

**Account / seed derivation (deterministic hashes over BN254/Grumpkin):**

- `deriveSigningKeyFromSeed(seed: Fr): GrumpkinScalar` — `account-derivation.ts:31-33`. `sha512ToGrumpkinScalar([seed, NULO_SIGNING_ROOT_SEP])`, separator `914717451` (`nulo-separators.ts:17`). Callers: `apps/extension/src/wallet/services/account/service.ts:441`, `apps/extension/src/wallet/crypto/key-vectors.test.ts:187`, `packages/aztec-runtime/src/account/derivation-vectors.test.ts:28`; internal via `deriveNuloAccountKeys`.
- `deriveNuloAccountKeys(seed: Fr): Promise<{signingKey, secretKey}>` — `account-derivation.ts:36-40`. Composes the above with upstream `deriveSecretKeyFromSigningKey` (`@aztec/accounts/utils`). Callers: `packages/aztec-runtime/src/account/nulo-account.ts:65`, `apps/tools/scripts/deploy.ts:415,423`, `apps/tools/tests/browser/test-wallet/wallet.ts:66`, `packages/bridge-core/scripts/*` (out of scope bodies), tests, `apps/extension/tests/e2e/fixtures/aztec.ts:553`.
- `assertCanonicalL1ChainId(l1ChainId: number): void` — `derive-account-seed.ts:19-23`. Bounds `0..0xffffffff`, safe-integer. **No external call sites** — only reached via `deriveAccountSeed`'s internal call.
- `deriveAccountSeed(master: Fr, l1ChainId: number, type: number, index: number): Promise<Fr>` — `derive-account-seed.ts:25-31`. `poseidon2HashWithSeparator([master, Fr(l1ChainId), Fr(type), Fr(index)], NULO_ACCOUNT_SEED_SEP)`, separator `2720999938` (`nulo-separators.ts:14`). Callers: `apps/extension/src/wallet/services/account/service.ts:268,440,576`, `apps/extension/src/wallet/services/account-integrity/coordinator.ts:56`, e2e fixtures/helpers, `packages/aztec-runtime/src/account/account-seed-vectors.test.ts`. **No colocated test in this package.**
- `NULO_ACCOUNT_SEED_SEP` / `NULO_SIGNING_ROOT_SEP` / `NULO_SEPARATOR_LABELS` — `nulo-separators.ts:14,17,20-23`.

**Mnemonic:**

- `deriveBip39Seed(words: string[], passphrase = ""): Promise<Uint8Array>` — `mnemonic-master.ts:26-47`. **PBKDF2-HMAC-SHA512, 2048 iterations** (`BIP39_ITERATIONS`, line 23 — BIP-39 spec constant), salt = `"mnemonic" + NFKD(passphrase)`, output 512 bits. Only internal use + `bip39-official-kat.test.ts`.
- `deriveMasterFromMnemonic(words, passphrase = ""): Promise<MasterSecretBytes>` — `mnemonic-master.ts:50-62`. Wraps the above + `Fr.fromBufferReduce` (64-byte input). Callers: `apps/extension/src/wallet/services/profile/service.ts:534,1617,1928,2239`, e2e, `account-seed-vectors.test.ts:36`.

**PXE store key:**

- `derivePxeStoreKey(master: Uint8Array, profileId: string): Promise<Uint8Array>` — `pxe-store-key.ts:29-34`. **HKDF-SHA256**, salt = `TextEncoder("nulo:pxe-store-salt:" + profileId)` (deterministic), info = `"nulo:pxe-store:v1"` (line 20/23), 256 bits. Callers: `apps/extension/src/wallet/runtime.ts:544`, `key-vectors.test.ts` V11.

**`EncryptionKey` (`encryption-key.ts`):**

- `PBKDF2_ITERATIONS = 600_000` (line 6).
- `.encrypt(payload, aad?)` — lines 41-58. **AES-256-GCM**. IV = `crypto.getRandomValues(new Uint8Array(12))` (line 42, fresh CSPRNG). PBKDF2 salt = `SHA-256(iv)` (line 43) — **derived from the IV, not independently random**. Key = PBKDF2-HMAC-SHA256 over `baseKey` (imported passhash), 600k, 256-bit (`deriveKey`, lines 15-31). AAD optional. Frame: `version(1 byte, =0) ‖ iv(12) ‖ ct+tag` (lines 51-57).
- `.decrypt(payload, aad?)` — lines 67-87. Rejects payload < 13 bytes or version ≠ 0.
- `.fromPassword(password)` / `.fromPasshash(passhash)` / `.getPasshash(password)` (= `SHA-256(UTF8(password))`, unsalted, line 122-125) / `.getHashHex(input)` — lines 94-139.
- Callers: `apps/extension/src/wallet/services/profile/service.ts` (dek seal/unseal at 1976-1986, and via `PasswordSecretBox`), `apps/extension/src/composables/{full-backup-restore.ts, useFullBackupImport.ts:2,390,392,396}`, `apps/extension/src/popup/pages/settings/security/export/full.vue:32,334,336,338`, `apps/extension/src/utils/full-backup-helpers.ts:6,145`, `packages/aztec-runtime/src/account/account-export.ts:23,147,149,155,156`, `packages/bridge-core/src/recovery-crypto.ts` (out of scope).

**`PasswordSecretBox` (`password-secret-box.ts`):**

- `ENCRYPTION_GUARD = Uint8Array([6,11,20,20,22,4,20,22])` — line 50. Fixed-plaintext round-trip / wrong-password check. DO NOT CHANGE.
- `PROFILE_AAD` — lines 56-60: `guard`="nulo:profile-guard:v2", `secret`="nulo:profile-master:v2", `entropy`="nulo:profile-entropy:v1". Purpose-only (no profileId) AAD tags.
- `.seal(password, secret, entropy) → {passhash, encrypted}` (94-106), `.sealWithPasshash(passhash, secret, entropy)` (115-122), `.unseal(password, encrypted)` (126-137), `.unsealWithPasshash(passhash, encrypted)` (148-154), `.reseal(oldPassword, newPassword, encrypted)` (166-191). All via `EncryptionKey`, one call per slot (`guard`/`secret`/`entropy`), each AAD-bound.
- Types: `EncryptedProfileSecret` (66-80), `Sealed` (85-88).
- Callers (all `apps/extension/src/wallet/services/profile/service.ts`, `this.secretBox` at line 264): `.seal` 540,2307; `.unseal` 597,1143,1639,1755,1840,1885,2615; `.sealWithPasshash` 2075; `.unsealWithPasshash` 972; `.reseal` 1077.

**`entropy-mac.ts` — envelope MAC:**

- `MAC_INFO_V3 = "nulo:envelope-mac:v3"` (line 39). Key = **HKDF-SHA256**(ikm = `master(32) ‖ dek(32)`, **salt = `new Uint8Array(32)` all-zero**, line 73) → HMAC-SHA256 key (non-extractable).
- `computeEnvelopeMacV3(profileId, master, dek, env)` (87-96) / `verifyEnvelopeMacV3(...)` (99-112). Preimage = `profileId.guard.secret.entropy.dek.walletFingerprint` (lines 51-59), `.` separator.
- Callers: `profile/service.ts:379(verify),552,1106,1970(verify),2077,2323`, `profile/session-manager.ts:588(verify)`.

**`imported-account-key-box.ts`:**

- `INFO_PREFIX_V2 = "nulo:imported-account-key:v2"` (line 24). Row key = **HKDF-SHA256**(dek, **salt = all-zero 32**, info = `"nulo:imported-account-key:v2|{chainId}|{address}"`) → AES-256-GCM (lines 26-36).
- `sealImportedSigningKeyV2(dek, chainId, address, signingKey)` (41-55) — IV fresh CSPRNG (line 48), no AAD (identity bound via HKDF info), output `version(1,=1) ‖ iv(12) ‖ ct`.
- `unsealImportedSigningKeyV2(dek, chainId, address, sealed)` (59-77) — throws on wrong DEK/transplant/corruption.
- Callers: `account/service.ts` — seal 491,790; unseal 378,426,784.

**`imported-keys-dek-box.ts`:**

- `IMPORTED_DEK_AAD = "nulo:profile-imported-dek:v1"` (line 29), `IMPORTED_KEYS_DEK_LEN = 32` (line 31).
- `generateImportedKeysDek()` (34-36) — raw CSPRNG 32 bytes. Callers: `profile/service.ts:537,687,1029,2068,2114,2313,2421`.
- `sealDekUnderWrapKey(wrapKey: CryptoKey, dek)` (40-50) — AES-256-GCM under caller-supplied `wrapKey` (`EncryptionKey` for password profiles / `PasskeyCredential.deriveDekWrapKey()` for passkey profiles), IV fresh (line 41), AAD = `IMPORTED_DEK_AAD`. Callers: `service.ts:690,2116,2424`.
- `unsealDekUnderWrapKey(wrapKey, sealed)` (54-73). Callers: `service.ts:420,1705,2417`.

**`wallet-fingerprint.ts`:**

- `FINGERPRINT_LABEL = "nulo:wallet-fingerprint:v1"` (line 29). `computeWalletFingerprint(master)` (31-42) = `hex(SHA-256(label ‖ master))`. **Deliberately plaintext on disk.** Callers: `profile/service.ts:416,1696,2005,2668`.

**`session-secret-box.ts` — silent-restore bearer:**

- `SESSION_WRAP_INFO = "nulo:session-wrap:v1"` (line 50), `MASTER_SECRET_LEN=32`, `PAIR_LEN=64`.
- `.wrapPair(master, dek, aad)` (69-102) — token = CSPRNG 32 (line 76, HKDF IKM), salt = CSPRNG 32 (line 77), IV = CSPRNG 12 (line 78). HKDF-SHA256(token, salt, info) → AES-256-GCM; AAD = profile id. `SessionWrappedSecret.v` accepts only `2` (38-41).
- `.unwrapPair(wrapped, aad)` (109-154) — returns `null` on any malformed input.
- Callers: `profile/session-manager.ts:268(wrapPair),564(unwrapPair)` (`this.sessionSecretBox` at line 95).

**`passkey-credential.ts` (`PasskeyCredential`):**

- `PASSKEY_KDF_LABEL="nulo:kdf:v1"`, `PASSKEY_MASTER_LABEL="nulo:master:v1"`, `PASSKEY_DEK_WRAP_LABEL="nulo:dek-wrap:v1"` — lines 30,31,34.
- `.create({id, prf, userHandle?})` (49-71) — HKDF base key from the WebAuthn PRF output; `salt = SHA-256(PASSKEY_KDF_LABEL ‖ credentialIdBytes)` (53,57 — deterministic per-credential). Callers: `passkey/service.ts:87,100`, `key-vectors.test.ts:157`.
- `.deriveMasterSecret()` (73-99) — HKDF-SHA256(baseKey, salt, info=`PASSKEY_MASTER_LABEL`) → 512 bits → `Fr.fromBufferReduce`. Callers: `profile/passkey-recovery-coordinator.ts:97`.
- `.deriveDekWrapKey()` (109-117) — HKDF-SHA256 → AES-256-GCM non-extractable. Callers: `passkey-recovery-coordinator.ts:98`.
- **No colocated test.** Exercised via `key-vectors.test.ts` (V3) and `passkey-recovery-coordinator.test.ts`.
- `PASSKEY_PRF_LABEL = "nulo:profile:v1"` — `constants.ts:10`. Consumed at `apps/extension/src/wallet/utils/passkey-ceremony.ts:35` (`SHA-256(PASSKEY_PRF_LABEL)` as the WebAuthn `eval` input) and re-exported by `passkey/spec.ts:27`.

**`zeroize.ts`:** `zeroize<T>(buf): T` (33-49) — `.fill(0)`. ~90 extension call sites in `account/service.ts`, `profile/service.ts` (≈70), `profile/session-manager.ts` (≈9).

**`secret-types.ts`** — branded types + zero-runtime mint functions (`asPasshash` 39 ext uses, `asImportedKeysDek` 11, `asBase64CredentialId` 19, `asBase64SecretPrf` 9, `asBase64MasterSecret` 8, `asMasterSecretBytes` 7, `asHexUserHandle` 5, `asBase64Ciphertext` 1).

## 3. Trust boundaries

- No untrusted input directly from a network/RPC/message boundary — leaf library.
- **Ciphertext/envelope inputs are treated as hostile.** `PasswordSecretBox.unsealInternal` (`password-secret-box.ts:214-249`), `unsealImportedSigningKeyV2` (59-77), `unsealDekUnderWrapKey` (54-73), `SessionSecretBox.unwrapPair` (109-154) decode base64 that originates from `chrome.storage.local/session` or an imported backup, fail closed.
- `EncryptionKey.decrypt` rejects payload < 13 bytes or version ≠ 0 (`encryption-key.ts:68-74`).
- No sender/origin/permission checks in this package — AAD / HKDF-info purpose tags are the substitute: they bind a ciphertext to its slot, not to a sender.
- Secrets handled: BIP-39 entropy/mnemonic, 32-byte master, passhash (`SHA-256(password)`), imported-keys DEK, WebAuthn PRF output, session bearer token, all their ciphertexts. Persistence is the caller's responsibility.
- No external calls, no storage writes.

## 4. Dependency graph

- Imports: `@nulo/wallet-core/utils` (`bytesToHex`, `canonicalizeMnemonic`, `array_equals`, `toBase64`, `fromBase64`); `@aztec/foundation/{crypto/sha512, crypto/poseidon, curves/bn254, curves/grumpkin}`, `@aztec/accounts/utils`. README claims an `ILogger` dep — no such import exists (stale).
- Imported by: `apps/extension/src/wallet/{runtime.ts, services/{account,account-integrity,passkey,profile}/*, utils/{create-passkey-profile.ts, passkey-ceremony.ts}}`; `apps/extension/src/{composables/*, popup/pages/settings/security/export/full.vue, components/passkey/PasskeyCeremonyDialog.vue, utils/full-backup-helpers.ts}`; `packages/aztec-runtime/src/{account/*, pxe/*}`; bridge-core + tools (out of scope).
- Handoff edges (data-shape): `PasswordSecretBox.seal()`'s `Sealed{passhash, encrypted}` → `SessionManager.open`; `PasskeyCredential.deriveDekWrapKey()` → `sealDekUnderWrapKey`/`unsealDekUnderWrapKey` at `passkey-recovery-coordinator.ts:98`.
- Biome (`biome.json:234-254`) forbids importing higher layers.

## 5. Frameworks / libs

Web Crypto only; `@aztec/foundation@5.2.0` (Fr/GrumpkinScalar, Poseidon2, sha512ToGrumpkinScalar); `@aztec/accounts@5.2.0` (`deriveSecretKeyFromSigningKey`); `@aztec/constants` test-only. No validation lib. Dev: vitest, jsdom.

## 6. Test surfaces

- Well covered: `password-secret-box.test.ts` (14), `entropy-mac.test.ts` (10), `zeroize.test.ts` (9), `imported-keys-dek-box.test.ts` (8), `encryption-key.test.ts` (7), `session-secret-box.test.ts` (6).
- Behaviour suites: `bip39-official-kat.test.ts` (24 official vectors), `reduction-entropy.test.ts`, `nonce-uniqueness.test.ts` (no AES-GCM box repeats a nonce), `zeroize.test.ts`.
- Thin/absent here: `derive-account-seed.ts` (downstream only), `passkey-credential.ts` (no colocated test), `account-derivation.test.ts` (1 test), `pxe-store-key.ts` (V11 only).
- Cross-package lock: `apps/extension/src/wallet/crypto/key-vectors.test.ts` — V1, V2, V3, V6, V7a, V8, V9, V11.
- Vectors: `packages/wallet-crypto/vectors/bip39-official-english.json` + `PROVENANCE.md`; `implementations-plan/key-model-v2/reference/vectors.json` + `derive-vectors.ts`.

## 7. Generated / vendored / fixture / test-only

`vectors/bip39-official-english.json` test-only; `*.test.ts` (14) not shipped; `globals.d.ts` build shim, production-wired (type only). No generated code.

## 8. Security-relevant invariants (quoted)

- README: `ENCRYPTION_GUARD` "is the V8-vector-frozen GCM associated-data tag. Changing it bricks every existing wallet." (README points at `constants.ts`; actual constant is `password-secret-box.ts:50` — stale pointer.)
- README: "Buffer ownership. Secret material is allocated as `Uint8Array<ArrayBuffer>`, never `Buffer`. Callers own the lifecycle and call `zeroize()` on drop."
- README: "`PasswordSecretBox.seal()` and `unseal()` are not symmetric across the passhash boundary … both must remain in lock-step with the V2/V8 vectors."
- README: "WebAuthn PRF non-portability … Cross-extension export+import of a passkey-typed backup is not supported."
- README: "A vector/KDF change is NOT an ordinary storage migration. The boot migrator runs BEFORE unlock, so it has no password."
- `constants.ts:1-5`: PRF `eval` label "DO NOT CHANGE — changing this bricks every existing passkey wallet."
- `password-secret-box.ts:52-55`: PROFILE_AAD "Purpose-only ON PURPOSE (no profileId …) — a ciphertext swapped between the `secret` and `entropy` slots fails authentication."
- `imported-account-key-box.ts:1-18`, `imported-keys-dek-box.ts:1-21`: DEK "deliberately CREDENTIAL-sealed (never master-derived): two profiles created from the same recovery phrase share the master … the credential is the only input distinguishing two same-phrase profiles."
- `entropy-mac.ts:34-38`: "The key is `HKDF(master ‖ dek)` — NOT master-only. The threat model includes an attacker who HOLDS the master (a same-phrase sibling profile)."
- `session-secret-box.ts:1-21`: "`token` + `wrappedSecret` live together in the Session record, so a session-store leak recovers BOTH secrets — that is the definition of a silent-restore bearer."
- `ATTACK-SURFACE.md`: "A weak password is the only realistic way to lose a wallet to an attacker who has the disk." / "PBKDF2, not Argon2id … re-encrypt-on-next-unlock change, deliberately not taken yet." / "`passhash` is an unsalted `SHA-256(password)` … password-equivalent if it ever leaked; that is why it is no longer persisted anywhere." / "A full backup carries the long-lived profile DEK, so a backup holder who later regains read access to the source profile can open imported-key rows created after the export." / "This is a custom derivation scheme … has not been reviewed by a human cryptographer."
- `wallet-fingerprint.ts:1-24`: plaintext fingerprint; 23-of-24-words search is 8 candidates, accepted tradeoff.
- `ARCHITECTURE.md:183-190`: derivation chains vector-locked by `key-vectors.test.ts`.
