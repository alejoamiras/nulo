# Repo map — `packages/wallet-crypto`

> Phase-1 map for `/harden quality` (ultra). Lens: **typing quality** (any/unknown, loose
> types, primitive obsession on keys/secrets/bytes, missing branded types, casts) + **dedup**.
> Read-only. Security findings are explicitly OUT of scope; only quality/typing/maintainability.

**Purpose (one line):** Framework-agnostic, host-agnostic crypto leaf package — password KDF
(PBKDF2 + AES-GCM `PasswordSecretBox`), passkey KDF (WebAuthn PRF → HKDF), and explicit
secret-byte zeroing. All derivation vectors are frozen and externally locked by
`packages/extension/src/wallet/crypto/key-vectors.test.ts`.

---

## 1. Module inventory

| File | LOC | Role | Notes |
|---|---|---|---|
| `src/index.ts` | 23 | Public barrel | Re-exports the 5 public symbols + 2 types. |
| `src/encryption-key.ts` | 116 | **Password KDF primitive** — PBKDF2(SHA-256, 600k iters) + AES-GCM framed ciphertext (1-byte version + 12-byte IV + ct). Static helpers `fromPassword`/`fromPasshash`/`getPasshash`/`getHashHex`. | README claims 250k iters; source is **600k** (`PBKDF2_ITERATIONS`) — doc drift. |
| `src/password-secret-box.ts` | 199 | **Password wrap** around `EncryptionKey`. `seal`/`unseal`/`unsealWithPasshash`/`sealWithPasshash`/`reseal`; GUARD round-trip check; null-on-wrong-password contract. Exports `ENCRYPTION_GUARD`, types `EncryptedProfileSecret`, `Sealed`. | Richest typing surface in the package. |
| `src/passkey-credential.ts` | 71 | **Passkey KDF primitive** — WebAuthn PRF IKM → HKDF(SHA-256) → BN254 `Fr` master secret. Type `PasskeyCredentialData`. | Uses `@aztec/foundation` `Fr`. |
| `src/constants.ts` | 10 | `PASSKEY_PRF_LABEL = "nulo:profile:v1"`. | The two HKDF labels live (privately) in `passkey-credential.ts`, NOT here — slightly split. |
| `src/zeroize.ts` | 49 | Best-effort byte wipe. Shared by both chains. | Generic over `Uint8Array \| ArrayBuffer \| undefined \| null`. |
| `src/globals.d.ts` | 22 | Ambient `Buffer` global decl (vite node-polyfill rationale). | Root cause of the Buffer↔Uint8Array duality below. |

Source total: ~490 LOC across 6 `.ts` + 1 `.d.ts`. Small, cohesive, self-contained.

## 2. Public exports (`src/index.ts`)

- `EncryptionKey` (class)
- `PasswordSecretBox` (class), `type EncryptedProfileSecret`, `type Sealed`
- `PasskeyCredential` (class), `type PasskeyCredentialData`
- `PASSKEY_PRF_LABEL` (const)
- `zeroize` (fn)

NOT exported but consumed via deep paths: `ENCRYPTION_GUARD` is exported from `password-secret-box.ts`
but NOT re-surfaced in the barrel; tests import it from the deep module. `getPasshash`/`getHashHex`
are static methods on the exported `EncryptionKey` (used widely in the extension — see §3).

## 3. Internal deps + consumers

**Imports (deps):**
- `@nulo/wallet-core/utils` → `array_equals` (`password-secret-box.ts`); `@aztec/foundation/curves/bn254` → `Fr` (`passkey-credential.ts`). Web Crypto via `self.crypto.subtle`. Ambient `Buffer`.
- Intra-package: `password-secret-box` → `encryption-key` + `zeroize`; `passkey-credential` → `zeroize`. `zeroize`/`constants` are leaves.

**Consumers (who imports `@nulo/wallet-crypto`):**
- `EncryptedProfileSecret` / `Sealed` / `PasswordSecretBox`: profile service + session-manager (`packages/extension/src/wallet/services/profile/*`).
- `PasskeyCredentialData`: ~13 sites; **re-exported** from `packages/extension/src/wallet/services/passkey/spec.ts` (good — single source of truth, no redefinition).
- `EncryptionKey.getPasshash`/`getHashHex`: `profile/service.ts` (5×), `session-manager.ts`, `useFullBackupImport.ts`, `export/full.vue`.
- `EncryptionKey` (direct): `packages/bridge-core/src/recovery-crypto.ts` (parallel sealing layer — see §8 dedup).

## 4. Libraries

- `@aztec/foundation` `5.0.0-rc.1` (exact-pinned per Aztec policy) — only `Fr` from `curves/bn254`.
- `@nulo/wallet-core` (workspace) — `array_equals` only.
- Web Crypto (`SubtleCrypto`) — runtime, no dep.
- Node `Buffer` (ambient via polyfill) — base64 + byte plumbing.
- Dev: `vitest` 4, `jsdom` 29, `typescript` 6, `@types/node` 24.

## 5. Test surfaces

- `src/encryption-key.test.ts` — 4 round-trip / wrong-key cases.
- `src/password-secret-box.test.ts` — seal/unseal/reseal/passhash + base64-format lock + `ENCRYPTION_GUARD` canary tripwire.
- `src/zeroize.test.ts` — view/buffer/null + **load-bearing `Fr` copy-semantics pins** (zeroing input must not corrupt `Fr`).
- **External contract (NOT in this package):** `packages/extension/src/wallet/crypto/key-vectors.test.ts` — byte-identical V1–V8 vector lock for the whole derivation chain. Any change here must keep it green; intentional changes need a storage-version bump + destructive migration.

## 6. EXCLUDE paths

- `node_modules/`, `dist/` (none present), any build output.
- `src/globals.d.ts` — ambient decl; not a refactor target (but the Buffer duality it enables IS, see §8).
- `*.test.ts` — covered as test surfaces (§5), not refactor targets.
- The frozen vector constants (`ENCRYPTION_GUARD`, `PASSKEY_PRF_LABEL`, the two HKDF labels, `PBKDF2_ITERATIONS`, the byte frame layout) — **values are frozen**; quality work may re-TYPE them but MUST NOT change bytes/labels/iteration counts (would brick wallets + break vectors).

## 7. Proposed Phase-2 clusters

Two stably-named units split by derivation chain, with shared leaves folded into the cluster that
owns the most surface. Names chosen to survive file renames.

1. **`wallet-crypto/password-secret-box`** — `encryption-key.ts` + `password-secret-box.ts` (+ `ENCRYPTION_GUARD`). The PBKDF2/AES-GCM password chain and its on-disk `EncryptedProfileSecret`/`Sealed` record types. Largest typing surface; owns the passhash/secret-bytes primitive-obsession hotspots and all the base64 casts.
2. **`wallet-crypto/passkey-credential`** — `passkey-credential.ts` + `constants.ts` (`PASSKEY_PRF_LABEL` + the 2 private HKDF labels). The WebAuthn-PRF → HKDF → `Fr` chain and the `PasskeyCredentialData` wire type.

Shared leaf `zeroize.ts` is cross-cutting infra touched by both clusters; review it once under
cluster 1 (it has the most call sites there) and treat cluster 2's usage as a consumer.

## 8. Typing + dedup hotspots

### Typing — primitive obsession on keys/secrets/bytes (the headline lens)

- **`passhash: ArrayBuffer` everywhere is stringly/primitive-typed.** `getPasshash` → `ArrayBuffer`; `Sealed.passhash: ArrayBuffer`; `seal`/`unsealWithPasshash`/`sealWithPasshash`/`reseal` all pass bare `ArrayBuffer`. A bare `ArrayBuffer` is indistinguishable from any other buffer (IV, salt, ciphertext, master secret) → easy to pass the wrong buffer with zero compile-time protection. **Missing branded type** `Passhash = ArrayBuffer & {__brand}` (and similarly `MasterSecret`, `Salt`). This is the single highest-value typing fix in the package; it also propagates to the extension's `session-manager.ts`/`service.ts` passhash plumbing.
- **`PasskeyCredentialData` is fully stringly-typed** (`id`, `prf`, `userHandle` all `string`; semantics — base64 vs base64-secret vs hex — live only in comments). `id` and `prf` are BOTH base64 strings, so swapping them at a call site type-checks fine. Brand them (`Base64<"credId">`, `Base64Secret<"prf">`, `Hex<"userHandle">`) or wrap in nominal types. Classic loose-boundary hotspot for a wire type carrying secret IKM.
- **`EncryptedProfileSecret.{guard,secret}` both `string` (base64).** Interchangeable at the type level; a transposed assignment silently corrupts a profile record. Same branding remedy.
- **Buffer ↔ `Uint8Array<ArrayBuffer>` ↔ `ArrayBuffer` duality drives every cast.** Three byte representations coexist (`encryption-key` uses `Uint8Array<ArrayBuffer>`; `getPasshash` returns raw `ArrayBuffer`; `passkey-credential.deriveMasterSecret` returns `Buffer<ArrayBuffer>`; secret-box plumbs `Buffer.from(...)`). Inconsistent return types across the two chains for the same conceptual thing ("32-byte master secret") is a maintainability tax — a reader can't tell which representation a secret is in without tracing.

### Typing — casts papering over the duality

Real (non-comment) casts, all symptoms of the duality above:
- `password-secret-box.ts:157` `ENCRYPTION_GUARD as Uint8Array<ArrayBuffer>` — the const is declared `Uint8Array` (not `<ArrayBuffer>`); fix at declaration, drop the cast.
- `password-secret-box.ts:169,174` `Buffer.from(..., "base64") as Uint8Array<ArrayBuffer>` ×2.
- `passkey-credential.ts:63` `masterFr.toBuffer() as Buffer<ArrayBuffer>`.
- `zeroize.ts:39,46` `buf as Uint8Array` / `buf as ArrayBufferLike` — intrinsic to the generic-narrowing impl; lower priority (well-tested, documented).
- Same cast pattern leaks into consumers (`profile/service.ts:628`). A shared, correctly-typed `fromBase64()/toBase64()` helper would erase several.

Note: **package is `any`/`unknown`-clean** (0 occurrences in source). The typing debt is entirely in *loose-but-concrete* types (bare buffers) and *casts*, not `any`. Good baseline.

### Dedup

- **Hex-encoding loop is triplicated.** `encryption-key.ts:114` (`getHashHex`), `wallet-core/src/utils/random.ts:9`, `bridge-core/src/content-hash.ts:43` all hand-roll `b.toString(16).padStart(2,"0")`. Extract one `bytesToHex` into `@nulo/wallet-core/utils` (already a dep of this package) and have all three call it. (`bridge-core/content-hash.ts:30` is a related `n.toString(16).padStart(64,"0")` BigInt variant — same family.)
- **Parallel seal/round-trip-verify abstraction in `bridge-core/src/recovery-crypto.ts`.** It builds its own `sealSecret`/`unsealSecret` on top of `EncryptionKey` plus a `reopened !== secretHex` round-trip integrity check that conceptually mirrors `PasswordSecretBox`'s `ENCRYPTION_GUARD` round-trip. Two independent "encrypt-then-verify-by-reopening" implementations that can drift. Worth flagging as a candidate to unify under one verified-seal primitive (cross-package; bridge-core sits above wallet-crypto so direction is feasible).
- **HKDF labels split from the PRF label.** `PASSKEY_PRF_LABEL` is in `constants.ts`; the two sibling labels (`nulo:kdf:v1`, `nulo:master:v1`) are module-private in `passkey-credential.ts`. All three are frozen domain separators of the same chain — co-locating them (read-only, no byte change) would make the "DO NOT CHANGE" contract legible in one place.
- **`tryDecrypt` provenance.** Comment says it "matches the original `ProfileService.tryDecrypt`" — confirm no stale twin still lives in the extension (extraction leftover). Low priority.

### Doc/consistency nits (maintainability)

- README §File map says PBKDF2 **250k** iterations; source is **600k**. One is wrong → drift that misleads the next reader of a security-critical constant.
- `password-secret-box.test.ts:133` comment references a non-existent `spec.ts` ("drive-by change to spec.ts") — the GUARD lives in `password-secret-box.ts`. Stale comment.
