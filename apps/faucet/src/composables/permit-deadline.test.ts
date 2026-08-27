import { readFileSync } from "node:fs"
import { join } from "node:path"
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
// Exact counts, not "at least one": with a lower bound, renaming or hardcoding ONE of
// useDeposit's two sites leaves the other satisfying the assertion and the test green — which
// is the same shape as the bug it exists to catch.
const SIGNING_SOURCES: ReadonlyArray<readonly [string, number]> = [
	["useDeposit.ts", 2],
	["useFuel.ts", 1],
]

describe("permit deadline reachability", () => {
	test.each(SIGNING_SOURCES)("%s derives all %i deadlines from the shared constant", (file, expected) => {
		const src = readFileSync(join(COMPOSABLES, file), "utf8")
		const assignments = src.match(/const deadline = .*/g) ?? []

		expect(assignments).toHaveLength(expected)
		for (const line of assignments) {
			expect(line).toContain("PERMIT_DEADLINE_SECONDS")
		}
	})

	test("no signing site hardcodes its own window", () => {
		for (const [file] of SIGNING_SOURCES) {
			const src = readFileSync(join(COMPOSABLES, file), "utf8")
			expect(src).not.toMatch(/Date\.now\(\) \/ 1000\) \+ \d+/)
		}
	})
})
