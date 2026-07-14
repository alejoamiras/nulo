import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { EthAddress } from "@aztec/foundation/eth-address"
import { TokenContractArtifact } from "@alejoamiras/aztec-standards/artifacts/src/artifacts/Token.js"
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

/** The fuel (swap-to-FeeJuice) deployment. Optional: absent config ⇒ the fuel UI never renders. */
export interface FuelDeployment {
	router: `0x${string}`
	swapTarget: `0x${string}`
	permit2: `0x${string}`
	poolManager: `0x${string}`
	quoter: `0x${string}`
	weth: `0x${string}`
	feeJuice: `0x${string}`
	pools: {
		azloWeth: { fee: number; tickSpacing: number }
		ethFj: { fee: number; tickSpacing: number }
	}
	slippageBps: number
	minFuelFj: bigint
}

const fuelCfg = (config.l1 as { fuel?: Record<string, unknown> }).fuel
export const BRIDGE_FUEL: FuelDeployment | undefined = fuelCfg
	? {
			router: fuelCfg.router as `0x${string}`,
			swapTarget: fuelCfg.swapTarget as `0x${string}`,
			permit2: fuelCfg.permit2 as `0x${string}`,
			poolManager: fuelCfg.poolManager as `0x${string}`,
			quoter: fuelCfg.quoter as `0x${string}`,
			weth: fuelCfg.weth as `0x${string}`,
			feeJuice: fuelCfg.feeJuice as `0x${string}`,
			pools: fuelCfg.pools as FuelDeployment["pools"],
			slippageBps: fuelCfg.slippageBps as number,
			minFuelFj: BigInt(fuelCfg.minFuelFj as string),
		}
	: undefined

/** The canonical direct Fee-Juice bridge config (`l1.feeJuice`) — independent of `BRIDGE_FUEL` (the
 *  swap stack) so a removed swap deployment never disables Fuel. Absent ⇒ the Fuel tab never renders.
 *  `FUEL_ASSET` is cross-checked against the portal's `UNDERLYING()` at runtime (Phase 3, fail-closed). */
const feeJuiceCfg = (config.l1 as { feeJuice?: Record<string, unknown> }).feeJuice
export const FUEL_PORTAL = feeJuiceCfg?.portal as `0x${string}` | undefined
export const FUEL_ASSET = feeJuiceCfg?.asset as `0x${string}` | undefined
/** Permissionless testnet FeeAssetHandler that mints the L1 fee asset. The pinned address IS the trust
 *  boundary — it must be reviewed against the node's `l1ContractAddresses.feeAssetHandlerAddress`; the
 *  mint path also cross-checks its `FEE_ASSET()` against `FUEL_ASSET` fail-closed. */
export const FUEL_ASSET_HANDLER = feeJuiceCfg?.feeAssetHandler as `0x${string}` | undefined
export const FUEL_MIN_FJ = feeJuiceCfg?.minFj ? BigInt(feeJuiceCfg.minFj as string) : undefined

export const BRIDGE_PROXY = AztecAddress.fromStringUnsafe(config.l2.proxy.address)
export const BRIDGE_TOKEN = AztecAddress.fromStringUnsafe(config.l2.token.address)

/** The bridged pair's display identity - ONE source for every surface. The token-identity flip
 *  (AZLO/18) changes these two lines + the deployment config; nothing else. */
export const BRIDGE_TOKEN_SYMBOL = "AZLO"
export const BRIDGE_TOKEN_DECIMALS = 18
export const BRIDGE = AztecAddress.fromStringUnsafe(config.l2.bridge.address)

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
