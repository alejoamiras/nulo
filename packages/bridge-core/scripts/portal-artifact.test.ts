import { describe, expect, it } from "vitest"
import { assertRuntimeMatchesTemplate } from "./portal-artifact"

// Mirrors the artifact's deployedBytecode.immutableReferences for the fork (slot-keyed map
// flattened): two full-word sites holding left-padded address immutables.
const IMMUTABLES = [
	{ start: 313, length: 32 },
	{ start: 843, length: 32 },
]

const A = "0x1111111111111111111111111111111111111111" as const
const B = "0x2222222222222222222222222222222222222222" as const
const addrBytes = (a: string) => Uint8Array.from(Buffer.from(a.slice(2), "hex"))

function buildTemplate(): Uint8Array {
	const t = new Uint8Array(1024)
	for (let i = 0; i < 1024; i++) t[i] = (i * 7) % 256
	return t
}

function patchTemplate(t: Uint8Array, a: string): Uint8Array {
	const out = Uint8Array.from(t)
	const ab = addrBytes(a)
	for (const { start, length } of IMMUTABLES) {
		out.fill(0, start, start + length)
		out.set(ab, start + length - ab.length)
	}
	return out
}

const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}` as `0x${string}`

describe("assertRuntimeMatchesTemplate", () => {
	it("accepts correctly-patched runtime and returns the initializer", () => {
		const template = buildTemplate()
		expect(assertRuntimeMatchesTemplate(hex(patchTemplate(template, A)), hex(template), A, IMMUTABLES)).toBe(A)
	})

	it("rejects a different initializer in the immutable slots", () => {
		const template = buildTemplate()
		expect(() => assertRuntimeMatchesTemplate(hex(patchTemplate(template, B)), hex(template), A, IMMUTABLES)).toThrow(
			/does not encode the expected initializer/,
		)
	})

	it("rejects one-byte drift outside the immutable ranges", () => {
		const actual = patchTemplate(buildTemplate(), A)
		actual[500] ^= 0xff
		expect(() => assertRuntimeMatchesTemplate(hex(actual), hex(buildTemplate()), A, IMMUTABLES)).toThrow(
			/non-immutable runtime drift at byte 500/,
		)
	})

	it("rejects length mismatch", () => {
		const short = patchTemplate(buildTemplate(), A).slice(0, 512)
		expect(() => assertRuntimeMatchesTemplate(hex(short), hex(buildTemplate()), A, IMMUTABLES)).toThrow(/length/)
	})
})

// Real-data integration: verifies the pinned offsets against an ACTUAL on-chain runtime capture
// (anvil double-deploy diff). Runs only when PORTAL_RUNTIME_CAPTURE points at the hex capture.
describe.skipIf(!process.env.PORTAL_RUNTIME_CAPTURE)("real captured runtime", () => {
	it("matches template at offsets 325/855 and rejects a foreign initializer", async () => {
		const { readFileSync } = await import("node:fs")
		const { join, dirname } = await import("node:path")
		const { existsSync } = await import("node:fs")
		// Walk up from this file: hoisted node_modules placement varies by runner.
		let dir = dirname(new URL(import.meta.url).pathname)
		let l1Root: string | undefined
		for (let i = 0; i < 8 && !l1Root; i++) {
			const cand = join(dir, "node_modules/@aztec/l1-artifacts/l1-contracts")
			if (existsSync(cand)) l1Root = cand
			dir = join(dir, "..")
		}
		if (!l1Root) throw new Error("l1-artifacts not found from test file")
		const actualHex = `0x${readFileSync(String(process.env.PORTAL_RUNTIME_CAPTURE), "utf8").trim().replace(/^0x/, "")}` as `0x${string}`
		const art = JSON.parse(readFileSync(join(l1Root, "out/NuloTokenPortal.sol/NuloTokenPortal.json"), "utf8"))
		const template = art.deployedBytecode.object.startsWith("0x") ? art.deployedBytecode.object : `0x${art.deployedBytecode.object}`
		const refs = Object.values(art.deployedBytecode.immutableReferences ?? {}).flat() as { start: number; length: number }[]
		expect(refs.length).toBeGreaterThan(0)
		const DEPLOYER1 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const
		const DEPLOYER2 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const
		expect(assertRuntimeMatchesTemplate(actualHex, template, DEPLOYER1, refs)).toBe(DEPLOYER1)
		expect(() => assertRuntimeMatchesTemplate(actualHex, template, DEPLOYER2, refs)).toThrow(/does not encode the expected initializer/)
	})
})
