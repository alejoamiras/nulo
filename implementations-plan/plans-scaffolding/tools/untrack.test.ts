import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { BASES_FILE, readManifest, writeManifest } from "./common"
import { cleanupRepos, commitAll, git, P, planRepo, tracked, writeFiles } from "./fixture"
import { promote } from "./promote"
import { apply, record, verify } from "./untrack"

afterAll(cleanupRepos)

const GITIGNORE = "audit-*.md\nplan-*.md\n_*.md\neli5.html\n!**/lessons/**\n"

describe("untrack", () => {
	test("record pins each path to the first base holding its blob, appends only, and refuses a path no base holds", () => {
		const { repo, base, dev } = planRepo(
			{ [`${P}/a/audit-x.md`]: "x1\n", [`${P}/a/lessons/audit-y.md`]: "y\n", [`${P}/b/_brief.md`]: "b\n" },
			{ [`${P}/a/audit-x.md`]: "x2\n", [`${P}/c/eli5.html`]: "<p>c</p>\n" },
		)
		expect(() => apply({ cwd: repo })).toThrow("run --record first")
		const { added, bases } = record({ cwd: repo, bases: [base] })
		expect(added.map((r) => `${r.path} ${r.sha === base ? "base" : r.sha === dev ? "dev" : r.sha}`)).toEqual([
			`${P}/a/audit-x.md dev`,
			`${P}/b/_brief.md base`,
			`${P}/c/eli5.html dev`,
		])
		expect(bases.sort()).toEqual([base, dev].sort())
		expect(Object.keys(JSON.parse(readFileSync(join(repo, BASES_FILE), "utf8"))).sort()).toEqual([base, dev].sort())
		commitAll(repo, "record")
		expect(record({ cwd: repo, bases: [base] }).added).toEqual([])

		writeFiles(repo, { [`${P}/d/audit-new.md`]: "new\n" })
		commitAll(repo, "branch-only transcript")
		expect(() => record({ cwd: repo, bases: [base] })).toThrow(`no base holds the HEAD blob of:\n  ${P}/d/audit-new.md`)

		const rows = readManifest(repo)
		writeManifest(repo, [{ ...rows[0], blob: rows[1].blob }, ...rows.slice(1)])
		expect(() => record({ cwd: repo, bases: [base] })).toThrow("manifest rows no longer verify")
	})

	test("apply untracks every recorded transcript, keeps lessons/, and leaves nothing tracked that is ignored", () => {
		const { repo, base } = planRepo(
			{ [`${P}/a/plan.md`]: "# A\n", [`${P}/a/audit-x.md`]: "x\n", [`${P}/a/lessons/audit-y.md`]: "y\n" },
			{ [`${P}/.gitignore`]: GITIGNORE },
		)
		record({ cwd: repo, bases: [base] })
		expect(apply({ cwd: repo })).toEqual([`${P}/a/audit-x.md`])
		expect(tracked(repo)).toEqual([`${P}/.gitignore`, `${P}/a/lessons/audit-y.md`, `${P}/a/plan.md`])
	})

	test("verify proves every row and covers every deleted or promoted-away path", () => {
		const promotions = [{ dir: "p", from: "plan-v2.md" }]
		const { repo, base } = planRepo(
			{
				[`${P}/p/plan.md`]: "# v1\n",
				[`${P}/p/plan-v2.md`]: "# v2\n",
				[`${P}/p/audit-x.md`]: "x\n",
				[`${P}/p/notes.md`]: "n\n",
			},
			{ [`${P}/.gitignore`]: GITIGNORE },
		)
		record({ cwd: repo, bases: [base], promotions })
		expect(readManifest(repo).map((r) => r.path)).toEqual([`${P}/p/audit-x.md`, `${P}/p/plan-v2.md`, `${P}/p/plan.md`])
		promote({ cwd: repo, promotions, renames: [] })
		apply({ cwd: repo })
		commitAll(repo, "untrack")
		expect(verify({ cwd: repo, promotions })).toEqual([])

		git(repo, "rm", "-q", `${P}/p/notes.md`)
		const branchOnly = commitAll(repo, "delete a kept file")
		const rows = readManifest(repo)
		writeManifest(repo, [{ ...rows[0], sha: branchOnly }, ...rows.slice(1).filter((r) => r.path !== `${P}/p/plan.md`)])
		expect(verify({ cwd: repo, promotions })).toEqual([
			`${P}/p/audit-x.md: blob ${rows[0].blob} is not at ${branchOnly}`,
			`${branchOnly} is not in ${BASES_FILE}`,
			`${branchOnly} is not an ancestor of dev`,
			`${P}/p/notes.md leaves the tree without a row`,
			`${P}/p/plan.md leaves the tree without a row`,
		])
	})
})
