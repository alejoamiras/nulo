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

export interface TokenDeployment {
	readonly address: string
	readonly salt: number
	readonly deployer: string
	readonly constructorArtifact: "constructor_with_minter"
	readonly constructorArgs: {
		readonly name: string
		readonly symbol: "NULO" | "OLUN"
		readonly decimals: number
		readonly minter: string
		/** 5.0.1 standards Token: the 5th constructor parameter. Absent only on
		 *  pre-5.0.1 records, which can no longer derive under the installed
		 *  artifact — the rebuild fails with a targeted error instead of an
		 *  arity crash. */
		readonly authContract?: string
	}
}

export interface DripperDeployment {
	readonly address: string
	readonly salt: number
	readonly deployer: string
	readonly constructorArtifact: "constructor"
}

export interface DeploymentsJson {
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

/** Record-parameterized rebuilds: the committed live json and a candidate json
 *  (`verify-deployments --config`) go through the SAME derivation, so candidate
 *  verification proves exactly what the app will later trust. */
export async function rebuildDripperInstanceFrom(record: DripperDeployment): Promise<ReconstructedInstance> {
	return getContractInstanceFromInstantiationParams(DripperContractArtifact, {
		constructorArgs: [],
		salt: new Fr(record.salt),
		publicKeys: PublicKeys.default(),
		deployer: AztecAddress.fromStringUnsafe(record.deployer),
		constructorArtifact: record.constructorArtifact,
	})
}

export async function rebuildDripperInstance(): Promise<ReconstructedInstance> {
	return rebuildDripperInstanceFrom(data.dripper)
}

export async function rebuildTokenInstanceFrom(record: TokenDeployment): Promise<ReconstructedInstance> {
	const { name, symbol, decimals, minter, authContract } = record.constructorArgs
	if (authContract === undefined) {
		throw new Error(
			`token ${symbol}: pre-5.0.1 record lacks constructorArgs.authContract — the installed 5.0.1 Token ` +
				"artifact takes 5 constructor args; this record cannot re-derive. Redeploy + promote (aztec-5.0.1-line P6).",
		)
	}
	return getContractInstanceFromInstantiationParams(TokenContractArtifact, {
		constructorArgs: [name, symbol, decimals, AztecAddress.fromStringUnsafe(minter), AztecAddress.fromStringUnsafe(authContract)],
		salt: new Fr(record.salt),
		publicKeys: PublicKeys.default(),
		deployer: AztecAddress.fromStringUnsafe(record.deployer),
		constructorArtifact: record.constructorArtifact,
	})
}

export async function rebuildNuloInstance(): Promise<ReconstructedInstance> {
	return rebuildTokenInstanceFrom(NULO_RECORD)
}

export async function rebuildOlunInstance(): Promise<ReconstructedInstance> {
	return rebuildTokenInstanceFrom(OLUN_RECORD)
}
