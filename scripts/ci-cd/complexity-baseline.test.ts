import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
	classifySuppressionLine,
	compareToManifest,
	installedBiomeVersion,
	scanTree,
} from "../complexity-baseline/scan"
import manifest from "../complexity-baseline/manifest.json"

// The complexity-budget baseline is shrink-only: grandfathered suppressions may be
// removed (with a manifest regeneration in the same PR), never added. Full protocol
// in CLAUDE.md § Complexity budgets. `bun scripts/complexity-baseline/check.ts` is
// the same enforcement in the local lint/pre-commit path; this file is the CI mirror.

// Sample lines are concatenation-built so this test file never matches the scanner itself.
const IGNORE = "// biome-ignore"
const line = (parts: string[]) => parts.join("")

describe("suppression classifier", () => {
	test("counts exact-rule directives, whitespace-tolerantly", () => {
		expect(classifySuppressionLine(line([IGNORE, " lint/complexity/noExcessiveCognitiveComplexity: x"]))).toEqual({
			kind: "baselined",
			rule: "noExcessiveCognitiveComplexity",
		})
		// Biome accepts multiple spaces between token and scope (verified on 2.5.9).
		expect(classifySuppressionLine(line([IGNORE, "  lint/complexity/noExcessiveLinesPerFunction: x"]))).toEqual({
			kind: "baselined",
			rule: "noExcessiveLinesPerFunction",
		})
	})

	test("flags every broader syntax that also suppresses budget rules (verified on Biome 2.5.9)", () => {
		for (const evasion of [
			line([IGNORE, " lint: bare scope"]),
			line([IGNORE, "  lint: bare scope, double space"]),
			line([IGNORE, " lint/complexity: group scope"]),
			line([IGNORE, "-all lint: file-wide bare"]),
			line([IGNORE, "-all lint/complexity/noExcessiveCognitiveComplexity: file-wide rule"]),
			line([IGNORE, "-start lint/complexity: range group"]),
			line([IGNORE, " lint/complexity/noExcessiveNestedTestSuites: zero-baseline rule"]),
		]) {
			expect(classifySuppressionLine(evasion)?.kind, evasion).toBe("forbidden")
		}
	})

	test("ignores suppressions that cannot reach a budget rule", () => {
		for (const unrelated of [
			line([IGNORE, " lint/suspicious/noExplicitAny: typed boundary"]),
			line([IGNORE, " lint/complexity/useArrowFunction: style call"]),
			line([IGNORE, "-start lint/style/noNonNullAssertion: range of another group"]),
			"const x = 1 // no suppression here",
		]) {
			expect(classifySuppressionLine(unrelated), unrelated).toBeNull()
		}
	})
})

describe("complexity baseline", () => {
	const scan = scanTree()

	test("manifest pins the installed Biome version", () => {
		const rootPkg = JSON.parse(readFileSync("package.json", "utf8"))
		expect(
			manifest.biomeVersion,
			"Biome version changed — suppression scores drift between releases. Regenerate the baseline " +
				"in this PR: `bun run baseline:complexity -- --adopt` and review the manifest diff.",
		).toBe(installedBiomeVersion(rootPkg))
	})

	test("no forbidden suppression forms anywhere in source", () => {
		expect(
			scan.forbidden.map((f) => `${f.file}:${f.line} — ${f.why}`),
			"Broad or file-wide/range suppressions can silence complexity budgets invisibly — " +
				"suppress a single rule on a single function, or refactor.",
		).toEqual([])
	})

	test("suppression counts match the manifest exactly (shrink-only ratchet)", () => {
		const drift = compareToManifest(manifest, scan.ruleCounts)
		expect(
			drift.grew,
			"New complexity suppression(s) added — the baseline only shrinks. Refactor the function under " +
				"the budget instead of suppressing. (Grandfathered directives are pre-existing debt, not a pattern to copy.)",
		).toEqual([])
		expect(
			drift.shrank,
			"Baseline offender(s) fixed — record the progress: rerun `bun run baseline:complexity` " +
				"in this PR so the manifest matches the shrunken baseline.",
		).toEqual([])
	})
})
