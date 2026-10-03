import { bytesToHex, fromBase64, toBase64 } from "@nulo/wallet-core/utils"
import { afterEach, describe, expect, test, vi } from "vitest"
import { NativeBuffer, ShippedBuffer, withBuffer } from "../../../tests/helpers/shipped-buffer"
import { fromBase64Lenient } from "./lenient-base64"

const hex = (bytes: Uint8Array) => bytesToHex(bytes)
const strict = (input: unknown): string => {
	try {
		return hex(fromBase64(input as string))
	} catch (e) {
		return (e as Error).name
	}
}

// One row per class of input. `native` is Bun's `Buffer`, which the tests run on; `shipped` is
// the polyfill the build injects. They part only on non-ASCII input.
const ROWS: Array<{ label: string; input: unknown; native: string; shipped: string; strict: string }> = [
	{ label: "canonical", input: "QUJD", native: "414243", shipped: "414243", strict: "414243" },
	{ label: "missing padding", input: "QUI", native: "4142", shipped: "4142", strict: "4142" },
	{ label: "length 1 mod 4", input: "QUJDR", native: "414243", shipped: "414243", strict: "InvalidCharacterError" },
	{ label: "short", input: "Q", native: "", shipped: "", strict: "InvalidCharacterError" },
	{ label: "empty", input: "", native: "", shipped: "", strict: "" },
	{ label: "ASCII whitespace", input: "QU JD\n", native: "414243", shipped: "414243", strict: "414243" },
	{ label: "doubled padding", input: "QUI==", native: "4142", shipped: "4142", strict: "InvalidCharacterError" },
	{ label: "inner =", input: "QU=JD", native: "41", shipped: "41", strict: "InvalidCharacterError" },
	{ label: "leading =", input: "=QUJD", native: "", shipped: "", strict: "InvalidCharacterError" },
	{ label: "0x prefix", input: "0xQUJD", native: "d3141424", shipped: "d3141424", strict: "d3141424" },
	{ label: "case", input: "qujd", native: "aae8dd", shipped: "aae8dd", strict: "aae8dd" },
	{ label: "URL-safe", input: "QUJD-_8", native: "414243fbff", shipped: "414243fbff", strict: "InvalidCharacterError" },
	{ label: "junk", input: "QUJ!D", native: "414243", shipped: "414243", strict: "InvalidCharacterError" },
	{ label: "Latin Extended", input: "QUīJD", native: "414f89", shipped: "414243", strict: "InvalidCharacterError" },
	{ label: "Unicode space", input: " QUJD", native: "fd0509", shipped: "414243", strict: "InvalidCharacterError" },
	{ label: "astral", input: "QU😀JD", native: "41", shipped: "414243", strict: "InvalidCharacterError" },
	{ label: "non-string array", input: [65, 66, 67], native: "414243", shipped: "414243", strict: "InvalidCharacterError" },
]

describe("fromBase64Lenient", () => {
	afterEach(() => vi.unstubAllGlobals())

	test.each(ROWS)("$label: native $native", ({ input, native }) => {
		const out = fromBase64Lenient(input as string)
		expect(NativeBuffer.isBuffer(out)).toBe(true)
		expect(hex(out)).toBe(native)
	})

	test.each(ROWS)("$label: shipped $shipped", ({ input, shipped }) => {
		withBuffer(ShippedBuffer)
		const out = fromBase64Lenient(input as string)
		expect(ShippedBuffer.isBuffer(out)).toBe(true)
		expect(hex(out)).toBe(shipped)
	})

	test.each(ROWS)("$label: strict fromBase64 gives $strict", ({ input, strict: expected }) => {
		expect(strict(input)).toBe(expected)
	})
})

describe("wallet-core encoders match the shipped Buffer", () => {
	const backing = new Uint8Array([0xaa, 0xbb, 0xfb, 0xff, 0x00, 0x10, 0xcc, 0xdd])
	const samples: Array<[string, Uint8Array]> = [
		["empty", new Uint8Array()],
		["one byte", new Uint8Array([0xfb])],
		["high bytes", new Uint8Array([0x00, 0x80, 0xff, 0xfe])],
		["32 x 0xfb", new Uint8Array(32).fill(0xfb)],
		["200,000 bytes", new Uint8Array(200_000).map((_, i) => (i * 31) & 0xff)],
		["ArrayBuffer wrap", new Uint8Array(new Uint8Array([1, 2, 0xfb, 0xff]).buffer)],
		["Buffer", NativeBuffer.from([0xfb, 0xef, 0xbe])],
		["offset view", backing.subarray(2, 6)],
	]

	test.each(samples)("%s", (_label, bytes) => {
		expect(toBase64(bytes)).toBe(ShippedBuffer.from(bytes).toString("base64"))
		expect(bytesToHex(bytes)).toBe(ShippedBuffer.from(bytes).toString("hex"))
	})

	test("an offset view encodes its own bytes, not its backing buffer", () => {
		const view = backing.subarray(2, 6)
		expect(toBase64(view)).toBe("+/8AEA==")
		expect(bytesToHex(view)).toBe("fbff0010")
	})
})
