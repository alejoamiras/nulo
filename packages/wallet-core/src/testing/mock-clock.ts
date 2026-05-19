/**
 * ClockPort implementation for tests. Time is virtual — `advance(ms)` runs
 * timers whose deadlines fall within the advance window. No wall-clock
 * waiting, no coupling to `vi.useFakeTimers()`.
 *
 * Usage:
 *   const clock = new MockClock()
 *   const svc = new SomeService(clock, ...)
 *   clock.advance(1000)            // fire all timers due in next 1s
 *   expect(...).toBe(...)
 *
 * The API mirrors ClockPort plus a small test-only surface (`advance`,
 * `setNow`, `pendingCount`).
 */

import type { ClockPort, TimerHandle } from "../ports"

interface ScheduledTimer {
	id: number
	due: number
	fn: () => void
	intervalMs?: number
}

export class MockClock implements ClockPort {
	private virtualNow: number
	private nextId = 1
	private readonly timers = new Map<number, ScheduledTimer>()

	public constructor(initialNow = 0) {
		this.virtualNow = initialNow
	}

	public now(): number {
		return this.virtualNow
	}

	public sleep(ms: number): Promise<void> {
		return new Promise((resolve) => {
			this.setTimeout(resolve, ms)
		})
	}

	public setTimeout(fn: () => void, ms: number): TimerHandle {
		const id = this.nextId++
		this.timers.set(id, { id, due: this.virtualNow + ms, fn })
		return id
	}

	public clearTimeout(handle: TimerHandle): void {
		this.timers.delete(handle as number)
	}

	public setInterval(fn: () => void, ms: number): TimerHandle {
		const id = this.nextId++
		this.timers.set(id, { id, due: this.virtualNow + ms, fn, intervalMs: ms })
		return id
	}

	public clearInterval(handle: TimerHandle): void {
		this.timers.delete(handle as number)
	}

	/** Test-only: advance virtual time by `ms`, firing timers due in the window. */
	public advance(ms: number): void {
		const target = this.virtualNow + ms

		// Loop because timers may schedule new timers when they fire.
		while (true) {
			const dueNext = [...this.timers.values()].filter((t) => t.due <= target).sort((a, b) => a.due - b.due)
			if (!dueNext.length) break

			const timer = dueNext[0]
			this.virtualNow = timer.due
			if (timer.intervalMs !== undefined) {
				// Intervals: reschedule for next tick before firing.
				timer.due = timer.due + timer.intervalMs
			} else {
				this.timers.delete(timer.id)
			}
			timer.fn()
		}

		this.virtualNow = target
	}

	/** Test-only: jump `now` without firing timers. Useful for seeding time. */
	public setNow(ms: number): void {
		this.virtualNow = ms
	}

	/** Test-only: number of scheduled timers still pending. */
	public get pendingCount(): number {
		return this.timers.size
	}
}
