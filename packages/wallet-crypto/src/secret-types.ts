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
 * Seven brands, each applied (mint→consume) in the PR that can carry its cascade. P14a:
 * `Passhash`, `MasterSecretBytes`, and the WebAuthn ceremony shuttle `Base64CredentialId` /
 * `Base64SecretPrf` / `HexUserHandle` — where the silent `id`↔`prf` transposition (both base64,
 * both `string` today) is the one catastrophic swap. P14b (the restore-payload split): the
 * `Base64Ciphertext` ↔ `Base64MasterSecret` PAIR — an on-disk AES-GCM ciphertext vs. a decrypted
 * base64 plain master key. They only earn their keep together, at the polymorphic `master-key` /
 * `exportPlain` / `exportEncrypted` boundary where one `string` slot legitimately carries a
 * ciphertext, a plain secret, or a credential id and only a runtime length/`!==` check guards it.
 * `Salt` from the finding's list is deliberately NOT branded: the PBKDF2 / HKDF salt is a private
 * local (`EncryptionKey.deriveKey`, `PasskeyCredential.salt`) that never crosses a function
 * boundary, so a brand would guard zero call sites.
 *
 * `PasskeyCredential.create` intentionally accepts an UNbranded `{ id; prf; userHandle? }` and
 * mints onto its branded fields: the swap is already caught upstream at the ceremony mint + the
 * branded `PasskeyCredentialData` shuttle, and this keeps the frozen `key-vectors.test.ts`
 * oracle (which calls `create` with plain-string fixtures) byte-unedited.
 */

declare const __passhash: unique symbol
declare const __masterSecretBytes: unique symbol
declare const __importedKeysDek: unique symbol
declare const __base64Ciphertext: unique symbol
declare const __base64MasterSecret: unique symbol
declare const __base64CredentialId: unique symbol
declare const __base64SecretPrf: unique symbol
declare const __hexUserHandle: unique symbol

/** SHA-256 of the UTF-8 password (`EncryptionKey.getPasshash`) — the PBKDF2 base-key input. */
export type Passhash = ArrayBuffer & { readonly [__passhash]: true }

/** The raw 32-byte master secret (unsealed / passkey-derived / freshly generated) — the value
 *  behind `Fr.fromBuffer`. `Buffer<ArrayBuffer>` satisfies the `Uint8Array<ArrayBuffer>` base
 *  structurally, so both mint here. */
export type MasterSecretBytes = Uint8Array<ArrayBuffer> & { readonly [__masterSecretBytes]: true }

/** The per-profile random 32-byte imported-keys DEK — the HKDF root for imported signing-key
 *  rows. CREDENTIAL-sealed (never master-derived: a shared recovery phrase means a shared master,
 *  so any master-rooted key is decryptable by the sibling profile by construction — the
 *  credential is the only input distinguishing two same-phrase profiles). Distinct brand from
 *  `MasterSecretBytes` so a master can never be passed where the DEK is required. */
export type ImportedKeysDek = Uint8Array<ArrayBuffer> & { readonly [__importedKeysDek]: true }

/** Base64-encoded AES-GCM ciphertext persisted on a profile record (`EncryptedProfileSecret`'s
 *  `guard` + `secret`). Distinguishes an on-disk ciphertext from any other base64 string — a
 *  credential id must never land in the ciphertext slot. */
export type Base64Ciphertext = string & { readonly [__base64Ciphertext]: true }

/** Base64-encoded 32-byte PLAIN master secret — `exportPlain`'s password-profile return + the
 *  backup `master-key` field for password profiles. The decrypted counterpart of
 *  `Base64Ciphertext`: the polymorphic `master-key` / `exportPlain` / `exportEncrypted` boundary
 *  is exactly where a ciphertext must never be confused with a plain secret. */
export type Base64MasterSecret = string & { readonly [__base64MasterSecret]: true }

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

/** Mint `ImportedKeysDek` — grep to audit every boundary where a DEK originates (fresh CSPRNG at
 *  profile creation, `unsealDekUnderWrapKey`, the backup restore carriage). */
export const asImportedKeysDek = (b: Uint8Array<ArrayBuffer>): ImportedKeysDek => b as ImportedKeysDek

/** Mint `Base64Ciphertext` — grep to audit ciphertext origins (`PasswordSecretBox.sealInternal`
 *  `toBase64`, the profile-record `guard`/`secret` lift at the unseal call sites). */
export const asBase64Ciphertext = (s: string): Base64Ciphertext => s as Base64Ciphertext

/** Mint `Base64MasterSecret` — grep to audit plain-master-secret origins (`exportPlain`'s
 *  base64 return for password profiles, the backup-import `master-key` field). */
export const asBase64MasterSecret = (s: string): Base64MasterSecret => s as Base64MasterSecret

/** Mint `Base64CredentialId` — grep to audit credential-id origins (the WebAuthn ceremony
 *  `encodeBase64(rawId)`, the backup-import `master-key` field for passkey profiles). */
export const asBase64CredentialId = (s: string): Base64CredentialId => s as Base64CredentialId

/** Mint `Base64SecretPrf` — grep to audit PRF origins (the WebAuthn ceremony
 *  `encodeBase64(prf.results.first)`). */
export const asBase64SecretPrf = (s: string): Base64SecretPrf => s as Base64SecretPrf

/** Mint `HexUserHandle` — grep to audit user-handle origins (the WebAuthn ceremony, profile
 *  creation). */
export const asHexUserHandle = (s: string): HexUserHandle => s as HexUserHandle
