import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PERMIT_DEADLINE_SECONDS } from "@nulo/bridge-core"
import { describe, expect, test } from "vitest"

/**
 * Reachability guard for the Permit2 signing deadline.
 *
 * Pinning the constant's VALUE is not enough: the deadline only binds what the wallet actually
 * signs, so a call site that computes its own literal is unaffected by any assertion on the
 * export. That is not hypothetical — the tightening from 1800s to 600s left a third signing
 * site in useFuel.ts untouched while both the PR body and econ-matrix.md recorded it as
 * covering every site.
 *
 * Source-level rather than behavioural because the alternative is mounting three composables
 * against a mock wallet purely to read one field back.
 */
const COMPOSABLES = join(__dirname)
const SIGNING_SOURCES = ["useDeposit.ts", "useFuel.ts"]

describe("permit deadline reachability", () => {
	test.each(SIGNING_SOURCES)("%s derives every deadline from the shared constant", (file) => {
		const src = readFileSync(join(COMPOSABLES, file), "utf8")
		const assignments = src.match(/const deadline = .*/g) ?? []

		expect(assignments.length).toBeGreaterThan(0)
		for (const line of assignments) {
			expect(line).toContain("PERMIT_DEADLINE_SECONDS")
		}
	})

	test("no signing site hardcodes the pre-tightening 1800s window", () => {
		for (const file of SIGNING_SOURCES) {
			const src = readFileSync(join(COMPOSABLES, file), "utf8")
			expect(src).not.toMatch(/Date\.now\(\) \/ 1000\) \+ \d+/)
		}
	})

	test("the shared constant stays inside the range the router will accept", () => {
		expect(PERMIT_DEADLINE_SECONDS).toBeGreaterThanOrEqual(60n)
		expect(PERMIT_DEADLINE_SECONDS).toBeLessThanOrEqual(900n)
	})
})
