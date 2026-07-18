/**
 * NULO-ACCOUNT-KDF v1 — the frozen seed→account-key derivation spec (signing-key-root model).
 *
 * Aztec 5.0.0 removed upstream `deriveSigningKey` and inverted the key relationship: the Schnorr
 * signing key is the root and the privacy secret derives FROM it. Nulo's root remains the
 * per-account seed (`poseidon2Hash([master, chainId, type, index])`), so this module defines the
 * ONE deterministic seed→signingKey step, using upstream's removed construction verbatim:
 *
 *     signingKey = sha512ToGrumpkinScalar([seed, DomainSeparator.IVSK_M])   // IVSK_M = 2747825907
 *     secretKey  = await deriveSecretKeyFromSigningKey(signingKey)          // upstream, one-way
 *
 * INVARIANTS (consensus-critical — changing ANY of these re-derives every wallet address):
 *  - The construction, input serialization, and domain separator are pinned by the committed
 *    reference vectors in `implementations-plan/aztec-5.0.0-stable/reference/` (regime A = the
 *    rc.2 upstream implementation; regime B = the published 5.0.0 packages) and by the key-vector
 *    tests. Those fixtures are REFERENCE-generated: never regenerate them from this module.
 *  - Only upstream primitives are composed here — no hand-rolled crypto, no improvised domain
 *    tags (a 256-bit-reduce fallback was explicitly rejected for modulo bias; see plan D7).
 *  - The signing key never leaves the extension's derivation path: the PXE seam carries only
 *    `secretKey` (privacy root), from which the signing key is NOT recoverable.
 */
import { DomainSeparator } from "@aztec/constants"
import { deriveSecretKeyFromSigningKey } from "@aztec/accounts/utils"
import { sha512ToGrumpkinScalar } from "@aztec/foundation/crypto/sha512"
import type { Fr } from "@aztec/foundation/curves/bn254"
import type { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin"

/** The account's Schnorr signing key (the ownership root), derived from the Nulo account seed. */
export function deriveSigningKeyFromSeed(seed: Fr): GrumpkinScalar {
	return sha512ToGrumpkinScalar([seed, DomainSeparator.IVSK_M])
}

/** The full v1 chain: seed → signing key (root) → privacy secret key. */
export async function deriveNuloAccountKeys(seed: Fr): Promise<{ signingKey: GrumpkinScalar; secretKey: Fr }> {
	const signingKey = deriveSigningKeyFromSeed(seed)
	const secretKey = await deriveSecretKeyFromSigningKey(signingKey)
	return { signingKey, secretKey }
}
