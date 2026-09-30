/**
 * What the archive tools share: the closed dirs the closure table lets them touch, where each one lives,
 * the move map, and a read-only view of a tree, the git index or a commit.
 */
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { CLOSURES, type Closures, type Row } from "./classify"
import { git, PLANS } from "./common"
import { lib, structure } from "./gate"

export const ARCHIVE = lib.ARCHIVE
export const FOLLOW_UPS = `${PLANS}/follow-ups.md`

/** A tree to read: its tracked paths, the dirs holding them, and each regular file's text ("" when absent). */
export type View = {
	tracked: ReadonlySet<string>
	dirs: ReadonlySet<string>
	read(path: string): string
	load(paths: Iterable<string>): void
}

export function has(view: Pick<View, "tracked" | "dirs">, path: string): boolean {
	const clean = path.replace(/\/+$/, "")
	return view.tracked.has(clean) || view.dirs.has(clean)
}

export function ancestorDirs(files: Iterable<string>): Set<string> {
	const dirs = new Set<string>()
	for (const file of files) {
		for (let at = file.indexOf("/"); at !== -1; at = file.indexOf("/", at + 1)) dirs.add(file.slice(0, at))
	}
	return dirs
}

export function indexView(cwd: string): View {
	return lib.createCtx({ cwd })
}

function catBlobs(cwd: string, oids: readonly string[]): Map<string, string> {
	const res = spawnSync("git", ["cat-file", "--batch"], {
		cwd,
		env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
		input: `${oids.join("\n")}\n`,
		maxBuffer: 1 << 30,
	})
	if (res.status !== 0) throw new Error(`git cat-file --batch failed: ${res.stderr?.toString().trim()}`)
	const out = res.stdout
	const blobs = new Map<string, string>()
	let at = 0
	for (const oid of oids) {
		const eol = out.indexOf(0x0a, at)
		const header = out.toString("latin1", at, eol)
		const size = header.startsWith(`${oid} blob `) ? Number(header.slice(oid.length + 6)) : Number.NaN
		if (!Number.isSafeInteger(size)) throw new Error(`git cat-file --batch: ${header}`)
		blobs.set(oid, out.toString("utf8", eol + 1, eol + 1 + size))
		at = eol + 2 + size
	}
	return blobs
}

/** The tree of `ref`; like the gate, it reads regular files only. */
export function commitView(cwd: string, ref: string): View {
	const oids = new Map<string, string>()
	for (const record of git(cwd, "ls-tree", "-r", "-z", "--full-tree", ref).split("\0")) {
		const m = record.match(/^(\d{6}) blob ([0-9a-f]+)\t(.+)$/s)
		if (m && lib.REGULAR_MODES.has(m[1])) oids.set(m[3], m[2])
	}
	const blobs = new Map<string, string>()
	const load = (paths: Iterable<string>) => {
		const want = [...new Set([...paths].flatMap((p) => oids.get(p) ?? []))].filter((oid) => !blobs.has(oid))
		if (want.length > 0) for (const [oid, text] of catBlobs(cwd, want)) blobs.set(oid, text)
	}
	return {
		tracked: new Set(oids.keys()),
		dirs: ancestorDirs(oids.keys()),
		load,
		read(path) {
			const oid = oids.get(path)
			if (!oid) return ""
			if (!blobs.has(oid)) load([path])
			return blobs.get(oid) ?? ""
		},
	}
}

/** `base` with `edits` applied: each edit replaces or adds one file. */
export function overlay(base: View, edits: ReadonlyMap<string, string>): View {
	const tracked = new Set([...base.tracked, ...edits.keys()])
	return {
		tracked,
		dirs: new Set([...base.dirs, ...ancestorDirs(edits.keys())]),
		load: (paths) => base.load(paths),
		read: (path) => edits.get(path) ?? base.read(path),
	}
}

export function readClosures(cwd: string): Closures {
	return JSON.parse(readFileSync(join(cwd, CLOSURES), "utf8")) as Closures
}

/** Index lines the closure table was judged against; any other line was written after it. */
export function baseIndexLines(cwd: string, closures: Closures): Set<string> {
	const res = lib.runGit(cwd, ["show", `${closures.closuresBase}:${lib.ACTIVE_INDEX}`])
	if (!res.ok) throw new Error(`cannot read index.md at closuresBase ${closures.closuresBase}: ${res.stderr.trim()}`)
	return new Set(res.stdout.split("\n"))
}

/** A closed row's dir and where it lives now: its plan-tree path, or its archive path once moved. */
export type Target = { row: Row; at: string }

export function isArchived(target: Target): boolean {
	return target.at.startsWith(`${ARCHIVE}/`)
}

function locate(view: View, dir: string): string | null {
	const [live, archived] = [`${PLANS}/${dir}`, `${ARCHIVE}/${dir}`]
	if (view.dirs.has(live) && view.dirs.has(archived)) throw new Error(`${dir} is both in the plan tree and in archive/`)
	if (view.dirs.has(live)) return live
	return view.dirs.has(archived) ? archived : null
}

/** A closed dir whose index line postdates the table and does not close it may have been reopened. */
function reopened(view: View, closed: ReadonlySet<string>, base: ReadonlySet<string>): string[] {
	const src = view.read(lib.ACTIVE_INDEX)
	const lines = src.split("\n")
	return lib
		.parseIndex(src)
		.entries.filter((e) => closed.has(e.target.split("/")[0]))
		.filter((e) => !base.has(lines[e.line - 1]) && e.status !== structure.CLOSING_STATUS)
		.map((e) => `${e.target.split("/")[0]}: index.md:${e.line} postdates the closure table and does not close it`)
}

/**
 * The closed rows found in `view`, the only dirs the tools edit or move; a row whose dir is gone is dropped.
 * Throws, touching nothing, when an index line written after the table leaves a closed dir open.
 */
export function closedTargets(view: View, closures: Closures, base: ReadonlySet<string>): Target[] {
	const rows = closures.rows.filter((r) => r.class === "closed")
	const refused = reopened(view, new Set(rows.map((r) => r.dir)), base)
	if (refused.length > 0) throw new Error(`refusing to archive; re-answer these in closures.json:\n  ${refused.join("\n  ")}`)
	return rows.flatMap((row) => {
		const at = locate(view, row.dir)
		return at ? [{ row, at }] : []
	})
}

/** `path` at its archive location when it lies in a moving dir. */
export function mapPath(moved: ReadonlySet<string>, path: string): string {
	const [head, dir, ...rest] = path.split("/")
	return head === PLANS && dir !== undefined && moved.has(dir) ? [ARCHIVE, dir, ...rest].join("/") : path
}

/** `path` back at its plan-tree location when it lies in a moved dir. */
export function unmapPath(moved: ReadonlySet<string>, path: string): string {
	if (!path.startsWith(`${ARCHIVE}/`)) return path
	const [, , dir, ...rest] = path.split("/")
	return dir !== undefined && moved.has(dir) ? [PLANS, dir, ...rest].join("/") : path
}

/** The row's Outcome host relative to its dir: the table's host, else the stub the generator writes. */
export function hostFile(row: Row): string {
	if (row.outcomeFile === null) return "plan.md"
	const prefix = `${PLANS}/${row.dir}/`
	if (!row.outcomeFile.startsWith(prefix)) throw new Error(`${row.dir}: its host ${row.outcomeFile} lies outside it`)
	return row.outcomeFile.slice(prefix.length)
}

/** Markdown a cut must not split: code spans, links and bold runs. */
const ATOM_RE = /`[^`]*`|\[[^\]]*\]\([^)]*\)|\*\*[^*]*\*\*/g

/** `text` cut to at most `max` characters, at a word boundary outside any code span, link or bold run. */
export function clip(text: string, max: number): string {
	if ([...text].length <= max) return text
	let cut = [...text].slice(0, max - 1).join("")
	for (const m of text.matchAll(ATOM_RE)) {
		const start = m.index ?? 0
		if (start < cut.length && start + m[0].length > cut.length) cut = cut.slice(0, start)
	}
	const space = cut.lastIndexOf(" ")
	if (space > 0) cut = cut.slice(0, space)
	return `${cut.replace(/[\s,;:—-]+$/, "")}…`
}

/** Writes and stages each file; one whose working copy differs from the index is refused before anything is written. */
export function writeFiles(cwd: string, files: ReadonlyMap<string, string>): void {
	const paths = [...files.keys()]
	for (let i = 0; i < paths.length; i += 200) {
		const res = lib.runGit(cwd, ["diff", "--name-only", "--", ...paths.slice(i, i + 200)])
		if (res.stdout.trim() !== "") throw new Error(`unstaged edits in:\n  ${res.stdout.trim().split("\n").join("\n  ")}`)
	}
	for (const [path, text] of files) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true })
		writeFileSync(join(cwd, path), text)
	}
	for (let i = 0; i < paths.length; i += 200) git(cwd, "add", "--", ...paths.slice(i, i + 200))
}

/** The Outcome generator's two stamped phrasings, and nothing a hand-written block would say. */
const STAMP_RE =
	/Generated by plans-scaffolding on (\d{4}-\d{2}-\d{2})|Seeds retired \((\d{4}-\d{2}-\d{2})\): the (?:`\/goal`|<code>\/goal<\/code>) and/g

/** The single date the Outcome generator stamped in `texts`, or null when nothing carries one. */
export function stampOf(texts: Iterable<string>): string | null {
	const dates = new Set<string>()
	for (const text of texts) for (const m of text.matchAll(STAMP_RE)) dates.add(m[1] ?? m[2])
	if (dates.size > 1) throw new Error(`generated text carries several dates: ${[...dates].join(", ")}`)
	return [...dates][0] ?? null
}
