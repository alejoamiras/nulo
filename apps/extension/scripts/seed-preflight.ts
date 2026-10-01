/**
 * Live seed preflight: prove a contract exists at the given address on the Testnet and capture its
 * TOFU pin (the contract class id). Exits 1 on a chain-id mismatch, a missing contract, a class id
 * other than the expected one, or any error, so a stale pin cannot pass as a printout.
 *
 * Run from apps/extension: bun run scripts/seed-preflight.ts <address> [expectedClassId] [nodeUrl]
 * — the node defaults to the Testnet seed's endpoint; another URL must serve the same chain.
 */
import { createAztecNodeClient } from "@aztec-labs/stdlib/interfaces/client"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { CHAIN_IDS } from "../src/utils/chain-ids"
import { TESTNET_RPC_URL } from "../src/wallet/constants/network-endpoints"

const [target, expectedClassId, url = TESTNET_RPC_URL] = process.argv.slice(2)
if (!target) {
	console.error("usage: bun run scripts/seed-preflight.ts <address> [expectedClassId] [nodeUrl]")
	process.exit(1)
}

let failed = false
const fail = (line: string) => {
	failed = true
	console.log(line)
}

console.log(`=== Testnet (${new URL(url).origin}) ===`)
try {
	const node = createAztecNodeClient(url)
	const info = await node.getNodeInfo()
	const chainId = (info.l1ChainId ^ info.rollupVersion) >>> 0
	const chainLine = `nodeInfo: nodeVersion=${info.nodeVersion} l1ChainId=${info.l1ChainId} rollupVersion=${info.rollupVersion} → chainId=${chainId} (expected ${CHAIN_IDS.TESTNET})`
	if (chainId === CHAIN_IDS.TESTNET) console.log(`${chainLine} OK`)
	else fail(`${chainLine} MISMATCH`)

	const contract = await node.getContract(AztecAddress.fromStringUnsafe(target))
	if (!contract) {
		fail(`contract ${target}: NOT FOUND`)
	} else {
		const classId = contract.currentContractClassId.toString()
		console.log(`instance address: ${contract.address.toString()}`)
		console.log(`originalContractClassId: ${contract.originalContractClassId.toString()}`)
		console.log(`deployer: ${contract.deployer.toString()}`)
		if (!expectedClassId) console.log(`currentContractClassId: ${classId}`)
		else if (BigInt(classId) === BigInt(expectedClassId)) console.log(`currentContractClassId: ${classId} OK`)
		else fail(`currentContractClassId: ${classId} (expected ${expectedClassId}) MISMATCH`)
	}
} catch (err) {
	fail(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
}
process.exit(failed ? 1 : 0)
