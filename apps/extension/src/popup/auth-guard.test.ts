import { describe, expect, test } from "vitest"
import { authRequiredGate } from "./auth-guard"

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
