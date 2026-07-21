/**
 * Known Aztec network chain identities — the ONE definition both shells consume (popup UI via
 * `components/ui/utils`, the SW via `network/service` + `constants/explorers`), owned here so
 * neither side imports across the popup/wallet boundary for a constant.
 *
 * A wallet chainId is `(l1ChainId ^ rollupVersion) >>> 0`. The rollupVersion CHANGES whenever a
 * network's rollup redeploys (resets and protocol upgrades), so every pinned id below is only as
 * fresh as its pair — the Alpha 5.0.1 upgrade shipped with a stale MAINNET pin precisely because
 * the id was a bare literal with no recorded pair. Keep the pair next to every id.
 */

export function walletChainId(l1ChainId: number, rollupVersion: number): number {
	return (l1ChainId ^ rollupVersion) >>> 0
}

/** Alpha mainnet identity (live-verified 2026-07-21 via node_getNodeInfo: nodeVersion 5.0.1). */
export const MAINNET_L1_CHAIN_ID = 1
export const MAINNET_ROLLUP_VERSION = 4248422647

export const CHAIN_IDS = {
	MAINNET: walletChainId(MAINNET_L1_CHAIN_ID, MAINNET_ROLLUP_VERSION), // 4248422646
	TESTNET: 1816023401, // (11155111 ^ 1821665230) >>> 0 — V5 testnet; canonical pair lives in the faucet's chain-constants.ts (release chain-guard single-sources it)
	DEVNET: 896946031, // (11155111 ^ 903641544) >>> 0 — v4-devnet-3
	SANDBOX: 0, // localhost:8080
} as const
