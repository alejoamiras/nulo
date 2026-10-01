import { describe, expect, test } from "vitest"
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { fieldAddressKey, sameFieldAddress } from "./field-address"

const A = `0x${"0a1b2c3d".repeat(8)}`
const hex64 = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`

/** xorshift32: a fixed seed gives the same values on every run, with no dependency. */
function xorshift32(seed: number): () => number {
	let s = seed | 0
	return () => {
		s ^= s << 13
		s ^= s >>> 17
		s ^= s << 5
		return s >>> 0
	}
}

describe("fieldAddressKey", () => {
	test.each([
		["lower case", A],
		["upper case", `0x${A.slice(2).toUpperCase()}`],
		["mixed case", `0x${A.slice(2, 34).toUpperCase()}${A.slice(34)}`],
	])("%s keys to the lower-case spelling", (_name, spelling) => {
		expect(fieldAddressKey(spelling)).toBe(A)
	})

	test("the largest field value has a key", () => {
		expect(fieldAddressKey(hex64(Fr.MODULUS - 1n))).toBe(hex64(Fr.MODULUS - 1n))
	})

	test.each([
		["no prefix", A.slice(2)],
		["an upper-case prefix", `0X${A.slice(2)}`],
		["63 digits", A.slice(0, -1)],
		["65 digits", `${A}0`],
		["a non-hex digit", `${A.slice(0, -1)}g`],
		["a Cyrillic а for an a", A.replace("a", "а")],
		["the field modulus", hex64(Fr.MODULUS)],
		["all f", `0x${"f".repeat(64)}`],
		["the empty string", ""],
		["the wildcard", "*"],
		["surrounding spaces", ` ${A} `],
		["a trailing newline", `${A}\n`],
	])("%s has no key", (_name, value) => {
		expect(fieldAddressKey(value)).toBeUndefined()
	})
})

describe("sameFieldAddress", () => {
	test("values without a key never match, not even one with itself", () => {
		expect(sameFieldAddress("0xtok", "0xtok")).toBe(false)
		expect(sameFieldAddress("0xtok", "0xTOK")).toBe(false)
		expect(sameFieldAddress("*", "*")).toBe(false)
		expect(sameFieldAddress(A, "0xtok")).toBe(false)
		expect(sameFieldAddress("0xtok", A)).toBe(false)
	})

	test("256 seeded values: any case matches the lower-case spelling; one changed digit or a dropped prefix never does", () => {
		const next = xorshift32(0x2545f491)
		for (let n = 0; n < 256; n++) {
			let value = 0n
			for (let word = 0; word < 8; word++) value = (value << 32n) | BigInt(next())
			const digits = (value % Fr.MODULUS).toString(16).padStart(64, "0")
			const lower = `0x${digits}`
			const spelled = `0x${[...digits].map((d) => (next() & 1 ? d.toUpperCase() : d)).join("")}`
			expect(sameFieldAddress(spelled, lower), spelled).toBe(true)
			expect(sameFieldAddress(spelled, digits), `${spelled} without its prefix`).toBe(false)
			expect(sameFieldAddress(digits, spelled), `${spelled} without its prefix`).toBe(false)
			for (let i = 0; i < 64; i++) {
				const changed = ((Number.parseInt(digits[i], 16) + 1 + (next() % 15)) % 16).toString(16)
				const other = `0x${digits.slice(0, i)}${changed}${digits.slice(i + 1)}`
				expect(sameFieldAddress(spelled, other), `${spelled} vs ${other}`).toBe(false)
			}
		}
	})
})
