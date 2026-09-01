/**
 * Single source of truth for the faucet's alpha-testnet chain identity, + a
 * build-time guard against drift. The prod faucet broke because a stale
 * `VITE_CHAIN_VERSION` (shipped in `.env.example`) overrode the correct value,
 * yielding a wallet chainId the V5 wallet has no network for ("No network
 * configured…").
 *
 * The canonical pair is single-sourced from the FAUCET's own
 * `apps/tools/src/lib/chain-constants.ts` (which `chain-info.ts` also imports)
 * so the faucet, the wallet, and this release-time `verify-live` guard cannot
 * diverge. A testnet redeploy that bumps `chain-constants.ts` (e.g. the 5.0.0
 * stable reset) automatically flows here — no hand-edit, no drift.
 */

import { TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION } from "../../apps/tools/src/lib/chain-constants"

export { TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION }

/**
 * The wallet's `DEFAULT_SEEDS` derives a network's chainId as
 * `(l1ChainId ^ rollupVersion) >>> 0`. Faucet + wallet MUST agree on this.
 */
export function walletChainId(l1ChainId: number, rollupVersion: number): number {
	return (l1ChainId ^ rollupVersion) >>> 0
}

/** Canonical V5 testnet wallet chainId — single-sourced from `chain-constants.ts`. */
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
