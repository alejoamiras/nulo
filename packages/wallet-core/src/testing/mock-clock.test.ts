import { describe, expect, test } from "vitest"
import { MockClock } from "./mock-clock"

describe("MockClock", () => {
	test("now() starts at 0 by default", () => {
		const clock = new MockClock()
		expect(clock.now()).toBe(0)
	})

	test("now() starts at initialNow when provided", () => {
		const clock = new MockClock(1000)
		expect(clock.now()).toBe(1000)
	})

	test("setTimeout fires when advance crosses the deadline", () => {
		const clock = new MockClock()
		let fired = false
		clock.setTimeout(() => {
			fired = true
		}, 500)

		expect(fired).toBe(false)
		clock.advance(499)
		expect(fired).toBe(false)
		clock.advance(1)
		expect(fired).toBe(true)
		expect(clock.now()).toBe(500)
	})

	test("clearTimeout cancels a pending timer", () => {
		const clock = new MockClock()
		let fired = false
		const handle = clock.setTimeout(() => {
			fired = true
		}, 500)
		clock.clearTimeout(handle)
		clock.advance(1000)
		expect(fired).toBe(false)
	})

	test("setInterval fires repeatedly", () => {
		const clock = new MockClock()
		let ticks = 0
		clock.setInterval(() => {
			ticks++
		}, 100)

		clock.advance(350)
		expect(ticks).toBe(3)
		clock.advance(200)
		expect(ticks).toBe(5)
	})

	test("clearInterval stops further firings", () => {
		const clock = new MockClock()
		let ticks = 0
		const handle = clock.setInterval(() => {
			ticks++
		}, 100)
		clock.advance(250)
		expect(ticks).toBe(2)
		clock.clearInterval(handle)
		clock.advance(1000)
		expect(ticks).toBe(2)
	})

	test("sleep resolves after the requested ms", async () => {
		const clock = new MockClock()
		let resolved = false
		const promise = clock.sleep(100).then(() => {
			resolved = true
		})
		clock.advance(50)
		await Promise.resolve()
		expect(resolved).toBe(false)
		clock.advance(50)
		await promise
		expect(resolved).toBe(true)
	})

	test("timers scheduled during a tick are eligible on the same advance", () => {
		const clock = new MockClock()
		let ran = false
		clock.setTimeout(() => {
			clock.setTimeout(() => {
				ran = true
			}, 50)
		}, 100)

		clock.advance(200)
		expect(ran).toBe(true)
	})

	test("pendingCount reflects live timers", () => {
		const clock = new MockClock()
		clock.setTimeout(() => {}, 100)
		clock.setTimeout(() => {}, 200)
		expect(clock.pendingCount).toBe(2)
		clock.advance(150)
		expect(clock.pendingCount).toBe(1)
	})

	test("setNow jumps time without firing timers", () => {
		const clock = new MockClock()
		let fired = false
		clock.setTimeout(() => {
			fired = true
		}, 500)
		clock.setNow(10_000)
		expect(fired).toBe(false)
		expect(clock.now()).toBe(10_000)
	})
})
