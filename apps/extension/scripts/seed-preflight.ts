/**
 * Live seed preflight: prove a contract exists at the given address on the Testnet and capture its
 * TOFU pin (the contract class id). Exits 1 on a node that is not the pinned Testnet, a missing
 * contract, a class id other than the expected one, or any error, so a stale pin cannot pass as a
 * printout.
 *
 * Run from apps/extension: bun run scripts/seed-preflight.ts <address> [expectedClassId] [nodeUrl]
 * — the node defaults to the Testnet seed's endpoint; another URL must serve the same chain.
 */
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { scrubUrls } from "../src/utils/scrub-urls"
import { TESTNET_RPC_URL } from "../src/wallet/constants/network-endpoints"
import { createPreflightNodeClient, readPinnedTestnetIdentity } from "./seed-preflight-node"

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
	const node = createPreflightNodeClient(url)
	const identity = await readPinnedTestnetIdentity(node)
	if (!identity.matches) {
		fail(`${identity.line} MISMATCH`)
		process.exit(1)
	}
	console.log(`${identity.line} OK`)

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
	fail(`ERROR: ${scrubUrls(err instanceof Error ? err.message : String(err))}`)
}
process.exit(failed ? 1 : 0)
