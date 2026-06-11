import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { EthAddress } from "@aztec/foundation/eth-address"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import config from "../../public/testnet-bridge.json"

/*
 * testnet-bridge.json is DEPLOY METADATA, not registerable instances. We rebuild each L2
 * instance here via getContractInstanceFromInstantiationParams - same salt + args + universal
 * deploy (deployer = ZERO) as deploy-bridge-testnet.ts, so the addresses agree by construction.
 * Mirrors src/contracts/deployments.ts for the faucet's own contracts.
 */

export const L1_USDC = config.l1.usdc as `0x${string}`
export const L1_PORTAL = config.l1.portal as `0x${string}`

export const BRIDGE_PROXY = AztecAddress.fromString(config.l2.proxy.address)
export const BRIDGE_TOKEN = AztecAddress.fromString(config.l2.token.address)
export const BRIDGE = AztecAddress.fromString(config.l2.bridge.address)

const common = { publicKeys: PublicKeys.default(), deployer: AztecAddress.ZERO } as const

export function rebuildBridgeProxyInstance() {
	return getContractInstanceFromInstantiationParams(bridgeProxyArtifact, {
		...common,
		constructorArgs: [],
		salt: new Fr(config.l2.proxy.salt),
		constructorArtifact: config.l2.proxy.constructorArtifact,
	})
}

export function rebuildBridgeTokenInstance() {
	const [name, symbol, decimals] = config.l2.token.constructorArgs
	return getContractInstanceFromInstantiationParams(TokenContractArtifact, {
		...common,
		constructorArgs: [name, symbol, decimals, BRIDGE_PROXY],
		salt: new Fr(config.l2.token.salt),
		constructorArtifact: config.l2.token.constructorArtifact,
	})
}

export function rebuildBridgeInstance() {
	return getContractInstanceFromInstantiationParams(tokenBridgeArtifact, {
		...common,
		constructorArgs: [BRIDGE_PROXY, EthAddress.fromString(L1_PORTAL)],
		salt: new Fr(config.l2.bridge.salt),
		constructorArtifact: config.l2.bridge.constructorArtifact,
	})
}
