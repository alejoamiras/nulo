import { describe, expect, test } from "bun:test"
import { formatDupReport, JSCPD_VERSION, type JscpdReport } from "../dup-trend/report"

const clone = (a: string, b: string, lines: number): JscpdReport["duplicates"][number] => ({
	format: "typescript",
	lines,
	firstFile: { name: a },
	secondFile: { name: b },
})

const fixture: JscpdReport = {
	duplicates: [
		clone("apps/x/src/service.ts", "apps/x/src/service.ts", 40),
		clone("apps/x/src/service.ts", "packages/y/src/util.ts", 12),
		clone("apps/x/src/service.ts", "packages/y/src/util.ts", 8),
		clone("apps/x/tests/a.test.ts", "apps/x/tests/b.test.ts", 30),
		clone("apps/x/src/service.ts", "apps/x/src/service.test.ts", 5),
	],
	statistics: {
		total: { sources: 10, lines: 1000, clones: 5, duplicatedLines: 95, percentage: 9.5, percentageTokens: 12.345 },
	},
}

describe("dup-trend report", () => {
	const md = formatDupReport(fixture)

	test("totals row renders with fixed-precision percentages", () => {
		expect(md).toContain("| 10 | 1000 | 5 | 95 | 9.50% | 12.35% |")
	})

	test("classifies clones into production / test / mixed", () => {
		expect(md).toContain("**production 3 clones / 60 lines** · test↔test 1 / 30 · mixed 1.")
	})

	test("aggregates pairs, labels self-clones, orders by duplicated lines", () => {
		const internal = md.indexOf("apps/x/src/service.ts (internal)")
		const pair = md.indexOf("apps/x/src/service.ts ↔ packages/y/src/util.ts")
		expect(internal).toBeGreaterThan(-1)
		expect(pair).toBeGreaterThan(-1)
		expect(internal).toBeLessThan(pair)
		expect(md).toContain("| 20 | 2 | `apps/x/src/service.ts ↔ packages/y/src/util.ts` |")
	})

	test("jscpd pin is an exact version", () => {
		expect(JSCPD_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
	})
})
