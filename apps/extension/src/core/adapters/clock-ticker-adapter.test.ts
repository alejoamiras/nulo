import { describe, test, expect, vi } from "vitest"
import type { ClockPort, TimerHandle } from "@nulo/wallet-core/ports"
import { ClockTickerAdapter } from "./clock-ticker-adapter"

/** Minimal ClockPort stub: `setInterval` captures the fn + ms and
 *  returns a handle; tests call `fire()` to drive ticks manually. */
function makeManualClock() {
	type Scheduled = { fn: () => void; ms: number; cancelled: boolean }
	const scheduled: Scheduled[] = []
	const clock = {
		now: () => 0,
		sleep: () => Promise.resolve(),
		setTimeout: (fn: () => void, _ms: number) => fn,
		clearTimeout: () => {},
		setInterval: ((fn: () => void, ms: number) => {
			const s: Scheduled = { fn, ms, cancelled: false }
			scheduled.push(s)
			return s as unknown as TimerHandle
		}) as ClockPort["setInterval"],
		clearInterval: ((handle: TimerHandle) => {
			;(handle as unknown as Scheduled).cancelled = true
		}) as ClockPort["clearInterval"],
	} as unknown as ClockPort
	return {
		clock,
		fire: async () => {
			for (const s of scheduled) {
				if (!s.cancelled) s.fn()
			}
			// Yield so the fn's microtasks run.
			await new Promise((r) => setTimeout(r, 0))
		},
		scheduled,
	}
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe("ClockTickerAdapter", () => {
	test("calls onTick on each interval fire", async () => {
		const { clock, fire } = makeManualClock()
		const ticker = new ClockTickerAdapter(clock)
		const onTick = vi.fn().mockResolvedValue(undefined)
		ticker.subscribe(1000, onTick)

		await fire()
		await fire()
		expect(onTick).toHaveBeenCalledTimes(2)
	})

	test("serializes concurrent ticks: while one is running, a second fire is coalesced", async () => {
		const { clock, fire } = makeManualClock()
		const ticker = new ClockTickerAdapter(clock)

		let resolveFirst!: () => void
		const firstRunning = new Promise<void>((r) => {
			resolveFirst = r
		})
		let firstReleased = false
		const onTick = vi.fn(async () => {
			if (!firstReleased) {
				firstReleased = true
				await firstRunning
			}
		})

		ticker.subscribe(1000, onTick)

		// Fire tick 1 — it awaits.
		await fire()
		expect(onTick).toHaveBeenCalledTimes(1)

		// Fires 2 + 3 while #1 is still running — both coalesce into one pending slot.
		await fire()
		await fire()
		expect(onTick).toHaveBeenCalledTimes(1) // still only the in-flight one

		// Release #1; exactly ONE coalesced follow-up fires.
		resolveFirst()
		await flush()
		await flush()
		expect(onTick).toHaveBeenCalledTimes(2)
	})

	test("error in onTick is swallowed; future ticks still fire", async () => {
		const { clock, fire } = makeManualClock()
		const ticker = new ClockTickerAdapter(clock)

		const onTick = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined)
		ticker.subscribe(1000, onTick)

		await fire()
		await flush()
		await fire()
		expect(onTick).toHaveBeenCalledTimes(2)
	})

	test("cancel prevents future tick delivery (idempotent)", async () => {
		const { clock, fire, scheduled } = makeManualClock()
		const ticker = new ClockTickerAdapter(clock)

		const onTick = vi.fn().mockResolvedValue(undefined)
		const handle = ticker.subscribe(1000, onTick)

		await fire()
		expect(onTick).toHaveBeenCalledTimes(1)

		handle.cancel()
		expect(scheduled[0]!.cancelled).toBe(true)

		// Manually re-firing simulates a lingering handler — the cancel flag
		// gates delivery even if the underlying interval somehow still fires.
		scheduled[0]!.fn()
		await flush()
		expect(onTick).toHaveBeenCalledTimes(1)

		// Cancel twice — no throw.
		expect(() => handle.cancel()).not.toThrow()
	})

	test("cancel during an in-flight tick drops the coalesced pending tick", async () => {
		const { clock, fire } = makeManualClock()
		const ticker = new ClockTickerAdapter(clock)

		let resolveFirst!: () => void
		const firstRunning = new Promise<void>((r) => {
			resolveFirst = r
		})
		let firstReleased = false
		const onTick = vi.fn(async () => {
			if (!firstReleased) {
				firstReleased = true
				await firstRunning
			}
		})

		const handle = ticker.subscribe(1000, onTick)
		await fire()
		await fire() // coalesced pending

		handle.cancel()
		resolveFirst()
		await flush()
		await flush()

		// First tick ran; the coalesced pending one was dropped.
		expect(onTick).toHaveBeenCalledTimes(1)
	})
})
