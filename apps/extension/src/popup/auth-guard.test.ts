import { describe, expect, test } from "vitest"
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
