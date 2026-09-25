import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { cleanupRepos, tempDir } from "./fixture-repo"
import { decodeEntities, type Finding, isCanonical, lineOf, mode, parseIndex, writeSummary } from "./lib"

afterAll(cleanupRepos)

describe("isCanonical", () => {
	test("transcript and draft shapes anywhere below the plans dir", () => {
		expect(isCanonical("implementations-plan/p/audit-codex.md")).toBe(true)
		expect(isCanonical("implementations-plan/p/sub/plan-v2.md")).toBe(true)
		expect(isCanonical("implementations-plan/p/_brief.md")).toBe(true)
		expect(isCanonical("implementations-plan/p/eli5.html")).toBe(true)
	})

	test("lessons/ is exempt, as are plan.md and paths outside the plans dir", () => {
		expect(isCanonical("implementations-plan/p/lessons/audit-x.md")).toBe(false)
		expect(isCanonical("implementations-plan/p/lessons/deep/eli5.html")).toBe(false)
		expect(isCanonical("implementations-plan/p/plan.md")).toBe(false)
		expect(isCanonical("docs/audit-x.md")).toBe(false)
	})
})

describe("mode", () => {
	test("enforces locally and on a pull request", () => {
		expect(mode({})).toBe("enforce")
		expect(mode({ GITHUB_ACTIONS: "true", GITHUB_BASE_REF: "dev" })).toBe("enforce")
	})

	test("only reports under Actions without a PR base (push, nightly, release)", () => {
		expect(mode({ GITHUB_ACTIONS: "true" })).toBe("report")
		expect(mode({ GITHUB_ACTIONS: "true", GITHUB_BASE_REF: "" })).toBe("report")
	})
})

describe("writeSummary", () => {
	const sample: Finding[] = [{ rule: "link-missing", file: "README.md", line: 3, detail: "x → y is not in the git index", fix: "fix it" }]

	test("a report-mode run writes its findings to the step summary", () => {
		const path = join(tempDir(), "summary.md")
		expect(writeSummary(sample, { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: path })).toBe(true)
		const text = readFileSync(path, "utf8")
		expect(text).toContain("Plan tree gate (report): 1 finding(s)")
		expect(text).toContain("`link-missing`: 1")
		expect(text).toContain("README.md:3")
	})

	test("without a summary file it writes nothing", () => {
		expect(writeSummary(sample, {})).toBe(false)
	})
})

describe("helpers", () => {
	test("decodeEntities handles named and numeric references", () => {
		expect(decodeEntities("Outcome &amp; Quality Bar")).toBe("Outcome & Quality Bar")
		expect(decodeEntities("&#x2F;a&#47;b &unknown;")).toBe("/a/b &unknown;")
	})

	test("lineOf finds the first line holding a needle", () => {
		expect(lineOf("a\nb [x](t.md)\nt.md", ["t.md"])).toBe(2)
		expect(lineOf("a", ["zzz"])).toBe(1)
	})

	test("parseIndex reads entries and flags entry-shaped lines that miss the format", () => {
		const { entries, malformed } = parseIndex("# Index\n\n- [a](a/plan.md) — active — does a\n- [b](b/plan.md) missing separators\n")
		expect(entries).toEqual([{ line: 3, name: "a", target: "a/plan.md", status: "active", hook: "does a" }])
		expect(malformed).toEqual([4])
	})
})
