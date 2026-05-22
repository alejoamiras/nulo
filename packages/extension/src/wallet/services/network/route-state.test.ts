import { describe, expect, test } from "vitest"
import {
	clearCooldowns,
	COOLDOWN_MS,
	HARD_THRESHOLD,
	isAvailable,
	markCooldown,
	newRouteState,
	pickFailoverCandidates,
	quarantineInvalidChain,
	recordFailure,
	recordSuccess,
	snapshotRouteState,
	SOFT_THRESHOLD,
	STRIKE_DECAY_MS,
} from "./route-state"

describe("network/route-state", () => {
	test("newRouteState initializes with the given active endpoint and empty maps", () => {
		const s = newRouteState("ep-1")
		expect(s.activeEndpointId).toBe("ep-1")
		expect(s.failures.size).toBe(0)
		expect(s.cooldownUntil.size).toBe(0)
		expect(s.invalidChain.size).toBe(0)
		expect(s.exhaustedAt).toBeUndefined()
	})

	test("recordSuccess clears the endpoint's counters, cooldown, and the global exhausted flag", () => {
		const s = newRouteState("ep-1")
		recordFailure(s, "ep-1", "hard", 1000)
		s.cooldownUntil.set("ep-1", 99999999)
		s.exhaustedAt = 5000
		recordSuccess(s, "ep-1")
		expect(s.failures.has("ep-1")).toBe(false)
		expect(s.cooldownUntil.has("ep-1")).toBe(false)
		expect(s.exhaustedAt).toBeUndefined()
	})

	test("recordFailure increments hard counter; trips at HARD_THRESHOLD", () => {
		const s = newRouteState("ep-1")
		const first = recordFailure(s, "ep-1", "hard", 1000)
		expect(first.tripped).toBe(false)
		expect(s.failures.get("ep-1")?.hard).toBe(1)
		const second = recordFailure(s, "ep-1", "hard", 1100)
		expect(second.tripped).toBe(true)
		expect(s.failures.get("ep-1")?.hard).toBe(HARD_THRESHOLD)
	})

	test("recordFailure increments soft counter; trips at SOFT_THRESHOLD", () => {
		const s = newRouteState("ep-1")
		for (let i = 1; i < SOFT_THRESHOLD; i++) {
			const out = recordFailure(s, "ep-1", "soft", 1000 + i)
			expect(out.tripped).toBe(false)
		}
		const final = recordFailure(s, "ep-1", "soft", 9999)
		expect(final.tripped).toBe(true)
		expect(s.failures.get("ep-1")?.soft).toBe(SOFT_THRESHOLD)
	})

	test("counters decay after STRIKE_DECAY_MS of no incident — next failure resets to a fresh count of 1", () => {
		const s = newRouteState("ep-1")
		recordFailure(s, "ep-1", "hard", 1000)
		expect(s.failures.get("ep-1")?.hard).toBe(1)
		// Far enough in the future to trigger decay.
		const out = recordFailure(s, "ep-1", "hard", 1000 + STRIKE_DECAY_MS + 1)
		expect(out.tripped).toBe(false)
		expect(s.failures.get("ep-1")?.hard).toBe(1)
	})

	test("markCooldown sets the cooldown window and clears counters", () => {
		const s = newRouteState("ep-1")
		recordFailure(s, "ep-1", "hard", 1000)
		markCooldown(s, "ep-1", 5000)
		expect(s.cooldownUntil.get("ep-1")).toBe(5000 + COOLDOWN_MS)
		expect(s.failures.has("ep-1")).toBe(false)
	})

	test("isAvailable returns false during cooldown and true after it elapses", () => {
		const s = newRouteState("ep-1")
		markCooldown(s, "ep-1", 1000)
		expect(isAvailable(s, "ep-1", 2000)).toBe(false)
		expect(isAvailable(s, "ep-1", 1000 + COOLDOWN_MS + 1)).toBe(true)
	})

	test("quarantineInvalidChain marks the endpoint unavailable permanently for this state", () => {
		const s = newRouteState("ep-1")
		quarantineInvalidChain(s, "ep-2")
		expect(isAvailable(s, "ep-2", Date.now() + 9999999)).toBe(false)
		expect(s.invalidChain.has("ep-2")).toBe(true)
	})

	test("clearCooldowns wipes both maps but leaves failure counters for next-success-reset", () => {
		const s = newRouteState("ep-1")
		s.cooldownUntil.set("ep-1", 99999999)
		s.invalidChain.add("ep-2")
		s.exhaustedAt = 1234
		recordFailure(s, "ep-3", "hard", 1000)
		clearCooldowns(s)
		expect(s.cooldownUntil.size).toBe(0)
		expect(s.invalidChain.size).toBe(0)
		expect(s.exhaustedAt).toBeUndefined()
		// Failure counters survive; success would reset them.
		expect(s.failures.has("ep-3")).toBe(true)
	})

	test("pickFailoverCandidates returns endpoints after the active, wrapping once; never the active itself", () => {
		const s = newRouteState("ep-b")
		const ids = ["ep-a", "ep-b", "ep-c", "ep-d"]
		const out = pickFailoverCandidates(s, ids, Date.now())
		expect(out).toEqual(["ep-c", "ep-d", "ep-a"])
	})

	test("pickFailoverCandidates skips cooldown'd endpoints", () => {
		const s = newRouteState("ep-b")
		markCooldown(s, "ep-c", 1000)
		const out = pickFailoverCandidates(s, ["ep-a", "ep-b", "ep-c", "ep-d"], 2000)
		expect(out).toEqual(["ep-d", "ep-a"])
	})

	test("pickFailoverCandidates skips quarantined endpoints", () => {
		const s = newRouteState("ep-b")
		quarantineInvalidChain(s, "ep-a")
		const out = pickFailoverCandidates(s, ["ep-a", "ep-b", "ep-c"], Date.now())
		expect(out).toEqual(["ep-c"])
	})

	test("pickFailoverCandidates returns empty when nothing is available", () => {
		const s = newRouteState("ep-b")
		quarantineInvalidChain(s, "ep-a")
		quarantineInvalidChain(s, "ep-c")
		const out = pickFailoverCandidates(s, ["ep-a", "ep-b", "ep-c"], Date.now())
		expect(out).toEqual([])
	})

	test("pickFailoverCandidates handles missing-active gracefully (starts from index 0)", () => {
		const s = newRouteState("ep-zzz")
		const out = pickFailoverCandidates(s, ["ep-a", "ep-b", "ep-c"], Date.now())
		expect(out).toEqual(["ep-a", "ep-b", "ep-c"])
	})

	test("snapshotRouteState produces a JSON-serializable plain object", () => {
		const s = newRouteState("ep-1")
		recordFailure(s, "ep-1", "hard", 1000)
		markCooldown(s, "ep-2", 2000)
		quarantineInvalidChain(s, "ep-3")
		s.exhaustedAt = 5000
		const snap = snapshotRouteState(s)
		// Round-trip through JSON proves serializability.
		const round = JSON.parse(JSON.stringify(snap))
		expect(round.activeEndpointId).toBe("ep-1")
		expect(round.failures["ep-1"].hard).toBe(1)
		expect(round.cooldownUntil["ep-2"]).toBe(2000 + COOLDOWN_MS)
		expect(round.invalidChain).toContain("ep-3")
		expect(round.exhaustedAt).toBe(5000)
	})
})
