import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { EthAddress } from "@aztec/foundation/eth-address"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { bridgeProxyArtifact, tokenBridgeArtifact } from "@nulo/bridge-core/artifacts"
import { parseCandidateManifest } from "@nulo/bridge-core"
import rawConfig from "../../public/testnet-bridge.json"

/*
 * testnet-bridge.json is DEPLOY METADATA, not registerable instances. We rebuild each L2
 * instance here via getContractInstanceFromInstantiationParams - same salt + args + universal
 * deploy (deployer = ZERO) as deploy-bridge-testnet.ts, so the addresses agree by construction.
 * Mirrors src/contracts/deployments.ts for the faucet's own contracts.
 *
 * STRICT-validated at module init (candidate-schema): a malformed or stale-shaped manifest fails
 * the faucet loudly at boot instead of shipping a broken lane (the rc.2 arc shipped a stale
 * carried feeJuicePortal precisely because this file used to cast an untyped `fuel` block).
 */
const config = parseCandidateManifest(rawConfig)

export const L1_USDC = config.l1.usdc as `0x${string}`
export const L1_PORTAL = config.l1.portal as `0x${string}`

/**
 * Router + Permit2 are REQUIRED bridge config now (bridge-only + fuel-only both go through the
 * router's `bridge()` — C7). They currently live under `l1.fuel`; read them from there but treat
 * them as bridge-level requirements. `undefined` here means the (post-cutover) single-path deposit
 * cannot run — the deposit code asserts their presence fail-closed.
 */
export const BRIDGE_ROUTER = (config.l1 as { fuel?: { router?: string } }).fuel?.router as `0x${string}` | undefined
export const BRIDGE_PERMIT2 = (config.l1 as { fuel?: { permit2?: string } }).fuel?.permit2 as `0x${string}` | undefined
/** The router's current swap target — witness-bound even for a bridge-only deposit (F-004). */
export const BRIDGE_SWAP_TARGET = (config.l1 as { fuel?: { swapTarget?: string } }).fuel?.swapTarget as `0x${string}` | undefined

/**
 * L9 runtime interlock (codex cond. 2): the deposit code REFUSES to build a private deposit unless
 * the active manifest declares `privateClaimMode: "salt-v2"` — so a stray preview/static deploy of
 * recipient-committed code against an OLD (bearer-bridge) manifest fails closed instead of stranding
 * funds. The value is written ONLY into the candidate→promoted manifest (never the live manifest
 * before promotion), so during the dev-side cutover window this is intentionally absent.
 */
export const PRIVATE_CLAIM_MODE = (config.l1 as { privateClaimMode?: string }).privateClaimMode
export const SUPPORTS_SALT_V2 = PRIVATE_CLAIM_MODE === "salt-v2"

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

// Fully typed via the strict schema — the pool keys the swap UI needs are asserted here (the
// schema keeps `pools` an open record; the faucet's swap lane requires these two specifically).
const fuelCfg = config.l1.fuel
const requiredPools = (pools: Record<string, { fee: number; tickSpacing: number }>): FuelDeployment["pools"] => {
	const { azloWeth, ethFj } = pools
	if (!azloWeth || !ethFj) throw new Error("bridge manifest: l1.fuel.pools must include azloWeth and ethFj")
	return { azloWeth, ethFj }
}
export const BRIDGE_FUEL: FuelDeployment | undefined = fuelCfg
	? {
			router: fuelCfg.router as `0x${string}`,
			swapTarget: fuelCfg.swapTarget as `0x${string}`,
			permit2: fuelCfg.permit2 as `0x${string}`,
			poolManager: fuelCfg.poolManager as `0x${string}`,
			quoter: fuelCfg.quoter as `0x${string}`,
			weth: fuelCfg.weth as `0x${string}`,
			feeJuice: fuelCfg.feeJuice as `0x${string}`,
			pools: requiredPools(fuelCfg.pools),
			slippageBps: fuelCfg.slippageBps,
			minFuelFj: BigInt(fuelCfg.minFuelFj),
		}
	: undefined

/** The canonical direct Fee-Juice bridge config (`l1.feeJuice`) — independent of `BRIDGE_FUEL` (the
 *  swap stack) so a removed swap deployment never disables Fuel. Absent ⇒ the Fuel tab never renders.
 *  `FUEL_ASSET` is cross-checked against the portal's `UNDERLYING()` at runtime (Phase 3, fail-closed). */
const feeJuiceCfg = config.l1.feeJuice
export const FUEL_PORTAL = feeJuiceCfg?.portal as `0x${string}` | undefined
export const FUEL_ASSET = feeJuiceCfg?.asset as `0x${string}` | undefined
/** Permissionless testnet FeeAssetHandler that mints the L1 fee asset. The pinned address IS the trust
 *  boundary — it must be reviewed against the node's `l1ContractAddresses.feeAssetHandlerAddress`; the
 *  mint path also cross-checks its `FEE_ASSET()` against `FUEL_ASSET` fail-closed. */
export const FUEL_ASSET_HANDLER = feeJuiceCfg?.feeAssetHandler as `0x${string}` | undefined
export const FUEL_MIN_FJ = feeJuiceCfg?.minFj ? BigInt(feeJuiceCfg.minFj) : undefined

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
		// 5.0.1 standards Token: constructor_with_minter's 5th param auth_contract (ZERO = none,
		// matching deploy-bridge-testnet). The minter (4th) stays hardcoded to BRIDGE_PROXY — an
		// invariant cross-check, not trusted from config. The reconstructed address is 5.0.1-derived,
		// so it matches only a 5.0.1-deployed bridge (P6 coupling; the live 5.0.0 manifest differs).
		constructorArgs: [name, symbol, decimals, BRIDGE_PROXY, AztecAddress.ZERO],
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
