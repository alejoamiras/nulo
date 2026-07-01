# Q-06 — branded secret-byte types + split the dual-role restore payload · tier: **deep** (crypto/secret)

**Re-verify (STEP 1, vs `dev-quality`):** VALID. Secret material (passhash, salt, master secret, ciphertext, guard, credential id, PRF output, user handle) is raw `ArrayBuffer`/`Uint8Array`/`Buffer`/`string`; `restore(profile, masterKey: string, …)` overloads `masterKey` (base64 master key for password, credentialId for passkey — `profile/spec.ts:250-262`).

## Decision ledger ([codex leg](./plan-leg-codex.md) `blzvp7zzw` + main verification; opus Plan leg glitched-discarded)

- **HARD-LIMIT / frozen oracle (codex corrected the path):** the frozen KDF/crypto oracle is **`apps/extension/src/wallet/crypto/key-vectors.test.ts`** (NOT `packages/wallet-crypto/...`). It pins `getPasshash`, PBKDF2 `600_000`, AES-GCM layout, passkey HKDF, signing-key derivation. **Never edit KDF/iterations/AES-GCM framing/HKDF labels/vectors.** Q-06 must keep it green + byte-UNEDITED.

- **PERSISTED-SHAPE question RESOLVED (main-verified — the key de-risk):** the persisted `Session` (`chrome.storage.session`, written at `session-manager.ts:202-218`) carries only `{profile, passhash?, since, lockedAt?}` — **NOT `masterKey`**. `masterKey` is a TRANSIENT `restore()` parameter from the backup-import boundary. So splitting it is an **INTERNAL/RPC-API change** — the persisted backup schema **v2 `"master-key"` field + the session shape STAY UNCHANGED** (construct the discriminated type at the import boundary from the existing fields). **⇒ NOT a wipe-vs-tolerate hard limit; Q-06 is fully autonomous.** (Default stance: no backup schema v3, no persisted-session split. IF a persisted change is ever needed → THAT would be the hard-limit surface.)

- **Two PRs, very different risk:**

### PR A (P14a) — branded types, TYPE-ONLY (zero runtime)
New `packages/wallet-crypto/src/secret-types.ts` (exported from `index.ts`). **Nominal `unique symbol` brands** — NOT classes (change runtime identity → break Web Crypto/`Buffer`/`Fr.fromBuffer`/`zeroize`), NOT `zod.brand()` (package has no zod dep + must be zero-runtime). 8 brands (the 7 from the finding + `Base64MasterSecret` — the password backup base64 plain master secret, which is NONE of the other 7; codex's adversarial catch — do NOT mislabel it `Base64Ciphertext`):
`Passhash` (ArrayBuffer), `MasterSecretBytes` (Uint8Array), `Salt` (ArrayBuffer), `Base64Ciphertext` (string), `Base64CredentialId` (string), `Base64SecretPrf` (string), `HexUserHandle` (string), `Base64MasterSecret` (string, restore-specific). Each minted at its existing trust boundary via an identity cast, consumed at the typed sinks (see the codex leg's mint/consume table). **Zeroization unchanged** — `zeroize<T extends Uint8Array|ArrayBuffer|…>` stays structurally compatible with branded bytes; branded strings remain non-zeroizable (keep existing escape comments). `Base64MasterSecret` (type-only, in-scope) resolves codex's Ask — no owner needed.

### PR B (P14b) — split the dual-role restore payload (RUNTIME internal-API change)
```ts
type RestoreSecret =
  | { type: "password"; masterKey: Base64MasterSecret }
  | { type: "passkey";  credentialId: Base64CredentialId }
```
`Methods.restore(profile, masterKey, password?, credentialData?)` → `restore(profile, secret: RestoreSecret, password?, credentialData?)`. `ProfileService.restore` FIRST asserts `secret.type === profile.type`, then branches (password: decode `secret.masterKey`, keep the 32-byte length check, seal, no session open; passkey: `secret.credentialId` for ceremony + the `recovery.credentialId !== secret.credentialId` P0 guard). **Every write/read site** (asymmetric-refactor = broken restore-after-SW-restart): `spec.ts:240-262` (contract docs), `client.ts:104-110` (send the object), `service.ts:840-994` (switch on `secret.type`), `useFullBackupImport.ts:201-287` (read v2 `"master-key"` → construct `{type,…}` at the boundary), `full.vue` (NO persisted change — still writes `"master-key"`), + the tests. **Session shape untouched.**

## Security / adversarial + behavior-preservation
A wrong encoding or byte-role swap = decrypt/restore failure or a secret in the wrong slot. Branding must not weaken zeroization; the KDF is never touched. **Proof (PR B) — 2 deterministic restore round-trip integration tests** in `service.integration.test.ts` (reuse `FakeBrowserApi`/`makeServiceFromExistingApi`/`FakePasskeyService`), the `sw-resilience` e2e being `.skip`'d:
1. `restore/finalize password profile survives simulated SW restart via chrome.storage.session` — restore + finalize, assert active + session passhash, construct a FRESH `ProfileService` over the same `FakeBrowserApi`, assert `getActiveProfile()` returns the restored id.
2. `restore/finalize passkey profile round-trips across SW restart WITHOUT silent activation` — per `session-manager.ts:351-355`, a fresh service does NOT auto-activate a passkey profile (WebAuthn needs a gesture); the persisted session record remains; then `unlockPasskeyProfile(...)` opens it.

## Phasing + gate
- **P14a** branded types (type-only): gate = typecheck:all + wallet-crypto units + **`key-vectors.test.ts` green & git-diff-UNEDITED** + smoke + full network.
- **P14b** restore split (runtime): gate = the 2 round-trip integration tests + profile units + `key-vectors.test.ts` UNEDITED + smoke + full network. Per-arc tail: `/code-review max --fix` → codex post-impl.

## Assumptions
- **Facts (main-verified):** persisted `Session` = `{profile,passhash?,since,lockedAt?}` (no masterKey); cold restore only rehydrates PASSWORD profiles, passkey short-circuits (`session-manager.ts:351-355`); backup v2 writes `"master-key"` (`full.vue`), import reads it (`useFullBackupImport.ts`); frozen oracle at `apps/extension/src/wallet/crypto/key-vectors.test.ts`.
- **Inferences:** branding is type-only if all brands mint at existing boundaries via identity casts; the restore split needs no backup-v2 / session change.
- **Asks (resolved autonomously):** `Base64MasterSecret` added (type-only, in-scope); NO backup schema v3; NO persisted-session split. All non-hard-limit. (Left surfaced ONLY as an FYI: cold passkey restore never auto-activates — that's existing product behavior, not Q-06's to change.)

## Implementation record — P14a (branch `qa/Q-06a-branded-types`, PR #209)

Landed as three behavior-preserving commits (all `typecheck:all=0`, frozen oracle byte-UNEDITED throughout, wallet-crypto 23/23 + extension crypto/profile/passkey/composables 163/163, biome clean bar 2 pre-existing warnings):
- `e330e29` — `Passhash` end-to-end.
- `e0a87ca` — `MasterSecretBytes` across unseal / derive / import boundaries.
- `70f3c2a` — the WebAuthn ceremony trio `Base64CredentialId` / `Base64SecretPrf` / `HexUserHandle`.

### Scope decisions (mapper-backed; the Explore mint→consume map confirmed each)
- **`Salt` NOT branded (dropped from the 8).** Both salts (`EncryptionKey.deriveKey` local, `PasskeyCredential.salt` private field) never cross a function boundary → a brand guards **zero** call sites. The finding's own cited "salt" instances (`encryption-key.ts:11,87,97,114`) are actually `getPasshash`/`fromPasshash`/`getHashHex` sites, not a salt slot.
- **`Base64Ciphertext` DEFINED in P14a, APPLIED in P14b.** `EncryptedProfileSecret.{guard,secret}` only move as named object fields and share one brand, so a guard↔secret swap is already caught by the `ENCRYPTION_GUARD` round-trip, not by branding. Its real value — separating an on-disk ciphertext from a **plain** base64 secret at the polymorphic `master-key`/`exportPlain`/`exportEncrypted` boundary — only materializes once `Base64MasterSecret` exists (P14b). Applying it alone costs ~14 `service.ts` lift-site mints for near-zero catch today, so it lands with P14b.
- **`PasskeyCredential.create` takes an UNbranded `{ id; prf; userHandle? }`** and mints onto its branded fields. Rationale: the catastrophic `id`↔`prf` swap is already rejected at the ceremony mint + the branded `PasskeyCredentialData` shuttle (every production path); `create` is the terminal sink. Making its param unbranded is the design that keeps the frozen `key-vectors.test.ts` oracle — which calls `create({id, prf})` with plain-string fixtures — **byte-UNEDITED** (the hard limit). Flagged for the post-impl codex audit to challenge whether this materially weakens the terminal sink (it does not, for any non-test path).

### Still open on P14a
- Per-arc tail: `/code-review max --fix` + codex post-impl audit (in flight).
- Full gate: dispatch `pr-quick` + `pr-smoke-e2e` + `pr-network-e2e` on the branch HEAD (`70f3c2a`), then plain squash-merge #209. Base64Ciphertext + Base64MasterSecret + the restore split move entirely to P14b.
