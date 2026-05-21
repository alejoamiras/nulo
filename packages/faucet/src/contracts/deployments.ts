import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { DripperContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Dripper.js"
import { TokenContractArtifact } from "@defi-wonderland/aztec-standards/dist/src/artifacts/Token.js"
import deploymentsJson from "./deployments.json"

/*
 * deployments.json is DEPLOY METADATA, not a registerable ContractInstance.
 * `wallet.registerContract` needs the full instance with publicKeys + the
 * derived address — we reconstruct each one here via
 * `getContractInstanceFromInstantiationParams` (matches what the deploy
 * script does on its side, so addresses agree by construction).
 *
 * Tokens are looked up by `constructorArgs.symbol` — the deploy script writes
 * an array; we never rely on its order.
 */

interface TokenDeployment {
	readonly address: string
	readonly salt: number
	readonly deployer: string
	readonly constructorArtifact: "constructor_with_minter"
	readonly constructorArgs: {
		readonly name: string
		readonly symbol: "USDC" | "ETH"
		readonly decimals: number
		readonly minter: string
	}
}

interface DripperDeployment {
	readonly address: string
	readonly salt: number
	readonly deployer: string
	readonly constructorArtifact: "constructor"
}

interface DeploymentsJson {
	readonly tokens: readonly TokenDeployment[]
	readonly dripper: DripperDeployment
}

const data = deploymentsJson as DeploymentsJson

function findToken(symbol: "USDC" | "ETH"): TokenDeployment {
	const t = data.tokens.find((t) => t.constructorArgs.symbol === symbol)
	if (!t) throw new Error(`deployments.json missing token: ${symbol}`)
	return t
}

const USDC_RECORD = findToken("USDC")
const ETH_RECORD = findToken("ETH")

export const DRIPPER = AztecAddress.fromString(data.dripper.address)
export const USDC = AztecAddress.fromString(USDC_RECORD.address)
export const ETH = AztecAddress.fromString(ETH_RECORD.address)

export const DEPLOYMENT_RECORDS = {
	dripper: data.dripper,
	usdc: USDC_RECORD,
	eth: ETH_RECORD,
} as const

type ReconstructedInstance = Awaited<ReturnType<typeof getContractInstanceFromInstantiationParams>>

export async function rebuildDripperInstance(): Promise<ReconstructedInstance> {
	return getContractInstanceFromInstantiationParams(DripperContractArtifact, {
		constructorArgs: [],
		salt: new Fr(data.dripper.salt),
		publicKeys: PublicKeys.default(),
		deployer: AztecAddress.fromString(data.dripper.deployer),
		constructorArtifact: data.dripper.constructorArtifact,
	})
}

async function rebuildTokenInstance(record: TokenDeployment): Promise<ReconstructedInstance> {
	const { name, symbol, decimals, minter } = record.constructorArgs
	return getContractInstanceFromInstantiationParams(TokenContractArtifact, {
		constructorArgs: [name, symbol, decimals, AztecAddress.fromString(minter)],
		salt: new Fr(record.salt),
		publicKeys: PublicKeys.default(),
		deployer: AztecAddress.fromString(record.deployer),
		constructorArtifact: record.constructorArtifact,
	})
}

export async function rebuildUsdcInstance(): Promise<ReconstructedInstance> {
	return rebuildTokenInstance(USDC_RECORD)
}

export async function rebuildEthInstance(): Promise<ReconstructedInstance> {
	return rebuildTokenInstance(ETH_RECORD)
}
