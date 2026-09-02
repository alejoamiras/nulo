import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	ambiguousAnchors,
	anchorFor,
	type BaselineManifest,
	classifySuppressionLine,
	diffEntries,
	hasEntries,
	installedBiomeVersion,
	type LegacyManifest,
	legacyRatchetViolations,
	type ManifestEntry,
	parseGrepWithContext,
	ratchetViolations,
	scanTree,
	toManifestEntries,
} from "../complexity-baseline/scan"
import manifest from "../complexity-baseline/manifest.json"

// The complexity-budget baseline is a set of JUSTIFIED acceptances that only shrinks: every
// directive is `accepted at score N — <why>` (or `N lines`), pinned in the manifest by identity
// (file, rule, the unique declaration under it) plus stamp and sentence. Three layers here:
// the classifier refuses every other suppression form; the tree must equal the manifest entry by
// entry; and, on a PR, the manifest may not gain or raise an acceptance relative to the base
// branch — so a hand-edited manifest row cannot get past CI either. A Biome version bump is the
// one path on which numbers rise. `bun scripts/complexity-baseline/check.ts` is the local mirror
// (lint + pre-commit); complexity-rescore.test.ts holds every stamp to the truth.

// Sample lines are concatenation-built so this test file never matches the scanner itself.
const IGNORE = "// biome-ignore"
const line = (parts: string[]) => parts.join("")
const COG = " lint/complexity/noExcessiveCognitiveComplexity: "
const LEN = " lint/complexity/noExcessiveLinesPerFunction: "

describe("suppression classifier", () => {
	test("counts the accepted form only, with its stamp and sentence, whitespace-tolerantly", () => {
		expect(classifySuppressionLine(line([IGNORE, COG, "accepted at score 45 — the walker IS the redaction policy"]))).toEqual({
			kind: "baselined",
			rule: "noExcessiveCognitiveComplexity",
			accepted: 45,
			sentence: "the walker IS the redaction policy",
		})
		// Biome accepts multiple spaces between token and scope (verified on 2.5.9).
		expect(classifySuppressionLine(line(["\t", IGNORE, " ", LEN, "accepted at 154 lines — one declarative theme value, split only fragments it"]))).toEqual({
			kind: "baselined",
			rule: "noExcessiveLinesPerFunction",
			accepted: 154,
			sentence: "one declarative theme value, split only fragments it",
		})
	})

	test("refuses the legacy text, the generator marker, unit mismatches and placeholder sentences", () => {
		for (const [refused, why] of [
			[line([IGNORE, COG, "baseline (score 22) — refactor when touched, never raise"]), /legacy/],
			[line([IGNORE, LEN, "JUSTIFICATION REQUIRED (observed 91 lines): refactor, or replace this line"]), /generator marker/],
			[line([IGNORE, COG, "accepted at 40 lines — the unit does not match the rule at all"]), /takes `accepted at score N/],
			[line([IGNORE, LEN, "accepted at score 40 — the unit does not match the rule at all"]), /takes `accepted at N lines/],
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

describe("identity anchors", () => {
	test("the anchor is the first declaration under the directive — past a paired directive, a doc block and blanks, in .ts and .vue alike", () => {
		const stdout = [
			`apps/x/Foo.vue:10:${line(["\t", IGNORE, LEN, "accepted at 91 lines — a"])}`,
			`apps/x/Foo.vue-11-${line(["\t", IGNORE, COG, "accepted at 61 — b"])}`,
			"apps/x/Foo.vue-12-\t/** Verifies the intent. */",
			"apps/x/Foo.vue-13-",
			"apps/x/Foo.vue-14-\tasync function verify(intentPath: string) {",
			"apps/x/Foo.vue-15-\tconst a = 1",
			"--",
			`packages/y/bar.ts:5:${line([IGNORE, COG, "accepted at score 22 — c"])}`,
			"packages/y/bar.ts-6-export function bar() {",
			"--",
			`packages/y/baz.ts:5:${line([IGNORE, COG, "accepted at score 22 — d"])}`,
			"packages/y/baz.ts-6-// only comments follow",
		].join("\n")
		const parsed = parseGrepWithContext(stdout)
		expect(parsed.matches.map((m) => `${m.file}:${m.line}`)).toEqual(["apps/x/Foo.vue:10", "packages/y/bar.ts:5", "packages/y/baz.ts:5"])
		expect(anchorFor(parsed, "apps/x/Foo.vue", 10)).toBe("async function verify(intentPath: string) {")
		expect(anchorFor(parsed, "apps/x/Foo.vue", 11)).toBe("async function verify(intentPath: string) {")
		expect(anchorFor(parsed, "packages/y/bar.ts", 5)).toBe("export function bar() {")
		expect(anchorFor(parsed, "packages/y/baz.ts", 5)).toBeUndefined()
	})

	test("an anchor must be unique in its file — a same-text declaration elsewhere is refused", () => {
		const dir = mkdtempSync(join(tmpdir(), "anchor-"))
		const file = join(dir, "twins.ts")
		writeFileSync(file, ["export const a = () => {", "\treturn new Promise((resolve) => {", "\t})", "}", "export const b = () => {", "\treturn new Promise((resolve) => {", "\t})", "}", ""].join("\n"))
		try {
			const base = { file, rule: "noExcessiveCognitiveComplexity" as const, accepted: 22, sentence: "x".repeat(12) }
			expect(ambiguousAnchors([{ ...base, line: 1, anchor: "return new Promise((resolve) => {" }]).map((f) => f.why)).toEqual([expect.stringMatching(/occurs 2×/)])
			expect(ambiguousAnchors([{ ...base, line: 1, anchor: "export const a = () => {" }])).toEqual([])
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("entry diff + ratchet", () => {
	const entry = (over: Partial<ManifestEntry>): ManifestEntry => ({
		file: "a.ts",
		rule: "noExcessiveCognitiveComplexity",
		anchor: "function f() {",
		accepted: 22,
		sentence: "the branches are the policy",
		...over,
	})

	test("a rename or file move keeping rule, stamp and sentence is a move, not growth; anything else added or raised is", () => {
		const base = [entry({}), entry({ anchor: "function g() {", accepted: 30 }), entry({ anchor: "function h() {", accepted: 25 })]
		const head = [
			entry({ file: "b.ts", anchor: "function f(x: number) {" }), // moved
			entry({ anchor: "function g() {", accepted: 28 }), // lowered
			entry({ anchor: "function h() {", accepted: 25, sentence: "tightened wording" }), // reworded
			entry({ anchor: "function k() {", accepted: 25, sentence: "brand new acceptance" }), // added
		]
		const diff = diffEntries(base, head)
		expect(diff.moved.map((m) => `${m.from.anchor} → ${m.to.file} ${m.to.anchor}`)).toEqual(["function f() { → b.ts function f(x: number) {"])
		expect(diff.restamped).toEqual([{ key: "noExcessiveCognitiveComplexity a.ts — function g() {", from: 30, to: 28 }])
		expect(diff.reworded).toEqual(["noExcessiveCognitiveComplexity a.ts — function h() {"])
		expect(diff.added.map((e) => e.anchor)).toEqual(["function k() {"])
		expect(diff.removed).toEqual([])
		expect(ratchetViolations(diff)).toEqual(["+ noExcessiveCognitiveComplexity a.ts — function k() { (accepted at 25)"])
		expect(ratchetViolations(diffEntries(base, [entry({ accepted: 23 })]))).toEqual(["↑ noExcessiveCognitiveComplexity a.ts — function f() {: 22 → 23"])
		// A swap: the directive leaves f and lands on k with k's real score and a fresh sentence — that is an add.
		expect(ratchetViolations(diffEntries([entry({})], [entry({ anchor: "function k() {", sentence: "different function, different why" })]))).toHaveLength(1)
	})

	test("against a base that predates entries, per-rule totals may not grow", () => {
		const base: LegacyManifest["rules"] = { noExcessiveCognitiveComplexity: { "a.ts": 2, "b.ts": 1 }, noExcessiveLinesPerFunction: { "c.ts": 1 } }
		expect(legacyRatchetViolations(base, { noExcessiveCognitiveComplexity: { "z.ts": 3 }, noExcessiveLinesPerFunction: {} })).toEqual([])
		expect(legacyRatchetViolations(base, { noExcessiveCognitiveComplexity: { "z.ts": 4 }, noExcessiveLinesPerFunction: {} })).toEqual(["↑ noExcessiveCognitiveComplexity: 3 → 4 acceptance(s)"])
	})
})

describe("complexity baseline (this checkout)", () => {
	const scan = scanTree()

	test("manifest pins the installed Biome version and carries per-acceptance entries", () => {
		const rootPkg = JSON.parse(readFileSync("package.json", "utf8"))
		expect(
			manifest.biomeVersion,
			"Biome version changed — suppression scores drift between releases. In this PR: `bun run baseline:rescore`, " +
				"re-stamp each drifted directive by hand, then `bun run baseline:complexity -- --adopt` and review the manifest diff.",
		).toBe(installedBiomeVersion(rootPkg))
		expect(hasEntries(manifest as BaselineManifest)).toBe(true)
	})

	test("no forbidden suppression forms anywhere in source", () => {
		expect(
			scan.forbidden.map((f) => `${f.file}:${f.line} — ${f.why}`),
			"Every budget-rule suppression must be a whole-line `accepted at … — <why>` directive above a unique declaration; " +
				"broad, file-wide, legacy or marker forms can silence complexity budgets invisibly — justify at the line, or refactor.",
		).toEqual([])
	})

	test("the tree equals the manifest entry by entry", () => {
		const diff = diffEntries((manifest as BaselineManifest).accepted, toManifestEntries(scan.accepted))
		expect(
			diff.added.map((e) => `${e.file} ${e.rule} — ${e.anchor}`),
			"New complexity acceptance(s) — the baseline only shrinks. Refactor the function under the budget instead of accepting it.",
		).toEqual([])
		expect(
			diff.restamped.map((r) => `${r.key}: ${r.from} → ${r.to}`),
			"An accepted stamp changed — confirm the observed value with `bun run baseline:rescore`, then record it with " +
				"`bun run baseline:complexity` (a Biome bump needs `-- --adopt`).",
		).toEqual([])
		expect(
			[...diff.removed.map((e) => `removed ${e.file} — ${e.anchor}`), ...diff.moved.map((m) => `moved ${m.from.anchor} → ${m.to.anchor}`), ...diff.reworded.map((k) => `reworded ${k}`)],
			"The manifest is stale — rerun `bun run baseline:complexity` in this PR so it records the change.",
		).toEqual([])
		expect((manifest as BaselineManifest).accepted.length).toBe(scan.accepted.length)
	})
})

/** The PR's base branch, or null when there is none to ratchet against: GitHub push/schedule/
 *  dispatch runs (the merged content already passed on its PR) — locally, `dev`. */
function ratchetBaseRef(): string | null {
	if (process.env.GITHUB_ACTIONS === "true") return process.env.GITHUB_BASE_REF || null
	return "dev"
}

function git(...args: string[]): { ok: boolean; stdout: string; stderr: string } {
	const res = spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000 })
	return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

/** Reads the base branch's manifest, fetching the branch tip shallowly when the checkout lacks it
 *  (CI checkouts are depth-1). Returns the reason when there is nothing to compare against. */
function readBaseManifest(base: string): { manifest: BaselineManifest | LegacyManifest } | { skipped: string } {
	const ref = `refs/remotes/origin/${base}`
	if (!git("rev-parse", "--verify", "-q", ref).ok) {
		const fetched = git("fetch", "--no-tags", "--depth=1", "origin", `${base}:${ref}`)
		if (!fetched.ok) return { skipped: `origin/${base} unavailable: ${fetched.stderr.trim() || "fetch failed"}` }
	}
	const shown = git("show", `${ref}:scripts/complexity-baseline/manifest.json`)
	if (!shown.ok) return { skipped: `origin/${base} has no manifest: ${shown.stderr.trim()}` }
	return { manifest: JSON.parse(shown.stdout) }
}

describe("shrink-only ratchet against the base branch", () => {
	test(
		"the manifest never gains or raises an acceptance relative to the PR base (a Biome bump excepted)",
		() => {
			const base = ratchetBaseRef()
			if (base === null) return
			const read = readBaseManifest(base)
			if ("skipped" in read) {
				// Fail closed on a PR run: CI must always have its base to ratchet against.
				expect(process.env.GITHUB_ACTIONS === "true", read.skipped).toBe(false)
				console.warn(`ratchet skipped — ${read.skipped}`)
				return
			}
			const head = manifest as BaselineManifest
			if (read.manifest.biomeVersion !== head.biomeVersion) {
				console.warn(`ratchet relaxed — Biome ${read.manifest.biomeVersion} → ${head.biomeVersion}: review every added or raised acceptance in this PR's diff by hand`)
				return
			}
			const violations = hasEntries(read.manifest) ? ratchetViolations(diffEntries(read.manifest.accepted, head.accepted)) : legacyRatchetViolations(read.manifest.rules, head.rules)
			expect(
				violations,
				`The manifest grew relative to origin/${base} on the same Biome — the baseline only shrinks, and manifest.json is ` +
					"never hand-edited. Refactor the function under the budget; a genuinely new acceptance is a blueprint with owner sign-off.",
			).toEqual([])
		},
		{ timeout: 180_000 },
	)
})
