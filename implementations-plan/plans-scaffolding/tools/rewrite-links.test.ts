import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PERMALINK_PREFIX, type Row } from "./common"
import { cleanupRepos, commitAll, git, P, planRepo, writeFiles } from "./fixture"
import { promote } from "./promote"
import { rewriteDocument, rewriteLinks, verifyCommit } from "./rewrite-links"
import { record } from "./untrack"

afterAll(cleanupRepos)

describe("rewrite-links", () => {
	test("every link form to a transcript becomes its permalink; text, code spans and other links stay", () => {
		const promotions = [{ dir: "p", from: "plan-v2.md" }]
		const { repo, base } = planRepo({
			[`${P}/a/audit-x.md`]: "x\n",
			[`${P}/a/eli5.html`]: "<p>e</p>\n",
			[`${P}/a/plan.md`]: [
				"# A",
				"",
				"See [audit-x.md](audit-x.md), [ref][r], <a href='audit-x.md'>raw</a> and [kept](plan.md).",
				"The file `audit-x.md` is named, not linked.",
				"",
				"[r]: ./audit-x.md",
			].join("\n"),
			[`${P}/a/status.html`]: '<a href="eli5.html">eli5</a> <a href="plan.md">plan</a>\n',
			[`${P}/p/plan.md`]: "# v1\n",
			[`${P}/p/plan-v2.md`]: "# v2\n\nSupersedes [plan.md](plan.md).\n",
			[`${P}/dapp-interaction-lock-fix-v1/plan.md`]: "- [audit-codex-round-4.md](audit-codex-round-4.md) — gone.\n",
			[`${P}/token-identity/deployments.md`]: "d\n",
			[`${P}/token-identity/lessons/phase-1.md`]: "In [deployments.md](../token-identity/deployments.md).\n",
		})
		record({ cwd: repo, bases: [base], promotions })
		promote({ cwd: repo, promotions, renames: [] })
		commitAll(repo, "promote")
		const at = (path: string) => `${PERMALINK_PREFIX}${base}/${P}/${path}`
		const result = rewriteLinks({ cwd: repo, promotions })
		expect(result.files).toEqual([
			`${P}/a/plan.md`,
			`${P}/a/status.html`,
			`${P}/dapp-interaction-lock-fix-v1/plan.md`,
			`${P}/p/plan.md`,
			`${P}/token-identity/lessons/phase-1.md`,
		])
		expect(result.links).toBe(7)
		const read = (path: string) => readFileSync(join(repo, P, path), "utf8")
		expect(read("a/plan.md")).toBe(
			[
				"# A",
				"",
				`See [audit-x.md](${at("a/audit-x.md")}), [ref][r], <a href='${at("a/audit-x.md")}'>raw</a> and [kept](plan.md).`,
				"The file `audit-x.md` is named, not linked.",
				"",
				`[r]: ${at("a/audit-x.md")}`,
			].join("\n"),
		)
		expect(read("a/status.html")).toBe(`<a href="${at("a/eli5.html")}">eli5</a> <a href="plan.md">plan</a>\n`)
		expect(read("dapp-interaction-lock-fix-v1/plan.md")).toBe("- audit-codex-round-4.md — gone.\n")
		expect(read("p/plan.md")).toContain(`Supersedes [plan.md](${at("p/plan.md")}).`)
		expect(read("token-identity/lessons/phase-1.md")).toBe("In [deployments.md](../deployments.md).\n")

		const rewrite = commitAll(repo, "rewrite")
		expect(verifyCommit({ cwd: repo, commit: rewrite, promotions })).toEqual([])
		expect(rewriteLinks({ cwd: repo, promotions }).files).toEqual([])
		writeFiles(repo, { [`${P}/a/plan.md`]: `${read("a/plan.md")}\nextra\n` })
		const tampered = commitAll(repo, "tamper")
		expect(verifyCommit({ cwd: repo, commit: tampered, promotions })).toEqual([`${P}/a/plan.md differs from its re-derived rewrite`])
		expect(git(repo, "status", "--porcelain")).toBe("")
	})

	test("a rewrite that would change what renders is refused", () => {
		const rows = new Map<string, Row>([[`${P}/a/audit-x.md`, { path: `${P}/a/audit-x.md`, sha: "a".repeat(40), blob: "b".repeat(40) }]])
		const ctx = { rows, replacedPlans: new Set<string>() }
		const src = "[x](audit-x.md) and the example `[x](audit-x.md)`.\n"
		expect(() => rewriteDocument(`${P}/a/plan.md`, src, ctx)).toThrow("changes the rendered page beyond its URLs")
		expect(() => rewriteDocument(`${P}/a/notes.md`, "[x](audit-x.md#why)\n", ctx)).toThrow("a fragment a permalink cannot keep")
	})
})
