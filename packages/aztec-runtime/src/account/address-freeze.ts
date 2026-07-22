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
 * - Entries are append-only. Editing or removing a historical entry is forbidden.
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
	/** Human acknowledgement binding intent to this exact entry's digests. */
	readonly ack: string
}

export const REGIMES = {
	"nulo-v5": {
		id: "nulo-v5",
		artifactSha256: FROZEN_ARTIFACT_SHA256,
		classId: FROZEN_ACCOUNT_CLASS_ID,
		descriptorVersion: NULO_DESCRIPTOR_VERSION,
		descriptorDigest: FROZEN_DESCRIPTOR_DIGEST,
		kdf: "nulo-account-kdf-v1",
		ack:
			`I acknowledge that regime nulo-v5 (artifact sha256 ${FROZEN_ARTIFACT_SHA256}, ` +
			`class id ${FROZEN_ACCOUNT_CLASS_ID}, descriptor v${NULO_DESCRIPTOR_VERSION} ` +
			`digest ${FROZEN_DESCRIPTOR_DIGEST}) fixes every Nulo V5 account address; changing any ` +
			`of these inputs rotates all derived addresses and ships ONLY as a new extension major ` +
			`with a new appended regime entry.`,
	},
} as const satisfies Record<string, AddressRegime>

/**
 * The one regime this extension major (Nulo V5) derives accounts under — a compile-time binding,
 * not a runtime pointer. Rotation appends a regime and ships a new major bound to it.
 */
export const V5_REGIME: AddressRegime = REGIMES["nulo-v5"]
