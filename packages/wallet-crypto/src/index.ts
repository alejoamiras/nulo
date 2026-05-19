/**
 * `@nulo/wallet-crypto` — security-critical derivation chains.
 *
 *   - `EncryptionKey`      — PBKDF2 + AES-GCM framed ciphertext.
 *   - `PasswordSecretBox`  — password-based wrap around `EncryptionKey`.
 *   - `PasskeyCredential`  — WebAuthn PRF → HKDF master-secret.
 *
 * Every chain is locked by test vectors at
 * `packages/extension/src/wallet/crypto/key-vectors.test.ts`. Those
 * vectors run as an extension integration test and MUST pass
 * byte-identically after any change here.
 *
 * No Chrome APIs, no Vue, no Node-specific I/O — only Web Crypto
 * (available in both browsers and jsdom), `@aztec/foundation` math
 * helpers, and pure bytes.
 */

export { EncryptionKey } from "./encryption-key"
export { ENCRYPTION_GUARD, PasswordSecretBox, type EncryptedProfileSecret, type Sealed } from "./password-secret-box"
export { PasskeyCredential, type PasskeyCredentialData } from "./passkey-credential"
export { PASSKEY_PRF_LABEL } from "./constants"
export { zeroize } from "./zeroize"
