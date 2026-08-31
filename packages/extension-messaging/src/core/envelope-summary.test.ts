import { describe, expect, test } from "vitest"
import { describeUnregisteredName, summarizeContent, summarizeMessage } from "./envelope-summary"
import { wrapParams } from "../utils"

/**
 * These assert ABSENCE, not shape. The envelopes described here reach `logWarn` on the
 * malformed-request and unmatched-response paths — both above the level filter — so a value that
 * survives summarisation lands in the log store verbatim.
 *
 * Params are built with the real `wrapParams` rather than a raw array: the wire shape is
 * `{ n, 0, 1, … }`, and a test using an array would exercise a branch production never hits.
 */

const SECRET = "correct-horse-battery-staple-abandon-abandon-ability"
const KNOWN = new Set(["unlockProfile", "importMnemonic", "exportMnemonic"])
const vouch = (name: string) => KNOWN.has(name)

describe("summarizeContent", () => {
	test("drops request params — the unlockProfile shape", () => {
		const summary = summarizeContent({ requestId: 7, method: "unlockProfile", params: wrapParams(["profile-1", SECRET]) }, vouch)

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(summary).toEqual({ requestId: 7, method: "unlockProfile", paramCount: 2 })
	})

	test("reads arity from the WRAPPED shape, not a mythical array", () => {
		const summary = summarizeContent({ requestId: 1, method: "importMnemonic", params: wrapParams(["n", [SECRET], "pw"]) }, vouch)

		expect(summary.paramCount).toBe(3)
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

	test("does NOT echo an unregistered method — it is attacker-chosen on this path", () => {
		// The whole point: these lines fire on MALFORMED input, so a hostile sender can put a
		// password in the method slot and have it logged as though it were a name.
		const summary = summarizeContent({ requestId: 2, method: SECRET }, vouch)

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(summary.method).toBe(`[unregistered:${SECRET.length}]`)
	})

	test("does not echo any method when no vouch is supplied", () => {
		const summary = summarizeContent({ requestId: 2, method: "unlockProfile" })

		expect(summary.method).toBe("[unregistered:13]")
	})

	test("keeps nothing from an unknown field added to the envelope later", () => {
		const summary = summarizeContent({ requestId: 2, method: "unlockProfile", freshlyAddedSecret: SECRET }, vouch)

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(summary).not.toHaveProperty("freshlyAddedSecret")
	})

	test("survives hostile shapes without throwing", () => {
		expect(() => summarizeContent(null)).not.toThrow()
		expect(() => summarizeContent("nope")).not.toThrow()
		expect(summarizeContent({ requestId: "not-a-number", params: "not-an-object" })).toEqual({
			requestId: "[string]",
			paramCount: "[string]",
		})
	})

	test("a throwing getter cannot take down the transport", () => {
		// This runs immediately before the handler sends a clean error response — a throw here
		// would strand the caller waiting for a reply that never comes.
		const hostile = Object.defineProperty({ requestId: 1 }, "method", {
			get() {
				throw new Error("boom")
			},
			enumerable: true,
		})

		expect(() => summarizeContent(hostile, vouch)).not.toThrow()
		expect(summarizeContent(hostile, vouch)).toEqual({ summaryFailed: true })
	})
})

describe("describeUnregisteredName", () => {
	// Used where the caller has ALREADY concluded the name is unknown — the forged-event path,
	// which logs at Warn and so lands in the store for every user.
	test("never echoes the value", () => {
		expect(describeUnregisteredName(SECRET)).toBe(`[unregistered:${SECRET.length}]`)
		expect(describeUnregisteredName(SECRET)).not.toContain("horse")
	})

	test("reports the type for a non-string", () => {
		expect(describeUnregisteredName(42)).toBe("[number]")
		expect(describeUnregisteredName(undefined)).toBe("[undefined]")
	})
})

describe("summarizeMessage", () => {
	test("drops params nested inside a wire message", () => {
		const summary = summarizeMessage(
			{ type: 0, from: "popup", content: { requestId: 4, method: "importMnemonic", params: wrapParams(["n", [SECRET], "pw"]) } },
			vouch,
		)

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(summary).toEqual({
			type: 0,
			from: "[unregistered:5]",
			content: { requestId: 4, method: "importMnemonic", paramCount: 3 },
		})
	})

	test("does not carry an event payload", () => {
		const summary = summarizeMessage({ type: 1, content: { event: "balanceUpdated", payload: { balance: SECRET } } })

		expect(JSON.stringify(summary)).not.toContain(SECRET)
		expect(summary.content).toEqual({ event: "[unregistered:14]", hasPayload: true })
	})

	test("survives a non-object message", () => {
		expect(summarizeMessage(undefined)).toEqual({ messageShape: "undefined" })
		expect(summarizeMessage(null)).toEqual({ messageShape: "null" })
	})
})
