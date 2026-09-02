import { describe, expect, test } from "vitest"
import { resolveBootSession } from "./boot-session"

const p1 = { id: "p1" }
const p2 = { id: "p2" }
const never = () => new Promise<never>(() => {})
const rejects = async () => {
	throw new Error("port not ready")
}

function deps(over: Partial<Parameters<typeof resolveBootSession<{ id: string }>>[0]> = {}) {
	return {
		getProfiles: async () => [p1, p2],
		getActiveProfile: async () => p1,
		bootstrap: async () => true,
		lastActiveProfileId: async () => "p2",
		isCurrent: () => true,
		// Short overall bound so the unreachable cases settle in milliseconds, not the 60s default.
		deadlineMs: 40,
		...over,
	}
}

describe("resolveBootSession", () => {
	test("an open session that bootstraps is active, with the list and the survival flag", async () => {
		expect(await resolveBootSession(deps())).toEqual({ kind: "active", profiles: [p1, p2], profile: p1, stillActive: true })
		expect(await resolveBootSession(deps({ bootstrap: async () => false }))).toMatchObject({ kind: "active", stillActive: false })
	})

	test("no open session is a lock whose candidate is the last active profile, else the first, else none", async () => {
		expect(await resolveBootSession(deps({ getActiveProfile: async () => undefined }))).toEqual({
			kind: "locked",
			profiles: [p1, p2],
			candidate: p2,
		})
		expect(
			await resolveBootSession(deps({ getActiveProfile: async () => undefined, lastActiveProfileId: async () => "gone" })),
		).toMatchObject({ candidate: p1 })
		expect(await resolveBootSession(deps({ getProfiles: async () => [], getActiveProfile: async () => undefined }))).toEqual({
			kind: "locked",
			profiles: [],
			candidate: undefined,
		})
	})

	test("an unreachable service reports unreachable — with the lock-screen candidate when the list was readable", async () => {
		expect(await resolveBootSession(deps({ getProfiles: never }))).toEqual({ kind: "unreachable", profiles: [], candidate: undefined })
		expect(await resolveBootSession(deps({ getActiveProfile: never }))).toEqual({
			kind: "unreachable",
			profiles: [p1, p2],
			candidate: p2,
		})
		expect(await resolveBootSession(deps({ getActiveProfile: rejects }))).toMatchObject({ kind: "unreachable", candidate: p2 })
	})

	test("an open session whose bootstrap throws is FAILED, never a lock", async () => {
		expect(
			await resolveBootSession(
				deps({
					bootstrap: async () => {
						throw new Error("network init failed")
					},
				}),
			),
		).toEqual({ kind: "failed", profiles: [p1, p2], profile: p1 })
	})

	test("a run superseded after ANY await commits nothing, whichever read it was in", async () => {
		let current = true
		const supersedeAfter =
			<T>(fn: () => Promise<T>) =>
			async () => {
				const v = await fn()
				current = false
				return v
			}
		const base = { isCurrent: () => current }
		current = true
		expect(await resolveBootSession(deps({ ...base, getProfiles: supersedeAfter(async () => [p1]) }))).toEqual({ kind: "superseded" })
		current = true
		expect(await resolveBootSession(deps({ ...base, getActiveProfile: supersedeAfter(async () => p1) }))).toEqual({
			kind: "superseded",
		})
		current = true
		expect(
			await resolveBootSession(
				deps({ ...base, getActiveProfile: async () => undefined, lastActiveProfileId: supersedeAfter(async () => "p2") }),
			),
		).toEqual({ kind: "superseded" })
		current = true
		expect(await resolveBootSession(deps({ ...base, bootstrap: supersedeAfter(async () => true) }))).toEqual({ kind: "superseded" })
		current = true
		expect(
			await resolveBootSession(
				deps({
					...base,
					bootstrap: async () => {
						current = false
						throw new Error("boom")
					},
				}),
			),
		).toEqual({ kind: "superseded" })
	})
})
