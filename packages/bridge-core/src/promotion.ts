/**
 * Pure validation seams for the `live-intent.ts promote` subcommand — extracted
 * so the fund-adjacent checks are unit-testable without live RPC/cast plumbing.
 */

export interface DripCandidateShape {
	tokens?: Array<{ constructorArgs?: { authContract?: string } }>
	dripper?: unknown
}

const AZTEC_ADDRESS_HEX = /^0x[0-9a-fA-F]{64}$/

/** The drip candidate must be post-5.0.1 shaped: tokens[] + dripper present and
 *  EVERY token record carrying constructorArgs.authContract (the 5th constructor
 *  parameter the 5.0.1 standards Token requires to re-derive its address). */
export function assertDripCandidateShape(candidate: DripCandidateShape): void {
	if (!Array.isArray(candidate.tokens) || candidate.tokens.length === 0 || !candidate.dripper) {
		throw new Error("drip candidate shape invalid (tokens[] + dripper required) — STOP")
	}
	for (const t of candidate.tokens) {
		if (!t.constructorArgs?.authContract) {
			throw new Error("drip candidate has a token without constructorArgs.authContract (pre-5.0.1 shape) — STOP")
		}
		if (!AZTEC_ADDRESS_HEX.test(t.constructorArgs.authContract)) {
			throw new Error(
				`drip candidate authContract is not a 32-byte aztec address: ${JSON.stringify(t.constructorArgs.authContract)} — STOP`,
			)
		}
	}
}

/** Zero-seed assertion for the 5.0.1 arc: the candidate's `l1.fuel` section must be
 *  byte-carried from the live manifest (or absent in both) — any new or changed fuel
 *  infrastructure means a fuel/router deploy or WETH seed happened, which this arc
 *  forbids. Deep-equality via canonical JSON of the two sections. */
/** Deep key-sorted stringify: the candidate arrives ZOD-PARSED (schema key order) while the live
 *  manifest is raw JSON (file key order) — the zero-seed invariant is semantic equality of keys +
 *  values, not serialization order (hit live at the first --drop-swap promote). */
function canonical(value: unknown): string {
	const sort = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(sort)
		if (v && typeof v === "object") {
			return Object.fromEntries(
				Object.keys(v as Record<string, unknown>)
					.sort()
					.map((k) => [k, sort((v as Record<string, unknown>)[k])]),
			)
		}
		return v
	}
	return JSON.stringify(sort(value ?? null))
}

export function assertZeroSeed(
	candidateFuel: unknown,
	liveFuel: unknown,
	opts: { allowSwapDrop?: boolean; allowSwapAdd?: boolean } = {},
): void {
	if (canonical(candidateFuel) === canonical(liveFuel)) return
	// EXPLICIT swap restoration (pools seeded THIS arc for the current token): the candidate keeps
	// `core` byte-equal and ADDS a whole `swap` block the live manifest lacks. Allowed only under the
	// operator's --restore-swap flag — core may never change, and an existing swap may never be
	// silently replaced through this door.
	if (opts.allowSwapAdd) {
		const cand = candidateFuel as { core?: unknown; swap?: unknown } | null | undefined
		const live = liveFuel as { core?: unknown; swap?: unknown } | null | undefined
		const coreEqual = canonical(cand?.core) === canonical(live?.core)
		if (coreEqual && cand?.swap !== undefined && live?.swap === undefined) return
	}
	// EXPLICIT swap retirement (a token cutover): the Uniswap pools are keyed by the token address,
	// so a new token cannot carry the old swap config — the candidate keeps `core` BYTE-EQUAL and
	// DROPS `swap` entirely. Allowed only under the operator's --drop-swap flag; core may never
	// change and swap may never be silently ALTERED (only dropped whole).
	if (opts.allowSwapDrop) {
		const cand = candidateFuel as { core?: unknown; swap?: unknown } | null | undefined
		const live = liveFuel as { core?: unknown; swap?: unknown } | null | undefined
		const coreEqual = canonical(cand?.core) === canonical(live?.core)
		if (coreEqual && cand?.swap === undefined && live?.swap !== undefined) return
	}
	throw new Error(
		"zero-seed violated: the candidate's l1.fuel differs from the live manifest — no fuel/router deploys this arc " +
			"(a token cutover retiring the swap stack must pass --drop-swap with core byte-carried); STOP",
	)
}
