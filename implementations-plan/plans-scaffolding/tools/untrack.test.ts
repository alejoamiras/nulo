import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { BASES_FILE, MANIFEST, readManifest, writeManifest } from "./common"
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

	test("verify proves every row, covers every deleted or promoted-away path, and refuses a missing manifest", () => {
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

		rmSync(join(repo, MANIFEST))
		expect(verify({ cwd: repo, promotions })).toEqual([`${MANIFEST} is missing, so no row can be verified`])
	})

	test("a file archived with an edit git cannot pair stays in the tree; a transcript archived that way still needs a row", () => {
		const link = (name: string, target: string) => `[${name}](${target})\n`
		const { repo } = planRepo({ [`${P}/a/notes.md`]: link("notes", "x/plan.md"), [`${P}/a/audit-y.md`]: link("audit", "x/plan.md") })
		git(repo, "rm", "-q", `${P}/a/notes.md`, `${P}/a/audit-y.md`)
		writeFiles(repo, {
			[`${P}/archive/a/notes.md`]: link("notes", "archive/x/plan.md"),
			[`${P}/archive/a/audit-y.md`]: link("audit", "archive/x/plan.md"),
		})
		commitAll(repo, "archive a with a link repair")
		expect(git(repo, "diff", "--name-status", "-M", "origin/dev...HEAD")).toContain(`D\t${P}/a/notes.md`)
		writeManifest(repo, [])
		expect(verify({ cwd: repo, promotions: [] })).toEqual([`${P}/a/audit-y.md leaves the tree without a row`])
	})

	test("a kept file moved out of the plan tree byte for byte needs no row; one edited on the way, even at R100, or a transcript, does", () => {
		const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`)
		const { repo } = planRepo({
			[`${P}/a/kept.ts`]: "export const k = 1\n",
			[`${P}/a/edited.txt`]: `${lines.join("\n")}\n`,
			[`${P}/a/audit-x.md`]: "x\n",
			[`${P}/a/shuffled.ts`]: "first()\nsecond()\nthird()\n",
		})
		git(repo, "rm", "-q", `${P}/a/kept.ts`, `${P}/a/edited.txt`, `${P}/a/audit-x.md`, `${P}/a/shuffled.ts`)
		writeFiles(repo, {
			"scripts/kept.ts": "export const k = 1\n",
			"scripts/shuffled.ts": "third()\nsecond()\nfirst()\n",
			"data/edited.txt": `${[...lines.slice(0, 11), "line 11, edited"].join("\n")}\n`,
			"docs/audit-x.md": "x\n",
		})
		commitAll(repo, "move four files out of the plan tree")
		const diff = git(repo, "diff", "--name-status", "-M", "origin/dev...HEAD").split("\n")
		const status = Object.fromEntries(diff.map((l) => l.split("\t")).map(([s, from]) => [from, s]))
		expect(status[`${P}/a/kept.ts`]).toBe("R100")
		expect(status[`${P}/a/audit-x.md`]).toBe("R100")
		expect(status[`${P}/a/shuffled.ts`]).toBe("R100")
		expect(status[`${P}/a/edited.txt`]).toMatch(/^R0\d\d$/)
		writeManifest(repo, [])
		expect(verify({ cwd: repo, promotions: [] })).toEqual([
			`${P}/a/audit-x.md leaves the tree without a row`,
			`${P}/a/edited.txt leaves the tree without a row`,
			`${P}/a/shuffled.ts leaves the tree without a row`,
		])
	})

	test("a path whose bytes in the base being untracked differ from its row is refused, before untracking and in verify", () => {
		const { repo, base } = planRepo({ [`${P}/a/audit-x.md`]: "x1\n" }, { [`${P}/.gitignore`]: GITIGNORE })
		record({ cwd: repo, bases: [base] })
		commitAll(repo, "record")
		const [row] = readManifest(repo)
		git(repo, "switch", "-q", "dev")
		writeFiles(repo, { [`${P}/a/audit-x.md`]: "x2 edited upstream\n" })
		git(repo, "update-ref", "refs/remotes/origin/dev", commitAll(repo, "upstream edit"))
		git(repo, "switch", "-q", "work")
		git(repo, "rebase", "-q", "dev")
		const drifted = git(repo, "rev-parse", `HEAD:${P}/a/audit-x.md`)
		const drift = `${P}/a/audit-x.md: the base being untracked holds ${drifted}, not the recorded ${row.blob}`
		expect(() => apply({ cwd: repo })).toThrow(drift)
		git(repo, "rm", "-q", "--cached", `${P}/a/audit-x.md`)
		commitAll(repo, "untrack by hand")
		expect(verify({ cwd: repo })).toEqual([drift])
	})
})
