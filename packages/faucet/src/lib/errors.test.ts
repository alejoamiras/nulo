import { describe, expect, it } from "vitest"
import { normalizeError } from "./errors"

describe("normalizeError", () => {
	it("classifies EIP-1193 code=4001 as user-rejected", () => {
		const out = normalizeError({ code: 4001, message: "User rejected the request" })
		expect(out.category).toBe("user-rejected")
		expect(out.message).toBe("Rejected in wallet.")
	})

	it("classifies textual 'denied by user' as user-rejected", () => {
		const out = normalizeError(new Error("Request denied by user"))
		expect(out.category).toBe("user-rejected")
	})

	it("classifies 'Existing nullifier' as account-uninitialized", () => {
		const out = normalizeError(new Error("Existing nullifier on tx submission"))
		expect(out.category).toBe("account-uninitialized")
		expect(out.message).toMatch(/account isn't deployed/i)
	})

	it("classifies 'transaction reverted' as tx-reverted", () => {
		const out = normalizeError(new Error("Transaction reverted on-chain"))
		expect(out.category).toBe("tx-reverted")
	})

	it("classifies fetch / timeout errors as network", () => {
		const out = normalizeError(new Error("fetch failed: timeout after 30s"))
		expect(out.category).toBe("network")
		expect(out.message).toMatch(/alpha-testnet is not responding/i)
	})

	it("falls back to 'unknown' for unrecognized errors", () => {
		const out = normalizeError(new Error("Some completely opaque internal error"))
		expect(out.category).toBe("unknown")
	})
})
