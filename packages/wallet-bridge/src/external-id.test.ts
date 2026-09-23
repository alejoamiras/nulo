import { beforeEach, describe, expect, test } from "vitest"
import { describeExternalId, describeWireMethod, resetExternalIdTokensForTest } from "./external-id"

/**
 * Substituting these ids for dApp origins in log lines only closes the leak if the ids themselves
 * are trustworthy — and they are not: the page supplies `requestId`, upstream reuses it verbatim as
 * `sessionId`, and the content-script validator accepts `sessionId: z.string().optional()` with no
 * shape constraint.
 *
 * A SHAPE check was tried first and rejected: a valid v4 UUID still carries ~122 attacker-chosen
 * bits, and a secret can be spread across several requests. Nothing page-supplied is echoed at all.
 */

beforeEach(() => resetExternalIdTokensForTest())

describe("describeExternalId", () => {
	test("never echoes the id, even a well-formed one", () => {
		const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
		const out = describeExternalId(uuid)

		expect(out).not.toContain("3f2504e0")
		expect(out).toMatch(/^ext-\d+$/)
	})

	test("closes the valid-UUID covert channel", () => {
		// A shape check would have passed this straight through: it is a syntactically valid v4
		// UUID whose bits are entirely attacker-chosen.
		const smuggled = "deadbeef-cafe-4bad-8fad-facefeedc0de"

		expect(describeExternalId(smuggled)).not.toContain("deadbeef")
		expect(describeExternalId(smuggled)).not.toContain("cafe")
	})

	test("does not echo a forged id carrying the page's URL", () => {
		const forged = "https://malicious.example.com/wallet-drainer?victim=alice"

		expect(describeExternalId(forged)).not.toContain("malicious.example.com")
		expect(describeExternalId(forged)).toMatch(/^ext-\d+$/)
	})

	test("is STABLE per id, so log lines still correlate", () => {
		const a = describeExternalId("session-a")
		const b = describeExternalId("session-b")

		expect(describeExternalId("session-a")).toBe(a)
		expect(b).not.toBe(a)
	})

	test("is bounded, and the bound actually evicts", () => {
		const first = describeExternalId("victim-session")
		// Overflow the 512-entry table.
		for (let i = 0; i < 600; i++) describeExternalId(`filler-${i}`)

		// Proof the table really cleared: the same id no longer resolves to its old token.
		expect(describeExternalId("victim-session")).not.toBe(first)
	})

	test("NEVER reuses a token after an overflow", () => {
		// Rewinding the counter would let a hostile page mint enough ids to force an eviction and
		// then have its next session reuse `ext-1` — making it read as an unrelated earlier session
		// in log lines still sitting in the store's buffer.
		const seen = new Set<string>()
		for (let i = 0; i < 1500; i++) {
			const token = describeExternalId(`id-${i}`)
			expect(seen.has(token)).toBe(false)
			seen.add(token)
		}
	})

	test("reports the type for a non-string", () => {
		expect(describeExternalId(undefined)).toBe("[undefined]")
		expect(describeExternalId(42)).toBe("[number]")
		expect(describeExternalId("")).toBe("[empty-id]")
	})
})

describe("describeWireMethod", () => {
	const registry = { aztec_getChainInfo: {}, aztec_sendTx: {} }

	test("echoes a registered method — that is the diagnosis", () => {
		expect(describeWireMethod("aztec_getChainInfo", registry)).toBe("aztec_getChainInfo")
	})

	test("does NOT echo an unregistered one — the wire payload is unvalidated", () => {
		// The unsupported-method branch is trivially reachable, so this slot is attacker-chosen.
		expect(describeWireMethod("https://malicious.example.com/x", registry)).toBe("[unsupported-method]")
	})

	test("is not fooled by inherited object properties", () => {
		expect(describeWireMethod("toString", registry)).toBe("[unsupported-method]")
		expect(describeWireMethod("constructor", registry)).toBe("[unsupported-method]")
	})

	test("reports the type for a non-string", () => {
		expect(describeWireMethod(42, registry)).toBe("[number]")
	})
})
