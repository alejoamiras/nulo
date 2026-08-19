# @nulo/wallet-crypto

Password and passkey-based KDF, `PasswordSecretBox` encryption, and the vector-locked derivation chain. Buffer ownership is explicit; secret material is zeroed on drop. Vectors must not change without ratcheting the storage version.

## Position in the stack

```
wallet-core  →  wallet-crypto  →  extension-messaging  →  …  →  extension
```

Depends only on `wallet-core` for the `ILogger` interface and `Web Crypto` (available in both browsers and jsdom). No `chrome.*`, no Node-specific I/O.

## File map

| Path | Purpose |
|---|---|
| `src/encryption-key.ts` | `EncryptionKey` — PBKDF2 (SHA-256, 600k iterations) + AES-GCM framed ciphertext. The 1-byte version frame lets future formats coexist. |
| `src/password-secret-box.ts` | `PasswordSecretBox` — password-based wrap around `EncryptionKey`. Stores `passhash` (a deterministic public hash of the password's KDF output) so a session can be silently re-derived without re-prompting. |
| `src/passkey-credential.ts` | `PasskeyCredential` — WebAuthn PRF → HKDF master-secret. Exposes `recoverFromCredentialData()` for the in-page modal Path A flow. |
| `src/constants.ts` | `ENCRYPTION_GUARD` (frozen by the V8 vector), `PASSKEY_PRF_LABEL`. |
| `src/zeroize.ts` | `zeroize()` helper for explicit secret-buffer wipes. |
| `src/index.ts` | Public exports. |
| [`ATTACK-SURFACE.md`](./ATTACK-SURFACE.md) | What an attacker who reads the disk actually gets, and the work factor to invert each artifact. Read this before changing a KDF cost, adding a persisted field, or arguing about whether something needs encrypting. |
| `vectors/` | Vendored **official** BIP-39 test vectors + provenance — the external oracle for the mnemonic step. |

## Scripts

| Command | Effect |
|---|---|
| `bun run typecheck` | `tsc --noEmit`. |
| `bun run test` | Unit tests via vitest. |

## Testing

Colocated `*.test.ts`. The cryptographic derivation chain is **additionally locked** by an extension-side integration test:

- `apps/extension/src/wallet/crypto/key-vectors.test.ts` exercises the full chain end-to-end and must pass byte-identically after any change here.

Four assurance suites exist to prove *behaviour*, not just consistency — each answers a question that
reading the code cannot:

| Suite | Question it settles |
|---|---|
| `src/bip39-official-kat.test.ts` | Does the mnemonic step match the **published spec**? All 24 official BIP-39 English vectors, vendored with provenance. The expected seeds come from outside this repo, so a misreading of the spec cannot make the code and its test wrong in the same direction. |
| `src/reduction-entropy.test.ts` | How much entropy does reducing into the BN254 field actually cost? Computed from the modulus (verified empirically, not trusted from a constant) rather than asserted in prose. Narrowing any reduce input reds this with the exact bit loss. |
| `src/nonce-uniqueness.test.ts` | Can any AES-GCM box ever repeat a nonce? A repeat destroys confidentiality **and** integrity at once, and the dangerous version of that bug is deterministic, so it collides on the first repeat. |
| `src/zeroize.test.ts` | Do secret buffers actually get wiped, including the copies library calls make internally? |

Treat that file as a contract. **A vector/KDF change is NOT an ordinary storage migration.** The boot migrator (`@nulo/wallet-core/migration`) runs BEFORE unlock, so it has no password and cannot decrypt + re-encrypt the stored secret. An intentional change (rotating a label, bumping a KDF cost) therefore requires either a **re-encrypt-on-next-unlock** step (once the password is available) or a **documented reset** — never a plain numbered migration. The data-preserving migration framework at `apps/extension/src/wallet/storage/migrations/` handles persisted-JSON shape changes only, not crypto.

## Key invariants

- **`ENCRYPTION_GUARD`** (`src/constants.ts`) is the V8-vector-frozen GCM associated-data tag. Changing it bricks every existing wallet.
- **Buffer ownership.** Secret material is allocated as `Uint8Array<ArrayBuffer>`, never `Buffer`. Callers own the lifecycle and call `zeroize()` on drop. The package never mutates a buffer it didn't allocate, and never returns a buffer it expects to keep alive.
- **`PasswordSecretBox.seal()` and `unseal()` are not symmetric across the passhash boundary.** `seal()` produces both an `EncryptedProfileSecret` (the on-disk record) and a `passhash` (the silent-restore bearer). `unsealWithPasshash()` and `unseal(password, …)` produce the same plaintext via different routes; both must remain in lock-step with the V2/V8 vectors.
- **WebAuthn PRF non-portability.** Passkey credentials are tied to the registering browser context (per Chromium's FrameTreeNode scope). Cross-extension export+import of a passkey-typed backup is not supported. See `implementations-plan/passkey-e2e/PRF-NON-PORTABLE.md`.
- **No Chrome APIs, no Node I/O.** Only Web Crypto, `@aztec/foundation` math helpers, and pure bytes.
