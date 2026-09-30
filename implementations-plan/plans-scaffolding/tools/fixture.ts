/** Fixture repos shaped like this one: a first base, then `origin/dev` ahead of it, then a work branch. */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CLOSURES, type Row } from "./classify"
import { ancestorDirs, type View } from "./closed"
import { fixtures } from "./gate"

export const { cleanupRepos, commitAll, git, writeFiles } = fixtures
export const P = "implementations-plan"

export type PlanRepo = { repo: string; base: string; dev: string }

/** `baseFiles` land in the first base, `devFiles` on dev after it; the work branch starts at dev. */
export function planRepo(baseFiles: Record<string, string>, devFiles: Record<string, string> = {}): PlanRepo {
	const repo = fixtures.makeRepo({ "scripts/ci-cd/plans/permalink-bases.json": "{}\n", ...baseFiles })
	const base = git(repo, "rev-parse", "HEAD")
	writeFiles(repo, devFiles)
	const dev = commitAll(repo, "dev")
	git(repo, "update-ref", "refs/remotes/origin/dev", dev)
	git(repo, "switch", "-q", "-c", "work")
	return { repo, base, dev }
}

export function tracked(repo: string, prefix = P): string[] {
	return git(repo, "ls-files", "--", prefix).split("\n").filter(Boolean)
}

/** A closed row with a host `plan.md`, unless `over` says otherwise. */
export function row(dir: string, over: Partial<Row> = {}): Row {
	return {
		dir,
		class: "closed",
		status: "completed",
		date: "2026-09-01",
		prs: [],
		outcomeFile: `${P}/${dir}/plan.md`,
		followUps: [],
		hook: dir,
		evidence: "fixture",
		...over,
	}
}

export type ClosuresRepo = { repo: string; base: string; head: string }

/** `files` in a first commit, then `closures.json` naming that commit as its base in a second. */
export function closuresRepo(files: Record<string, string>, rows: readonly Row[]): ClosuresRepo {
	const repo = fixtures.makeRepo({ "scripts/ci-cd/plans/permalink-bases.json": "{}\n", ...files })
	const base = git(repo, "rev-parse", "HEAD")
	writeFiles(repo, { [CLOSURES]: `${JSON.stringify({ closuresBase: base, rows }, null, "\t")}\n` })
	return { repo, base, head: commitAll(repo, "closures") }
}

/** Runs a tool's command line in `repo`. */
export function tool(repo: string, name: string, ...args: string[]): { status: number | null; out: string } {
	const res = spawnSync("bun", [join(import.meta.dir, `${name}.ts`), ...args], { cwd: repo, encoding: "utf8" })
	return { status: res.status, out: `${res.stdout}${res.stderr}` }
}

export function read(repo: string, path: string): string {
	return readFileSync(join(repo, path), "utf8")
}

/** An in-memory tree. */
export function memView(files: Record<string, string>): View {
	const paths = new Set(Object.keys(files))
	return { tracked: paths, dirs: ancestorDirs(paths), load: () => {}, read: (p) => files[p] ?? "" }
}

const INDEX = `# Implementations plan index

Format: \`- [plan-name](plan-name/plan.md) — status — one-line hook\`

- [done](done/plan.md) — **complete — 2 phases ✓** (light) — the done plan, beside [live](live/plan.md)
- [fm](fm/plan.md) — historical — pre-open-source import (2026-05-19) — FM
- [partial](partial/plan.md) — closed, awaiting archive — a partial block
- [whole](whole/plan.md) — closed, awaiting archive — a complete block
- [dup](dup/plan.md) — DRAFT — the first line
- [dup](dup/plan.md) — completed — the later line

## Children

A paragraph about them.

- [nest](nest/plan.md) — completed — a parent
- [seeds](seeds/plan.md) — completed — seeds everywhere
- [parked](parked/plan.md) — PARKED — waits
- a proposal — proposed — not planned
- [live](live/plan.md) — in progress — the live plan
- [plans-scaffolding](plans-scaffolding/plan.md) — in progress — this plan
`

/** Git pairs an edited file with its rename only while half of it is unchanged, as the real hosts are. */
export const PAD = `\n${"This paragraph pads the file, so git still pairs its rename once a block is added. ".repeat(20).trim()}\n`

/** Long lines that each open with a rooted cite: mapping them leaves the file too unlike itself for git to pair. */
const CITES = Array.from(
	{ length: 6 },
	(_, i) => `- See [the plan](implementations-plan/done/plan.md:${i + 1}), ${"then a long tail of prose ".repeat(12)}\n`,
).join("")

/**
 * One plan tree for the archive tools: closed dirs with no block, front matter, a partial block, a
 * complete one, a nested plan, no host, seed files; active and parked dirs; a row whose dir is gone; and
 * the curated, live, audit and code files that link or name them.
 */
export function planTree(): { files: Record<string, string>; rows: Row[] } {
	const files: Record<string, string> = {
		[`${P}/index.md`]: INDEX,
		[`${P}/follow-ups.md`]:
			"# Follow-ups\n\n- **Fix the thing** — before launch ([plan](done/plan.md)).\n- A child's loose end. It links [the child](nest/child/plan.md).\n- **Live work** — see [live](live/plan.md).\n",
		[`${P}/lessons.md`]: "# Lessons\n\n- A lesson. [Evidence](done/plan.md)\n",
		[`${P}/done/plan.md`]: `# Done\n\nSee [the index](../index.md), [live](../live/plan.md), [code](../../apps/x.ts) and [fm](../fm/plan.md).\n\n\`\`\`\n/goal finish done\n\`\`\`\n${PAD}`,
		[`${P}/done/cites.md`]: `# Cites\n\n${CITES}`,
		[`${P}/fm/plan.md`]: `---\nplan: fm\ntier: light\n---\n\n# FM\n${PAD}`,
		[`${P}/partial/plan.md`]:
			"---\nplan: partial\n---\n\n## Outcome\n\n- **Date:** 2026-09-02. **Status:** closed.\n- **Shipped** on a branch.\n- **Seeds retired:** spent.\n\n# Partial\n",
		[`${P}/whole/plan.md`]:
			"## Outcome\n\n- **Date**: 2026-09-03. **Status**: completed.\n- **Shipped**: #3.\n- **Seeds retired**: spent.\n\n# Whole\n",
		[`${P}/nest/plan.md`]: `# Nest\n${PAD}`,
		[`${P}/nest/child/plan.md`]: `# Child\n\nSee [the parent](../plan.md).\n${PAD}`,
		[`${P}/stubbed/notes.md`]: "# Notes\n\nSee [done](../done/plan.md).\n",
		[`${P}/seeds/plan.md`]: `# Seeds\n${PAD}`,
		[`${P}/seeds/goal.md`]: `# Goal\n\nPaste:\n\n\`\`\`\n/goal ship it\n\`\`\`\n\n\`\`\`\n/loop again\n\`\`\`\n${PAD}`,
		[`${P}/seeds/eli5-v2.html`]: `<html><body><p>Seeds</p>\n    <pre><code>/loop 5m check</code></pre>\n<p>${PAD}</p>\n</body></html>\n`,
		[`${P}/seeds/indented.md`]: `# Indented\n\n    /goal indented seed\n${PAD}`,
		[`${P}/dup/plan.md`]: `# Dup\n${PAD}`,
		[`${P}/live/plan.md`]: "# Live\n\n```\n/goal live seed\n```\n\nLinks [done](../done/plan.md).\n",
		[`${P}/parked/plan.md`]: "# Parked\n",
		[`${P}/plans-scaffolding/plan.md`]: "# Plans scaffolding\n",
		[`${P}/plans-scaffolding/notes.md`]: "# Notes\n\nArchives [done](../done/plan.md).\n",
		"CLAUDE.md":
			"# Rules\n\nSee [done](implementations-plan/done/plan.md), `implementations-plan/fm/plan.md` and `implementations-plan/live/plan.md`.\n",
		"audit/report.md": "# Report\n\nPer [the plan](../implementations-plan/done/plan.md), `implementations-plan/done/plan.md`.\n",
		"apps/x.ts": "// Named in implementations-plan/done/plan.md.\nexport const x = 1\n",
	}
	const rows = [
		row("done", {
			prs: [5, 6],
			followUps: ["fix-the-thing"],
			hook: "2 phases ✓** (light) — the done plan, beside [live](live/plan.md)",
		}),
		row("dup", { hook: "the later line" }),
		row("fm", { status: "historical — pre-open-source import (2026-05-19)", date: "2026-05-19", hook: "FM" }),
		row("gone", { hook: "a dir no longer in the tree" }),
		row("live", { class: "active", status: "ACTIVE" }),
		row("nest", { prs: [8], hook: "a parent" }),
		row("parked", { class: "parked", status: "PARKED" }),
		row("partial", { prs: [7], hook: "a partial block" }),
		row("plans-scaffolding", { class: "active", status: "ACTIVE" }),
		row("seeds", { hook: "seeds everywhere" }),
		row("stubbed", { outcomeFile: null, hook: "Notes" }),
		row("whole", { prs: [3], hook: "a complete block" }),
	]
	return { files, rows }
}
