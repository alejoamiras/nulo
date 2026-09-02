/**
 * LIVE-testnet tools drip canary: proves the deployed Dripper actually drips through the SAME
 * call the tools app UI makes (`drip_to_public(token, amount)` paid by the Sponsored FPC) from a
 * fresh L2 account. Instances are REBUILT from the committed deployments.json params and their
 * addresses asserted — a drifted record fails here, not in a user's browser.
 *
 * Run: bun scripts/drip-canary-testnet.ts   (no L1 env needed; the drip is L2-only)
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { Contract, getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts"
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee"
import { Fr } from "@aztec/aztec.js/fields"
import { PublicKeys } from "@aztec/aztec.js/keys"
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { TxStatus } from "@aztec/aztec.js/tx"
import { SPONSORED_FPC_SALT } from "@aztec/constants"
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC"
import { EmbeddedWallet } from "@aztec/wallets/embedded"
import { DripperContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Dripper.js"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { stopwatch } from "./script-bootstrap"

const NODE_URL = process.env.AZTEC_NODE_URL ?? "https://v5.testnet.rpc.aztec-labs.com"
// The tools app UI's NULO drip (constants/tokens.ts): 1,000 NULO at 6 decimals.
const DRIP_AMOUNT = 1_000_000_000n

const here = dirname(fileURLToPath(import.meta.url))
// `--config <path>` targets a CANDIDATE manifest (candidate-first: the canary must
// prove the candidate BEFORE promote touches the live file); default = live.
const configArgIndex = process.argv.indexOf("--config")
const deploymentsPath =
	configArgIndex >= 0 && process.argv[configArgIndex + 1]
		? process.argv[configArgIndex + 1]
		: join(here, "..", "..", "..", "apps", "tools", "src", "contracts", "deployments.json")
const deployments = JSON.parse(readFileSync(deploymentsPath, "utf8")) as {
	dripper: { address: string; salt: number; constructorArtifact: string }
	tokens: {
		address: string
		salt: number
		constructorArtifact: string
		constructorArgs: { name: string; symbol: string; decimals: number; minter: string; authContract?: string }
	}[]
}

async function main() {
	console.log(`drip canary config: ${deploymentsPath}`)
	const mins = stopwatch()

	const node = createAztecNodeClient(NODE_URL)
	const ewallet = await EmbeddedWallet.create(NODE_URL, { pxeConfig: { proverEnabled: true } })
	const { signingKey, secretKey } = await deriveNuloAccountKeys(Fr.random())
	const manager = await ewallet.createSchnorrAccount(secretKey, Fr.random(), signingKey)
	const from = (await manager.getAccount()).getAddress()
	console.log(`L2 drip recipient ${from.toString()}`)

	const fpc = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT) })
	try {
		await ewallet.registerContract(fpc, SponsoredFPCContract.artifact)
	} catch {}
	const sponsoredFee = { paymentMethod: new SponsoredFeePaymentMethod(fpc.address) }
	if (!(await node.getContract(from))) {
		console.log(`deploying L2 account via sponsored FPC (real proof)… (${mins()})`)
		const deployMethod = await manager.getDeployMethod()
		await deployMethod.send({ fee: sponsoredFee, from: "NO_FROM" as never } as never)
		console.log(`L2 account deployed (${mins()})`)
	}

	// Rebuild + assert the dripper and the NULO token from the COMMITTED records (universal deploys).
	const dripperInstance = await getContractInstanceFromInstantiationParams(
		DripperContractArtifact as never,
		{
			salt: new Fr(deployments.dripper.salt),
			publicKeys: PublicKeys.default(),
			deployer: AztecAddress.ZERO,
			constructorArtifact: deployments.dripper.constructorArtifact,
			constructorArgs: [],
		} as never,
	)
	if (dripperInstance.address.toString() !== deployments.dripper.address) {
		throw new Error(`dripper rebuilt ${dripperInstance.address} != committed ${deployments.dripper.address}`)
	}
	const nulo = deployments.tokens.find((t) => t.constructorArgs.symbol === "NULO")
	if (!nulo) throw new Error("no NULO token record in deployments.json")
	const a = nulo.constructorArgs
	// 5.0.1 standards Token: constructor_with_minter takes 5 args; a record without
	// authContract predates the fence and cannot re-derive under the installed artifact.
	if (!a.authContract) throw new Error("NULO record lacks constructorArgs.authContract (pre-5.0.1 shape) — redeploy/promote first")
	const tokenInstance = await getContractInstanceFromInstantiationParams(
		TokenContractArtifact as never,
		{
			salt: new Fr(nulo.salt),
			publicKeys: PublicKeys.default(),
			deployer: AztecAddress.ZERO,
			constructorArtifact: nulo.constructorArtifact,
			constructorArgs: [
				a.name,
				a.symbol,
				a.decimals,
				AztecAddress.fromStringUnsafe(a.minter),
				AztecAddress.fromStringUnsafe(a.authContract),
			],
		} as never,
	)
	if (tokenInstance.address.toString() !== nulo.address) {
		throw new Error(`NULO rebuilt ${tokenInstance.address} != committed ${nulo.address}`)
	}
	try {
		await ewallet.registerContract(dripperInstance, DripperContractArtifact as never)
	} catch {}
	try {
		await ewallet.registerContract(tokenInstance, TokenContractArtifact as never)
	} catch {}
	console.log(`dripper + NULO instances rebuilt and match the committed records (${mins()})`)

	const dripper = await Contract.at(dripperInstance.address, DripperContractArtifact as never, ewallet as never)
	const token = await Contract.at(tokenInstance.address, TokenContractArtifact as never, ewallet as never)
	const balanceOf = async (): Promise<bigint> => {
		const r = (await token.methods.balance_of_public(from).simulate({ from })) as { result?: bigint } | bigint
		return typeof r === "bigint" ? r : (r.result ?? 0n)
	}

	const before = await balanceOf()
	console.log(`dripping ${DRIP_AMOUNT} NULO-units (sponsored)… (${mins()})`)
	await dripper.methods.drip_to_public(tokenInstance.address, DRIP_AMOUNT).send({
		from,
		fee: sponsoredFee,
		wait: { waitForStatus: TxStatus.PROPOSED },
	} as never)
	const after = await balanceOf()
	if (after - before !== DRIP_AMOUNT) throw new Error(`drip landed ${after - before}, expected ${DRIP_AMOUNT}`)
	console.log(`\n✅ DRIP canary PASSED — ${DRIP_AMOUNT} NULO-units dripped to a fresh account in ${mins()}.`)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
