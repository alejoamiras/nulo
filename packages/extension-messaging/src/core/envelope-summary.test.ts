import { describe, expect, test } from "vitest"
import { summarizeContent, summarizeMessage } from "./envelope-summary"

/**
 * These assert ABSENCE, not shape. The envelopes described here reach `logWarn` on the
 * malformed-request and unmatched-response paths — both above the level filter — so a value that
 * survives summarisation lands in the log store verbatim.
 */

const SECRET = "correct-horse-battery-staple-abandon-abandon-ability"

describe("summarizeContent", () => {
	test("drops request params — the unlockProfile/importMnemonic shape", () => {
		const summary = summarizeContent({ requestId: 7, method: "unlockProfile", params: ["profile-1", SECRET] })

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(summary).toEqual({ requestId: 7, method: "unlockProfile", paramCount: 2 })
	})

	test("drops response results — the exportMnemonic shape on a raced reply", () => {
		const summary = summarizeContent({ requestId: 9, result: { mnemonic: SECRET.split(" ") } })

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(summary).toEqual({ requestId: 9, hasResult: true })
	})

	test("reports error presence without the error's contents", () => {
		const summary = summarizeContent({ requestId: 1, error: `failed for ${SECRET}`, errorPayload: { detail: SECRET } })

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(summary).toMatchObject({ hasError: true, hasErrorPayload: true })
	})

	test("keeps nothing from an unknown field added to the envelope later", () => {
		// The allowlist is rebuild-from-known-good, so a new field is invisible by construction.
		const summary = summarizeContent({ requestId: 2, method: "m", freshlyAddedSecret: SECRET })

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(summary).not.toHaveProperty("freshlyAddedSecret")
	})

	test("bounds a hostile method name instead of echoing it whole", () => {
		const summary = summarizeContent({ requestId: 3, method: "x".repeat(5000) })

		expect((summary.method as string).length).toBeLessThanOrEqual(80)
	})

	test("survives hostile shapes without throwing", () => {
		expect(() => summarizeContent(null)).not.toThrow()
		expect(() => summarizeContent("nope")).not.toThrow()
		expect(summarizeContent({ requestId: "not-a-number", params: "not-an-array" })).toEqual({
			requestId: "[string]",
			paramCount: "[string]",
		})
	})
})

describe("summarizeMessage", () => {
	test("drops params nested inside a wire message", () => {
		const summary = summarizeMessage({
			type: 0,
			from: "popup",
			content: { requestId: 4, method: "importMnemonic", params: ["name", SECRET.split(" "), "hunter2"] },
		})

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(JSON.stringify(summary)).not.toContain("hunter2")
		expect(summary).toEqual({ type: 0, from: "popup", content: { requestId: 4, method: "importMnemonic", paramCount: 3 } })
	})

	test("does not carry an event payload", () => {
		const summary = summarizeMessage({ type: 1, content: { event: "balanceUpdated", payload: { balance: SECRET } } })

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(summary).toEqual({ type: 1, content: { event: "balanceUpdated", hasPayload: true } })
	})

	test("survives a non-object message", () => {
		expect(summarizeMessage(undefined)).toEqual({ messageShape: "undefined" })
		expect(summarizeMessage(null)).toEqual({ messageShape: "null" })
	})
})
