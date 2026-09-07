/**
 * One ordering for every token list in the popup (Home, Holdings, the Send picker):
 * pinned → held and priced (fiat desc) → held and unpriced → never synced → empty, names inside
 * a class. Emptiness is decided before price so a priced token with nothing in it never outranks
 * a funded token the price feed does not know. Pin membership is decided before the row's numbers
 * are parsed, so a malformed pinned row keeps its slot.
 */
import { stringCompare } from "@/utils/string"
import { type FiatOf, isValidDecimals, parseRawBalance } from "@/utils/token-amount"

/** Home's row budget AND the pin cap — one number by design. */
export const HOME_TOKEN_ROWS = 3

export type OrderableRow = {
	token: { chainId: number; contract: string; name: string; symbol: string; decimals?: number }
	publicBalance?: string
	privateBalance?: string
	updatedAt?: number
}

export type OrderCtx<T extends OrderableRow = OrderableRow> = {
	/** Lowercase contract addresses pinned on the active chain. */
	pinnedContracts: ReadonlySet<string>
	fiatOf: FiatOf<T>
}

export type RowClass = "pinned" | "held-priced" | "held-unpriced" | "unsynced" | "unknown" | "empty"

const CLASS_RANK: Record<RowClass, number> = {
	pinned: 0,
	"held-priced": 1,
	"held-unpriced": 2,
	unsynced: 3,
	unknown: 4,
	empty: 5,
}

/** A row whose numbers cannot be trusted: a malformed side or a `decimals` outside 0..77. */
export function isUnknownRow(tb: OrderableRow): boolean {
	return parseRawBalance(tb) === undefined || !isValidDecimals(tb.token.decimals)
}

export function classifyRow<T extends OrderableRow>(tb: T, ctx: OrderCtx<T>): RowClass {
	if (ctx.pinnedContracts.has(tb.token.contract.toLowerCase())) return "pinned"
	if (isUnknownRow(tb)) return "unknown"
	const raw = parseRawBalance(tb) as bigint
	if (raw > 0n) return ctx.fiatOf(tb) === undefined ? "held-unpriced" : "held-priced"
	return tb.updatedAt === 0 ? "unsynced" : "empty"
}

/** Fiat desc; unpriced (or malformed) after priced. */
function compareByFiat<T extends OrderableRow>(a: T, b: T, ctx: OrderCtx<T>): number {
	const fa = isUnknownRow(a) ? undefined : ctx.fiatOf(a)
	const fb = isUnknownRow(b) ? undefined : ctx.fiatOf(b)
	if (fa !== undefined && fb !== undefined) return fa === fb ? 0 : fa > fb ? -1 : 1
	if (fa !== undefined) return -1
	if (fb !== undefined) return 1
	return 0
}

export function compareTokenRows<T extends OrderableRow>(a: T, b: T, ctx: OrderCtx<T>): number {
	const ca = classifyRow(a, ctx)
	const cb = classifyRow(b, ctx)
	if (ca !== cb) return CLASS_RANK[ca] - CLASS_RANK[cb]
	if (ca === "pinned") {
		// A malformed pin keeps its slot but sits behind every readable pin, priced or not.
		const ua = isUnknownRow(a)
		const ub = isUnknownRow(b)
		if (ua !== ub) return ua ? 1 : -1
	}
	if (ca === "pinned" || ca === "held-priced") {
		const byFiat = compareByFiat(a, b, ctx)
		if (byFiat !== 0) return byFiat
	}
	return stringCompare(a.token.name, b.token.name) || a.token.symbol.localeCompare(b.token.symbol)
}

/** A sorted copy; the input is never mutated. */
export function orderTokenRows<T extends OrderableRow>(rows: readonly T[], ctx: OrderCtx<T>): T[] {
	return [...rows].sort((a, b) => compareTokenRows(a, b, ctx))
}

export function capTokenRows<T>(rows: readonly T[], budget = HOME_TOKEN_ROWS): { shown: T[]; overflow: number } {
	const shown = rows.slice(0, budget)
	return { shown, overflow: rows.length - shown.length }
}

/**
 * The balance service returns a shared address's rows from every chain of the profile; each
 * consumer keeps the active chain's rows only.
 */
export function forChain<T extends { token: { chainId: number } }>(rows: readonly T[], chainId: number | undefined): T[] {
	if (chainId === undefined) return []
	return rows.filter((tb) => tb.token.chainId === chainId)
}
