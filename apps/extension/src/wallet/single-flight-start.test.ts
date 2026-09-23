/**
 * Unit pins for `createSingleFlightStart` — including the post-registration
 * latch case the runtime-level pins can't reach without booting the real
 * service graph.
 */

import { describe, expect, test, vi } from "vitest"
import { createSingleFlightStart } from "./single-flight-start"

const tick = () => new Promise((r) => setTimeout(r, 5))

describe("createSingleFlightStart", () => {
	test("concurrent callers share ONE in-flight doStart", async () => {
		let release!: () => void
		const doStart = vi.fn(() => new Promise<void>((r) => (release = r)))
		const start = createSingleFlightStart(doStart, () => true)

		const p1 = start()
		const p2 = start()
		expect(doStart).toHaveBeenCalledTimes(1)

		let p2Settled = false
		void p2.then(() => (p2Settled = true))
		await tick()
		expect(p2Settled).toBe(false)

		release()
		await Promise.all([p1, p2])
		expect(p2Settled).toBe(true)
	})

	test("a successful boot is memoized — later calls never re-run doStart", async () => {
		const doStart = vi.fn(async () => {})
		const start = createSingleFlightStart(doStart, () => true)
		await start()
		await start()
		expect(doStart).toHaveBeenCalledTimes(1)
	})

	test("a failed boot resets the memo when retry is allowed — next call re-attempts", async () => {
		const doStart = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined)
		const start = createSingleFlightStart(doStart, () => true)
		await expect(start()).rejects.toThrow("boom")
		await expect(start()).resolves.toBeUndefined()
		expect(doStart).toHaveBeenCalledTimes(2)
	})

	test("a failed boot KEEPS the rejected memo when retry is vetoed — later calls observe the same rejection, doStart runs once", async () => {
		const doStart = vi.fn().mockRejectedValue(new Error("post-registration failure"))
		const start = createSingleFlightStart(doStart, () => false)
		await expect(start()).rejects.toThrow("post-registration failure")
		await expect(start()).rejects.toThrow("post-registration failure")
		expect(doStart).toHaveBeenCalledTimes(1)
	})

	test("every concurrent waiter of a failed boot observes the rejection", async () => {
		let reject!: (e: Error) => void
		const doStart = () => new Promise<void>((_r, rj) => (reject = rj))
		const start = createSingleFlightStart(doStart, () => true)
		const p1 = start()
		const p2 = start()
		reject(new Error("shared failure"))
		await expect(p1).rejects.toThrow("shared failure")
		await expect(p2).rejects.toThrow("shared failure")
	})
})
