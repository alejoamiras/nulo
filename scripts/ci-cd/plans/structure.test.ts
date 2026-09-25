import { afterAll, describe, expect, test } from "bun:test"
import { CANONICAL_GITIGNORE, cleanupRepos, commitAll, findings, git, makeRepo, writeFiles } from "./fixture-repo"
import { NESTED_IGNORE_ALLOWLIST } from "./structure"

afterAll(cleanupRepos)

const OUTCOME = "## Outcome\n\n- **Date**: 2026-09-25. **Status**: completed.\n- **Shipped**: #1.\n- **Seeds retired**: spent.\n"
const HYGIENE = { "implementations-plan/.gitignore": CANONICAL_GITIGNORE, "implementations-plan/.ignore": "/archive/\n" }

describe("tracked-artifact", () => {
	test("a tracked transcript fails; a lessons file with a transcript-shaped name stays tracked", () => {
		const repo = makeRepo({ "implementations-plan/p/audit-codex.md": "a\n", "implementations-plan/p/lessons/audit-x.md": "l\n" })
		expect(findings(repo, "tracked-artifact").map((f) => f.file)).toEqual(["implementations-plan/p/audit-codex.md"])
	})

	test("a tracked file that an ignore rule covers fails (ls-files -ci, not check-ignore)", () => {
		const repo = makeRepo({ ".gitignore": "*.log\n", "implementations-plan/p/plan.md": "p\n" })
		writeFiles(repo, { "implementations-plan/p/run.log": "log\n" })
		git(repo, "add", "-f", "implementations-plan/p/run.log")
		commitAll(repo)
		expect(findings(repo, "tracked-artifact").map((f) => f.detail)).toEqual([
			"implementations-plan/p/run.log is tracked although ignored",
		])
	})

	test("a clean tree passes", () => {
		expect(findings(makeRepo({ ...HYGIENE, "implementations-plan/p/plan.md": "p\n" }), "tracked-artifact")).toEqual([])
	})
})

describe("hygiene-files", () => {
	test("the canonical files pass", () => {
		expect(findings(makeRepo(HYGIENE), "hygiene-files")).toEqual([])
	})

	test("missing files fail, one finding per missing line", () => {
		expect(findings(makeRepo({ "README.md": "r\n" }), "hygiene-files")).toHaveLength(6)
	})

	test("an appended `!audit-*.md` reds both hygiene-files and tracked-artifact", () => {
		const repo = makeRepo({
			...HYGIENE,
			"implementations-plan/.gitignore": `${CANONICAL_GITIGNORE}!audit-*.md\n`,
			"implementations-plan/p/audit-codex.md": "a\n",
		})
		expect(findings(repo, "hygiene-files").map((f) => `${f.line} ${f.detail}`)).toEqual([
			"6 `!audit-*.md` re-includes a transcript shape",
		])
		expect(findings(repo, "tracked-artifact").map((f) => f.file)).toEqual(["implementations-plan/p/audit-codex.md"])
	})

	test("the .ignore holds `/archive/` alone: a negation or any other pattern fails", () => {
		const repo = makeRepo({ ...HYGIENE, "implementations-plan/.ignore": "/archive/\n!/archive/\n\n*.md\n" })
		expect(findings(repo, "hygiene-files").map((f) => `${f.file}:${f.line}`)).toEqual([
			"implementations-plan/.ignore:2",
			"implementations-plan/.ignore:4",
		])
	})
})

describe("nested-ignore", () => {
	test("a nested .gitignore, .ignore or .rgignore fails", () => {
		const repo = makeRepo({
			...HYGIENE,
			"implementations-plan/p/.gitignore": "audit-*.md\n",
			"implementations-plan/q/.ignore": "!/archive/\n",
			"implementations-plan/archive/.rgignore": "!*\n",
		})
		expect(findings(repo, "nested-ignore").map((f) => f.file)).toEqual([
			"implementations-plan/archive/.rgignore",
			"implementations-plan/p/.gitignore",
			"implementations-plan/q/.ignore",
		])
	})

	test("an allowlisted one passes, and the allowlist only shrinks", () => {
		const repo = makeRepo({ ...HYGIENE, [NESTED_IGNORE_ALLOWLIST[0]]: "*\n!.gitignore\n" })
		expect(findings(repo, "nested-ignore")).toEqual([])
		expect(NESTED_IGNORE_ALLOWLIST.length).toBeLessThanOrEqual(1)
	})
})

describe("index-structure", () => {
	const split = { "implementations-plan/archive/index.md": "# Archive\n" }

	test("before the archive split there is no active set, so nothing is checked", () => {
		expect(findings(makeRepo({ "implementations-plan/index.md": "- [gone](gone/plan.md) — x — y\n" }), "index-structure")).toEqual([])
	})

	test("one line per active dir, pointing at its host, passes", () => {
		const repo = makeRepo({
			...split,
			"implementations-plan/index.md": "- [a](a/plan.md) — active — does a\n",
			"implementations-plan/a/plan.md": "# A\n",
		})
		expect(findings(repo, "index-structure")).toEqual([])
	})

	test("an unlisted dir, a duplicate, a dead target and an archive target each fail", () => {
		const repo = makeRepo({
			...split,
			"implementations-plan/index.md": [
				"- [a](a/plan.md) — active — a",
				"- [a2](a/plan.md) — active — again",
				"- [c](c/plan.md) — active — dead",
				"- [z](archive/z/plan.md) — closed — wrong index",
				"- [bad](bad/plan.md) no separators",
			].join("\n"),
			"implementations-plan/a/plan.md": "# A\n",
			"implementations-plan/b/plan.md": "# B\n",
		})
		expect(findings(repo, "index-structure").map((f) => f.detail)).toEqual([
			"b has no line in index.md",
			"a is listed twice",
			"c/plan.md is not in the git index",
			"z points into archive/",
			"archive/z/plan.md is not in the git index",
			"not `- [name](target) — status — hook`",
		])
	})

	test("an Outcome and the closing status go together", () => {
		const repo = makeRepo({
			...split,
			"implementations-plan/index.md": [
				"- [a](a/plan.md) — active — has an Outcome",
				"- [b](b/plan.md) — closed, awaiting archive — lacks one",
				"- [c](c/plan.md) — closed, awaiting archive — complete",
			].join("\n"),
			"implementations-plan/a/plan.md": `# A\n\n${OUTCOME}`,
			"implementations-plan/b/plan.md": "# B\n\n## Outcome & Quality Bar\n",
			"implementations-plan/c/plan.md": `# C\n\n${OUTCOME}`,
		})
		expect(findings(repo, "index-structure").map((f) => f.detail)).toEqual([
			"a has an Outcome but is listed as active",
			'b is "closed, awaiting archive" without a complete Outcome',
		])
	})
})

describe("archive-structure", () => {
	const line = (dir: string) => `- [${dir}](${dir}/plan.md) — completed 2026-09-25 (#1) — ${dir}`

	test("an archived plan with its line and a complete Outcome passes", () => {
		const repo = makeRepo({
			"implementations-plan/archive/index.md": `${line("a")}\n`,
			"implementations-plan/archive/a/plan.md": `# A\n\n${OUTCOME}`,
		})
		expect(findings(repo, "archive-structure")).toEqual([])
	})

	test("a fenced Outcome, an `Outcome & Quality Bar`, a missing Seeds line and a missing index line all fail", () => {
		const repo = makeRepo({
			"implementations-plan/archive/index.md": ["a", "b", "c"].map(line).join("\n"),
			"implementations-plan/archive/a/plan.md": `# A\n\n\`\`\`md\n${OUTCOME}\`\`\`\n`,
			"implementations-plan/archive/b/plan.md":
				"# B\n\n## Outcome & Quality Bar\n\n- **Date**: x **Status**: y **Shipped**: z **Seeds retired**: w\n",
			"implementations-plan/archive/c/plan.md": "# C\n\n## Outcome\n\n- **Date**: x. **Status**: y.\n- **Shipped**: z.\n",
			"implementations-plan/archive/d/plan.md": `# D\n\n${OUTCOME}`,
		})
		expect(findings(repo, "archive-structure").map((f) => f.file)).toEqual([
			"implementations-plan/archive/a/plan.md",
			"implementations-plan/archive/b/plan.md",
			"implementations-plan/archive/c/plan.md",
			"implementations-plan/archive/d",
		])
	})
})

describe("curated-budget", () => {
	const entry = "- One gotcha, in one line ([log](archive/p/lessons/phase-1.md)).\n"
	/** Padded before the first entry, where free text is allowed, to exactly `size` bytes. */
	const body = (size: number) => {
		const fixed = `# Lessons\n\n<!--  -->\n\n${entry}`
		return `# Lessons\n\n<!-- ${"x".repeat(size - Buffer.byteLength(fixed))} -->\n\n${entry}`
	}

	test("lessons.md at 8,192 B passes and at 8,193 B fails", () => {
		expect(Buffer.byteLength(body(8192))).toBe(8192)
		expect(findings(makeRepo({ "implementations-plan/lessons.md": body(8192) }), "curated-budget")).toEqual([])
		expect(findings(makeRepo({ "implementations-plan/lessons.md": body(8193) }), "curated-budget").map((f) => f.detail)).toEqual([
			"8193 B is over the 8192 B budget",
		])
	})

	test("a two-line entry, an entry without evidence and a foreign URL fail", () => {
		const repo = makeRepo({
			"implementations-plan/lessons.md": `# Lessons\n\n${entry}  continued on a second line\n- No link at all.\n- Evil [x](https://evil.example/x) and [log](archive/p/lessons/phase-1.md).\n`,
		})
		expect(findings(repo, "curated-budget").map((f) => `${f.line} ${f.detail}`)).toEqual([
			"4 an entry runs past one line",
			"5 the entry links no evidence",
			"6 https://evil.example/x leaves the plan tree",
		])
	})

	test("`*`, `+` and numbered items are entries too, held to evidence and one line", () => {
		const repo = makeRepo({
			"implementations-plan/lessons.md": [
				"# Lessons",
				"",
				"* No evidence.",
				"+ No evidence either.",
				"1. Numbered ([log](archive/p/lessons/phase-1.md))",
				"   and it runs on.",
				"2) Also no evidence.",
			].join("\n"),
		})
		expect(findings(repo, "curated-budget").map((f) => `${f.line} ${f.detail}`)).toEqual([
			"3 the entry links no evidence",
			"4 the entry links no evidence",
			"6 an entry runs past one line",
			"7 the entry links no evidence",
		])
	})

	test("a reference-style entry resolves against the whole document; a definition glued to an entry is a second line", () => {
		const ok = "# Lessons\n\n- One gotcha ([log][p1]).\n\n[p1]: archive/p/lessons/phase-1.md\n"
		expect(findings(makeRepo({ "implementations-plan/lessons.md": ok }), "curated-budget")).toEqual([])
		const glued = "# Lessons\n\n- One gotcha ([log][p1]).\n[p1]: archive/p/lessons/phase-1.md\n"
		expect(
			findings(makeRepo({ "implementations-plan/lessons.md": glued }), "curated-budget").map((f) => `${f.line} ${f.detail}`),
		).toEqual(["3 the entry links no evidence", "4 an entry runs past one line"])
	})

	test("an item indented one to three spaces is an entry, held to evidence and one line", () => {
		const repo = makeRepo({
			"implementations-plan/lessons.md": [
				"# Lessons",
				"",
				" - One space, no evidence.",
				"  - Two spaces ([log](archive/p/lessons/phase-1.md))",
				"    and it runs on.",
				"   - Three spaces, no evidence.",
			].join("\n"),
		})
		expect(findings(repo, "curated-budget").map((f) => `${f.line} ${f.detail}`)).toEqual([
			"3 the entry links no evidence",
			"5 an entry runs past one line",
			"6 the entry links no evidence",
		])
	})

	test("a would-be definition that renders a link lends no entry its evidence, and after the entries it is stray text", () => {
		const fake = "[unused]: bad target [fake](archive/p/plan.md)"
		const after = makeRepo({ "implementations-plan/lessons.md": `# Lessons\n\n- One gotcha, no link.\n\n${fake}\n` })
		expect(findings(after, "curated-budget").map((f) => `${f.line} ${f.detail}`)).toEqual([
			"3 the entry links no evidence",
			"5 text outside any entry",
		])
		const before = makeRepo({ "implementations-plan/lessons.md": `# Lessons\n\n${fake}\n\n- One gotcha, no link.\n` })
		expect(findings(before, "curated-budget").map((f) => `${f.line} ${f.detail}`)).toEqual(["5 the entry links no evidence"])
	})

	test("an entry is one paragraph on one line: a nested list or a second paragraph runs past it", () => {
		const log = "([log](archive/p/lessons/phase-1.md))"
		const src = `# Lessons\n\n- Parent ${log}\n  - child\n- Loose ${log}\n\n  second paragraph\n- Fine ${log}\n`
		expect(
			findings(makeRepo({ "implementations-plan/lessons.md": src }), "curated-budget").map((f) => `${f.line} ${f.detail}`),
		).toEqual(["4 an entry runs past one line", "7 an entry runs past one line"])
	})

	test("a raw HTML list beside the entries fails closed: no entry can borrow its links", () => {
		const src = "# Lessons\n\n<ul><li>raw [x](archive/p/lessons/phase-1.md)</li></ul>\n\n- One gotcha, no link.\n"
		expect(
			findings(makeRepo({ "implementations-plan/lessons.md": src }), "curated-budget").map((f) => `${f.line} ${f.detail}`),
		).toEqual(["1 raw HTML list items blur which entry owns a link"])
	})

	test("a valid multiline reference definition passes and resolves its entry's link", () => {
		const src = '# Lessons\n\n- One gotcha ([log][p1]).\n\n[p1]:\n  archive/p/lessons/phase-1.md\n  "the phase-1 log"\n'
		expect(findings(makeRepo({ "implementations-plan/lessons.md": src }), "curated-budget")).toEqual([])
	})

	test("follow-ups may point at this repository's issues and at plans", () => {
		const repo = makeRepo({
			"implementations-plan/follow-ups.md":
				"- Tracked in [#336](https://github.com/alejoamiras/nulo/issues/336), see [plan](archive/p/plan.md).\n",
		})
		expect(findings(repo, "curated-budget")).toEqual([])
	})
})

describe("local-path", () => {
	/** Assembled at runtime so the source never trips the repo's own home-path pre-commit guard. */
	const abs = (...segments: string[]) => `/${segments.join("/")}`

	test("a home path in a curated file, an index or the active plan dir fails", () => {
		const repo = makeRepo({
			"implementations-plan/lessons.md": `- Ran ${abs("home", "alice", "x")} ([l](archive/p/lessons/a.md)).\n`,
			"implementations-plan/index.md": `Built in ${abs("mnt", "data", "bob", "repo")}.\n`,
			"implementations-plan/plans-scaffolding/lessons/phase-1.md": `cd ${abs("Users", "carol", "nulo")}\n`,
		})
		expect(findings(repo, "local-path").map((f) => f.file)).toEqual([
			"implementations-plan/index.md",
			"implementations-plan/lessons.md",
			"implementations-plan/plans-scaffolding/lessons/phase-1.md",
		])
	})

	test("root's home, digit and underscore usernames and Windows profiles are home paths; a URL path is not", () => {
		const repo = makeRepo({
			"implementations-plan/plans-scaffolding/notes.md": [
				`cd ${abs("root", "project")}`,
				`cd ${abs("home", "1user", "p")}`,
				`cd ${abs("home", "_user", "p")}`,
				`cd ${["C:", "Users", "Alice", "x"].join("\\")}`,
				`"${["D:", "users", "bob"].join("\\\\")}"`,
				`see https://example.com${abs("home", "alice")} and repo${abs("root", "x")}`,
			].join("\n"),
		})
		expect(findings(repo, "local-path").map((f) => f.line)).toEqual([1, 2, 3, 4, 5])
	})

	test("a NUL byte in an in-scope Markdown file is a finding, and its lines are still scanned", () => {
		const repo = makeRepo({ "implementations-plan/plans-scaffolding/notes.md": `x\0y\ncd ${abs("home", "alice")}\n` })
		expect(findings(repo, "local-path").map((f) => `${f.line} ${f.detail}`)).toEqual([
			"1 a NUL byte makes git treat this document as binary",
			"2 an absolute home path",
		])
	})

	test("~ paths pass, and closed plan prose is out of scope until the split", () => {
		const repo = makeRepo({
			"implementations-plan/lessons.md": "- Ran ~/x ([l](archive/p/lessons/a.md)).\n",
			"implementations-plan/old-plan/lessons/phase-1.md": `cd ${abs("Users", "carol", "nulo")}\n`,
		})
		expect(findings(repo, "local-path")).toEqual([])
	})
})
