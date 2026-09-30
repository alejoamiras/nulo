import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Closures, Row } from "./classify"
import { cleanupRepos, git, P, writeFiles } from "./fixture"
import { fixtures } from "./gate"
import { admit, carried, type Decisions, inventoryFor, readRecords, type Rec, verify, writeRecords } from "./mine"

afterAll(cleanupRepos)

const row = (dir: string, outcomeFile: string | null, followUps: string[] = []): Row => ({
	dir,
	class: "closed",
	status: "completed",
	date: "2026-09-01",
	prs: [],
	outcomeFile,
	followUps,
	hook: dir,
	evidence: "S1",
})

const LOG = "- A cold cache hides it: under /home/alice/src the warm run passes.\n"

const LESSON = {
	path: `${P}/a/lessons/phase-1.md`,
	quote: "A cold cache hides it: under /home/alice/src the warm run passes.",
	cluster: "bun-deps" as const,
	target: "lessons" as const,
	gotcha: "g",
	owner: "lessons.md",
	sourceDate: "2026-09-01",
	check: "c",
	result: "r",
}

/** Plans `a` (with nested `a/sub`), `b` hosted by its README, and `c` with no host; one lesson, one follow-up. */
function minedTree(): { repo: string; file: Closures } {
	const repo = fixtures.makeRepo({
		[`${P}/a/plan.md`]: "# A\n",
		[`${P}/a/lessons/phase-1.md`]: LOG,
		[`${P}/a/notes.md`]: "A plan note, not a mining source.\n",
		[`${P}/a/sub/plan.md`]: "# Sub\n",
		[`${P}/a/sub/lessons/x.md`]: "sub log\n",
		[`${P}/b/README.md`]: "# B\n",
		[`${P}/c/shot.png`]: "png",
		[`${P}/lessons.md`]: "# Lessons\n\n- A warm cache hides a cold-cache crash ([evidence](a/lessons/phase-1.md)).\n",
		[`${P}/follow-ups.md`]: "# Follow-ups\n\n- **Rerun on a cold cache.** [Record](a/plan.md)\n",
	})
	const file: Closures = {
		closuresBase: git(repo, "rev-parse", "HEAD"),
		rows: [row("a", `${P}/a/plan.md`, ["a-rerun"]), row("b", `${P}/b/README.md`), row("c", null)],
	}
	writeFiles(repo, { [`${P}/plans-scaffolding/closures.json`]: JSON.stringify(file) })
	return { repo, file }
}

/** The records a clean run leaves: every file read, one reader candidate, each entry's line and verdicts. */
function cleanRun(repo: string, file: Closures): Rec[] {
	const inventory = inventoryFor(repo, file).map((u) => ({ ...u, files: u.files.map((f) => ({ ...f, status: "read" as const })) }))
	const kept = carried(repo, file)
	const reader = {
		reader: "t",
		files: [],
		candidates: [LESSON],
		carried: kept.map((k) => ({ id: k.id, verdict: "keep", check: "c", result: "r" })),
	}
	const { add, problems } = admit(repo, file, reader, [...inventory, ...kept])
	expect(problems).toEqual([])
	const mined = add.find((r) => r.kind === "candidate")
	const [lesson, followUp] = kept
	const decisions: Decisions = {
		verdicts: [...kept.map((k) => k.id), mined?.kind === "candidate" ? mined.id : ""].flatMap((id) => [
			{ stage: "driver", ref: id, verdict: "accept", note: "" },
		]),
		lines: [
			{
				id: "L1",
				file: "lessons.md",
				text: readFileSync(join(repo, P, "lessons.md"), "utf8").split("\n")[2],
				candidates: [lesson.id],
			},
			{
				id: "F1",
				file: "follow-ups.md",
				text: readFileSync(join(repo, P, "follow-ups.md"), "utf8").split("\n")[2],
				candidates: [followUp.id],
				followUp: "a-rerun",
			},
		],
	}
	const checks = ["L1", "F1"].flatMap((ref): Rec[] => [
		{ kind: "verdict", stage: "currency", ref, verdict: "holds", note: "" },
		{ kind: "verdict", stage: "verifier", ref, verdict: "supported", note: "" },
	])
	return [
		...inventory,
		...kept,
		...add,
		...decisions.verdicts.map((v): Rec => ({ kind: "verdict", ...v })),
		...decisions.lines.map((l): Rec => ({ kind: "line", ...l })),
		...checks,
	]
}

describe("mine", () => {
	test("the inventory is keyed by plan: a nested plan owns its files, hosts come from the table, only sources are listed", () => {
		const { repo, file } = minedTree()
		expect(inventoryFor(repo, file).map((u) => [u.plan, u.host, u.files.map((f) => f.path)])).toEqual([
			["a", `${P}/a/plan.md`, [`${P}/a/plan.md`, `${P}/a/lessons/phase-1.md`]],
			["b", `${P}/b/README.md`, [`${P}/b/README.md`]],
			["c", null, []],
			["a/sub", `${P}/a/sub/plan.md`, [`${P}/a/sub/plan.md`, `${P}/a/sub/lessons/x.md`]],
		])
	})

	test("a quote is admitted only byte for byte, and its home path is scrubbed for display, not for the hash", () => {
		const { repo, file } = minedTree()
		const recs = cleanRun(repo, file)
		const mined = recs.find((r) => r.kind === "candidate" && r.by === "t")
		expect(mined?.kind === "candidate" && mined.quote).toBe("A cold cache hides it: under <local path> the warm run passes.")
		const misquote = {
			reader: "t",
			files: [{ path: `${P}/a/nope.md`, status: "read" as const }],
			candidates: [
				{ ...LESSON, quote: "A cold cache hides it:  under the warm run." },
				{ ...LESSON, quote: "under /home/alice/src the warm run passes.\n" },
				{ ...LESSON, path: `${P}/a/notes.md`, quote: "A plan note, not a mining source." },
			],
			carried: [{ id: "k-none", verdict: "keep", check: "", result: "" }],
		}
		expect(admit(repo, file, misquote, recs).problems).toEqual([
			`${P}/a/lessons/phase-1.md: quote not found byte for byte; copy one line's text exactly, without line numbers: "A cold cache hides it:  under the warm run."`,
			`${P}/a/lessons/phase-1.md: quote spans lines; copy one line's text: "under /home/alice/src the warm run passes.\\n"`,
			`${P}/a/notes.md: not a mining source in the inventory`,
			"k-none: no such carried candidate",
			`${P}/a/nope.md: reported but not in the inventory`,
		])
	})

	test("--verify holds a clean run, keeps an entry whose links moved under archive/, and names each gap", () => {
		const { repo, file } = minedTree()
		const recs = cleanRun(repo, file)
		writeRecords(repo, recs)
		expect(verify(repo)).toEqual([])
		const lessons = join(repo, P, "lessons.md")
		writeFileSync(lessons, readFileSync(lessons, "utf8").replace("](a/", "](archive/a/"))
		expect(verify(repo)).toEqual([])

		writeFileSync(lessons, `${readFileSync(lessons, "utf8")}- An entry nobody mined.\n`)
		const lessonId = recs.flatMap((r) => (r.kind === "line" && r.id === "L1" ? r.candidates : []))[0]
		const broken = readRecords(repo).flatMap((r): Rec[] => {
			if (r.kind === "candidate" && r.by === "t") return [{ ...r, quote: `${r.quote}!` }]
			if (r.kind === "verdict" && r.ref === "F1") return r.stage === "verifier" ? [] : [{ ...r, verdict: "fails" }]
			if (r.kind === "verdict" && r.stage === "driver" && r.ref === lessonId) return []
			if (r.kind === "line" && r.id === "F1")
				return [
					{ ...r, followUp: undefined },
					{ ...r, id: "L1", followUp: undefined },
				]
			if (r.kind === "inventory" && r.plan === "b") return [{ ...r, files: r.files.map((f) => ({ ...f, status: undefined })) }]
			if (r.kind === "inventory" && r.plan === "a")
				return [{ ...r, files: r.files.map((f, i) => (i === 0 ? { ...f, status: "skipped" as const } : f)) }]
			if (r.kind === "inventory" && r.plan === "c") return [{ ...r, host: `${P}/c/plan.md` }]
			if (r.kind === "inventory" && r.plan === "a/sub") return []
			return [r]
		})
		writeRecords(repo, broken)
		expect(verify(repo).map((p) => p.replace(/([ck])-[0-9a-f]{10}/, "$1-…"))).toEqual([
			`${P}/a/plan.md: skipped without a reason`,
			`${P}/b/README.md: neither mined nor skipped`,
			`c: host ${P}/c/plan.md is not the Outcome host null`,
			"a/sub: no inventory entry",
			"c-…: scrubbing the slice does not yield its quote",
			"L1: two lines share the id, so one's verdicts would pass the other",
			'lessons.md: an entry no line records: "- An entry nobody mined."',
			"L1: the driver did not accept k-…",
			"F1: no currency check that held",
			"F1: the verifier has not supported it",
			"follow-up a-rerun: no follow-ups.md entry",
		])
	})
})
