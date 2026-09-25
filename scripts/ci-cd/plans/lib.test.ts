import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { cleanupRepos, findings, git, makeRepo, tempDir, writeFiles } from "./fixture-repo"
import { decodeEntities } from "./html"
import { type Env, type Finding, isCanonical, lineOf, mode, parseIndex, writeSummary } from "./lib"

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
	const actions = (event?: string, base?: string): Env => ({ GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: event, GITHUB_BASE_REF: base })
	const matrix: [string, Env, "enforce" | "report"][] = [
		["local", {}, "enforce"],
		["pull_request", actions("pull_request", "dev"), "enforce"],
		["pull_request_target", actions("pull_request_target", "dev"), "enforce"],
		["pull_request with an empty base (fails closed)", actions("pull_request", ""), "enforce"],
		["pull_request without a base", actions("pull_request"), "enforce"],
		["push with a base ref set", actions("push", "dev"), "report"],
		["schedule", actions("schedule"), "report"],
		["workflow_dispatch", actions("workflow_dispatch", "dev"), "report"],
		["Actions without an event name", actions(), "report"],
	]

	test.each(matrix)("%s → %p", (_label, env, expected) => {
		expect(mode(env)).toBe(expected)
	})
})

describe("contents come from the index", () => {
	test("a staged violation is judged from its blob although the working copy is clean", () => {
		const repo = makeRepo({ "README.md": "[a](docs/a.md)\n", "docs/a.md": "a\n" })
		writeFiles(repo, { "README.md": "[gone](docs/gone.md)\n" })
		git(repo, "add", "README.md")
		writeFiles(repo, { "README.md": "[a](docs/a.md)\n" })
		expect(findings(repo, "link-missing").map((f) => f.detail)).toEqual(["docs/gone.md → docs/gone.md is not in the git index"])
	})

	test("a tracked Markdown symlink or a plan-tree gitlink is a document-type finding, and a symlink is never followed", () => {
		const outside = join(tempDir(), "outside.md")
		writeFileSync(outside, "[x](nowhere.md)\n")
		const repo = makeRepo({ "README.md": "r\n" })
		symlinkSync(outside, join(repo, "notes.md"))
		git(repo, "add", "notes.md")
		const gitlink = "implementations-plan/plans-scaffolding/sub"
		git(repo, "update-index", "--add", "--cacheinfo", `160000,${git(repo, "rev-parse", "HEAD")},${gitlink}`)
		// Not `add -A`: the gitlink has no working-tree directory, so it would be staged as deleted.
		git(repo, "commit", "-q", "-m", "links")
		expect(findings(repo, "document-type").map((f) => f.file)).toEqual([gitlink, "notes.md"])
		expect(findings(repo, "link-missing")).toEqual([])
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

	test("an invalid numeric reference becomes U+FFFD, as in HTML, and never throws", () => {
		const refs = ["&#x110000;", "&#0;", "&#xD800;", `&#${"9".repeat(40)};`, "&#x41;"]
		expect(decodeEntities(refs.join("|"))).toBe(["�", "�", "�", "�", "A"].join("|"))
	})

	test("a numeric reference decodes as HTML reads it: without its semicolon, and C1 through Windows-1252", () => {
		expect(decodeEntities("&#98lob &#x62;x &#x80; &#150; &#x81; &#x")).toBe("blob bx € – \u0081 &#x")
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
