/**
 * Wallet-injected fee/entrypoint methods. NOT the user's intent. Sites that
 * derive a journal-record title or activity-card label from a call list must
 * filter these out — otherwise the popup shows "Sponsored unconditionally"
 * (the fee path) while a tx is proving, then flips to the real method name
 * once the chain tx record is built.
 *
 * Owned here rather than in `tx-enrichment.ts` so both popup utilities AND
 * wallet-service journal-title sites can import without a directional
 * dependency from wallet-services up to popup utils. `tx-enrichment.ts`
 * re-exports for backward compat.
 */
export const FEE_METHODS: ReadonlySet<string> = new Set([
	"sponsor_unconditionally",
	"fee_entrypoint_private",
	"fee_entrypoint_public",
	"pay_fee",
	"set_authorized",
])

/** Heterogeneous call-like shape. Covers `TxCall` (`method`), `Action` of
 *  kind `call` (`method`) or `encoded_call` (`name`), and the sendTx
 *  wallet-message call entries (`name`). Sites that need to feed a hex
 *  `selector` fallback should project it into `name` before calling. */
export type MethodCarrier = { method?: string; name?: string }

const methodOf = (c: MethodCarrier | undefined): string | undefined => c?.method ?? c?.name

/**
 * Pick the user-facing primary method from a list of call-like items.
 * Mirrors `getPrimaryCall`'s filter + mint heuristic but works on the
 * looser shape available at journal-creation time (before transfers /
 * tx-level enrichment has happened).
 *
 * Returns `undefined` ONLY when no item carries a method/name string at all.
 * If every named item is a `FEE_METHOD`, returns the first named item
 * verbatim — preserves the pre-existing display behavior. The all-fee-only
 * fallback is documented as a (BUG PIN) in the test file; reshaping it
 * belongs to a separate behavior-change PR, not this extraction.
 */
export function pickPrimaryMethod(items: ReadonlyArray<MethodCarrier> | undefined): string | undefined {
	if (!Array.isArray(items) || items.length === 0) return undefined
	const named = items.map(methodOf).filter((m): m is string => typeof m === "string" && m.length > 0)
	if (named.length === 0) return undefined
	const userMethods = named.filter((m) => !FEE_METHODS.has(m))
	if (userMethods.length === 0) return named[0]
	if (userMethods[1]?.startsWith("mint")) return userMethods[1]
	return userMethods[0]
}
