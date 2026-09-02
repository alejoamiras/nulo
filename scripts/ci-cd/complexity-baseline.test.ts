import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
	classifySuppressionLine,
	compareToManifest,
	installedBiomeVersion,
	parseGrepWithContext,
	scanTree,
} from "../complexity-baseline/scan"
import manifest from "../complexity-baseline/manifest.json"

// The complexity-budget baseline is a set of JUSTIFIED acceptances that only shrinks: every
// directive is `accepted at score N — <why>` (or `N lines`), pinned in the manifest by identity
// (file, rule, the declaration under it) and stamp; nothing may be added, moved or re-stamped
// upward outside a Biome-version bump. Full protocol in CLAUDE.md § Complexity budgets.
// `bun scripts/complexity-baseline/check.ts` is the same enforcement in the local lint/pre-commit
// path; this file is the CI mirror (complexity-rescore.test.ts holds the stamps to the truth).

// Sample lines are concatenation-built so this test file never matches the scanner itself.
const IGNORE = "// biome-ignore"
const line = (parts: string[]) => parts.join("")
const COG = " lint/complexity/noExcessiveCognitiveComplexity: "
const LEN = " lint/complexity/noExcessiveLinesPerFunction: "

describe("suppression classifier", () => {
	test("counts the accepted form only, with its stamp, whitespace-tolerantly", () => {
		expect(classifySuppressionLine(line([IGNORE, COG, "accepted at score 45 — the walker IS the redaction policy"]))).toEqual({
			kind: "baselined",
			rule: "noExcessiveCognitiveComplexity",
			accepted: 45,
		})
		// Biome accepts multiple spaces between token and scope (verified on 2.5.9).
		expect(classifySuppressionLine(line(["\t", IGNORE, " ", LEN, "accepted at 154 lines — one declarative theme value, split only fragments it"]))).toEqual({
			kind: "baselined",
			rule: "noExcessiveLinesPerFunction",
			accepted: 154,
		})
	})

	test("refuses the legacy text, the generator marker, unit mismatches and placeholder sentences", () => {
		for (const [refused, why] of [
			[line([IGNORE, COG, "baseline (score 22) — refactor when touched, never raise"]), /legacy/],
			[line([IGNORE, LEN, "JUSTIFICATION REQUIRED (observed 91 lines): refactor, or replace this line"]), /generator marker/],
			[line([IGNORE, COG, "accepted at 40 lines — the unit does not match the rule at all"]), /takes `accepted at score N/],
			[line([IGNORE, LEN, "accepted at score 40 — the unit does not match the rule at all"]), /takes `accepted at 40 lines|takes `accepted at N lines/],
			[line([IGNORE, COG, "accepted at score 22 — TODO"]), /placeholders/],
			[line([IGNORE, COG, "accepted at score 22 — short"]), /placeholders|essential/],
			[line([IGNORE, COG, "necessary here"]), /whole `\/\/` comment/],
			[line(["const x = 1 ", IGNORE, COG, "accepted at score 22 — trailing on a code line is not a whole comment"]), /whole `\/\/` comment/],
		] as const) {
			const c = classifySuppressionLine(refused)
			expect(c?.kind, refused).toBe("forbidden")
			expect(c && c.kind === "forbidden" ? c.why : "", refused).toMatch(why)
		}
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
			line(["/* biome-ignore", COG, "accepted at score 22 — a block comment is not the accepted whole-line form */"]),
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

describe("grep context parsing (identity anchors)", () => {
	test("pairs a directive with the declaration under it, skipping a second directive, in .ts and .vue alike", () => {
		const stdout = [
			`apps/x/Foo.vue:10:${line(["\t", IGNORE, LEN, "accepted at 91 lines — a"])}`,
			`apps/x/Foo.vue-11-${line(["\t", IGNORE, COG, "accepted at 61 — b"])}`,
			"apps/x/Foo.vue-12-\tasync function verify(intentPath: string) {",
			"apps/x/Foo.vue-13-\tconst a = 1",
			"--",
			`packages/y/bar.ts:5:${line([IGNORE, COG, "accepted at score 22 — c"])}`,
			"packages/y/bar.ts-6-export function bar() {",
		].join("\n")
		const parsed = parseGrepWithContext(stdout)
		expect(parsed.matches.map((m) => `${m.file}:${m.line}`)).toEqual(["apps/x/Foo.vue:10", "packages/y/bar.ts:5"])
		expect(parsed.byKey.get("apps/x/Foo.vue:12")).toBe("\tasync function verify(intentPath: string) {")
		expect(parsed.byKey.get("packages/y/bar.ts:6")).toBe("export function bar() {")
	})
})

describe("complexity baseline", () => {
	const scan = scanTree()

	test("manifest pins the installed Biome version", () => {
		const rootPkg = JSON.parse(readFileSync("package.json", "utf8"))
		expect(
			manifest.biomeVersion,
			"Biome version changed — suppression scores drift between releases. In this PR: `bun run baseline:rescore`, " +
				"re-stamp each drifted directive by hand, then `bun run baseline:complexity -- --adopt` and review the manifest diff.",
		).toBe(installedBiomeVersion(rootPkg))
	})

	test("no forbidden suppression forms anywhere in source", () => {
		expect(
			scan.forbidden.map((f) => `${f.file}:${f.line} — ${f.why}`),
			"Every budget-rule suppression must be a whole-line `accepted at … — <why>` directive; broad, file-wide, legacy or " +
				"marker forms can silence complexity budgets invisibly — justify at the line, or refactor.",
		).toEqual([])
	})

	test("acceptances match the manifest exactly (identity + stamp; shrink-only ratchet)", () => {
		const drift = compareToManifest(manifest, scan.accepted)
		expect(
			drift.added,
			"New or MOVED complexity acceptance(s) — the baseline only shrinks. Refactor the function under the budget instead " +
				"of accepting it. (Existing acceptances are reviewed debt, not a pattern to copy.)",
		).toEqual([])
		expect(
			drift.restamped.map((r) => `${r.key}: ${r.from} → ${r.to}`),
			"An accepted stamp changed — confirm the observed value with `bun run baseline:rescore`, then record it with " +
				"`bun run baseline:complexity` (a Biome bump needs `-- --adopt`).",
		).toEqual([])
		expect(
			drift.removed,
			"Accepted function(s) fixed or removed — record the progress: rerun `bun run baseline:complexity` in this PR " +
				"so the manifest matches.",
		).toEqual([])
		expect(manifest.accepted.length).toBe(scan.accepted.length)
	})
})
