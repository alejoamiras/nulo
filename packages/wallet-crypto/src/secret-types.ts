/**
 * Branded secret + wire-encoding types (Q-06). Each brand is a nominal `unique symbol`
 * intersection — the TYPES erase at emit (no bytes). The `as*` mint helpers are runtime
 * IDENTITY functions (`(b) => b as X`): one trivial, trivially-inlinable call per mint that
 * returns the same reference — NO allocation, NO byte change, NO control-flow or zeroization
 * delta, so behavior stays byte-identical. (They're functions, not erased casts, on purpose:
 * a single named mint per value is grep-auditable — the one sanctioned boundary where a raw
 * value acquires the brand.) Consumed at the typed sinks — stopping the class of bug where a
 * base64 string, a ciphertext, a credential id, or a raw byte-array is passed into the wrong
 * slot and only fails at decrypt/restore time.
 *
 * NOT classes (would change runtime identity → break Web Crypto / `Buffer` / `Fr.fromBuffer`
 * / `zeroize`). NOT `zod.brand()` (this package has no zod dep; branding must be zero-runtime).
 * `zeroize<T extends Uint8Array | ArrayBuffer>` stays structurally compatible with the
 * byte-array brands, so zeroization is unchanged. A brand widens to its base for free
 * (`Base64CredentialId` → `string` needs no cast), so branding a producer does NOT force every
 * downstream base-typed param to become branded — only the origin mints.
 *
 * ## Scope (Q-06)
 * Six brands are defined here; each is applied (mint→consume) in the PR that can carry its
 * cascade. Already applied: `Passhash`, `MasterSecretBytes`. Applied alongside this definition:
 * `Base64CredentialId`, `Base64SecretPrf`, `HexUserHandle` — the WebAuthn ceremony shuttle,
 * where the silent `id`↔`prf` transposition (both base64, both `string` today) is the one
 * catastrophic swap. `Base64Ciphertext` is DEFINED but applied with the restore-payload split,
 * where it pairs with `Base64MasterSecret` (the base64 plain master key) to separate an on-disk
 * ciphertext from a plain secret — the distinction that gives it value; applying it alone earns
 * little for a wide `service.ts` cascade. `Salt` from the finding's list is deliberately NOT
 * branded: the PBKDF2 / HKDF salt is a private local (`EncryptionKey.deriveKey`,
 * `PasskeyCredential.salt`) that never crosses a function boundary, so a brand would guard zero
 * call sites.
 *
 * `PasskeyCredential.create` intentionally accepts an UNbranded `{ id; prf; userHandle? }` and
 * mints onto its branded fields: the swap is already caught upstream at the ceremony mint + the
 * branded `PasskeyCredentialData` shuttle, and this keeps the frozen `key-vectors.test.ts`
 * oracle (which calls `create` with plain-string fixtures) byte-unedited.
 */

declare const __passhash: unique symbol
declare const __masterSecretBytes: unique symbol
declare const __base64Ciphertext: unique symbol
declare const __base64CredentialId: unique symbol
declare const __base64SecretPrf: unique symbol
declare const __hexUserHandle: unique symbol

/** SHA-256 of the UTF-8 password (`EncryptionKey.getPasshash`) — the PBKDF2 base-key input. */
export type Passhash = ArrayBuffer & { readonly [__passhash]: true }

/** The raw 32-byte master secret (unsealed / passkey-derived / freshly generated) — the value
 *  behind `Fr.fromBuffer`. `Buffer<ArrayBuffer>` satisfies the `Uint8Array<ArrayBuffer>` base
 *  structurally, so both mint here. */
export type MasterSecretBytes = Uint8Array<ArrayBuffer> & { readonly [__masterSecretBytes]: true }

/** Base64-encoded AES-GCM ciphertext persisted on a profile record (`EncryptedProfileSecret`'s
 *  `guard` + `secret`). Distinguishes an on-disk ciphertext from any other base64 string — a
 *  credential id must never land in the ciphertext slot. */
export type Base64Ciphertext = string & { readonly [__base64Ciphertext]: true }

/** Base64-encoded WebAuthn credential id (`PublicKeyCredential.rawId`). Adjacent to the PRF and
 *  user-handle strings on the ceremony shuttle + the recovery record + the restore payload,
 *  where a swap type-checks today. */
export type Base64CredentialId = string & { readonly [__base64CredentialId]: true }

/** Base64-encoded WebAuthn PRF output — the secret IKM fed to HKDF. Distinct from the credential
 *  id it travels beside on `PasskeyCredentialData`. */
export type Base64SecretPrf = string & { readonly [__base64SecretPrf]: true }

/** Hex-encoded WebAuthn user handle tying a credential to a profile. Distinct from the base64
 *  credential id it travels beside. */
export type HexUserHandle = string & { readonly [__hexUserHandle]: true }

/** Mint a `Passhash` — the ONLY sanctioned way to brand a raw digest as a passhash. Grep this
 *  to audit every boundary where a passhash originates (`getPasshash`, base64-session decode,
 *  test fixtures). */
export const asPasshash = (b: ArrayBuffer): Passhash => b as Passhash

/** Mint `MasterSecretBytes` — grep to audit every boundary where the master secret originates
 *  (`PasswordSecretBox.unseal*`, `PasskeyCredential.deriveMasterSecret`, fresh `Fr.random`). */
export const asMasterSecretBytes = (b: Uint8Array<ArrayBuffer>): MasterSecretBytes => b as MasterSecretBytes

/** Mint `Base64Ciphertext` — grep to audit ciphertext origins (`PasswordSecretBox.sealInternal`
 *  `toBase64`, the profile-record `guard`/`secret` lift at the unseal call sites). */
export const asBase64Ciphertext = (s: string): Base64Ciphertext => s as Base64Ciphertext

/** Mint `Base64CredentialId` — grep to audit credential-id origins (the WebAuthn ceremony
 *  `encodeBase64(rawId)`, the backup-import `master-key` field for passkey profiles). */
export const asBase64CredentialId = (s: string): Base64CredentialId => s as Base64CredentialId

/** Mint `Base64SecretPrf` — grep to audit PRF origins (the WebAuthn ceremony
 *  `encodeBase64(prf.results.first)`). */
export const asBase64SecretPrf = (s: string): Base64SecretPrf => s as Base64SecretPrf

/** Mint `HexUserHandle` — grep to audit user-handle origins (the WebAuthn ceremony, profile
 *  creation). */
export const asHexUserHandle = (s: string): HexUserHandle => s as HexUserHandle
