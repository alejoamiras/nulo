/**
 * Phase-2 live seed preflight: prove cUSD exists at the pinned address on
 * CURRENT Testnet + Mainnet and capture the TOFU pins (contract class id).
 * Run from packages/extension: bun run <this file>
 */
import { createAztecNodeClient } from "@aztec/stdlib/interfaces/client"
import { AztecAddress } from "@aztec/stdlib/aztec-address"

const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"

const NETWORKS = [
	{ name: "Testnet", url: "https://v5.testnet.rpc.aztec-labs.com", expectedChainId: 1816023401 },
	{ name: "Alpha V5", url: "https://aztec-mainnet.drpc.org", expectedChainId: 4248422646 },
]

for (const net of NETWORKS) {
	console.log(`\n=== ${net.name} (${net.url}) ===`)
	try {
		const node = createAztecNodeClient(net.url)
		const info = await node.getNodeInfo()
		const chainId = (info.l1ChainId ^ info.rollupVersion) >>> 0
		console.log(
			`nodeInfo: l1ChainId=${info.l1ChainId} rollupVersion=${info.rollupVersion} → chainId=${chainId} (expected ${net.expectedChainId}) ${chainId === net.expectedChainId ? "OK" : "MISMATCH"}`,
		)

		const contract = await node.getContract(AztecAddress.fromStringUnsafe(CUSD))
		if (!contract) {
			console.log("cUSD contract: NOT FOUND at pinned address")
			continue
		}
		console.log(`cUSD instance address: ${contract.address.toString()}`)
		console.log(`currentContractClassId: ${contract.currentContractClassId.toString()}`)
		console.log(`originalContractClassId: ${contract.originalContractClassId.toString()}`)
		console.log(`deployer: ${contract.deployer.toString()}`)
	} catch (err) {
		console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
	}
}
