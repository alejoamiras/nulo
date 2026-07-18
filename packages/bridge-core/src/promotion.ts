/**
 * Pure validation seams for the `live-intent.ts promote` subcommand — extracted
 * so the fund-adjacent checks are unit-testable without live RPC/cast plumbing.
 */

export interface FaucetCandidateShape {
	tokens?: Array<{ constructorArgs?: { authContract?: string } }>
	dripper?: unknown
}

/** The faucet candidate must be post-5.0.1 shaped: tokens[] + dripper present and
 *  EVERY token record carrying constructorArgs.authContract (the 5th constructor
 *  parameter the 5.0.1 standards Token requires to re-derive its address). */
export function assertFaucetCandidateShape(candidate: FaucetCandidateShape): void {
	if (!Array.isArray(candidate.tokens) || candidate.tokens.length === 0 || !candidate.dripper) {
		throw new Error("faucet candidate shape invalid (tokens[] + dripper required) — STOP")
	}
	for (const t of candidate.tokens) {
		if (!t.constructorArgs?.authContract) {
			throw new Error("faucet candidate has a token without constructorArgs.authContract (pre-5.0.1 shape) — STOP")
		}
	}
}

/** Zero-seed assertion for the 5.0.1 arc: the candidate's `l1.fuel` section must be
 *  byte-carried from the live manifest (or absent in both) — any new or changed fuel
 *  infrastructure means a fuel/router deploy or WETH seed happened, which this arc
 *  forbids. Deep-equality via canonical JSON of the two sections. */
export function assertZeroSeed(candidateFuel: unknown, liveFuel: unknown): void {
	if (JSON.stringify(candidateFuel ?? null) !== JSON.stringify(liveFuel ?? null)) {
		throw new Error(
			"zero-seed violated: the candidate's l1.fuel differs from the live manifest — no fuel/router deploys this arc; STOP",
		)
	}
}
