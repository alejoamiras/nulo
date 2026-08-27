/**
 * NULO-ACCOUNT-KDF v2 — the frozen seed→account-key derivation spec (signing-key-root model).
 *
 * Aztec 5.0.0 removed upstream `deriveSigningKey` and inverted the key relationship: the Schnorr
 * signing key is the root and the privacy secret derives FROM it. Nulo's root remains the
 * per-account seed (`deriveAccountSeed` — poseidon2 over master/l1ChainId/type/index under
 * NULO_ACCOUNT_SEED_SEP), so this module defines the ONE deterministic seed→signingKey step,
 * upstream's removed construction under a dedicated Nulo domain separator:
 *
 *     signingKey = sha512ToGrumpkinScalar([seed, NULO_SIGNING_ROOT_SEP])   // 914717451
 *     secretKey  = await deriveSecretKeyFromSigningKey(signingKey)         // upstream, one-way
 *
 * INVARIANTS (consensus-critical — changing ANY of these re-derives every wallet address):
 *  - The construction, input serialization, and domain separator are pinned by the committed
 *    reference vectors in `implementations-plan/key-model-v2/reference/` (published-5.0.1-tarball
 *    provenance, separator labels documented in `nulo-separators.ts`) and by the key-vector
 *    tests. Those fixtures are REFERENCE-generated: never regenerate them from this module.
 *  - Only upstream primitives are composed here — no hand-rolled crypto (a 256-bit-reduce
 *    fallback was explicitly rejected for modulo bias); the ONLY Nulo-original input is the
 *    domain separator, whose provenance is sha256-of-label (see `nulo-separators.ts`).
 *  - The signing key never leaves the extension's derivation path: the PXE seam carries only
 *    `secretKey` (privacy root), from which the signing key is NOT recoverable.
 */
import { deriveSecretKeyFromSigningKey } from "@aztec/accounts/utils"
import { sha512ToGrumpkinScalar } from "@aztec/foundation/crypto/sha512"
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin"
import { NULO_SIGNING_ROOT_SEP } from "./nulo-separators"

/** The account's Schnorr signing key (the ownership root), derived from the Nulo account seed. */
export function deriveSigningKeyFromSeed(seed: Fr): GrumpkinScalar {
	return sha512ToGrumpkinScalar([seed, NULO_SIGNING_ROOT_SEP])
}

/** The full v2 chain: seed → signing key (root) → privacy secret key. */
export async function deriveNuloAccountKeys(seed: Fr): Promise<{ signingKey: GrumpkinScalar; secretKey: Fr }> {
	const signingKey = deriveSigningKeyFromSeed(seed)
	const secretKey = await deriveSecretKeyFromSigningKey(signingKey)
	return { signingKey, secretKey }
}
