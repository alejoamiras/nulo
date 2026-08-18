import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { awaitLivenessAdvance, readLiveness } from "./background-liveness"

type Listener = (changes: Record<string, { newValue?: unknown }>) => void

describe("awaitLivenessAdvance", () => {
	let store: Record<string, unknown>
	let listeners: Listener[]

	function write(value: number): void {
		store["nulo:liveness"] = value
		for (const l of [...listeners]) l({ "nulo:liveness": { newValue: value } })
	}

	beforeEach(() => {
		store = {}
		listeners = []
		vi.stubGlobal("chrome", {
			storage: {
				session: {
					get: vi.fn(async (key: string) => ({ [key]: store[key] })),
					onChanged: {
						addListener: vi.fn((l: Listener) => listeners.push(l)),
						removeListener: vi.fn((l: Listener) => {
							listeners = listeners.filter((x) => x !== l)
						}),
					},
				},
			},
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	it("readLiveness returns the stored number, 0 when absent or malformed", async () => {
		expect(await readLiveness()).toBe(0)
		store["nulo:liveness"] = 42
		expect(await readLiveness()).toBe(42)
		store["nulo:liveness"] = "junk"
		expect(await readLiveness()).toBe(0)
	})

	it("resolves on a strictly-later onChanged write", async () => {
		store["nulo:liveness"] = 100
		const p = awaitLivenessAdvance(100, 60_000)
		await Promise.resolve()
		write(101)
		await expect(p).resolves.toBe(101)
		// Cleanup: the listener is removed on resolution.
		expect(listeners).toHaveLength(0)
	})

	it("a value equal to the baseline does not resolve; a later one does", async () => {
		store["nulo:liveness"] = 100
		const p = awaitLivenessAdvance(100, 60_000)
		await Promise.resolve()
		write(100)
		let done = false
		void p.then(() => {
			done = true
		})
		await Promise.resolve()
		await Promise.resolve()
		expect(done).toBe(false)
		write(150)
		await expect(p).resolves.toBe(150)
	})

	it("closes the subscribe race: a write landing before the call resolves via the initial re-read", async () => {
		// The advance happened BEFORE anyone subscribed — only the post-subscribe
		// re-read (the poll leg's first sample) can observe it.
		store["nulo:liveness"] = 200
		await expect(awaitLivenessAdvance(150, 60_000)).resolves.toBe(200)
		expect(listeners).toHaveLength(0)
	})

	it("the poll leg resolves without any onChanged delivery", async () => {
		vi.useFakeTimers()
		store["nulo:liveness"] = 100
		const p = awaitLivenessAdvance(100, 60_000)
		// Silent onChanged (delivery quirk): only the 1s poll observes the write.
		await vi.advanceTimersByTimeAsync(10)
		store["nulo:liveness"] = 175
		await vi.advanceTimersByTimeAsync(1_100)
		await expect(p).resolves.toBe(175)
	})

	it("the ceiling rejects with the last-seen value and tears everything down", async () => {
		vi.useFakeTimers()
		store["nulo:liveness"] = 100
		const p = awaitLivenessAdvance(100, 5_000)
		const guarded = p.catch((e: Error) => e)
		await vi.advanceTimersByTimeAsync(10)
		write(100) // never strictly later
		await vi.advanceTimersByTimeAsync(5_100)
		const err = (await guarded) as Error
		expect(err.message).toContain("never advanced past 100")
		expect(err.message).toContain("last seen: 100")
		expect(listeners).toHaveLength(0)
		// No timers may survive the ceiling (the dual-observer leak pin).
		expect(vi.getTimerCount()).toBe(0)
	})
})
