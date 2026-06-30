/**
 * Single source of truth for the faucet's alpha-testnet chain identity, + a
 * build-time guard against drift. The prod faucet broke because a stale
 * `VITE_CHAIN_VERSION=4127419662` (shipped in `.env.example`) overrode the
 * correct value, yielding wallet chainId `4138294185` — which the V5 wallet
 * (chainId `4229590296`) has no network for ("No network configured…").
 *
 * Phase 3 wires `apps/faucet/src/lib/chain-info.ts` to import these
 * constants (dropping the `VITE_CHAIN_*` override path entirely) so the faucet
 * + wallet cannot diverge; this module is the canonical pair + the assert.
 */

/** Sepolia — the L1 the alpha-testnet rollup settles to. */
export const TESTNET_L1_CHAIN_ID = 11155111
/** V5 alpha-testnet rollup version (the value `.env.example` must carry). */
export const TESTNET_ROLLUP_VERSION = 4239416255

/**
 * The wallet's `DEFAULT_SEEDS` derives a network's chainId as
 * `(l1ChainId ^ rollupVersion) >>> 0`. Faucet + wallet MUST agree on this.
 */
export function walletChainId(l1ChainId: number, rollupVersion: number): number {
	return (l1ChainId ^ rollupVersion) >>> 0
}

/** Canonical V5 testnet wallet chainId — `(11155111 ^ 4239416255) >>> 0 = 4229590296`. */
export const TESTNET_WALLET_CHAIN_ID = walletChainId(TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION)

export interface ResolvedChainIdentity {
	l1ChainId: number
	rollupVersion: number
}

/**
 * Fail the build if the faucet's resolved identity drifts from the canonical
 * V5 testnet pair. Throws with the exact remediation; never returns a "wrong
 * but plausible" value (that's the bug class we're killing).
 */
export function assertTestnetIdentity(resolved: ResolvedChainIdentity): void {
	if (resolved.l1ChainId !== TESTNET_L1_CHAIN_ID || resolved.rollupVersion !== TESTNET_ROLLUP_VERSION) {
		const got = walletChainId(resolved.l1ChainId, resolved.rollupVersion)
		throw new Error(
			`faucet chain-identity drift: got l1=${resolved.l1ChainId} rollupVersion=${resolved.rollupVersion} ` +
				`(wallet chainId ${got}), expected ${TESTNET_L1_CHAIN_ID}/${TESTNET_ROLLUP_VERSION} ` +
				`(wallet chainId ${TESTNET_WALLET_CHAIN_ID}, V5 alpha-testnet). The faucet is testnet-only — ` +
				`do NOT override via VITE_CHAIN_*. See implementations-plan/release-dx-hardening.`,
		)
	}
}
