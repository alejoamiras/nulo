import { PrestoClient } from "@alejoamiras/presto-core"
import { describe, expect, test, vi } from "vitest"

describe("getPrestoClient", () => {
	test("returns one PrestoClient per module instance", async () => {
		vi.resetModules()
		const { getPrestoClient } = await import("./client")
		const first = getPrestoClient()
		expect(first).toBeInstanceOf(PrestoClient)
		expect(getPrestoClient()).toBe(first)
	})

	test("a fresh module instance (a new page context) gets its own client", async () => {
		vi.resetModules()
		const a = (await import("./client")).getPrestoClient()
		vi.resetModules()
		const b = (await import("./client")).getPrestoClient()
		expect(b).not.toBe(a)
	})
})
