import { beforeEach, describe, expect, test } from "vitest"
import { isSupersededByAdopt, OFFSCREEN_ADOPT_INSTANCE } from "./offscreen"

const sw = { id: "nulo-ext-id" } as chrome.runtime.MessageSender
const tabSender = { id: "nulo-ext-id", tab: { id: 1 } } as unknown as chrome.runtime.MessageSender
const foreign = { id: "other-ext" } as chrome.runtime.MessageSender
const adopt = (token: string) => ({ type: OFFSCREEN_ADOPT_INSTANCE, token })

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: ensure chrome.runtime.id without clobbering the shared stub
	const c = ((globalThis as any).chrome ??= {})
	c.runtime = { ...c.runtime, id: "nulo-ext-id" }
})

describe("isSupersededByAdopt (F-10 stale-offscreen self-close)", () => {
	test("two stale windows are superseded by a fresh instance; the fresh one is not", () => {
		// SW's current instance token is "fresh"; two stale windows hold old tokens.
		expect(isSupersededByAdopt(adopt("fresh"), sw, "stale-1")).toBe(true)
		expect(isSupersededByAdopt(adopt("fresh"), sw, "stale-2")).toBe(true)
		expect(isSupersededByAdopt(adopt("fresh"), sw, "fresh")).toBe(false) // matching token → stays
	})

	test("Chrome (no instance token) is never superseded", () => {
		expect(isSupersededByAdopt(adopt("fresh"), sw, null)).toBe(false)
	})

	test("ignores an ADOPT from a tab-bound or foreign sender (spoof defense)", () => {
		expect(isSupersededByAdopt(adopt("fresh"), tabSender, "stale")).toBe(false)
		expect(isSupersededByAdopt(adopt("fresh"), foreign, "stale")).toBe(false)
		expect(isSupersededByAdopt(adopt("fresh"), undefined, "stale")).toBe(false)
	})

	test("ignores non-ADOPT messages", () => {
		expect(isSupersededByAdopt("OFFSCREEN_PING", sw, "stale")).toBe(false)
		expect(isSupersededByAdopt({ type: "SOMETHING_ELSE", token: "x" }, sw, "stale")).toBe(false)
		expect(isSupersededByAdopt(null, sw, "stale")).toBe(false)
	})
})
