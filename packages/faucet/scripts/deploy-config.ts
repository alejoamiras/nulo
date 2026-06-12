/**
 * Faucet-specific deploy configuration.
 *
 * Mirrors the shape of aztec-standards/scripts/deploy-config.ts so the
 * vendored deploy.ts can reuse the upstream pattern verbatim — but our
 * token list is NULO (decimals=6, USDC-shaped) + OLUN (decimals=18,
 * ETH-shaped), not the upstream's WETH/DAI/USDC defaults.
 *
 * Salts:
 *   - Dripper salt 1337 matches Wonderland's default. If their Dripper is
 *     already deployed at this salt on alpha-testnet, our deterministic
 *     address collides to theirs (good — we share).
 *   - Token salts 4244 (NULO) and 4245 (OLUN) avoid colliding with their
 *     defaults at salt 1337 AND with our retired USDC/ETH drips (4242/4243).
 */

export type Network = "testnet" | "local-network"

export const NETWORK_URLS: Record<Network, string> = {
	testnet: "https://rpc.testnet.aztec-labs.com",
	"local-network": "http://localhost:8080",
}

export const DRIPPER_SALT = 1337

export interface FaucetTokenConfig {
	readonly name: string
	readonly symbol: "NULO" | "OLUN"
	readonly decimals: number
	readonly salt: number
}

export const FAUCET_TOKEN_CONFIGS: readonly FaucetTokenConfig[] = [
	{ name: "NULO", symbol: "NULO", decimals: 6, salt: 4244 },
	{ name: "OLUN", symbol: "OLUN", decimals: 18, salt: 4245 },
] as const

export interface DeploymentConfig {
	readonly network: { readonly name: Network; readonly nodeUrl: string }
	readonly deployer: { readonly dataDirectory: string }
	readonly contracts: {
		readonly tokens: readonly FaucetTokenConfig[]
		readonly dripper: { readonly salt: number }
	}
}

export function getDeploymentConfig(network: Network): DeploymentConfig {
	// AZTEC_NODE_URL overrides the per-network default. The frontend reads
	// its own VITE_AZTEC_NODE_URL — deliberately separate so the bundled
	// build never embeds DEPLOYER_SECRET-adjacent config.
	const nodeUrl = process.env.AZTEC_NODE_URL || NETWORK_URLS[network]
	return {
		network: { name: network, nodeUrl },
		deployer: { dataDirectory: `.faucet-deploy-${network}/` },
		contracts: {
			tokens: FAUCET_TOKEN_CONFIGS,
			dripper: { salt: DRIPPER_SALT },
		},
	}
}
