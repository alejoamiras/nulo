/**
 * Per-account export envelope (NULO-ACCOUNT-EXPORT v1) — the "export/import one account" format.
 *
 * What an account IS on Aztec is its Schnorr signing key (the ownership root) plus the frozen
 * contract shape; everything else (the privacy secret, the address) derives from those. So the
 * export carries ONLY the signing key as secret material, tagged with the frozen digests that
 * pin the contract shape it belongs to, and the address for a human cross-check. The privacy
 * `secretKey` is deliberately NOT exported (it's derivable, and shipping it invites confusing a
 * privacy root for the ownership key).
 *
 * Two variants share one payload:
 *  - plaintext: the JSON below, gated behind a password confirm + explicit warnings in the UI.
 *  - encrypted: that JSON AES-GCM-sealed under the user's password (the default), AAD-bound to
 *    the export purpose. Wrong password and a corrupted file share one honest failure.
 *
 * SECURITY POSTURE: the plaintext checksum is CORRUPTION DETECTION, not authentication — an
 * attacker holding the file can substitute a signingKey and recompute address + checksum into a
 * fully self-consistent hostile file. The import UI therefore shows the recomputed address and
 * requires explicit confirmation; "tampered export fails closed" holds for the ENCRYPTED variant
 * (AES-GCM authenticates under the password) and for non-self-consistent plaintext mutations.
 */
import { fromBase64, toBase64 } from "@nulo/wallet-core/utils"
import { EncryptionKey } from "@nulo/wallet-crypto"
import { Fq } from "@aztec/foundation/curves/bn254"
import { sha256 } from "@aztec/foundation/crypto/sha256"
import { NULO_KDF_DIGEST, V5_REGIME } from "./address-freeze"
import { FROZEN_ACCOUNT_CLASS_ID, FROZEN_ARTIFACT_SHA256 } from "./frozen-artifact"
import { FROZEN_DESCRIPTOR_DIGEST } from "./instantiation-descriptor"

export const ACCOUNT_EXPORT_FORMAT = "nulo-account-export"
export const ACCOUNT_EXPORT_VERSION = 1

/** AES-GCM AAD for the encrypted variant — a fixed purpose tag (no per-file identity is needed;
 *  the payload is self-describing and the password authenticates it). */
const ACCOUNT_EXPORT_AAD = new TextEncoder().encode("nulo:account-export:v1") as Uint8Array<ArrayBuffer>

/** The frozen digests THIS build derives accounts under — an imported file must match all four,
 *  or it belongs to a different contract shape / KDF and is rejected before any address work. */
export const EXPORT_REGIME_DIGESTS = {
	regime: V5_REGIME.id,
	artifactSha256: FROZEN_ARTIFACT_SHA256,
	classId: FROZEN_ACCOUNT_CLASS_ID,
	descriptorDigest: FROZEN_DESCRIPTOR_DIGEST,
	kdfDigest: NULO_KDF_DIGEST,
} as const

export interface AccountExportV1 {
	format: typeof ACCOUNT_EXPORT_FORMAT
	version: typeof ACCOUNT_EXPORT_VERSION
	regime: string
	artifactSha256: string
	classId: string
	descriptorDigest: string
	kdfDigest: string
	l1ChainId: number
	address: string
	/** The Schnorr signing key (GrumpkinScalar/Fq), 0x + 64 hex. */
	signingKey: string
	/** sha256 (hex) over the canonical serialization of every field above. */
	checksum: string
}

/** The field order the checksum canonicalizes over (checksum itself excluded). FROZEN. */
const CANONICAL_FIELDS = [
	"format",
	"version",
	"regime",
	"artifactSha256",
	"classId",
	"descriptorDigest",
	"kdfDigest",
	"l1ChainId",
	"address",
	"signingKey",
] as const

function canonicalChecksum(body: Omit<AccountExportV1, "checksum">): string {
	// A pinned, order-fixed JSON array of [key, value] pairs — independent of JS object key order.
	const canonical = JSON.stringify(CANONICAL_FIELDS.map((k) => [k, (body as Record<string, unknown>)[k]]))
	return Buffer.from(sha256(Buffer.from(canonical, "utf8"))).toString("hex")
}

/** Assemble a plaintext export for a signing key (Fq) + the account's L1 id + its address. */
export function buildAccountExport(signingKey: Fq, l1ChainId: number, address: string): AccountExportV1 {
	const body: Omit<AccountExportV1, "checksum"> = {
		format: ACCOUNT_EXPORT_FORMAT,
		version: ACCOUNT_EXPORT_VERSION,
		...EXPORT_REGIME_DIGESTS,
		l1ChainId,
		address,
		signingKey: signingKey.toString(),
	}
	return { ...body, checksum: canonicalChecksum(body) }
}

/** Serialize a plaintext export to the JSON string the user downloads. */
export function serializeAccountExport(exp: AccountExportV1): string {
	return JSON.stringify(exp, null, "\t")
}

/**
 * Parse + STRUCTURALLY validate a plaintext export (hostile input): shape, this-build regime
 * digests, canonical signing key (Fq rejects ≥ modulus), and checksum. Returns the validated
 * signing key + l1ChainId + the file's CLAIMED address (the caller must recompute the address
 * from the signing key and compare — the checksum does not authenticate the address).
 */
/** The envelope gates: format, version, this-build regime digests. Flat on purpose —
 *  each check is one hostile-input rejection with its own message. */
function assertExportEnvelope(v: Record<string, unknown>): void {
	if (v.format !== ACCOUNT_EXPORT_FORMAT) throw new Error("Not a Nulo account export")
	if (v.version !== ACCOUNT_EXPORT_VERSION) throw new Error(`Unsupported account-export version: ${String(v.version)}`)
	for (const [k, expected] of Object.entries(EXPORT_REGIME_DIGESTS)) {
		if (v[k] !== expected) throw new Error(`Account export is for a different Nulo regime (${k} mismatch)`)
	}
}

export function parseAccountExport(json: string): { signingKey: Fq; l1ChainId: number; claimedAddress: string } {
	let raw: unknown
	try {
		raw = JSON.parse(json)
	} catch {
		throw new Error("Account export is not valid JSON")
	}
	if (!raw || typeof raw !== "object") throw new Error("Account export is not an object")
	const v = raw as Record<string, unknown>
	assertExportEnvelope(v)
	if (typeof v.l1ChainId !== "number" || !Number.isSafeInteger(v.l1ChainId) || v.l1ChainId < 0 || v.l1ChainId > 0xffffffff) {
		throw new Error("Account export has a non-canonical l1ChainId")
	}
	if (typeof v.address !== "string" || v.address.length === 0) throw new Error("Account export is missing its address")
	if (typeof v.signingKey !== "string") throw new Error("Account export is missing its signing key")
	if (typeof v.checksum !== "string") throw new Error("Account export is missing its checksum")
	// Canonical Fq — `Fq.fromString` throws on a value ≥ the field modulus (never reduce a key).
	let signingKey: Fq
	try {
		signingKey = Fq.fromString(v.signingKey)
	} catch {
		throw new Error("Account export signing key is not a canonical field element")
	}
	const body = Object.fromEntries(CANONICAL_FIELDS.map((k) => [k, v[k]])) as unknown as Omit<AccountExportV1, "checksum">
	if (canonicalChecksum(body) !== v.checksum) throw new Error("Account export checksum mismatch (corrupted file)")
	return { signingKey, l1ChainId: v.l1ChainId, claimedAddress: v.address }
}

/** Encrypt a plaintext export under `password` (the default download variant). */
export async function encryptAccountExport(exp: AccountExportV1, password: string): Promise<string> {
	const key = await EncryptionKey.fromPassword(password)
	const payload = new TextEncoder().encode(serializeAccountExport(exp)) as Uint8Array<ArrayBuffer>
	const ct = await key.encrypt(payload, ACCOUNT_EXPORT_AAD)
	return toBase64(new Uint8Array(ct.buffer))
}

/** Decrypt an encrypted export; wrong password / corruption / AAD mismatch all throw. */
export async function decryptAccountExport(base64: string, password: string): Promise<string> {
	const key = await EncryptionKey.fromPassword(password)
	const pt = await key.decrypt(fromBase64(base64) as Uint8Array<ArrayBuffer>, ACCOUNT_EXPORT_AAD)
	return new TextDecoder().decode(pt)
}
