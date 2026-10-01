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

/** Ethereum mainnet's L1 id: the trust root a stored `mainnet`-kind network row is checked against.
 *  No mainnet network is seeded on the V6 line. */
export const MAINNET_L1_CHAIN_ID = 1

/** V6 testnet identity (live-verified 2026-10-01 via node_getNodeInfo: nodeVersion 6.0.0-rc.1) —
 *  the L1/rollup pair behind CHAIN_IDS.TESTNET. The bridge keeps its own copy; nothing checks that
 *  the two agree. */
export const TESTNET_L1_CHAIN_ID = 11155111
export const TESTNET_ROLLUP_VERSION = 2914217885

/** Anvil's fixed default chain id — the seeded Local Network's L1 identity. Hardcoded (never
 *  probed at seed time) so profile creation stays offline-safe; key derivation consumes it. */
export const LOCAL_L1_CHAIN_ID = 31337

export const CHAIN_IDS = {
	TESTNET: walletChainId(TESTNET_L1_CHAIN_ID, TESTNET_ROLLUP_VERSION), // 2904119610 — V6 testnet
	SANDBOX: 0, // localhost:8080
} as const
