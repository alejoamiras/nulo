/**
 * The single source of truth for the app-side network identity: the L1 chain, the Aztec node
 * endpoint, and explorer bases. Every composable and component reads chain identity from `NETWORK`
 * here — NOT from `viem/chains` directly. That import is Biome-banned everywhere except this file
 * (see `biome.json` → `noRestrictedImports`), so a half-switched build can't leave one composable
 * signing a Permit2 witness against the wrong chain id (the class of bug that reverts 100% of
 * deposits). The Permit2 EIP-712 domain chain id MUST be `NETWORK.l1ChainId`.
 *
 * Chain-id math lives in the Node-safe `chain-constants.ts` (importable from `vite.config.ts` with
 * no `viem`/`@aztec` pull); this module layers the `viem` Chain object + endpoints on top for the
 * app bundle. Today it is pinned to testnet (Sepolia); the two-network build makes it target-driven.
 */
import type { Chain } from "viem"
import { sepolia } from "viem/chains"
import { TESTNET_L1_CHAIN_ID, TESTNET_WALLET_CHAIN_ID } from "./chain-constants"

export interface NetworkConfig {
	/** L1 (Ethereum) chain id — every viem client + the Permit2 EIP-712 domain bind to this. */
	l1ChainId: number
	/** Aztec wallet chain id, `(l1 ^ rollupVersion) >>> 0` — the node-handshake identity. */
	walletChainId: number
	/** The `viem` Chain object for L1 clients (`createWalletClient`, `writeContract`, …). */
	viemChain: Chain
	/** Aztec node RPC endpoint. */
	nodeUrl: string
	/** L1 block-explorer base (Etherscan-style), no trailing slash. */
	l1ExplorerBaseUrl: string
}

export const NETWORK: NetworkConfig = {
	l1ChainId: TESTNET_L1_CHAIN_ID,
	walletChainId: TESTNET_WALLET_CHAIN_ID,
	viemChain: sepolia,
	nodeUrl: import.meta.env.VITE_AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com",
	l1ExplorerBaseUrl: "https://sepolia.etherscan.io",
}

// The two chain-id sources (the Node-safe constant + the viem Chain) must never diverge — if they
// do, viem clients and the Permit2 domain would disagree. Cheap fail-closed guard at module load.
if (NETWORK.viemChain.id !== NETWORK.l1ChainId) {
	throw new Error(`network.ts: viemChain.id (${NETWORK.viemChain.id}) !== l1ChainId (${NETWORK.l1ChainId}) — chain-id sources drifted`)
}
