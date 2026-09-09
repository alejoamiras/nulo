import { describe, expect, test } from "bun:test"
import { expectationMatches, GITHUB_ACTIONS_APP_ID, normalize, planAdd, planRename, RENAMES } from "./required-checks"

const live = {
	strict: true,
	contexts: ["network-e2e-status", "quality-status", "smoke-e2e-status"],
	checks: [
		{ context: "network-e2e-status", app_id: 15368 },
		{ context: "quality-status", app_id: 15368 },
		{ context: "smoke-e2e-status", app_id: 15368 },
	],
}

describe("required-checks", () => {
	test("rename maps the aggregators, keeps strict, app ids and unrelated checks, and is idempotent", () => {
		const once = planRename(normalize(live))
		expect(once.strict).toBe(true)
		expect(once.checks.map((c) => c.context)).toEqual(["extension-network-e2e-status", "extension-smoke-e2e-status", "quality-status"])
		expect(once.checks.every((c) => c.app_id === 15368)).toBe(true)
		expect(planRename(once)).toEqual(once)
	})

	test("rename preserves a check it does not know", () => {
		const current = normalize({ strict: false, checks: [...live.checks, { context: "some-other-check", app_id: 42 }] })
		const plan = planRename(current)
		expect(plan.checks).toContainEqual({ context: "some-other-check", app_id: 42 })
		expect(plan.strict).toBe(false)
	})

	test("add appends missing names under the Actions app id and is idempotent", () => {
		const plan = planAdd(normalize(live), ["bridge-contracts-status", "quality-status"])
		expect(plan.checks).toContainEqual({ context: "bridge-contracts-status", app_id: GITHUB_ACTIONS_APP_ID })
		expect(plan.checks.filter((c) => c.context === "quality-status")).toHaveLength(1)
		expect(planAdd(plan, ["bridge-contracts-status"])).toEqual(plan)
	})

	test("expectation is order-insensitive and ignores the deprecated contexts mirror", () => {
		const shuffled = { strict: true, checks: [...live.checks].reverse() }
		expect(expectationMatches(normalize(live), normalize(shuffled)).ok).toBe(true)
		const drifted = { strict: true, checks: [...live.checks, { context: "new-thing", app_id: 15368 }] }
		const r = expectationMatches(normalize(live), normalize(drifted))
		expect(r.ok).toBe(false)
		expect(r.diff).toContain("new-thing")
	})

	test("every rename target is the name an aggregator job produces", () => {
		expect(Object.values(RENAMES).sort()).toEqual(["bridge-contracts-status", "extension-network-e2e-status", "extension-smoke-e2e-status"])
	})
})
