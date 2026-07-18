/**
 * Pure seams for `deploy-bridge-testnet.ts --reuse-token` — extracted so the
 * fund-adjacent decisions are unit-testable without viem/network plumbing.
 */

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** Parse `--reuse-token <address>` from argv. Absent flag = fresh-deploy mode
 *  (returns undefined); a flag without a valid 20-byte address is a hard stop —
 *  silently falling back to a fresh deploy would fork the token identity. */
export function parseReuseTokenArg(argv: readonly string[]): `0x${string}` | undefined {
	const i = argv.indexOf("--reuse-token")
	if (i < 0) return undefined
	const value = argv[i + 1]
	if (!value || !EVM_ADDRESS.test(value)) {
		throw new Error(`--reuse-token requires a valid 20-byte address, got ${JSON.stringify(value)} — STOP`)
	}
	return value as `0x${string}`
}

export interface Erc20Metadata {
	name: string
	symbol: string
	decimals: number
}

/** Readback verification of a REUSED L1 token: the live contract's metadata must
 *  match the expected identity exactly — a wrong address here silently bridges
 *  the wrong asset. */
export function assertReusedTokenMetadata(live: Erc20Metadata, expected: Erc20Metadata): void {
	for (const key of ["name", "symbol", "decimals"] as const) {
		if (live[key] !== expected[key]) {
			throw new Error(
				`reused token ${key} mismatch: live=${JSON.stringify(live[key])} expected=${JSON.stringify(expected[key])} — STOP`,
			)
		}
	}
}

const ZERO_EVM = `0x${"0".repeat(40)}`

/** Portal-reuse preflight: the freshly-deployed portal's `l2Bridge()` must still be
 *  ZERO before `initialize` — a non-zero read means the address belongs to an
 *  ALREADY-INITIALIZED portal (reuse), which is forbidden: the one-shot initialize
 *  binding is the security anchor and must target the NEW L2 bridge only. */
export function assertPortalUninitialized(liveL2Bridge: string): void {
	const normalized = liveL2Bridge?.toLowerCase?.() ?? ""
	const isZero = normalized === ZERO_EVM || /^0x0+$/.test(normalized)
	if (!isZero) {
		throw new Error(`portal.l2Bridge() already set (${liveL2Bridge}) — portal reuse is forbidden; deploy a fresh portal — STOP`)
	}
}
