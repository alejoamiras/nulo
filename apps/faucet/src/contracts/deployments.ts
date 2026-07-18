import { AztecAddress } from "@aztec/aztec.js/addresses"
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { DripperContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import deploymentsJson from "./deployments.json"

/*
 * deployments.json is DEPLOY METADATA, not a registerable ContractInstance.
 * `wallet.registerContract` needs the full instance with publicKeys + the
 * derived address - we reconstruct each one here via
 * `getContractInstanceFromInstantiationParams` (matches what the deploy
 * script does on its side, so addresses agree by construction).
 *
 * Tokens are looked up by `constructorArgs.symbol` - the deploy script writes
 * an array; we never rely on its order.
 */

interface TokenDeployment {
	readonly address: string
	readonly salt: number
	readonly deployer: string
	readonly constructorArtifact: "constructor_with_minter"
	readonly constructorArgs: {
		readonly name: string
		readonly symbol: "NULO" | "OLUN"
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

function findToken(symbol: "NULO" | "OLUN"): TokenDeployment {
	const t = data.tokens.find((t) => t.constructorArgs.symbol === symbol)
	if (!t) throw new Error(`deployments.json missing token: ${symbol}`)
	return t
}

const NULO_RECORD = findToken("NULO")
const OLUN_RECORD = findToken("OLUN")

export const DRIPPER = AztecAddress.fromStringUnsafe(data.dripper.address)
export const NULO = AztecAddress.fromStringUnsafe(NULO_RECORD.address)
export const OLUN = AztecAddress.fromStringUnsafe(OLUN_RECORD.address)

export const DEPLOYMENT_RECORDS = {
	dripper: data.dripper,
	nulo: NULO_RECORD,
	olun: OLUN_RECORD,
} as const

type ReconstructedInstance = Awaited<ReturnType<typeof getContractInstanceFromInstantiationParams>>

export async function rebuildDripperInstance(): Promise<ReconstructedInstance> {
	return getContractInstanceFromInstantiationParams(DripperContractArtifact, {
		constructorArgs: [],
		salt: new Fr(data.dripper.salt),
		publicKeys: PublicKeys.default(),
		deployer: AztecAddress.fromStringUnsafe(data.dripper.deployer),
		constructorArtifact: data.dripper.constructorArtifact,
	})
}

async function rebuildTokenInstance(record: TokenDeployment): Promise<ReconstructedInstance> {
	const { name, symbol, decimals, minter } = record.constructorArgs
	return getContractInstanceFromInstantiationParams(TokenContractArtifact, {
		constructorArgs: [name, symbol, decimals, AztecAddress.fromStringUnsafe(minter)],
		salt: new Fr(record.salt),
		publicKeys: PublicKeys.default(),
		deployer: AztecAddress.fromStringUnsafe(record.deployer),
		constructorArtifact: record.constructorArtifact,
	})
}

export async function rebuildNuloInstance(): Promise<ReconstructedInstance> {
	return rebuildTokenInstance(NULO_RECORD)
}

export async function rebuildOlunInstance(): Promise<ReconstructedInstance> {
	return rebuildTokenInstance(OLUN_RECORD)
}
