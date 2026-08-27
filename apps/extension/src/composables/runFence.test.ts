import { describe, expect, test } from "vitest"
import { createRunFence } from "./runFence"

describe("createRunFence", () => {
	test("a lone run is current", () => {
		const fence = createRunFence()
		const isCurrent = fence.begin()
		expect(isCurrent()).toBe(true)
	})

	test("a second begin() invalidates the first run", () => {
		const fence = createRunFence()
		const first = fence.begin()
		const second = fence.begin()
		expect(first()).toBe(false)
		expect(second()).toBe(true)
	})

	test("invalidation is permanent — a superseded closure never turns true again", () => {
		const fence = createRunFence()
		const first = fence.begin()
		fence.begin()
		fence.begin()
		expect(first()).toBe(false)
		fence.begin()
		expect(first()).toBe(false)
	})

	test("only the LATEST run is current across many begins", () => {
		const fence = createRunFence()
		const closures = Array.from({ length: 5 }, () => fence.begin())
		expect(closures.map((c) => c())).toEqual([false, false, false, false, true])
	})

	test("closures are independent snapshots (calling one does not affect another)", () => {
		const fence = createRunFence()
		const a = fence.begin()
		const b = fence.begin()
		expect(b()).toBe(true)
		expect(a()).toBe(false)
		expect(b()).toBe(true) // unchanged by a's checks
	})

	test("two fences do not interfere", () => {
		const f1 = createRunFence()
		const f2 = createRunFence()
		const r1 = f1.begin()
		f2.begin()
		f2.begin()
		expect(r1()).toBe(true) // f2's begins are invisible to f1
	})

	test("a run can check its currency repeatedly (idempotent reads)", () => {
		const fence = createRunFence()
		const isCurrent = fence.begin()
		expect(isCurrent()).toBe(true)
		expect(isCurrent()).toBe(true)
		expect(isCurrent()).toBe(true)
	})

	test("ABA: begin → begin → the FIRST closure stays false even after more begins", () => {
		const fence = createRunFence()
		const a = fence.begin()
		fence.begin() // B
		const a2 = fence.begin() // "back to A" — but it is a NEW run
		expect(a()).toBe(false) // the original A run is dead forever
		expect(a2()).toBe(true)
	})

	test("interleaved async runs: the parked older run observes its invalidation on resume", async () => {
		const fence = createRunFence()
		const older = fence.begin()
		let observed: boolean | undefined
		const parked = (async () => {
			await new Promise((r) => setTimeout(r, 10))
			observed = older()
		})()
		fence.begin() // supersede while parked
		await parked
		expect(observed).toBe(false)
	})

	test("high-volume begins stay consistent (no counter wrap concerns at realistic scale)", () => {
		const fence = createRunFence()
		let last = fence.begin()
		for (let i = 0; i < 10_000; i++) last = fence.begin()
		expect(last()).toBe(true)
	})
})
