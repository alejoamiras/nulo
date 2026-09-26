import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PERMALINK_PREFIX } from "./common"
import { cleanupRepos, git, P, planRepo, tracked } from "./fixture"
import { insertUnderTitle, promote } from "./promote"
import { record } from "./untrack"

afterAll(cleanupRepos)

describe("promote", () => {
	test("the latest revision becomes plan.md and lists every earlier revision by permalink; leg drafts are not revisions", () => {
		const promotions = [{ dir: "p", from: "plan-v2.md" }]
		const renames = [[`${P}/q/audit-findings.md`, `${P}/q/findings.md`] as const]
		const { repo, base } = planRepo({
			[`${P}/p/plan.md`]: "# v1\n",
			[`${P}/p/plan-v1.md`]: "# v1 again\n",
			[`${P}/p/plan-v2.md`]: "# P v2\n\nbody\n",
			[`${P}/p/plan-codex.md`]: "# leg\n",
			[`${P}/q/audit-findings.md`]: "curated\n",
		})
		expect(() => promote({ cwd: repo, promotions, renames })).toThrow("run untrack.ts --record first")
		record({ cwd: repo, bases: [base], promotions })
		expect(promote({ cwd: repo, promotions, renames })).toEqual({ promoted: ["p"], renamed: [`${P}/q/audit-findings.md`] })
		const at = (f: string) => `${PERMALINK_PREFIX}${base}/${P}/p/${f}`
		expect(readFileSync(join(repo, P, "p/plan.md"), "utf8")).toBe(
			`# P v2\n\nEarlier revisions: [plan.md](${at("plan.md")}), [plan-v1.md](${at("plan-v1.md")}).\n\nbody\n`,
		)
		expect(tracked(repo)).toEqual([`${P}/p/plan-codex.md`, `${P}/p/plan-v1.md`, `${P}/p/plan.md`, `${P}/q/findings.md`])
		git(repo, "add", "-A")
		git(repo, "commit", "-q", "-m", "promote")
		expect(promote({ cwd: repo, promotions, renames })).toEqual({ promoted: [], renamed: [] })
		expect(git(repo, "status", "--porcelain")).toBe("")
	})

	test("the line sits under the H1, after any front matter, and first when there is no H1", () => {
		expect(insertUnderTitle("---\nx: 1\n---\n# T\nbody\n", "L")).toBe("---\nx: 1\n---\n# T\n\nL\n\nbody\n")
		expect(insertUnderTitle("no title\n", "L")).toBe("L\n\nno title\n")
	})
})
