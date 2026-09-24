import { GasFees, ManaUsageEstimate } from "@aztec/stdlib/gas"

/** Minimal node shape for fee prediction (avoids a hard dep on the full node client type). */
export type MinFeeNode = {
	getPredictedMinFees?: (manaUsage?: ManaUsageEstimate) => Promise<GasFees[]>
	getCurrentMinFees: () => Promise<GasFees>
}

/**
 * The protocol's worst-case min fee across predicted future slots — the inclusion-safe basis for a
 * committed `maxFeesPerGas`. Like `@aztec/wallet-sdk` `BaseWallet.getMinFees` (Limit estimate,
 * method-missing fallback), but takes the DA and L2 maxima independently across slots. Falls back
 * to `getCurrentMinFees()` when the node lacks the method or predicts no slots.
 *
 * A transaction is simulated and proven seconds-to-minutes before it lands; committing only the
 * CURRENT min fee risks an inclusion-time reject if the base fee rises in that window.
 */
export async function predictedWorstMinFees(node: MinFeeNode): Promise<GasFees> {
	if (!node.getPredictedMinFees) return node.getCurrentMinFees()
	let predicted: GasFees[]
	try {
		// Limit-congestion estimate (blocks at max capacity), matching BaseWallet's conservative default -
		// an argless call defaults the node to Target, which under-prices the cap under rising congestion.
		predicted = await node.getPredictedMinFees(ManaUsageEstimate.Limit)
	} catch (e) {
		// Only a missing method permits the fallback (BaseWallet's predicate: code -32601 on
		// `cause`, or "Method not found"); a transient error such as "block not found" must
		// propagate, or the cap is silently under-priced.
		const code = (e as { cause?: { code?: number } } | null | undefined)?.cause?.code
		const msg = e instanceof Error ? e.message : String(e)
		if (code === -32601 || /method not found/i.test(msg)) return node.getCurrentMinFees()
		throw e
	}
	if (!predicted || predicted.length === 0) return node.getCurrentMinFees()
	// Component-wise worst across slots (max each fee independently) — a true upper bound even if the DA
	// and L2 fees peak in different slots, so the committed cap is never under-priced on either axis.
	const first = predicted[0]
	if (!first) return node.getCurrentMinFees()
	let worstDa = first.feePerDaGas
	let worstL2 = first.feePerL2Gas
	for (const f of predicted) {
		if (f.feePerDaGas > worstDa) worstDa = f.feePerDaGas
		if (f.feePerL2Gas > worstL2) worstL2 = f.feePerL2Gas
	}
	return new GasFees(worstDa, worstL2)
}
