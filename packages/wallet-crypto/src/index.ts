/**
 * `@nulo/wallet-crypto` — security-critical derivation chains.
 *
 *   - `EncryptionKey`      — PBKDF2 + AES-GCM framed ciphertext.
 *   - `PasswordSecretBox`  — password-based wrap around `EncryptionKey`.
 *   - `PasskeyCredential`  — WebAuthn PRF → HKDF master-secret.
 *
 * Every chain is locked by test vectors at
 * `apps/extension/src/wallet/crypto/key-vectors.test.ts`. Those
 * vectors run as an extension integration test and MUST pass
 * byte-identically after any change here.
 *
 * No Chrome APIs, no Vue, no Node-specific I/O — only Web Crypto
 * (available in both browsers and jsdom), `@aztec/foundation` math
 * helpers, and pure bytes.
 */

export { deriveNuloAccountKeys, deriveSigningKeyFromSeed } from "./account-derivation"
export { assertCanonicalL1ChainId, deriveAccountSeed } from "./derive-account-seed"
export { deriveBip39Seed, deriveMasterFromMnemonic } from "./mnemonic-master"
export { NULO_ACCOUNT_SEED_SEP, NULO_SEPARATOR_LABELS, NULO_SIGNING_ROOT_SEP } from "./nulo-separators"
export { derivePxeStoreKey, PXE_STORE_KDF_LABEL } from "./pxe-store-key"
export { EncryptionKey } from "./encryption-key"
export { PasswordSecretBox, PROFILE_AAD, type EncryptedProfileSecret, type Sealed } from "./password-secret-box"
export { computeEnvelopeMac, verifyEnvelopeMac, type MacEnvelope } from "./entropy-mac"
export { sealImportedSigningKey, unsealImportedSigningKey } from "./imported-account-key-box"
export { SessionSecretBox, type SessionWrappedSecret } from "./session-secret-box"
export { PasskeyCredential, type PasskeyCredentialData } from "./passkey-credential"
export { PASSKEY_PRF_LABEL } from "./constants"
export { zeroize } from "./zeroize"
export {
	type Base64Ciphertext,
	type Base64CredentialId,
	type Base64MasterSecret,
	type Base64SecretPrf,
	type HexUserHandle,
	type MasterSecretBytes,
	type Passhash,
	asBase64Ciphertext,
	asBase64CredentialId,
	asBase64MasterSecret,
	asBase64SecretPrf,
	asHexUserHandle,
	asMasterSecretBytes,
	asPasshash,
} from "./secret-types"
