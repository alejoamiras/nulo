/**
 * Pure classification of an Aztec claim-tx receipt into the engine's receipt-round
 * vocabulary. TxStatus (4.2.0+) is BLOCK-finalization state with NO "success" value: a
 * confirmed tx reads checkpointed → proven → finalized. Inclusion at ANY of those =
 * landed; the separate executionResult carries the revert signal. Waiting for
 * "finalized" alone stranded confirmed claims at "Confirming" for epochs.
 *
 * "proposed" is deliberately distinct from "pending": it is REAL evidence the claim was
 * accepted into a proposed block (the quiet-flip display state), but it is NOT
 * inclusion — a proposed tx can still drop, so nothing settlement-grade may key on it.
 */
export type ClaimReceiptClass = "success" | "dropped" | "reverted" | "proposed" | "pending"

/** A persisted tx hash the node can be asked about. `TxHash.fromString` throws on anything
 *  else, and a probe that swallows that throw reads as pending/unreachable forever — so the
 *  engine checks the shape BEFORE any receipt path and names the record, not the network. */
export const isWellFormedTxHash = (h: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(h)

export function classifyClaimReceipt(receipt: { status?: unknown; executionResult?: unknown } | null | undefined): ClaimReceiptClass {
	const status = String(receipt?.status ?? "pending").toLowerCase()
	const included = /checkpointed|proven|finalized|success|mined/.test(status)
	if (included) {
		const exec = String(receipt?.executionResult ?? "success").toLowerCase()
		return exec.includes("revert") ? "reverted" : "success"
	}
	if (status.includes("dropped")) return "dropped"
	if (status.includes("reverted")) return "reverted"
	if (status.includes("proposed")) return "proposed"
	return "pending"
}
