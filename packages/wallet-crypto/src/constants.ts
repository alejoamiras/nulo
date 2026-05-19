/**
 * `eval` argument passed to the WebAuthn PRF extension. Domain-separates
 * this wallet from any other site using the same passkey. Locked by the
 * V8 derivation vector. **DO NOT CHANGE** — changing this bricks every
 * existing passkey wallet.
 *
 * The two internal labels used inside `passkey-credential.ts`
 * (`"nulo:kdf:v1"`, `"nulo:master:v1"`) stay module-private there.
 */
export const PASSKEY_PRF_LABEL = "nulo:profile:v1"
