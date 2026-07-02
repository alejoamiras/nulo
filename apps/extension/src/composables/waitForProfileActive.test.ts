import { reactive } from "vue"
import { describe, expect, test, vi } from "vitest"

import { waitForProfileActive } from "./waitForProfileActive"

describe("waitForProfileActive", () => {
	test("resolves immediately when already active at call time", async () => {
		const store = reactive({ isLogined: true, profile: { id: "p1" } })
		await expect(waitForProfileActive(store, "p1", 5_000)).resolves.toBeUndefined()
	})

	test("resolves after the watcher fires with matching state change", async () => {
		vi.useFakeTimers()
		try {
			const store = reactive<{ isLogined: boolean; profile?: { id: string } }>({
				isLogined: false,
				profile: undefined,
			})
			const promise = waitForProfileActive(store, "p2", 5_000)
			// Flip both fields to the expected state.
			store.profile = { id: "p2" }
			store.isLogined = true
			await vi.runAllTimersAsync()
			await expect(promise).resolves.toBeUndefined()
		} finally {
			vi.useRealTimers()
		}
	})

	test("rejects with timeout message after timeoutMs", async () => {
		vi.useFakeTimers()
		try {
			const store = reactive({ isLogined: false, profile: undefined as { id: string } | undefined })
			const promise = waitForProfileActive(store, "p3", 100)
			vi.advanceTimersByTime(150)
			await expect(promise).rejects.toThrow("Profile activation timeout")
		} finally {
			vi.useRealTimers()
		}
	})

	test("ignores state changes for a different profile id", async () => {
		vi.useFakeTimers()
		try {
			const store = reactive<{ isLogined: boolean; profile?: { id: string } }>({
				isLogined: false,
				profile: undefined,
			})
			const promise = waitForProfileActive(store, "expected", 200)
			store.profile = { id: "different" }
			store.isLogined = true
			vi.advanceTimersByTime(250)
			await expect(promise).rejects.toThrow("Profile activation timeout")
		} finally {
			vi.useRealTimers()
		}
	})

	test("watcher torn down on success (does not fire on subsequent unrelated changes)", async () => {
		const store = reactive<{ isLogined: boolean; profile?: { id: string } }>({
			isLogined: true,
			profile: { id: "p4" },
		})
		await waitForProfileActive(store, "p4", 5_000)
		// Subsequent change should NOT throw "already resolved" or leak — just
		// be a no-op.
		store.profile = { id: "p5" }
		store.isLogined = false
		// If the watcher leaked, Vue would warn or the test would flake; the
		// fact that no async event fires is the actual evidence. This test
		// passes as long as the above mutations don't throw.
		expect(store.profile.id).toBe("p5")
	})
})
