import { describe, expect, test } from "vitest"
import { describeExternalId } from "./external-id"

/**
 * Substituting these ids for dApp origins in log lines only closes the leak if the ids themselves
 * are trustworthy — and they are not: the page supplies `requestId`, upstream reuses it verbatim as
 * `sessionId`, and the content-script validator accepts `sessionId: z.string().optional()` with no
 * shape constraint.
 */

describe("describeExternalId", () => {
	test("echoes an id with the shape the protocol generates", () => {
		const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
		expect(describeExternalId(uuid)).toBe(uuid)
	})

	test("does NOT echo a forged id carrying the page's URL", () => {
		// The exact substitution attack: a hostile dApp puts its origin where a correlation id
		// belongs, and every log line that switched from origin to id hands it back.
		const forged = "https://malicious.example.com/wallet-drainer?victim=alice"

		expect(describeExternalId(forged)).toBe(`[malformed-id:${forged.length}]`)
		expect(describeExternalId(forged)).not.toContain("malicious.example.com")
	})

	test("does not echo arbitrary text", () => {
		expect(describeExternalId("correct-horse-battery-staple")).toBe("[malformed-id:28]")
	})

	test("reports the type for a non-string", () => {
		expect(describeExternalId(undefined)).toBe("[undefined]")
		expect(describeExternalId(42)).toBe("[number]")
		expect(describeExternalId(null)).toBe("[object]")
	})

	test("keeps a length so absent and malformed stay distinguishable", () => {
		expect(describeExternalId("")).toBe("[malformed-id:0]")
	})
})
