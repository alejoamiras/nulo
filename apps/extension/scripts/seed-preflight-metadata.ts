/**
 * Preflight companion to seed-preflight.ts: capture a seed token's
 * symbol/name/decimals pins by reading public storage directly from the node
 * (bb-free — no PXE, no simulation). Exits 1 when a field has no slot in the
 * layout, a read fails, or a value does not decode, so only chain truth
 * becomes a pin.
 *
 * Uses the AZTEC-STANDARDS Token storage layout — the class every seed pins.
 * The upstream `@aztec-labs/noir-contracts.js/Token` sample artifact puts
 * name/symbol/decimals at DIFFERENT slots and decodes garbage; a symbol pin
 * taken from product intent instead ("cUSD" vs the real "cUSDC") once made the
 * seeder hard-skip its token on every unlock. Always match this artifact to
 * the pinned class.
 *
 * Run from apps/extension: bun run scripts/seed-preflight-metadata.ts <tokenAddress> [nodeUrl]
 * — the node defaults to the Testnet seed's endpoint.
 */
import { createAztecNodeClient } from "@aztec-labs/stdlib/interfaces/client"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { TokenContract } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { TESTNET_RPC_URL } from "../src/wallet/constants/network-endpoints"

/** The seeder's own bound: a token outside it is never seeded. */
const MAX_DECIMALS = 18n

const [target, url = TESTNET_RPC_URL] = process.argv.slice(2)
if (!target) {
	console.error("usage: bun run scripts/seed-preflight-metadata.ts <tokenAddress> [nodeUrl]")
	process.exit(1)
}

// biome-ignore lint/suspicious/noExplicitAny: artifact typing does not expose storageLayout
const layout = (TokenContract.artifact as any).storageLayout as Record<string, { slot: { toString(): string } }>
console.log("standards storageLayout keys:", Object.keys(layout ?? {}).join(", "))

const node = createAztecNodeClient(url)
const addr = AztecAddress.fromStringUnsafe(target)
const block = await node.getBlockNumber()
console.log(`node: ${new URL(url).origin} block: ${block}\ntoken: ${target}`)

/** Standards CompressedString: ASCII bytes big-endian-packed into one field, zero-padded. Any
 *  non-printable byte between the first and last non-zero byte means the slot holds something else. */
function decodeCompressedString(hex: string): string | undefined {
	const bytes = [...Buffer.from(hex.replace(/^0x/, "").padStart(64, "0"), "hex")]
	const first = bytes.findIndex((b) => b !== 0)
	if (first < 0) return undefined
	const text = bytes.slice(first, bytes.findLastIndex((b) => b !== 0) + 1)
	return text.every((b) => b >= 0x20 && b < 0x7f) ? String.fromCharCode(...text) : undefined
}

function decode(key: string, hex: string): string | undefined {
	if (key !== "decimals") return decodeCompressedString(hex)
	const decimals = BigInt(hex)
	return decimals <= MAX_DECIMALS ? decimals.toString() : undefined
}

let failed = false
for (const key of ["name", "symbol", "decimals"]) {
	const entry = layout?.[key]
	if (!entry) {
		failed = true
		console.log(`${key}: no slot in standards layout`)
		continue
	}
	try {
		// biome-ignore lint/suspicious/noExplicitAny: node API variance across versions
		const value = await (node as any).getPublicStorageAt(block, addr, entry.slot)
		const hex = value.toString()
		const decoded = decode(key, hex)
		if (decoded === undefined) failed = true
		console.log(
			`${key}: slot=${BigInt(entry.slot.toString())} raw=${hex} ${decoded === undefined ? "UNDECODABLE" : `decoded="${decoded}"`}`,
		)
	} catch (err) {
		failed = true
		console.log(`${key}: read failed — ${err instanceof Error ? err.message : String(err)}`)
	}
}
process.exit(failed ? 1 : 0)
