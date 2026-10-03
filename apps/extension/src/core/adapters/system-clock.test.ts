import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SystemClock } from "./system-clock"

beforeEach(() => {
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
})

describe("SystemClock.sleep", () => {
	test("resolves on the global timer after exactly the requested delay, with no value", async () => {
		let settled: unknown = "pending"
		void new SystemClock().sleep(40).then((value) => {
			settled = value
		})
		await vi.advanceTimersByTimeAsync(39)
		expect(settled).toBe("pending")
		await vi.advanceTimersByTimeAsync(1)
		expect(settled).toBeUndefined()
	})
})
