/**
 * Preflight companion to seed-preflight.ts: capture a seed token's
 * symbol/name/decimals pins by reading public storage directly from the node
 * (bb-free — no PXE, no simulation).
 *
 * Uses the AZTEC-STANDARDS Token storage layout — the class every current
 * seed pins (0x0225da…). The first version of this script imported the
 * upstream `@aztec/noir-contracts.js/Token` sample artifact, whose layout
 * puts name/symbol/decimals at DIFFERENT slots, so it decoded garbage and
 * the cUSD `expectedSymbol` pin shipped from product intent instead of chain
 * truth ("cUSD" vs the real "cUSDC") — the seeder then hard-skipped the token
 * on every unlock. Always match this artifact to the pinned class.
 *
 * Run from apps/extension: bun run scripts/seed-preflight-metadata.ts [tokenAddress] [nodeUrl]
 * — defaults to cUSD on Alpha V5.
 */
import { createAztecNodeClient } from "@aztec/stdlib/interfaces/client"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { TokenContract } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"

const CUSD = "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6"
const TARGET = process.argv[2] ?? CUSD
const URL = process.argv[3] ?? "https://aztec-mainnet.drpc.org"

// biome-ignore lint/suspicious/noExplicitAny: artifact typing does not expose storageLayout
const layout = (TokenContract.artifact as any).storageLayout as Record<string, { slot: { toString(): string } }>
console.log("standards storageLayout keys:", Object.keys(layout ?? {}).join(", "))

const node = createAztecNodeClient(URL)
const addr = AztecAddress.fromStringUnsafe(TARGET)
const block = await node.getBlockNumber()
console.log(`node: ${URL} block: ${block}\ntoken: ${TARGET}`)

/** Standards CompressedString: ASCII bytes big-endian-packed into one field. */
function decodeCompressedString(hex: string): string {
	const bytes = Buffer.from(hex.replace(/^0x/, ""), "hex")
	return String.fromCharCode(...bytes.filter((b) => b >= 0x20 && b < 0x7f))
}

for (const key of ["name", "symbol", "decimals"]) {
	const entry = layout?.[key]
	if (!entry) {
		console.log(`${key}: no slot in standards layout`)
		continue
	}
	try {
		// biome-ignore lint/suspicious/noExplicitAny: node API variance across versions
		const value = await (node as any).getPublicStorageAt(block, addr, entry.slot)
		const hex = value.toString()
		console.log(
			`${key}: slot=${BigInt(entry.slot.toString())} raw=${hex} decoded="${decodeCompressedString(hex)}" asNumber=${BigInt(hex)}`,
		)
	} catch (err) {
		console.log(`${key}: read failed — ${err instanceof Error ? err.message : String(err)}`)
	}
}
