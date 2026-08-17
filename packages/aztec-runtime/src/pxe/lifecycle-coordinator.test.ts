import { describe, expect, test } from "vitest"
import { PxeLifecycleCoordinator } from "./lifecycle-coordinator"

describe("PxeLifecycleCoordinator (Q-01)", () => {
	test("current is 0 for an unseen key", () => {
		expect(new PxeLifecycleCoordinator().current("k")).toBe(0)
	})

	test("bump advances a key's epoch monotonically, independent per key", () => {
		const c = new PxeLifecycleCoordinator()
		c.bump("a")
		c.bump("a")
		c.bump("b")
		expect(c.current("a")).toBe(2)
		expect(c.current("b")).toBe(1)
		expect(c.current("unseen")).toBe(0)
	})

	test("assertUnchanged passes when the epoch has not advanced since capture", () => {
		const c = new PxeLifecycleCoordinator()
		c.bump("k")
		const captured = c.current("k")
		expect(() => c.assertUnchanged("k", captured, "op")).not.toThrow()
	})

	test("assertUnchanged throws the stable 'purged mid-operation' message once the epoch advances", () => {
		const c = new PxeLifecycleCoordinator()
		const captured = c.current("k") // 0
		c.bump("k") // a concurrent purge lands
		expect(() => c.assertUnchanged("k", captured, "myLabel")).toThrow(/myLabel: chain was purged mid-operation/)
	})

	test("assertUnchanged fences a capture from BEFORE a double-bump (B-18 shape)", () => {
		const c = new PxeLifecycleCoordinator()
		const captured = c.current("k")
		c.bump("k") // opening bump
		c.bump("k") // closing bump
		expect(() => c.assertUnchanged("k", captured, "op")).toThrow(/purged mid-operation/)
	})
})
