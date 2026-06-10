import { beforeEach, describe, expect, it } from "vitest"
import type { BridgePhase } from "./bridge-steps"
import { __resetPhaseClockForTests, dropPhaseClock, formatElapsed, trackPhases } from "./phase-clock"

const phase = (key: BridgePhase["key"], state: BridgePhase["state"]): BridgePhase => ({ key, label: key.toUpperCase(), state })

describe("phase-clock (the labor-illusion timekeeper)", () => {
	beforeEach(() => __resetPhaseClockForTests())

	it("stamps active→done transitions and reports elapsedMs", () => {
		trackPhases("r1", [phase("deposit", "active"), phase("sync", "pending")], 1_000)
		const out = trackPhases("r1", [phase("deposit", "done"), phase("sync", "active")], 15_000)
		expect(out[0].elapsedMs).toBe(14_000)
		expect(out[1].startedAt).toBe(15_000)
	})

	it("phases already done at first sight (reload) get NO duration - honest degradation", () => {
		const out = trackPhases("r2", [phase("deposit", "done"), phase("sync", "active")], 5_000)
		expect(out[0].elapsedMs).toBeUndefined()
		expect(out[0].startedAt).toBeUndefined()
	})

	it("skipped phases stamp like done; repeat calls never restamp", () => {
		trackPhases("r3", [phase("approve", "active")], 1_000)
		const a = trackPhases("r3", [phase("approve", "skipped")], 3_000)
		const b = trackPhases("r3", [phase("approve", "skipped")], 9_000)
		expect(a[0].elapsedMs).toBe(2_000)
		expect(b[0].elapsedMs).toBe(2_000)
	})

	it("dropPhaseClock forgets a record (discard path)", () => {
		trackPhases("r4", [phase("exit", "active")], 1_000)
		dropPhaseClock("r4")
		const out = trackPhases("r4", [phase("exit", "done")], 9_000)
		expect(out[0].elapsedMs).toBeUndefined()
	})

	it("formatElapsed: seconds, minutes, hours", () => {
		expect(formatElapsed(14_000)).toBe("14s")
		expect(formatElapsed(125_000)).toBe("2m 05s")
		expect(formatElapsed(4_320_000)).toBe("1h 12m")
	})
})
