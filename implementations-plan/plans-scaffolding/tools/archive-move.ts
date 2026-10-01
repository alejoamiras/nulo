#!/usr/bin/env bun
/**
 * Moves every closed top-level plan dir to `archive/<dir>` with `git mv`, staging the renames and nothing
 * else; the caller commits.
 *
 * `--verify --parent <ref> [--date <YYYY-MM-DD>]` is the fidelity proof of the archive commits against
 * their actual parent. It re-derives, from `<ref>`, the Outcome edits, the move, the index split and the
 * link repairs, then reads `git diff --raw -M <ref> HEAD` and requires: every path under a closed dir renamed
 * to its mapped path, its blob unchanged unless an edit is planned for it; every planned edit's file equal to its
 * derivation; no addition but `archive/index.md` and the stubs; no modification outside
 * `plans-scaffolding/` without a planned edit; nothing deleted, copied or retyped; fewer than 3,000
 * changed files. A planned edit git cannot pair (under 50% similar) passes as the deletion of its old path
 * and the addition of its mapped one, with a note. Without `--date` the stamp is read back from the
 * generated text.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import {
	ancestorDirs,
	ARCHIVE,
	baseIndexLines,
	closedTargets,
	commitView,
	FOLLOW_UPS,
	indexView,
	isArchived,
	mapPath,
	overlay,
	readClosures,
	stampOf,
	type Target,
	unmapPath,
	type View,
} from "./closed"
import { blobIds, git, PLANS, rawMeta } from "./common"
import { lib } from "./gate"
import { followUpEntries, planOutcomes } from "./outcome"
import { planRepairs } from "./repair-links"
import { splitIndex } from "./split-index"

export const MAX_CHANGED = 3000
const OWN_DIR = `${PLANS}/plans-scaffolding/`

/** `git mv`s each target still in the plan tree into `archive/`; returns how many moved. */
export function moveClosed(cwd: string, targets: readonly Target[]): number {
	const pending = targets.filter((t) => !isArchived(t)).map((t) => t.at)
	if (pending.length === 0) return 0
	mkdirSync(join(cwd, ARCHIVE), { recursive: true })
	for (let i = 0; i < pending.length; i += 100) git(cwd, "mv", "--", ...pending.slice(i, i + 100), `${ARCHIVE}/`)
	return pending.length
}

/** `view` with every path under a moved dir at its archive location. */
function movedView(view: View, moved: ReadonlySet<string>): View {
	const tracked = new Set([...view.tracked].map((p) => mapPath(moved, p)))
	return {
		tracked,
		dirs: ancestorDirs(tracked),
		load: (paths) => view.load([...paths].map((p) => unmapPath(moved, p))),
		read: (path) => (tracked.has(path) ? view.read(unmapPath(moved, path)) : ""),
	}
}

/** What the archive commits must hold: each old path's new one, and the final text of every file they edit. */
export type Derivation = { renames: Map<string, string>; edits: Map<string, string>; added: Set<string> }

/** Re-derives the archive commits from `parent`: the four tools' outputs, composed as the pipeline runs them. */
export function derive(cwd: string, parent: string, stamp: string): Derivation {
	const closures = readClosures(cwd)
	const base = baseIndexLines(cwd, closures)
	const before = commitView(cwd, parent)
	const targets = closedTargets(before, closures, base)
	const archived = targets.find(isArchived)
	if (archived) throw new Error(`${parent} already archives ${archived.row.dir}; verify against the commit before the move`)
	const outcomes = planOutcomes(before, targets, { stamp, followUps: followUpEntries(before.read(FOLLOW_UPS)) })
	const pre = overlay(before, new Map([...outcomes].map(([path, e]) => [path, e.text])))
	const moved = new Set(targets.map((t) => t.row.dir))
	const post = movedView(pre, moved)
	const split = splitIndex(
		post,
		targets.map((t) => ({ row: t.row, at: mapPath(moved, t.at) })),
		base,
		{ moved, before: pre },
	)
	const indexed = overlay(
		post,
		new Map([
			[lib.ACTIVE_INDEX, split.index],
			[lib.ARCHIVE_INDEX, split.archive],
		]),
	)
	const edits = new Map([...outcomes].map(([path, e]) => [mapPath(moved, path), e.text]))
	for (const [path, text] of [[lib.ACTIVE_INDEX, split.index], [lib.ARCHIVE_INDEX, split.archive], ...planRepairs(indexed, pre, moved)])
		edits.set(path, text)
	const renames = new Map([...before.tracked].flatMap((p) => (mapPath(moved, p) === p ? [] : [[p, mapPath(moved, p)] as const])))
	const added = new Set([...edits.keys()].filter((p) => !before.tracked.has(unmapPath(moved, p))))
	return { renames, edits, added }
}

export type Change = { status: string; score: number; same: boolean; paths: string[] }

/** `git diff --raw --no-abbrev -M -z` between two commits. */
export function rawChanges(cwd: string, from: string, to: string): Change[] {
	const fields = git(cwd, "diff", "--raw", "--no-abbrev", "-M", "-z", from, to).split("\0")
	const changes: Change[] = []
	for (let i = 0; i + 1 < fields.length; ) {
		const meta = rawMeta(fields[i])
		if (meta === null) throw new Error(`not a git diff --raw field: ${fields[i]}`)
		const count = meta.status === "R" || meta.status === "C" ? 2 : 1
		changes.push({ status: meta.status, score: meta.score, same: meta.same, paths: fields.slice(i + 1, i + 1 + count) })
		i += 1 + count
	}
	return changes
}

type Judge = { d: Derivation; paired: Set<string>; swaps: [string, string][] }

function renameProblems(c: Change, j: Judge): string[] {
	const [from, to] = c.paths
	j.paired.add(from)
	const mapped = j.d.renames.get(from)
	if (mapped === undefined) return [`${from} → ${to}: a rename outside the move`]
	if (mapped !== to) j.swaps.push([from, to])
	if (!c.same && !j.d.edits.has(to)) return [`${from} → ${to}: changed (R${c.score}) with no planned edit`]
	return []
}

function changeProblems(c: Change, j: Judge): string[] {
	const [path] = c.paths
	if (c.status === "R") return renameProblems(c, j)
	if (c.status === "A") return j.d.added.has(path) ? [] : [`${path}: added, but neither archive/index.md nor a stub`]
	if (c.status === "M") return j.d.edits.has(path) || path.startsWith(OWN_DIR) ? [] : [`${path}: modified with no planned edit`]
	return [`${c.paths.join(" → ")}: ${c.status}, which the archive commits never make`]
}

/** A rename git paired off its mapped path is harmless only between two identical files: `from` and the true source of `to`. */
export function swapProblems(cwd: string, parent: string, swaps: readonly [string, string][], renames: Derivation["renames"]): string[] {
	if (swaps.length === 0) return []
	const sourceOf = new Map([...renames].map(([from, to]) => [to, from]))
	const ids = blobIds(
		cwd,
		swaps.flatMap(([from, to]) => [`${parent}:${from}`, `${parent}:${sourceOf.get(to) ?? to}`]),
	)
	return swaps.flatMap(([from, to], i) =>
		ids[2 * i] !== null && ids[2 * i] === ids[2 * i + 1] ? [] : [`${from} → ${to}: paired off its mapped path`],
	)
}

/**
 * Planned edits that leave a moved file under git's 50% rename similarity, so the diff shows its old path
 * deleted and its mapped path added. Only a planned edit qualifies: its text is still proved against the
 * derivation, while an unedited file must keep its blob.
 */
export function unpairedEdits(changes: readonly Change[], d: Derivation): Map<string, string> {
	const added = new Set(changes.flatMap((c) => (c.status === "A" ? c.paths : [])))
	return new Map(
		changes.flatMap((c) => {
			const to = c.status === "D" ? d.renames.get(c.paths[0]) : undefined
			return to !== undefined && added.has(to) && d.edits.has(to) ? [[c.paths[0], to] as const] : []
		}),
	)
}

function outsidePairs(changes: readonly Change[], unpaired: ReadonlyMap<string, string>): Change[] {
	const targets = new Set(unpaired.values())
	return changes.filter((c) => !(c.status === "D" && unpaired.has(c.paths[0])) && !(c.status === "A" && targets.has(c.paths[0])))
}

function treeModes(cwd: string, rev: string): Map<string, string> {
	const modes = new Map<string, string>()
	for (const record of git(cwd, "ls-tree", "-r", "-z", "--full-tree", rev).split("\0")) {
		const m = record.match(/^(\d{6}) \w+ [0-9a-f]+\t(.+)$/s)
		if (m) modes.set(m[2], m[1])
	}
	return modes
}

/**
 * Modes are read through the move map, never git's pairing: two identical blobs can trade modes while
 * every pair git reports still matches. A moved or edited file keeps its source's mode; an addition is 100644.
 */
export function modeProblems(cwd: string, parent: string, d: Derivation): string[] {
	const [before, after] = [treeModes(cwd, parent), treeModes(cwd, "HEAD")]
	const sourceOf = new Map([...d.renames].map(([from, to]) => [to, from]))
	return [...new Set([...sourceOf.keys(), ...d.edits.keys()])].flatMap((path) => {
		const now = after.get(path)
		const was = d.added.has(path) ? "100644" : before.get(sourceOf.get(path) ?? path)
		return path.startsWith(OWN_DIR) || now === undefined || now === was ? [] : [`${path}: mode ${was} → ${now}`]
	})
}

/** Every way HEAD departs from the derivation. */
export function fidelityProblems(cwd: string, parent: string, d: Derivation, cap = MAX_CHANGED): string[] {
	const changes = rawChanges(cwd, parent, "HEAD")
	const unpaired = unpairedEdits(changes, d)
	const j: Judge = { d, paired: new Set(unpaired.keys()), swaps: [] }
	const problems = changes.length >= cap ? [`${changes.length} changed files, at or over the ${cap} cap`] : []
	for (const c of outsidePairs(changes, unpaired)) problems.push(...changeProblems(c, j))
	problems.push(...modeProblems(cwd, parent, d))
	problems.push(...swapProblems(cwd, parent, j.swaps, d.renames))
	for (const from of d.renames.keys()) if (!j.paired.has(from)) problems.push(`${from}: no rename pairs it with ${d.renames.get(from)}`)
	const head = commitView(cwd, "HEAD")
	head.load(d.edits.keys())
	for (const [path, text] of d.edits) {
		if (path.startsWith(OWN_DIR)) continue
		if (!head.tracked.has(path)) problems.push(`${path}: a planned edit is missing from HEAD`)
		else if (head.read(path) !== text) problems.push(`${path}: differs from its derivation`)
	}
	return problems
}

function stampFromHead(cwd: string): string | null {
	const head = commitView(cwd, "HEAD")
	const docs = [...head.tracked].filter((p) => p.startsWith(`${ARCHIVE}/`) && lib.isDocument(p))
	head.load(docs)
	return stampOf(docs.map((p) => head.read(p)))
}

/** Git's rename score for one pair at any similarity, `R0` when it will not pair them at all. */
function similarity(cwd: string, parent: string, from: string, to: string): string {
	const [code] = git(cwd, "diff", "--name-status", "-M1%", "-z", parent, "HEAD", "--", from, to).split("\0")
	return code.startsWith("R") ? code : "R0"
}

function flag(argv: readonly string[], name: string): string | undefined {
	const at = argv.indexOf(name)
	return at === -1 ? undefined : argv[at + 1]
}

function verify(cwd: string, argv: readonly string[]): number {
	const parent = flag(argv, "--parent")
	if (!parent) throw new Error("--verify needs --parent <ref>, the archive commits' actual parent")
	const stamp = flag(argv, "--date") ?? stampFromHead(cwd)
	if (!stamp) throw new Error("no generated stamp in HEAD's archive; pass --date")
	const d = derive(cwd, parent, stamp)
	const problems = fidelityProblems(cwd, parent, d)
	for (const p of problems) console.log(p)
	const changes = rawChanges(cwd, parent, "HEAD")
	const unpaired = unpairedEdits(changes, d)
	for (const [from, to] of unpaired)
		console.log(
			`note: ${from} → ${to}: git pairs this planned edit only at ${similarity(cwd, parent, from, to)}, so the diff shows it deleted and added`,
		)
	console.log(
		`archive-move --verify: ${d.renames.size} renames (${unpaired.size} unpaired by git), ${d.edits.size} planned edits (${d.added.size} added), ${changes.length} changed files, ${problems.length} problem(s)`,
	)
	return problems.length === 0 ? 0 : 1
}

function main(argv: readonly string[]): number {
	const cwd = process.cwd()
	if (argv.includes("--verify")) return verify(cwd, argv)
	const closures = readClosures(cwd)
	const targets = closedTargets(indexView(cwd), closures, baseIndexLines(cwd, closures))
	const count = moveClosed(cwd, targets)
	console.log(`archive-move: ${count} dir(s) moved to ${ARCHIVE}/, ${targets.length - count} already there`)
	return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
