/**
 * Branded secret + wire-encoding types (Q-06). Zero-runtime: each brand is a nominal
 * `unique symbol` intersection, minted at a trust boundary via an identity cast (the `as*`
 * helpers) and required at the typed sinks — stopping the class of bug where a base64 string,
 * a ciphertext, a credential id, or a raw byte-array is passed into the wrong slot and only
 * fails at decrypt/restore time.
 *
 * NOT classes (would change runtime identity → break Web Crypto / `Buffer` / `Fr.fromBuffer`
 * / `zeroize`). NOT `zod.brand()` (this package has no zod dep; branding must be zero-runtime).
 * `zeroize<T extends Uint8Array | ArrayBuffer>` stays structurally compatible with the
 * byte-array brands, so zeroization is unchanged.
 *
 * Applied incrementally per brand (each brand lands with its full mint→consume application):
 * `Passhash` first (the most-connected). Others (`MasterSecretBytes`, `Salt`, `Base64*`,
 * `HexUserHandle`) follow in their own PRs.
 */

declare const __passhash: unique symbol
declare const __masterSecretBytes: unique symbol

/** SHA-256 of the UTF-8 password (`EncryptionKey.getPasshash`) — the PBKDF2 base-key input. */
export type Passhash = ArrayBuffer & { readonly [__passhash]: true }

/** The raw 32-byte master secret (unsealed / passkey-derived / freshly generated) — the value
 *  behind `Fr.fromBuffer`. `Buffer<ArrayBuffer>` satisfies the `Uint8Array<ArrayBuffer>` base
 *  structurally, so both mint here. */
export type MasterSecretBytes = Uint8Array<ArrayBuffer> & { readonly [__masterSecretBytes]: true }

/** Mint a `Passhash` — the ONLY sanctioned way to brand a raw digest as a passhash. Grep this
 *  to audit every boundary where a passhash originates (`getPasshash`, base64-session decode,
 *  test fixtures). */
export const asPasshash = (b: ArrayBuffer): Passhash => b as Passhash

/** Mint `MasterSecretBytes` — grep to audit every boundary where the master secret originates
 *  (`PasswordSecretBox.unseal*`, `PasskeyCredential.deriveMasterSecret`, fresh `Fr.random`). */
export const asMasterSecretBytes = (b: Uint8Array<ArrayBuffer>): MasterSecretBytes => b as MasterSecretBytes
