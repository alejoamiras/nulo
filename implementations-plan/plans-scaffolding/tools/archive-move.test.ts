import { afterAll, describe, expect, test } from "bun:test"
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { derive, fidelityProblems, swapProblems } from "./archive-move"
import { stampOf } from "./closed"
import { cleanupRepos, closuresRepo, commitAll, git, P, planTree, read, tool, writeFiles } from "./fixture"
import { fixtures } from "./gate"
import { ARCHIVE_HEADER } from "./split-index"

afterAll(cleanupRepos)

const STEPS: readonly string[][] = [["outcome", "--date", "2026-09-30"], ["archive-move"], ["split-index"], ["repair-links"]]

/** The planTree fixture after the archive pipeline, one commit per step as the plan runs it. */
function archived() {
	const { files, rows } = planTree()
	const { repo, head } = closuresRepo(files, rows)
	const run = (step: readonly string[]) => {
		const res = tool(repo, step[0], ...step.slice(1))
		if (res.status !== 0) throw new Error(`${step.join(" ")}: ${res.out}`)
	}
	run(STEPS[0])
	commitAll(repo, "outcomes")
	run(STEPS[1])
	commitAll(repo, "move")
	run(STEPS[2])
	run(STEPS[3])
	commitAll(repo, "index and links")
	return { repo, head, run }
}

describe("archive-move", () => {
	test("the four tools compose: the commits verify against their parent, a rerun changes nothing, and the gate passes them", () => {
		const { repo, head, run } = archived()
		const verified = tool(repo, "archive-move", "--verify", "--parent", head)
		expect(verified.out).toContain("0 problem(s)")
		expect(verified.out).toMatch(
			new RegExp(`note: ${P}/done/cites.md → ${P}/archive/done/cites.md: git pairs this planned edit only at R\\d+,`),
		)
		expect(verified.status).toBe(0)
		for (const step of STEPS) run(step)
		expect(git(repo, "status", "--short")).toBe("")
		for (const rule of ["index-structure", "archive-structure", "link-missing", "path-token"] as const)
			expect(fixtures.findings(repo, rule)).toEqual([])
		expect(read(repo, `${P}/index.md`)).toBe(
			"# Implementations plan index\n\nFormat: `- [plan-name](plan-name/plan.md) — status — one-line hook`\n\n- [parked](parked/plan.md) — PARKED — waits\n- a proposal — proposed — not planned\n- [live](live/plan.md) — in progress — the live plan\n- [plans-scaffolding](plans-scaffolding/plan.md) — in progress — this plan\n",
		)
		expect(read(repo, `${P}/archive/index.md`)).toBe(
			[
				...ARCHIVE_HEADER,
				"",
				"- [done](done/plan.md) — completed 2026-09-01 (#5, #6) — 2 phases ✓ (light) — the done plan, beside [live](../live/plan.md)",
				"- [dup](dup/plan.md) — completed 2026-09-01 — the later line",
				"- [fm](fm/plan.md) — historical, pre-open-source import (2026-05-19) — FM",
				"- [nest](nest/plan.md) — completed 2026-09-01 (#8) — a parent",
				"- [partial](partial/plan.md) — completed 2026-09-01 (#7) — a partial block",
				"- [seeds](seeds/plan.md) — completed 2026-09-01 — seeds everywhere",
				"- [stubbed](stubbed/plan.md) — completed 2026-09-01 — Notes",
				"- [whole](whole/plan.md) — completed 2026-09-01 (#3) — a complete block",
				"",
			].join("\n"),
		)
		expect(read(repo, `${P}/archive/done/plan.md`)).toContain(
			"See [the index](../../index.md), [live](../../live/plan.md), [code](../../../apps/x.ts) and [fm](../fm/plan.md).",
		)
		expect(read(repo, "CLAUDE.md")).toBe(
			"# Rules\n\nSee [done](implementations-plan/archive/done/plan.md), `implementations-plan/archive/fm/plan.md` and `implementations-plan/live/plan.md`.\n",
		)
		expect(read(repo, "audit/report.md")).toBe(
			"# Report\n\nPer [the plan](../implementations-plan/archive/done/plan.md), `implementations-plan/done/plan.md`.\n",
		)
		expect(read(repo, `${P}/follow-ups.md`)).toContain(
			"([plan](archive/done/plan.md)).\n- A child's loose end. It links [the child](archive/nest/child/plan.md).",
		)
		expect(read(repo, `${P}/live/plan.md`)).toContain("Links [done](../archive/done/plan.md).")
		expect(read(repo, "apps/x.ts")).toBe("// Named in implementations-plan/done/plan.md.\nexport const x = 1\n")
	})

	test("verify names each way the commits depart from their derivation", () => {
		const { repo, head } = archived()
		const d = derive(repo, head, "2026-09-30")
		const probe = (mutate: () => void) => {
			mutate()
			commitAll(repo, "mutation")
			const found = fidelityProblems(repo, head, d).join("\n")
			git(repo, "reset", "-q", "--hard", "HEAD~1")
			return found
		}
		const append = (path: string) => () => appendFileSync(join(repo, path), "Stray.\n")
		expect(fidelityProblems(repo, head, d)).toEqual([])
		expect(probe(append(`${P}/archive/fm/plan.md`))).toContain(`${P}/archive/fm/plan.md: differs from its derivation`)
		expect(probe(append(`${P}/archive/done/cites.md`))).toBe(`${P}/archive/done/cites.md: differs from its derivation`)
		expect(probe(() => writeFiles(repo, { [`${P}/archive/stubbed/notes.md`]: "Rewritten past recognition.\n" }))).toContain(
			`${P}/stubbed/notes.md: D, which the archive commits never make`,
		)
		expect(probe(append(`${P}/archive/stubbed/notes.md`))).toMatch(/stubbed\/notes\.md → .*: R\d+ with no planned edit/)
		expect(probe(() => writeFiles(repo, { [`${P}/archive/fm/extra.md`]: "x\n" }))).toContain("extra.md: added, but neither")
		expect(probe(append("apps/x.ts"))).toContain("apps/x.ts: modified with no planned edit")
		expect(probe(() => git(repo, "rm", "-q", `${P}/archive/seeds/indented.md`))).toContain(
			`${P}/seeds/indented.md: D, which the archive commits never make`,
		)
		expect(probe(() => git(repo, "mv", `${P}/archive/whole`, `${P}/whole`))).toContain(`${P}/whole/plan.md: no rename pairs it`)
		expect(probe(() => git(repo, "mv", "apps/x.ts", "apps/y.ts"))).toContain("apps/x.ts → apps/y.ts: a rename outside the move")
		expect(fidelityProblems(repo, head, d, 5).join("\n")).toContain("at or over the 5 cap")
		expect(probe(() => ["plan", "notes"].forEach((f) => append(`${P}/plans-scaffolding/${f}.md`)()))).toBe("")
		expect(probe(() => git(repo, "rm", "-q", `${P}/archive/stubbed/plan.md`))).toBe(
			`${P}/archive/stubbed/plan.md: a planned edit is missing from HEAD`,
		)
		expect(probe(() => git(repo, "mv", `${P}/archive/stubbed/notes.md`, `${P}/archive/stubbed/moved.md`))).toBe(
			`${P}/stubbed/notes.md → ${P}/archive/stubbed/moved.md: paired off its mapped path`,
		)
		expect(() => derive(repo, "HEAD", "2026-09-30")).toThrow("already archives")
		expect(() => stampOf(["Generated by plans-scaffolding on 2026-09-30.", "Generated by plans-scaffolding on 2026-10-01."])).toThrow(
			"several dates",
		)
		expect(swapProblems(repo, head, [[`${P}/dup/plan.md`, `${P}/archive/dup/plan.md`]], d.renames)).toEqual([])
		expect(swapProblems(repo, head, [[`${P}/dup/plan.md`, `${P}/archive/nest/plan.md`]], d.renames)).toEqual([
			`${P}/dup/plan.md → ${P}/archive/nest/plan.md: paired off its mapped path`,
		])
	})
})
