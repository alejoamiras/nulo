import { describe, expect, it } from "vitest"
import { validateContentScriptMessage } from "./content-script-validator"

describe("validateContentScriptMessage", () => {
	it("passes through non-object inputs", () => {
		expect(validateContentScriptMessage(undefined).kind).toBe("passthrough")
		expect(validateContentScriptMessage(null).kind).toBe("passthrough")
		expect(validateContentScriptMessage("string").kind).toBe("passthrough")
		expect(validateContentScriptMessage(42).kind).toBe("passthrough")
	})

	it("passes through messages without a content-script origin", () => {
		expect(validateContentScriptMessage({}).kind).toBe("passthrough")
		expect(validateContentScriptMessage({ origin: "background", type: "X" }).kind).toBe("passthrough")
		// ServiceClient response shape uses `from`/`to`/`type` (no `origin`).
		expect(validateContentScriptMessage({ from: "svc", to: "uid", type: "Response", content: {} }).kind).toBe("passthrough")
		// Offscreen ping shape — no origin.
		expect(validateContentScriptMessage({ pong: true }).kind).toBe("passthrough")
	})

	it("validates a well-formed discovery-request envelope", () => {
		const result = validateContentScriptMessage({
			origin: "content-script",
			type: "discovery-request",
			content: { type: "discovery", requestId: "abc", appId: "test", chainInfo: {} },
		})
		expect(result.kind).toBe("valid")
		if (result.kind === "valid") {
			expect(result.message.type).toBe("discovery-request")
		}
	})

	it("validates a well-formed key-exchange-request with sessionId", () => {
		const result = validateContentScriptMessage({
			origin: "content-script",
			type: "key-exchange-request",
			sessionId: "sess-123",
			content: { type: "key-exchange-request", requestId: "abc", publicKey: {} },
		})
		expect(result.kind).toBe("valid")
		if (result.kind === "valid") {
			expect(result.message.sessionId).toBe("sess-123")
		}
	})

	it("validates a secure-message envelope (encrypted payload as opaque content)", () => {
		const result = validateContentScriptMessage({
			origin: "content-script",
			type: "secure-message",
			sessionId: "sess-1",
			content: { iv: "...", ciphertext: "..." },
		})
		expect(result.kind).toBe("valid")
	})

	it("validates a disconnect-request envelope", () => {
		const result = validateContentScriptMessage({
			origin: "content-script",
			type: "disconnect-request",
			sessionId: "sess-1",
		})
		expect(result.kind).toBe("valid")
	})

	it("rejects content-script envelope with unknown type", () => {
		const result = validateContentScriptMessage({
			origin: "content-script",
			type: "evil-payload-type",
			content: {},
		})
		expect(result.kind).toBe("invalid")
		if (result.kind === "invalid") {
			expect(result.reason).toMatch(/schema check/)
		}
	})

	it("rejects content-script envelope missing required `type` field", () => {
		const result = validateContentScriptMessage({
			origin: "content-script",
			content: {},
		})
		expect(result.kind).toBe("invalid")
	})

	it("rejects content-script envelope with non-string sessionId", () => {
		const result = validateContentScriptMessage({
			origin: "content-script",
			type: "secure-message",
			sessionId: 12345, // attacker tries to inject a non-string
			content: {},
		})
		expect(result.kind).toBe("invalid")
	})

	it("rejects an envelope with a background-to-content-script type from a content-script origin", () => {
		// Adversarial: an attacker page (or compromised content script)
		// tries to send a "discovery-approved" message to confuse the SW
		// into approving its own discovery. Schema rejects since
		// "discovery-approved" is NOT in the content-script→background
		// type set.
		const result = validateContentScriptMessage({
			origin: "content-script",
			type: "discovery-approved",
			sessionId: "fake",
			content: {},
		})
		expect(result.kind).toBe("invalid")
	})
})
