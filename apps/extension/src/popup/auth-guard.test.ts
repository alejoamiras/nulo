import { describe, expect, test, vi } from "vitest"
import { authRequiredGate, lookupActiveProfileWithBackoff } from "./auth-guard"

describe("lookupActiveProfileWithBackoff", () => {
	test("an open session is active, a clean undefined is locked — both on the first call", async () => {
		let calls = 0
		expect(
			await lookupActiveProfileWithBackoff(async () => {
				calls++
				return { id: "p1" }
			}),
		).toEqual({ kind: "active", profile: { id: "p1" } })
		expect(await lookupActiveProfileWithBackoff(async () => undefined)).toEqual({ kind: "locked" })
		expect(calls).toBe(1)
	})

	test("rejections retry across the schedule; a late answer wins, exhaustion is UNREACHABLE (unknown), never locked", async () => {
		let calls = 0
		const lateOk = async () => {
			calls++
			if (calls < 3) throw new Error("port not ready")
			return { id: "p1" }
		}
		expect(await lookupActiveProfileWithBackoff(lateOk)).toEqual({ kind: "active", profile: { id: "p1" } })
		expect(calls).toBe(3)
		let always = 0
		const alwaysRejects = async () => {
			always++
			throw new Error("port not ready")
		}
		expect(await lookupActiveProfileWithBackoff(alwaysRejects)).toEqual({ kind: "unreachable" })
		expect(always).toBe(4)
	})

	test("one overall deadline bounds the whole call, in-flight requests included — never four RPC timeouts in a row", async () => {
		let calls = 0
		const hangs = () => {
			calls++
			return new Promise<{ id: string } | undefined>(() => {})
		}
		const started = Date.now()
		expect(await lookupActiveProfileWithBackoff(hangs, { deadlineMs: 60 })).toEqual({ kind: "unreachable" })
		expect(Date.now() - started).toBeLessThan(1_000)
		expect(calls).toBe(1) // the first attempt consumed the whole budget; no retry sleeps were started past it
	})

	test("a retry sleep that resumes past the deadline (starved timer) launches no request", async () => {
		// The wall clock is what the deadline reads; a starved runner's sleep resumes with that
		// clock far ahead. Leap it 5s DURING the first retry sleep of a 1s budget.
		let now = 0
		const clock = vi.spyOn(Date, "now").mockImplementation(() => now)
		try {
			let calls = 0
			const rejectsOnce = async () => {
				calls++
				throw new Error("port not ready")
			}
			setTimeout(() => {
				now = 5_000
			}, 10)
			expect(await lookupActiveProfileWithBackoff(rejectsOnce, { deadlineMs: 1_000 })).toEqual({ kind: "unreachable" })
			expect(calls).toBe(1) // the pre-sleep check passed (1000 > 250); the post-sleep re-read saw the leap
		} finally {
			clock.mockRestore()
		}
	})

	test("a request the deadline abandons never surfaces as an unhandled rejection", async () => {
		const unhandled: unknown[] = []
		const onUnhandled = (reason: unknown) => unhandled.push(reason)
		process.on("unhandledRejection", onUnhandled)
		try {
			let rejectLate: (e: Error) => void = () => {}
			const late = () => new Promise<{ id: string } | undefined>((_, reject) => (rejectLate = reject))
			expect(await lookupActiveProfileWithBackoff(late, { deadlineMs: 20 })).toEqual({ kind: "unreachable" })
			rejectLate(new Error("late transport failure"))
			await new Promise((r) => setTimeout(r, 10))
			expect(unhandled).toEqual([])
		} finally {
			process.off("unhandledRejection", onUnhandled)
		}
	})
})

const activeProfile = { id: "p1" }
const okLookup = async () => activeProfile
const emptyLookup = async () => undefined

describe("authRequiredGate", () => {
	test("isLogined short-circuits to pass — the session lookup is not even consulted", async () => {
		let called = 0
		const gate = await authRequiredGate(true, true, () => {
			called++
			return Promise.resolve(undefined)
		})
		expect(gate).toBe("pass")
		expect(called).toBe(0)
	})

	test("unchecked session (initial load deciding) is conservatively auth", async () => {
		expect(await authRequiredGate(false, false, okLookup)).toBe("auth")
	})

	test("THE REGRESSION: checked + lagging flag + genuinely open session passes", async () => {
		// The captured CI failure: unlock accepted, bootstrap still running, navigation to
		// settings/accounts ejected to /popup/auth because only the lagging flag was consulted.
		expect(await authRequiredGate(false, true, okLookup)).toBe("pass")
	})

	test("checked + no active session (locked) bounces to auth", async () => {
		expect(await authRequiredGate(false, true, emptyLookup)).toBe("auth")
	})

	test("a rejecting lookup retried across the backoff schedule succeeds → pass (service worker respawn)", async () => {
		let calls = 0
		const respawnLookup = async () => {
			calls++
			if (calls <= 3) throw new Error("port closed")
			return activeProfile
		}
		expect(await authRequiredGate(false, true, respawnLookup)).toBe("pass")
		expect(calls).toBe(4)
	})

	test("a persistently rejecting lookup degrades to PASS — unknown is not locked, and ejecting an open session is the bug", async () => {
		let calls = 0
		const dead = async () => {
			calls++
			throw new Error("port closed")
		}
		expect(await authRequiredGate(false, true, dead)).toBe("pass")
		expect(calls).toBe(4)
	})
})
