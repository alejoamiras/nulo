import { beforeEach, describe, expect, test, vi } from "vitest"

const KEY = "nulo:ui:sendFeePaymentMethods"
let backing: Record<string, unknown>
let failNextSet = false
/** Resolvers of writes held open by a test, so two operations can overlap on purpose. */
let heldSets: (() => void)[]
let holdSets = false

vi.mock("@/utils/storage", () => ({
	storageLocalGet: vi.fn(async (key: string) => (key in backing ? { [key]: structuredClone(backing[key]) } : {})),
	storageLocalSet: vi.fn(async (items: Record<string, unknown>) => {
		if (failNextSet) {
			failNextSet = false
			throw new Error("quota")
		}
		if (holdSets) await new Promise<void>((resolve) => heldSets.push(resolve))
		Object.assign(backing, structuredClone(items))
		return true
	}),
	storageLocalRemove: vi.fn(async (key: string) => {
		delete backing[key]
	}),
}))

import { clearSendSelections, mutateSendSelections, readSendSlots, withoutFpc, withSendSlot } from "./fee-send-selection"

beforeEach(() => {
	backing = {}
	failNextSet = false
	heldSets = []
	holdSets = false
})

describe("slot parsing", () => {
	test("round trip, slots independent per account and origin", () => {
		let raw: unknown
		raw = withSendSlot(raw, "0xA", "private", { type: "fj" })
		raw = withSendSlot(raw, "0xA", "public", { type: "fpc", fpc: { id: "s1" } })
		raw = withSendSlot(raw, "0xB", "private", { type: "private_fpc" })
		expect(readSendSlots(raw, "0xA")).toEqual({ private: { type: "fj" }, public: { type: "fpc", fpc: { id: "s1" } } })
		expect(readSendSlots(raw, "0xB")).toEqual({ private: { type: "private_fpc" } })
		expect(readSendSlots(raw, "0xC")).toEqual({})
	})

	test("stores the semantic key and the preview label — everything else is dropped", () => {
		const raw = withSendSlot(undefined, "0xA", "private", {
			type: "fpc",
			fpc: { id: "s1", name: "Sponsor", type: 1, address: "0xfpc" },
			title: "Sponsor",
		} as never)
		expect(raw).toEqual({ "0xA": { private: { type: "fpc", fpc: { id: "s1", name: "Sponsor" } } } })
	})

	test.each([
		["a non-string", 7],
		["an empty string", ""],
		["an oversized string", "x".repeat(65)],
	])("a label that is %s is dropped, the pick is kept", (_, name) => {
		const stored = { "0xA": { private: { type: "fpc", fpc: { id: "s1", name } } } }
		expect(readSendSlots(stored, "0xA")).toEqual({ private: { type: "fpc", fpc: { id: "s1" } } })
	})

	test.each<[string, unknown]>([
		["non-object", "nope"],
		["array", [{ private: { type: "fj" } }]],
		["number", 7],
		["null", null],
		["account entry is an array", { "0xA": [{ type: "fj" }] }],
		["unknown slot only", { "0xA": { sideways: { type: "fj" } } }],
		["missing type", { "0xA": { private: {} } }],
		["unknown type", { "0xA": { private: { type: "embedded" } } }],
		["fpc without an id", { "0xA": { private: { type: "fpc" } } }],
		["non-string fpc id", { "0xA": { private: { type: "fpc", fpc: { id: 12 } } } }],
		["empty fpc id", { "0xA": { private: { type: "fpc", fpc: { id: "" } } } }],
	])("hostile input reads as absent and never throws: %s", (_name, raw) => {
		expect(readSendSlots(raw, "0xA")).toEqual({})
		expect(() => withSendSlot(raw, "0xA", "public", { type: "fj" })).not.toThrow()
		expect(() => withoutFpc(raw, "s1")).not.toThrow()
	})

	test("a write does not carry a malformed neighbour forward", () => {
		const raw = withSendSlot({ "0xBad": 5, "0xOk": { public: { type: "fj" } } }, "0xA", "private", { type: "fj" })
		expect(raw).toEqual({ "0xOk": { public: { type: "fj" } }, "0xA": { private: { type: "fj" } } })
	})

	test("withoutFpc prunes both slots on every account and leaves the rest", () => {
		const raw = {
			"0xA": { private: { type: "fpc", fpc: { id: "s1" } }, public: { type: "fj" } },
			"0xB": { private: { type: "fpc", fpc: { id: "s1" } }, public: { type: "fpc", fpc: { id: "s1" } } },
			"0xC": { public: { type: "fpc", fpc: { id: "s2" } } },
		}
		expect(withoutFpc(raw, "s1")).toEqual({
			"0xA": { public: { type: "fj" } },
			"0xC": { public: { type: "fpc", fpc: { id: "s2" } } },
		})
	})
})

describe("the write chain", () => {
	test("overlapping writers do not lose each other's update", async () => {
		holdSets = true
		const first = mutateSendSelections((raw) => withSendSlot(raw, "0xA", "private", { type: "fj" }))
		const second = mutateSendSelections((raw) => withSendSlot(raw, "0xA", "public", { type: "private_fpc" }))
		await vi.waitFor(() => expect(heldSets).toHaveLength(1))
		heldSets.shift()?.()
		await vi.waitFor(() => expect(heldSets).toHaveLength(1))
		heldSets.shift()?.()
		await Promise.all([first, second])
		expect(backing[KEY]).toEqual({ "0xA": { private: { type: "fj" }, public: { type: "private_fpc" } } })
	})

	test("a rejected write reaches its caller and does not wedge the next one", async () => {
		failNextSet = true
		await expect(mutateSendSelections((raw) => withSendSlot(raw, "0xA", "private", { type: "fj" }))).rejects.toThrow("quota")
		await mutateSendSelections((raw) => withSendSlot(raw, "0xA", "public", { type: "fj" }))
		expect(backing[KEY]).toEqual({ "0xA": { public: { type: "fj" } } })
	})

	test("a pick queued just before a reset cannot resurrect the key", async () => {
		holdSets = true
		const pick = mutateSendSelections((raw) => withSendSlot(raw, "0xA", "private", { type: "fj" }))
		const reset = clearSendSelections()
		await vi.waitFor(() => expect(heldSets).toHaveLength(1))
		heldSets.shift()?.()
		await Promise.all([pick, reset])
		expect(KEY in backing).toBe(false)
	})
})
