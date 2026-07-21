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
	// Fee-payload setup calls of the SELF-PAY payment methods: FeeJuicePaymentMethodWithClaim injects
	// claim_and_end_setup; an embedded private-FPC payment injects mint_and_pay_fee (after FeeJuice.claim).
	// Both are HOW the fee is paid, never the user's intent — and mint_and_pay_fee additionally hijacked
	// the mint heuristic below, titling a bundled private token claim "Mint And Pay Fee".
	"claim_and_end_setup",
	"mint_and_pay_fee",
])

/** Heterogeneous call-like shape. Covers `TxCall` (`method`), `Action` of
 *  kind `call` (`method`) or `encoded_call` (`name`), and the sendTx
 *  wallet-message call entries (`name`). Sites that need to feed a hex
 *  `selector` fallback should project it into `name` before calling. */
export type MethodCarrier = { method?: string; name?: string }

const methodOf = (c: MethodCarrier | undefined): string | undefined => c?.method ?? c?.name

/**
 * The user-facing methods of a call list. Beyond the static FEE_METHODS set, the embedded private-FPC
 * fee payload emits a FeeJuice `claim` IMMEDIATELY followed by `mint_and_pay_fee` (one ExecutionPayload,
 * fixed order) — that ADJACENT pair is fee infra. Only the adjacent claim is filtered: a `claim`
 * elsewhere in the same tx (an airdrop-style app call riding a private-FPC-paid tx) stays user-facing,
 * and a lone `claim` is always user intent.
 */
export function userMethodsOf(named: readonly string[]): string[] {
	return userIndexesOf(named).map((i) => named[i])
}

/** Indexes into `named` that survive the fee-infra filter (the index twin of {@link userMethodsOf}). */
function userIndexesOf(named: readonly string[]): number[] {
	const out: number[] = []
	for (let i = 0; i < named.length; i++) {
		const m = named[i]
		if (FEE_METHODS.has(m)) continue
		if (m === "claim" && named[i + 1] === "mint_and_pay_fee") continue
		out.push(i)
	}
	return out
}

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
	const idx = pickPrimaryIndex(items)
	return idx === undefined ? undefined : methodOf((items as ReadonlyArray<MethodCarrier>)[idx])
}

/**
 * The INDEX of the primary call in `items` - same policy as {@link pickPrimaryMethod}, for consumers
 * that need the call OBJECT (contract, transfers). A name-based find would return the wrong call when
 * the primary's name also appears in the fee payload (e.g. [FeeJuice.claim, mint_and_pay_fee,
 * App.claim] - the app claim is the primary, but "claim" first matches the fee one).
 */
export function pickPrimaryIndex(items: ReadonlyArray<MethodCarrier> | undefined): number | undefined {
	if (!Array.isArray(items) || items.length === 0) return undefined
	// Positions of named items in `items`, and their names, index-aligned.
	const namedPos: number[] = []
	const named: string[] = []
	items.forEach((c, i) => {
		const m = methodOf(c)
		if (typeof m === "string" && m.length > 0) {
			namedPos.push(i)
			named.push(m)
		}
	})
	if (named.length === 0) return undefined
	const user = userIndexesOf(named)
	if (user.length === 0) return namedPos[0]
	const second = user[1]
	if (second !== undefined && named[second].startsWith("mint")) return namedPos[second]
	return namedPos[user[0]]
}
