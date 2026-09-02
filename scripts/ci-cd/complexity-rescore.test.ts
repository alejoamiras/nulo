import { describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { rescore, siblingCopyPath } from "../complexity-baseline/rescore"
import { scanTree } from "../complexity-baseline/scan"

// Every accepted complexity directive's stamp must EQUAL its function's observed value — a raised
// stamp is an unreviewed ceiling, a lowered one a function that grew, a stale one a directive that
// outlived its function. CLAUDE.md § Complexity budgets. `bun run baseline:rescore` is the same
// audit on demand; this is the CI gate.

const IGNORE = "// biome-ignore"
const rule = "noExcessiveCognitiveComplexity" as const

/** A function whose cognitive score is far over 15, under a directive stamped `accepted`. Lives
 *  under an included Biome root (`scripts/ci-cd/test-soak/`) so the repo config applies. */
function fixture(accepted: number, deep: boolean): { file: string; line: number } {
	const file = `scripts/ci-cd/test-soak/rescore-fixture-${process.pid}.ts`
	const body = deep
		? ["export function f(a: number, b: number): number {", "\tlet n = 0", "\tfor (let i = 0; i < a; i++) {", "\t\tif (i % 2 === 0 && b > 1) {", "\t\t\tif (i % 3 === 0 || b > 2) {", "\t\t\t\tif (i % 5 === 0 && b > 3) {", "\t\t\t\t\tif (i % 7 === 0 || b > 4) n += i", "\t\t\t\t\telse n -= 1", "\t\t\t\t}", "\t\t\t}", "\t\t}", "\t}", "\treturn n", "}"]
		: ["export function f(a: number): number {", "\treturn a + 1", "}"]
	const directive = `${IGNORE} lint/complexity/${rule}: accepted at score ${accepted} — the nested loop is the fixture's whole point here`
	writeFileSync(file, `${[directive, ...body].join("\n")}\n`, { flag: "wx" })
	return { file, line: 1 }
}

describe("complexity rescore", () => {
	test(
		"every accepted directive in the tree matches its function exactly",
		() => {
			const result = rescore(scanTree().accepted)
			expect(result.checked).toBeGreaterThan(0)
			expect(
				result.violations,
				"An accepted stamp no longer equals the function's observed value. A function that GREW must be brought back " +
					"under its stamp (or the stamp raised only with a justification review); one that shrank gets its stamp lowered; " +
					"one under the budget loses its directive. Then `bun run baseline:complexity`.",
			).toEqual([])
		},
		{ timeout: 180_000 },
	)

	test(
		"the audit fails a stamp that is too high, too low, or stale — and passes an exact one",
		() => {
			const seen: Array<[number, boolean, string[]]> = []
			for (const [accepted, deep] of [
				[99, true],
				[16, true],
				[22, false],
			] as const) {
				const fx = fixture(accepted, deep)
				try {
					seen.push([accepted, deep, rescore([{ ...fx, rule, accepted, anchor: "export function f" }]).violations])
				} finally {
					rmSync(fx.file, { force: true })
				}
			}
			expect(seen[0][2].join("\n")).toMatch(/accepted 99 → observed \d+ \(the function fell below its stamp/)
			expect(seen[1][2].join("\n")).toMatch(/accepted 16 → observed \d+ \(the function grew past its stamp/)
			expect(seen[2][2].join("\n")).toMatch(/no longer has a function over budget under it/)
			// The exact stamp is whatever Biome reports for the deep fixture — read it back from the first violation.
			const observed = Number(seen[0][2][0].match(/observed (\d+)/)?.[1])
			const exact = fixture(observed, true)
			try {
				expect(rescore([{ ...exact, rule, accepted: observed, anchor: "export function f" }]).violations).toEqual([])
			} finally {
				rmSync(exact.file, { force: true })
			}
		},
		{ timeout: 180_000 },
	)

	test("sibling copies keep every suffix so Biome's path overrides still apply", () => {
		expect(siblingCopyPath("apps/x/Foo.test.ts", "7")).toBe("apps/x/Foo.rescore-7.test.ts")
		expect(siblingCopyPath("apps/x/creator.js", "7")).toBe("apps/x/creator.rescore-7.js")
		expect(siblingCopyPath("apps/x/Bar.vue", "7")).toBe("apps/x/Bar.rescore-7.vue")
	})
})
