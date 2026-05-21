import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ORIGINAL_ENV = import.meta.env

beforeEach(() => {
	vi.stubEnv("VITE_EXPLORER_BASE_URL", "https://testnet.aztecscan.xyz")
})

afterEach(() => {
	vi.unstubAllEnvs()
	void ORIGINAL_ENV
})

import { explorerAddressUrl, explorerTxUrl } from "./explorer"

describe("explorer URLs (aztecscan testnet)", () => {
	const TX = "0x172684be7d86acff9c0e16b15e3f34647e5c8c26f0838a0872df7f61ddcb7070"
	const ADDR = "0x2af7c3bdd0bee3d825ec40786dc479bfd85f749b45da78a20ddca8ec3e4347c5"

	it("tx URLs use the /tx-effects/<hash> path (not /tx/)", () => {
		expect(explorerTxUrl(TX)).toBe(`https://testnet.aztecscan.xyz/tx-effects/${TX}`)
	})

	it("contract URLs use the /contracts/<address> path", () => {
		expect(explorerAddressUrl(ADDR)).toBe(`https://testnet.aztecscan.xyz/contracts/${ADDR}`)
	})

	it("returns the empty string when the env base URL isn't configured", () => {
		vi.stubEnv("VITE_EXPLORER_BASE_URL", "")
		expect(explorerTxUrl(TX)).toBe("")
		expect(explorerAddressUrl(ADDR)).toBe("")
	})

	it("returns the empty string when called with an empty hash/address", () => {
		expect(explorerTxUrl("")).toBe("")
		expect(explorerAddressUrl("")).toBe("")
	})

	it("strips a trailing slash from the base URL before composing", () => {
		vi.stubEnv("VITE_EXPLORER_BASE_URL", "https://testnet.aztecscan.xyz/")
		expect(explorerTxUrl(TX)).toBe(`https://testnet.aztecscan.xyz/tx-effects/${TX}`)
	})
})
