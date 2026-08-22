/**
 * Append-only record of Nulo's account-address regimes.
 *
 * A regime is the complete set of Nulo-owned address inputs: the vendored artifact (by sha256 +
 * loaded class id), the frozen instantiation descriptor (by version + digest), and the KDF spec.
 * Every account a given extension major derives belongs to that major's ONE regime — there is no
 * runtime regime selection, so stored accounts are never ambiguous.
 *
 * Rules (enforced socially by review + branch protection, mechanically by the paired test
 * `address-freeze.test.ts`, which independently hardcodes EVERY entry):
 * - Entries are append-only ONCE SHIPPED. Editing or removing a historical entry is forbidden.
 *   One-time pre-launch carve-out: the launch-baseline entry of a major that has never shipped a
 *   build, backup, or exported artifact MAY be redefined in place, in one reviewed commit that
 *   updates this record, its paired test, and this rules text together (exercised once, for the
 *   KDF v1→v2 baseline redefinition — `implementations-plan/key-model-v2/`; owner-ratified).
 * - Each extension major binds at compile time to exactly one regime constant (`V5_REGIME`).
 *   Re-binding a shipped major to a different regime is the forbidden act.
 * - Rotation = append a new entry AND ship a new extension major that binds to it (the
 *   "Nulo V6 is a new extension" policy — see CLAUDE.md "Account-address freeze").
 * - The `ack` string must embed the entry's own digests; it exists to force INTENT into any diff
 *   that touches the freeze. Review + immutable history are the anti-tamper controls, not the ack.
 */
import { FROZEN_ACCOUNT_CLASS_ID, FROZEN_ARTIFACT_SHA256 } from "./frozen-artifact"
import { FROZEN_DESCRIPTOR_DIGEST, NULO_DESCRIPTOR_VERSION } from "./instantiation-descriptor"

export type AddressRegime = {
	/** Unique, stable regime id; also the record key. */
	readonly id: string
	/** sha256 of the vendored artifact bytes this regime derives addresses from. */
	readonly artifactSha256: string
	/** Contract class id of the loaded artifact. */
	readonly classId: string
	/** Frozen instantiation-descriptor version + canonical-content digest. */
	readonly descriptorVersion: number
	readonly descriptorDigest: string
	/** The seed→keys derivation spec (see `@nulo/wallet-crypto` account-derivation). */
	readonly kdf: string
	/** sha256 (hex) of `NULO_KDF_SPEC` — the mechanical tripwire the bare `kdf` label lacked:
	 *  any change to the canonical formula description reds the paired test, so a KDF edit can
	 *  never slide through without touching the freeze record. */
	readonly kdfDigest: string
	/** Human acknowledgement binding intent to this exact entry's digests. */
	readonly ack: string
}

/**
 * The canonical, byte-frozen description of NULO-ACCOUNT-KDF v2 — the preimage of `kdfDigest`.
 * Changing ANY line changes the digest and reds `address-freeze.test.ts`. The constructions
 * themselves live in `@nulo/wallet-crypto` (mnemonic-master.ts, derive-account-seed.ts,
 * account-derivation.ts, nulo-separators.ts) and are value-pinned by the reference vectors in
 * `implementations-plan/key-model-v2/reference/`.
 */
export const NULO_KDF_SPEC =
	"nulo-account-kdf-v2\n" +
	"seed64 = PBKDF2-HMAC-SHA512(NFKD(canonical(words).join(' ')), 'mnemonic'+NFKD(passphrase), 2048, 64B)\n" +
	"master = Fr.fromBufferReduce(seed64)\n" +
	"accountSeed = poseidon2HashWithSeparator([master, l1ChainId, type, index], 2720999938)  // sha256('nulo:account-seed:v2')[0..4]\n" +
	"signingKey = sha512ToGrumpkinScalar([accountSeed, 914717451])  // sha256('nulo:signing-root:v2')[0..4]\n" +
	"secretKey = deriveSecretKeyFromSigningKey(signingKey)  // upstream @aztec/accounts 5.0.1, one-way\n"

/** sha256(NULO_KDF_SPEC) — recomputed and asserted by the paired test. */
export const NULO_KDF_DIGEST = "f6b4eee4f0d46c47090b06a6ce77786807d63e3772e5092466b9aedcf41bd1e3"

export const REGIMES = {
	"nulo-v5": {
		id: "nulo-v5",
		artifactSha256: FROZEN_ARTIFACT_SHA256,
		classId: FROZEN_ACCOUNT_CLASS_ID,
		descriptorVersion: NULO_DESCRIPTOR_VERSION,
		descriptorDigest: FROZEN_DESCRIPTOR_DIGEST,
		kdf: "nulo-account-kdf-v2",
		kdfDigest: NULO_KDF_DIGEST,
		ack:
			`I acknowledge that regime nulo-v5 (artifact sha256 ${FROZEN_ARTIFACT_SHA256}, ` +
			`class id ${FROZEN_ACCOUNT_CLASS_ID}, descriptor v${NULO_DESCRIPTOR_VERSION} ` +
			`digest ${FROZEN_DESCRIPTOR_DIGEST}, kdf nulo-account-kdf-v2 digest ${NULO_KDF_DIGEST}) ` +
			`fixes every Nulo V5 account address; changing any of these inputs rotates all derived ` +
			`addresses and ships ONLY as a new extension major with a new appended regime entry.`,
	},
} as const satisfies Record<string, AddressRegime>

/**
 * The one regime this extension major (Nulo V5) derives accounts under — a compile-time binding,
 * not a runtime pointer. Rotation appends a regime and ships a new major bound to it.
 */
export const V5_REGIME: AddressRegime = REGIMES["nulo-v5"]
