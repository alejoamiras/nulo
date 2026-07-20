import { describe, expect, it } from "vitest"
import { assertPortalUninitialized, assertReuseMatchesManifest, assertReusedTokenMetadata, parseReuseTokenArg } from "./reuse-token"

const ADDR = `0x${"ab".repeat(20)}` as const

describe("parseReuseTokenArg", () => {
	it("returns undefined without the flag (fresh-deploy mode)", () => {
		expect(parseReuseTokenArg(["bun", "x.ts"])).toBeUndefined()
	})
	it("returns the address when valid", () => {
		expect(parseReuseTokenArg(["--reuse-token", ADDR])).toBe(ADDR)
	})
	it("hard-stops on a missing or malformed address (never silently fresh-deploys)", () => {
		expect(() => parseReuseTokenArg(["--reuse-token"])).toThrow(/valid 20-byte address/)
		expect(() => parseReuseTokenArg(["--reuse-token", "0x123"])).toThrow(/valid 20-byte address/)
		expect(() => parseReuseTokenArg(["--reuse-token", "--other"])).toThrow(/valid 20-byte address/)
	})
})

describe("assertReusedTokenMetadata", () => {
	const expected = { name: "Azlo", symbol: "AZLO", decimals: 6 }
	it("accepts an exact match", () => {
		expect(() => assertReusedTokenMetadata({ ...expected }, expected)).not.toThrow()
	})
	it("rejects any field mismatch", () => {
		expect(() => assertReusedTokenMetadata({ ...expected, symbol: "AZL0" }, expected)).toThrow(/symbol mismatch/)
		expect(() => assertReusedTokenMetadata({ ...expected, decimals: 18 }, expected)).toThrow(/decimals mismatch/)
	})
})

describe("assertPortalUninitialized", () => {
	it("accepts a zero l2Bridge (fresh portal)", () => {
		expect(() => assertPortalUninitialized(`0x${"0".repeat(40)}`)).not.toThrow()
		expect(() => assertPortalUninitialized(`0x${"0".repeat(64)}`)).not.toThrow()
	})
	it("rejects an already-initialized portal", () => {
		expect(() => assertPortalUninitialized(ADDR)).toThrow(/portal reuse is forbidden/)
	})
})

describe("assertReuseMatchesManifest", () => {
	it("accepts a case-insensitive match and an absent manifest (first deploy)", () => {
		expect(() => assertReuseMatchesManifest(ADDR, ADDR.toUpperCase().replace("0X", "0x"))).not.toThrow()
		expect(() => assertReuseMatchesManifest(ADDR, undefined)).not.toThrow()
	})
	it("rejects a reused address that differs from the live manifest token", () => {
		expect(() => assertReuseMatchesManifest(ADDR, `0x${"cd".repeat(20)}`)).toThrow(/forks the bridge identity/)
	})
})
