import { describe, expect, it } from "vitest"
import { normalizeError, userMessage } from "./errors"

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

describe("userMessage", () => {
	it("unwraps a viem-style error to its cause, not the wrapper prose and version line", () => {
		const viemLike = Object.assign(
			new Error("An unknown RPC error occurred. Details: Connect your Ethereum wallet first. Version: viem@2.55.17"),
			{
				details: "Connect your Ethereum wallet first.",
				shortMessage: "An unknown RPC error occurred.",
			},
		)
		expect(userMessage(viemLike)).toBe("Connect your Ethereum wallet first.")
	})

	it("falls back to shortMessage, then the message, then the caller's default", () => {
		expect(userMessage(Object.assign(new Error("long"), { shortMessage: "Short." }))).toBe("Short.")
		expect(userMessage(new Error("plain"))).toBe("plain")
		expect(userMessage(new Error(""), "Could not read this token.")).toBe("Could not read this token.")
		expect(userMessage(undefined, "x")).toBe("x")
	})
})
