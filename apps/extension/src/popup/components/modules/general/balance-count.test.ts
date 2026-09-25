import { describe, expect, test } from "vitest"
import { COUNT_MS, COUNT_WINDOW_MS, createBalanceCount } from "./balance-count"

const MINUTE = 60_000

function harness() {
	let t = 0
	let nextId = 1
	const frames = new Map<number, () => void>()
	const shown: (bigint | null)[] = []
	const count = createBalanceCount({
		now: () => t,
		frame: (step) => {
			const id = nextId++
			frames.set(id, step)
			return id
		},
		cancelFrame: (id) => {
			frames.delete(id)
		},
		show: (micro) => {
			shown.push(micro)
		},
	})
	const advance = (ms: number) => {
		t += ms
	}
	/** Runs pending frames 16 ms apart for `ms`. */
	const run = (ms: number) => {
		const end = t + ms
		while (frames.size > 0 && t < end) {
			t += 16
			const [id, step] = [...frames][0]
			frames.delete(id)
			step()
		}
	}
	return { count, advance, run, shown, frames, last: () => shown.at(-1) }
}

const isRising = (values: (bigint | null)[]) =>
	values.every((v, i) => i === 0 || (v !== null && values[i - 1] !== null && v >= (values[i - 1] as bigint)))

describe("createBalanceCount", () => {
	test("a rise 3 s after an arrival counts from the value shown a minute before, rising, then hands back the aggregate", () => {
		const h = harness()
		h.count.observe(100n)
		h.advance(MINUTE)
		h.count.arrive(false)
		h.advance(3_000)
		h.count.observe(250n)
		expect(h.shown).toEqual([100n])
		h.run(COUNT_MS / 2)
		const mid = h.last() as bigint
		expect(mid > 100n && mid < 250n).toBe(true)
		h.run(COUNT_MS)
		expect(h.last()).toBeNull()
		expect(h.frames.size).toBe(0)
		expect(isRising(h.shown.slice(0, -1))).toBe(true)
		expect((h.shown.slice(0, -1) as bigint[]).every((v) => v >= 100n && v <= 250n)).toBe(true)
	})

	test("a rise 3 s before the arrival counts once the arrival lands", () => {
		const h = harness()
		h.count.observe(100n)
		h.advance(MINUTE)
		h.count.observe(250n)
		expect(h.shown).toEqual([])
		h.advance(3_000)
		h.count.arrive(false)
		expect(h.shown).toEqual([100n])
		expect(h.frames.size).toBe(1)
	})

	test("a rise 11 s after, or 11 s before, the arrival does not count", () => {
		const after = harness()
		after.count.observe(100n)
		after.count.arrive(false)
		after.advance(COUNT_WINDOW_MS + 1_000)
		after.count.observe(250n)
		expect(after.shown).toEqual([])

		const before = harness()
		before.count.observe(100n)
		before.advance(MINUTE)
		before.count.observe(250n)
		before.advance(COUNT_WINDOW_MS + 1_000)
		before.count.arrive(false)
		expect(before.shown).toEqual([])
		expect(before.frames.size).toBe(0)
	})

	test("a second arrival mid-count retargets from the value on screen, with one frame pending", () => {
		const h = harness()
		h.count.observe(100n)
		h.count.arrive(false)
		h.count.observe(200n)
		h.run(COUNT_MS / 3)
		const onScreen = h.last() as bigint
		expect(onScreen > 100n && onScreen < 200n).toBe(true)
		h.count.arrive(false)
		expect(h.last()).toBe(onScreen)
		h.count.observe(400n)
		expect(h.last()).toBe(onScreen)
		expect(h.frames.size).toBe(1)
		h.run(COUNT_MS / 2)
		expect((h.last() as bigint) > 200n).toBe(true)
		h.run(COUNT_MS)
		expect(h.last()).toBeNull()
	})

	test("a fall stops a running count at the aggregate, and a fall never counts", () => {
		const h = harness()
		h.count.observe(100n)
		h.count.arrive(false)
		h.count.observe(200n)
		h.run(COUNT_MS / 3)
		h.count.observe(150n)
		expect(h.last()).toBeNull()
		expect(h.frames.size).toBe(0)
		const before = h.shown.length
		h.count.arrive(false)
		h.count.observe(120n)
		expect(h.shown.length).toBe(before)
	})

	test("calm shows the final value at once with no frame", () => {
		const h = harness()
		h.count.observe(100n)
		h.count.arrive(true)
		h.count.observe(200n)
		expect(h.shown).toEqual([null])
		expect(h.frames.size).toBe(0)
	})

	test("a scope reset cancels a running count, and a rise right after counts from nothing of the old scope", () => {
		const h = harness()
		h.count.observe(100n)
		h.count.arrive(false)
		h.count.observe(200n)
		h.count.reset({ scope: true })
		expect(h.last()).toBeNull()
		expect(h.frames.size).toBe(0)
		const before = h.shown.length
		h.count.observe(500n)
		h.count.observe(600n)
		expect(h.shown.length).toBe(before)
	})

	test("a hero that stops showing a known figure forgets the value it showed", () => {
		const h = harness()
		h.count.observe(100n)
		h.count.arrive(false)
		h.count.reset()
		h.count.observe(200n)
		expect(h.frames.size).toBe(0)
	})

	test("stop cancels the pending frame and hands back the aggregate", () => {
		const h = harness()
		h.count.observe(100n)
		h.count.arrive(false)
		h.count.observe(200n)
		h.count.stop()
		expect(h.frames.size).toBe(0)
		expect(h.last()).toBeNull()
	})
})
