/**
 * One-way, plaintext wallet fingerprint — the duplicate-recovery-phrase detector.
 *
 * `hex(sha256(UTF8("nulo:wallet-fingerprint:v1") || master))`, stored UNencrypted on every profile
 * row so a candidate master (derived during import/restore, pre-persist) can be compared against
 * profiles whose own masters are sealed. Fingerprints the MASTER, not the entropy — well-defined
 * for passkey profiles too, one code path.
 *
 * Honest properties (documented, owner-accepted): one-way (sha256 preimage over a ~253.6-bit
 * secret); NEGLIGIBLE-marginal — not zero — same-device linkability (same-phrase profiles with
 * populated same-network account rows already expose identical plaintext addresses, but
 * zero-account or disjoint-network profiles do not). Never a secret; never reduces any secret's
 * entropy.
 *
 * It IS an offline confirmation oracle over CANDIDATE phrases, and that is inherent, not an
 * oversight: the duplicate check runs pre-unlock against profiles whose credentials are unavailable,
 * so the comparand must be computable from the candidate master alone. The sharp case is a partial
 * phrase — someone holding 23 of the 24 words faces exactly 8 checksum-valid completions (the last
 * word carries 3 entropy bits + the 8 checksum bits), and this value picks the right one instantly
 * and offline. Cost-hardening the hash would not help: it is the 8-candidate search space, not the
 * per-guess cost, that makes that case cheap. The security argument is therefore that a
 * near-complete phrase is already a catastrophic compromise (the same 8 candidates are testable
 * against public chain state), and that against an UNKNOWN phrase the preimage space is the full
 * master entropy.
 */
import type { MasterSecretBytes } from "./secret-types"
import { zeroize } from "./zeroize"

const FINGERPRINT_LABEL = new TextEncoder().encode("nulo:wallet-fingerprint:v1")

export async function computeWalletFingerprint(master: MasterSecretBytes): Promise<string> {
	const preimage = new Uint8Array(FINGERPRINT_LABEL.length + master.length) as Uint8Array<ArrayBuffer>
	preimage.set(FINGERPRINT_LABEL, 0)
	preimage.set(master, FINGERPRINT_LABEL.length)
	try {
		const digest = await globalThis.crypto.subtle.digest("SHA-256", preimage)
		return Buffer.from(digest).toString("hex")
	} finally {
		// The preimage copy embeds the master.
		zeroize(preimage)
	}
}
