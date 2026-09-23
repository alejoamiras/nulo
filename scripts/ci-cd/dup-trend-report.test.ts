import { describe, expect, test } from "bun:test"
import { formatDupReport, JSCPD_VERSION, type JscpdReport } from "../dup-trend/report"

const clone = (
	a: string,
	b: string,
	lines: number,
	format = "typescript",
): JscpdReport["duplicates"][number] => ({
	format,
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
		clone("apps/x/src/pages/a.vue", "apps/x/src/pages/b.vue", 200, "html"),
	],
	statistics: {
		total: { sources: 10, lines: 1000, clones: 6, duplicatedLines: 295, percentage: 9.5, percentageTokens: 12.345 },
	},
}

describe("dup-trend report", () => {
	const md = formatDupReport(fixture)

	test("totals row renders with fixed-precision percentages", () => {
		expect(md).toContain("| 10 | 1000 | 6 | 295 | 9.50% | 12.35% |")
	})

	test("classifies clones into production / test / mixed", () => {
		expect(md).toContain("**production 4 clones / 260 lines** · test↔test 1 / 30 · mixed 1.")
	})

	test("splits production by format, html counted in totals but excluded from the pair table", () => {
		expect(md).toContain("Production by format: html 1 / 200 · typescript 3 / 60.")
		expect(md).not.toContain("a.vue")
		expect(md).toContain("(html excluded — Vue-template tokenizer noise)")
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
