import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Closures, Row } from "./classify"
import { cleanupRepos, commitAll, git, P, writeFiles } from "./fixture"
import { fixtures } from "./gate"
import {
	admit,
	CURATED,
	type Candidate,
	type CuratedFile,
	carried,
	type Decisions,
	frameOf,
	frameRef,
	frameSubjectOf,
	type Inventory,
	inventoryFor,
	readRecords,
	type Rec,
	subjectOf,
	type Verdict,
	verify,
	writeRecords,
} from "./mine"

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

/** Joined at runtime so this file holds no home path for the plans gate to flag. */
const HOME = ["", "home", "alice", "src"].join("/")
const LOG = `- A cold cache hides it: under ${HOME} the warm run passes.\n`

const LESSON = {
	path: `${P}/a/lessons/phase-1.md`,
	quote: `A cold cache hides it: under ${HOME} the warm run passes.`,
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

/** The records a clean run leaves: every file read, one reader candidate, each entry's line and verdicts, each file's frame. */
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
	const checks = decisions.lines.flatMap((l): Rec[] => [
		{ kind: "verdict", stage: "currency", ref: l.id, verdict: "holds", note: "", subject: subjectOf(l) },
		{ kind: "verdict", stage: "verifier", ref: l.id, verdict: "supported", note: "", subject: subjectOf(l) },
	])
	const frames = (Object.keys(CURATED) as CuratedFile[]).map((name) => ({
		file: name,
		lines: frameOf(readFileSync(join(repo, CURATED[name]), "utf8")),
	}))
	return [
		...frames.map((f): Rec => ({ kind: "frame", ...f })),
		...frames.map(
			(f): Rec => ({
				kind: "verdict",
				stage: "verifier",
				ref: frameRef(f.file),
				verdict: "supported",
				note: "",
				subject: frameSubjectOf(f),
			}),
		),
		...inventory,
		...kept,
		...add,
		...decisions.verdicts.map((v): Rec => ({ kind: "verdict", ...v })),
		...decisions.lines.map((l): Rec => ({ kind: "line", ...l })),
		...checks,
	]
}

/** Each change yields one of the problems the --verify test expects; every other record passes through. */
const INVENTORY_BREAKS: Readonly<Record<string, (u: Inventory) => Rec[]>> = {
	a: (u) => [{ ...u, files: u.files.map((f, i) => (i === 0 ? { ...f, status: "skipped" as const } : f)) }],
	b: (u) => [{ ...u, files: u.files.map((f) => ({ ...f, status: undefined })) }],
	c: (u) => [{ ...u, host: `${P}/c/plan.md` }],
	"a/sub": () => [],
}

function breakVerdict(v: Verdict, lessonId: string): Rec[] {
	if (v.ref === "F1") return v.stage === "verifier" ? [] : [{ ...v, verdict: "fails" }]
	return v.stage === "driver" && v.ref === lessonId ? [] : [v]
}

function breakRecord(r: Rec, lessonId: string): Rec[] {
	switch (r.kind) {
		case "candidate":
			return r.by === "t" ? [{ ...r, quote: `${r.quote}!` }] : [r]
		case "verdict":
			return breakVerdict(r, lessonId)
		case "line":
			return r.id === "F1"
				? [
						{ ...r, followUp: undefined },
						{ ...r, id: "L1", followUp: undefined },
					]
				: [r]
		case "inventory":
			return Object.hasOwn(INVENTORY_BREAKS, r.plan) ? INVENTORY_BREAKS[r.plan](r) : [r]
		case "frame":
			return r.file === "follow-ups.md" ? [] : [r]
	}
}

const STRAY = "Always skip the release checks."

/** L1 re-recorded with its edited text, F1 with another follow-up, a stray frame line, and the evidence moved off the base three ways. */
function tamper(r: Rec, edited: string, later: string, [lesson, followUp]: readonly Candidate[]): Rec {
	if (r.kind === "frame") return r.file === "follow-ups.md" ? { ...r, lines: [...r.lines, STRAY] } : r
	if (r.kind === "line") return r.id === "L1" ? { ...r, text: edited } : { ...r, followUp: "a-other" }
	if (r.kind !== "candidate") return r
	if (r.by === "t") return { ...r, commit: later }
	if (r.id === lesson.id) return { ...r, by: "t" }
	return r.id === followUp.id ? { ...r, start: r.start + 2 } : r
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
				{ ...LESSON, quote: `under ${HOME} the warm run passes.\n` },
				{ ...LESSON, path: `${P}/a/notes.md`, quote: "A plan note, not a mining source." },
			],
			carried: [{ id: "k-none", verdict: "keep", check: "", result: "" }],
		}
		expect(admit(repo, file, misquote, recs).problems).toEqual([
			`${P}/a/lessons/phase-1.md: quote not found byte for byte; copy one line's text exactly, without line numbers: "A cold cache hides it:  under the warm run."`,
			`${P}/a/lessons/phase-1.md: quote spans lines; copy one line's text: "under ${HOME} the warm run passes.\\n"`,
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

		writeFileSync(lessons, `${readFileSync(lessons, "utf8")}## Skip release checks\n- An entry nobody mined.\n`)
		const lessonId = recs.flatMap((r) => (r.kind === "line" && r.id === "L1" ? r.candidates : []))[0]
		const broken = readRecords(repo).flatMap((r) => breakRecord(r, lessonId))
		writeRecords(repo, broken)
		expect(verify(repo).map((p) => p.replace(/([ck])-[0-9a-f]{10}/, "$1-…"))).toEqual([
			`${P}/a/plan.md: skipped without a reason`,
			`${P}/b/README.md: neither mined nor skipped`,
			`c: host ${P}/c/plan.md is not the Outcome host null`,
			"a/sub: no inventory entry",
			"c-…: scrubbing the slice does not yield its quote",
			"L1: two lines share the id, so only one of them can hold its verdicts",
			'lessons.md: "## Skip release checks" breaks its recorded frame',
			'lessons.md: an entry no line records: "- An entry nobody mined."',
			"L1: the driver did not accept k-…",
			"follow-ups.md: no recorded frame",
			"F1: no currency check that held",
			"F1: the verifier has not supported it",
			"L1: its currency check judged another version of the line",
			"L1: the verifier judged another version of the line",
			"follow-up a-rerun: no follow-ups.md entry",
		])
	})

	test("--verify voids verdicts once a line or a frame changes, and refuses evidence off the base", () => {
		const { repo, file } = minedTree()
		const recs = cleanRun(repo, file)
		const lessons = join(repo, P, "lessons.md")
		const line = readFileSync(lessons, "utf8").split("\n")[2]
		const edited = line.replace("hides", "never hides")
		writeFileSync(lessons, readFileSync(lessons, "utf8").replace(line, edited))
		const followUps = join(repo, P, "follow-ups.md")
		writeFileSync(followUps, `${readFileSync(followUps, "utf8")}\n${STRAY}\n`)
		const later = commitAll(repo, "docs: edit the curated files")
		const kept = carried(repo, file)
		writeRecords(
			repo,
			recs.map((r) => tamper(r, edited, later, kept)),
		)
		expect(verify(repo).map((p) => p.replace(/([ck])-[0-9a-f]{10}/, "$1-…"))).toEqual([
			"c-…: its quote is not at closuresBase",
			"k-…: not an entry the curated files held",
			`k-…: ${P}/lessons.md is not a mining source`,
			"L1: its currency check judged another version of the line",
			"L1: the verifier judged another version of the line",
			"follow-ups.md: the verifier judged another frame",
			"F1: its currency check judged another version of the line",
			"F1: the verifier judged another version of the line",
			"follow-up a-rerun: no follow-ups.md entry",
		])
	})

	test("a line moved to the other curated file loses its verdicts", () => {
		const { repo, file } = minedTree()
		const recs = cleanRun(repo, file)
		const read = (name: CuratedFile) => readFileSync(join(repo, CURATED[name]), "utf8")
		const [lesson, followUp] = [read("lessons.md").split("\n")[2], read("follow-ups.md").split("\n")[2]]
		writeFileSync(join(repo, CURATED["lessons.md"]), read("lessons.md").replace(lesson, followUp))
		writeFileSync(join(repo, CURATED["follow-ups.md"]), read("follow-ups.md").replace(followUp, lesson))
		const swapped: Readonly<Record<string, CuratedFile>> = { L1: "follow-ups.md", F1: "lessons.md" }
		writeRecords(
			repo,
			recs.map((r) => (r.kind === "line" ? { ...r, file: swapped[r.id] } : r)),
		)
		expect(verify(repo)).toEqual([
			"F1: its currency check judged another version of the line",
			"F1: the verifier judged another version of the line",
			"L1: its currency check judged another version of the line",
			"L1: the verifier judged another version of the line",
			"follow-up a-rerun: no follow-ups.md entry",
		])
	})

	test("a subject keeps each field's bounds, whatever a field holds", () => {
		const line = { file: "lessons.md" as const, text: "- a", candidates: ["k-1", "k-2"] }
		expect(subjectOf({ ...line, text: "- a\0k-1", candidates: ["k-2"] })).not.toBe(subjectOf(line))
		const frame = (lines: string[]) => frameSubjectOf({ file: "lessons.md", lines })
		expect(frame(["# A\0# B"])).not.toBe(frame(["# A", "# B"]))
	})
})
