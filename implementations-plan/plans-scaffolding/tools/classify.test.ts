import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { checkClosures, deriveRows, HISTORICAL, type Pr, RELOCATED } from "./classify"
import { cleanupRepos, commitAll, git, P, writeFiles } from "./fixture"
import { fixtures } from "./gate"

afterAll(cleanupRepos)

const LINES = [
	"- [old](old/plan.md) — done (#1) — a plan from the private repo",
	"- [check-names](check-names/plan.md) — ✅ COMPLETE — #11 merged, #12 deliberate-red correctly blocked",
	"- [release-cut](release-cut/plan.md) — SHIPPED — assetless recovery gated on tag-integrity",
	"- [waiting](waiting/plan.md) — blocked — on issue #20 and stack #21",
	"- [dup](dup/plan.md) — draft — first hook (#14)",
	"- [dup](dup/plan.md) — done — later hook (#15)",
	"- [context](context/plan.md) — done — follows #16 and #22; shipped in #17, #18 and #19",
]

/** An import holding `old`, then one commit per dir; the snapshot is built against the real commit times. */
function planTree(): { repo: string; imported: string; prs: Map<number, Pr> } {
	const repo = fixtures.makeRepo({ [`${P}/index.md`]: `${LINES.join("\n")}\n`, [`${P}/old/plan.md`]: "# Old\n" })
	const imported = git(repo, "rev-parse", "HEAD")
	const add = (dir: string, subject: string, files: Record<string, string> = {}) => {
		writeFiles(repo, { [`${P}/${dir}/plan.md`]: `# ${dir}\n`, ...files })
		return commitAll(repo, subject)
	}
	add("check-names", "feat: check names (#11)", { [`${P}/check-names/vectors.json`]: "{}\n" })
	const unnumbered = add("release-cut", "fix: a squash whose subject lost its number")
	add("waiting", "docs: waiting")
	add("dup", "docs: dup")
	add("status-only", "docs: status only", { [`${P}/status-only/STATUS.md`]: "# Status\n\n## Outcome\n\nShipped.\n" })
	add("context", "docs: context")
	const born = Date.parse(git(repo, "log", "-1", "--format=%cI"))
	const at = (ms: number) => new Date(ms).toISOString()
	const pr = (number: number, mergedAt: string | null, base = "dev", mergeCommit: string | null = null): Pr => ({
		number,
		state: mergedAt ? "MERGED" : "CLOSED",
		base,
		mergedAt,
		mergeCommit,
	})
	const later = "2099-01-01T00:00:00Z"
	const prs = [
		pr(1, later),
		pr(11, later),
		pr(12, null),
		pr(13, later, "dev", unnumbered),
		pr(14, later),
		pr(15, later),
		pr(16, "2000-01-01T00:00:00Z"),
		pr(17, later),
		pr(18, "2000-01-01T00:00:00Z", "stack/lower"),
		pr(19, at(born - 60_000)),
		pr(22, at(born - 600_000)),
	]
	return { repo, imported, prs: new Map(prs.map((p) => [p.number, p])) }
}

describe("classify", () => {
	test("a PR counts when its squash changed the dir's content or the dir's line names it after the plan began", () => {
		const { repo, imported, prs } = planTree()
		mkdirSync(join(repo, "reference"))
		git(repo, "mv", `${P}/check-names/vectors.json`, "reference/vectors.json")
		commitAll(repo, "chore: move the vectors beside their test (#30)")
		prs.set(30, { number: 30, state: "MERGED", base: "dev", mergedAt: "2099-01-01T00:00:00Z", mergeCommit: null })
		const rows = deriveRows({ cwd: repo, prs, importSha: imported })
		expect(rows.map((r) => [r.dir, r.class, r.evidence, r.prs])).toEqual([
			["check-names", "closed", "S1: merged #11", [11]],
			["context", "closed", "S1: merged #17, #18, #19", [17, 18, 19]],
			["dup", "closed", "S1: merged #14, #15", [14, 15]],
			["old", "closed", "S2: only the import touched it", []],
			["release-cut", "closed", "S1: merged #13", [13]],
			["status-only", "closed", "STATUS.md Outcome", []],
			["waiting", "ambiguous", "none", []],
		])
		const byDir = new Map(rows.map((r) => [r.dir, r]))
		expect(byDir.get("dup")?.hook).toBe("later hook (#15)")
		expect([byDir.get("old")?.status, byDir.get("old")?.date]).toEqual([HISTORICAL, "2026-05-19"])
	})

	test("--check holds each row to its base derivation and counts any content change as drift, whatever the subject", () => {
		const { repo, imported, prs } = planTree()
		writeFiles(repo, { [`${P}/passkey-e2e/PRF.md`]: "prf\n" })
		commitAll(repo, "docs: passkey notes")
		const closuresBase = git(repo, "rev-parse", "HEAD")
		const derived = deriveRows({ cwd: repo, prs, importSha: imported, ref: closuresBase })
		expect(derived.find((r) => r.dir === "passkey-e2e")?.status.startsWith(RELOCATED)).toBe(true)
		const rows = derived
			.filter((r) => r.dir !== "dup")
			.map((r) => (r.dir === "context" ? { ...r, class: "active" as const, outcomeFile: "../../outside.md" } : r))
		rows.push({ ...derived[0], dir: "gone" })
		mkdirSync(join(repo, "apps"))
		git(repo, "mv", `${P}/passkey-e2e/PRF.md`, "apps/PRF.md")
		commitAll(repo, "docs(e2e): keep PRF.md beside the suite")
		writeFiles(repo, { [`${P}/check-names/assets/moved.md`]: "x\n" })
		commitAll(repo, "chore(plans): relocate plan-dir assets that code and ci read")
		writeFiles(repo, { [`${P}/release-cut/plan.md`]: "# reopened\n" })
		commitAll(repo, "docs: reopen release-cut")
		const snapshot = (items: unknown[], totalCount: number) => JSON.stringify({ capturedAt: "2026-09-30", totalCount, items })
		writeFiles(repo, { [`${P}/plans-scaffolding/gh-prs.json`]: snapshot([...prs.values()], prs.size) })
		writeFileSync(join(repo, P, "plans-scaffolding/gh-issues.json"), snapshot([{ number: 20 }], 2))
		const base = closuresBase.slice(0, 8)
		expect(checkClosures(repo, { closuresBase, rows }, "HEAD", imported)).toEqual({
			problems: [
				`${P}/plans-scaffolding/gh-issues.json: 1 items of 2`,
				"context: its class is not what closuresBase derives",
				"context: its outcomeFile is not what closuresBase derives",
				"gone: no such dir at closuresBase",
				"waiting: ambiguous (AMBIGUOUS — no merged PR, no answer)",
				"gone: no such dir",
				`check-names: changed since ${base}; re-answer it and regenerate`,
				`release-cut: changed since ${base}; re-answer it and regenerate`,
			],
			rowless: ["dup"],
		})
	})
})
