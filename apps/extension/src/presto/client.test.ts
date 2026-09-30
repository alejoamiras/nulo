import { PrestoClient } from "@alejoamiras/presto-core"
import { beforeEach, describe, expect, test, vi } from "vitest"

type ClientModule = typeof import("./client")
let first: ClientModule
let second: ClientModule

// Loading is not the behaviour under test, so it runs in the hook, not on a test's own budget.
beforeEach(async () => {
	vi.resetModules()
	first = await import("./client")
	vi.resetModules()
	second = await import("./client")
})

describe("getPrestoClient", () => {
	test("returns one PrestoClient per module instance", () => {
		const client = first.getPrestoClient()
		expect(client).toBeInstanceOf(PrestoClient)
		expect(first.getPrestoClient()).toBe(client)
	})

	test("a fresh module instance (a new page context) gets its own client", () => {
		expect(second.getPrestoClient()).not.toBe(first.getPrestoClient())
	})
})
