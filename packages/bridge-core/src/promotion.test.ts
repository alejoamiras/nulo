import { describe, expect, it } from "vitest"
import { assertFaucetCandidateShape, assertZeroSeed } from "./promotion"

const token = (authContract?: string) => ({ constructorArgs: { authContract } })

describe("assertFaucetCandidateShape", () => {
	it("accepts a post-5.0.1 candidate", () => {
		expect(() => assertFaucetCandidateShape({ tokens: [token(`0x${"00".repeat(32)}`)], dripper: {} })).not.toThrow()
	})
	it("rejects an empty or dripper-less candidate", () => {
		expect(() => assertFaucetCandidateShape({ tokens: [], dripper: {} })).toThrow(/shape invalid/)
		expect(() => assertFaucetCandidateShape({ tokens: [token("0x1")] })).toThrow(/shape invalid/)
	})
	it("rejects any pre-5.0.1 token record (missing authContract)", () => {
		expect(() => assertFaucetCandidateShape({ tokens: [token("0x1"), token(undefined)], dripper: {} })).toThrow(/pre-5\.0\.1 shape/)
	})
})

describe("assertZeroSeed", () => {
	const fuel = { router: "0xr", weth: "0xw", pools: { a: 1 } }
	it("accepts byte-carried fuel and absent-in-both", () => {
		expect(() => assertZeroSeed(structuredClone(fuel), fuel)).not.toThrow()
		expect(() => assertZeroSeed(undefined, undefined)).not.toThrow()
	})
	it("rejects new, removed, or changed fuel sections", () => {
		expect(() => assertZeroSeed(fuel, undefined)).toThrow(/zero-seed violated/)
		expect(() => assertZeroSeed(undefined, fuel)).toThrow(/zero-seed violated/)
		expect(() => assertZeroSeed({ ...fuel, router: "0xother" }, fuel)).toThrow(/zero-seed violated/)
	})
})
