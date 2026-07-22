/**
 * Phase-2 preflight companion: capture cUSD's symbol/name/decimals pins by
 * reading the standard Token contract's public-immutable storage slots
 * directly from the node (bb-free — no PXE, no simulation).
 * Run: bun run apps/extension/scripts/seed-preflight-metadata.ts
 */
import { createAztecNodeClient } from "@aztec/stdlib/interfaces/client"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { TokenContractArtifact } from "@aztec/noir-contracts.js/Token"

const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
const URL = "https://aztec-mainnet.drpc.org"

const layout = TokenContractArtifact.storageLayout as Record<string, { slot: { toString(): string } }>
console.log("storageLayout keys:", Object.keys(layout).join(", "))

const node = createAztecNodeClient(URL)
const addr = AztecAddress.fromStringUnsafe(CUSD)
const block = await node.getBlockNumber()

function decodeCompressedString(hex: string): string {
	const bytes = Buffer.from(hex.replace(/^0x/, ""), "hex")
	return bytes.filter((b) => b >= 0x20 && b < 0x7f).toString()
}

for (const key of ["name", "symbol", "decimals"]) {
	const entry = layout[key]
	if (!entry) {
		console.log(`${key}: no slot in standard layout`)
		continue
	}
	try {
		// biome-ignore lint/suspicious/noExplicitAny: probe script, node API variance across versions
		const value = await (node as any).getPublicStorageAt(block, addr, entry.slot)
		const hex = value.toString()
		console.log(`${key}: slot=${entry.slot.toString()} raw=${hex} decoded="${decodeCompressedString(hex)}" asNumber=${BigInt(hex)}`)
	} catch (err) {
		console.log(`${key}: read failed — ${err instanceof Error ? err.message : String(err)}`)
	}
}
