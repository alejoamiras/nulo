import { CHAIN_IDS } from "@/utils/chain-ids"

// Re-exported so existing popup-side importers keep their path; the definition lives in
// @/utils/chain-ids (shared with the SW side, which must not import components/*).
export { CHAIN_IDS }

export function getChainPosition(chainId: number): number {
	switch (chainId) {
		case CHAIN_IDS.MAINNET:
			return 0
		case CHAIN_IDS.TESTNET:
			return 1
		case CHAIN_IDS.DEVNET:
			return 2
		case CHAIN_IDS.SANDBOX:
			return 3
		default:
			return 4
	}
}

export function getChainColor(chainId: number): string {
	switch (chainId) {
		case CHAIN_IDS.MAINNET:
			return "green"
		case CHAIN_IDS.TESTNET:
			return "neutral-mint"
		case CHAIN_IDS.DEVNET:
			return "blue"
		case CHAIN_IDS.SANDBOX:
			return "sand"
		default:
			return "purple"
	}
}

export function getChainName(chainId: number): string {
	switch (chainId) {
		case CHAIN_IDS.MAINNET:
			return "Alpha"
		case CHAIN_IDS.TESTNET:
			return "Testnet"
		case CHAIN_IDS.DEVNET:
			return "Devnet"
		case CHAIN_IDS.SANDBOX:
			return "Sandbox"
		default:
			return `Aztec:${chainId}`
	}
}
