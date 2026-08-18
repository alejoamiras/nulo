/**
 * NULO-ACCOUNT-KDF v2 domain separators (consensus-critical — changing either value re-derives
 * every wallet address).
 *
 * Provenance: first 4 bytes (big-endian) of sha256(label). The values are hardcoded (not
 * computed at runtime) so the module stays synchronous and the constants stay greppable; the
 * paired test recomputes them from the labels and asserts equality, plus non-collision against
 * every numeric value of upstream's `DomainSeparator` enum (the ONE separator namespace the
 * installed @aztec 5.0.1 tree exports — both its sha512 and poseidon call sites draw from it)
 * and mutual distinctness. Reference vectors: `implementations-plan/key-model-v2/reference/`.
 */

/** Poseidon2 separator for the account-seed fan-out. sha256("nulo:account-seed:v2")[0..4]. */
export const NULO_ACCOUNT_SEED_SEP = 2720999938 // 0xa22f2a02

/** sha512ToGrumpkinScalar separator for seed→signingKey. sha256("nulo:signing-root:v2")[0..4]. */
export const NULO_SIGNING_ROOT_SEP = 914717451 // 0x36857b0b

/** The labels the constants derive from — exported for the recomputation test and the kdfDigest spec. */
export const NULO_SEPARATOR_LABELS = {
	NULO_ACCOUNT_SEED_SEP: "nulo:account-seed:v2",
	NULO_SIGNING_ROOT_SEP: "nulo:signing-root:v2",
} as const
