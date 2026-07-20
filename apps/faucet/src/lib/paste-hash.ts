import type { DepositJournalRecord } from "@nulo/bridge-core"

/**
 * Validate a user-pasted L1 deposit tx hash against chain truth before a record trusts it
 * (journal-ux plan L16). The unknown-outcome cell (a deposit prompt was issued, no hash recorded)
 * is never auto-resumed — the tx may have broadcast. Instead the user pastes the tx id from their
 * wallet, and THIS check confirms it is genuinely THIS record's deposit before the engine recovers
 * from it: right shape, mined success, sent to the record's portal, and (best-effort) carrying a
 * log whose 32-byte content-hash topic equals the record's secretHash (the deposit binds it).
 *
 * A wrong or unrelated hash simply fails — it can never redirect the record's funds, because the
 * on-chain content hash is recipient-and-amount-bound; the worst a bad paste does is not match.
 */

export interface MinimalReceipt {
	status: "success" | "reverted" | (string & {})
	to?: string | null
	logs: { topics?: readonly string[]; data?: string }[]
}

export type PasteHashVerdict = { ok: true } | { ok: false; reason: string }

const HEX64 = /^0x[0-9a-fA-F]{64}$/

export async function validatePastedDepositHash(
	rec: DepositJournalRecord,
	rawHash: string,
	getReceipt: (hash: `0x${string}`) => Promise<MinimalReceipt | null>,
): Promise<PasteHashVerdict> {
	const hash = rawHash.trim()
	if (!HEX64.test(hash)) return { ok: false, reason: "That is not a valid Ethereum transaction id (0x + 64 hex characters)." }

	let receipt: MinimalReceipt | null
	try {
		receipt = await getReceipt(hash as `0x${string}`)
	} catch {
		return { ok: false, reason: "Could not read that transaction — check your connection and try again." }
	}
	if (!receipt) return { ok: false, reason: "That transaction isn't on Ethereum yet — wait for it to confirm, then try again." }
	if (receipt.status !== "success") return { ok: false, reason: "That transaction reverted on Ethereum — it did not deposit anything." }
	if (!receipt.to || receipt.to.toLowerCase() !== rec.portal.toLowerCase()) {
		return { ok: false, reason: "That transaction was not sent to this bridge's deposit contract." }
	}
	// Content-hash corroboration: the deposit event carries the record's secretHash (= its id) as a
	// topic. Best-effort — absence isn't fatal (ABIs vary), but a present mismatch across ALL logs
	// with none matching is a strong "wrong tx" signal we surface.
	const idTopic = rec.id.toLowerCase()
	const anyTopic = receipt.logs.some((l) => (l.topics ?? []).some((t) => t.toLowerCase() === idTopic))
	if (receipt.logs.length > 0 && !anyTopic) {
		return { ok: false, reason: "That transaction doesn't match this bridge (its secret hash isn't in the logs)." }
	}
	return { ok: true }
}
