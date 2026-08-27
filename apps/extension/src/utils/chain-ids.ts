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

/** V5 testnet identity — the L1/rollup pair behind CHAIN_IDS.TESTNET; the faucet's
 *  chain-constants.ts independently pins the same pair (release chain-guard). */
export const TESTNET_L1_CHAIN_ID = 11155111
export const TESTNET_ROLLUP_VERSION = 1821665230

/** Anvil's fixed default chain id — the seeded Local Network's L1 identity. Hardcoded (never
 *  probed at seed time) so profile creation stays offline-safe; key derivation consumes it. */
export const LOCAL_L1_CHAIN_ID = 31337

export const CHAIN_IDS = {
	MAINNET: walletChainId(MAINNET_L1_CHAIN_ID, MAINNET_ROLLUP_VERSION), // 4248422646
	TESTNET: walletChainId(TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION), // 1816023401 — V5 testnet
	SANDBOX: 0, // localhost:8080
} as const
