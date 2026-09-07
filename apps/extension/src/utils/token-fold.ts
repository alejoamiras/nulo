/**
 * The Holdings fold: which rows tuck away behind the "N hidden" row. Empty rows always; funded rows
 * only when the wallet's dust threshold says so. Pinned rows never fold (the user chose them), and
 * neither do never-synced or malformed rows (nothing is known about them yet).
 */
import { isAmountAboveDustThreshold } from "@/utils/incoming-dust"
import { parseRawBalance } from "@/utils/token-amount"
import { type OrderCtx, type OrderableRow, classifyRow } from "@/utils/token-order"

export function isHiddenHolding<T extends OrderableRow>(
	tb: T,
	p: { ctx: OrderCtx<T>; usdRate: number | undefined; thresholdMicro: bigint },
): boolean {
	const cls = classifyRow(tb, p.ctx)
	if (cls === "pinned" || cls === "unsynced" || cls === "unknown") return false
	const raw = parseRawBalance(tb)
	if (raw === undefined) return false
	if (raw === 0n) return true
	return !isAmountAboveDustThreshold({
		amountRaw: raw.toString(),
		decimals: tb.token.decimals ?? 0,
		usdRate: p.usdRate,
		thresholdMicro: p.thresholdMicro,
	})
}

/** The fold row's label, or `undefined` when nothing is hidden. */
export function foldLabel(p: { hidden: number; empty: number; dust: number; thresholdUsd: number }): string | undefined {
	if (p.hidden === 0) return undefined
	if (p.thresholdUsd <= 0) return `${p.hidden} empty`
	return `${p.hidden} hidden · ${p.empty} empty · ${p.dust} under $${p.thresholdUsd}`
}
