#!/usr/bin/env bun
/**
 * Splits the plan index once the closed dirs sit in `archive/`. `index.md` keeps its header, its format
 * line and, verbatim, every line of a dir the move left in place (active and parked plans, dirs with no
 * row), every unlinked bullet, and any other line the closure table's base did not have. `archive/index.md`
 * is generated from `closures.json`, one line per archived dir in table order:
 * `- [name](name/<outcome host>) — <status> <date> (#PRs) — <hook ≤ 200 chars>`. The hook is the table's
 * (its last index line's hook, else the host's H1), so a duplicated line collapses to the later one and a
 * section of child plans becomes one line per child. Links and path tokens in the generated lines are
 * repaired for the file's new depth.
 */
import type { Row } from "./classify"
import {
	baseIndexLines,
	clip,
	closedTargets,
	hostFile,
	indexView,
	isArchived,
	readClosures,
	type Target,
	type View,
	writeFiles,
} from "./closed"
import { lib } from "./gate"
import { type RepairCtx, repairFile } from "./repair-links"

export const HOOK_MAX = 200
const LINKED_BULLET_RE = /^- \[[^\]]*\]\(([^)\s]+)\)/
export const ARCHIVE_HEADER: readonly string[] = [
	"# Archived plans",
	"",
	"Closed plans, one line each: `- [plan-name](plan-name/<outcome host>) — status date (#PRs) — one-line hook`. An archived plan records what was decided and why; it is never a task list.",
]

type Kept = { text: string; kind: "bullet" | "continuation" | "other" }

function lineKind(line: string): Kept["kind"] {
	if (/^\s/.test(line)) return "continuation"
	return line.startsWith("- ") ? "bullet" : "other"
}

/** Whether a body line survives: a linked bullet by its dir, an indented line with the line it continues, any other line unless the base had it. */
function keptLines(body: readonly string[], moved: ReadonlySet<string>, base: ReadonlySet<string>): Kept[] {
	const kept: Kept[] = []
	let continued = false
	for (const text of body) {
		if (text.trim() === "") continue
		const kind = lineKind(text)
		const target = kind === "bullet" ? text.match(LINKED_BULLET_RE)?.[1] : undefined
		const dropped = target !== undefined && moved.has(target.split("/")[0])
		const keep: boolean = kind === "continuation" ? continued : kind === "bullet" ? !dropped : !base.has(text)
		if (kind !== "continuation") continued = keep
		if (keep) kept.push({ text, kind })
	}
	return kept
}

/** The active index: `src`'s header, then its surviving lines, bullets consecutive and other lines set apart by blank lines. */
export function activeIndex(src: string, moved: ReadonlySet<string>, base: ReadonlySet<string>): string {
	const lines = src.split("\n")
	const first = lines.findIndex((l) => l.startsWith("- "))
	const header = lines.slice(0, first === -1 ? lines.length : first)
	while (header.length > 0 && header[header.length - 1].trim() === "") header.pop()
	const out = [...header]
	let afterBullet = false
	for (const k of keptLines(lines.slice(header.length), moved, base)) {
		const joins = k.kind === "continuation" || (k.kind === "bullet" && afterBullet)
		if (out.length > 0 && !joins) out.push("")
		out.push(k.text)
		if (k.kind !== "continuation") afterBullet = k.kind === "bullet"
	}
	return `${out.join("\n")}\n`
}

/** `<status> <date> (#PRs)`, with any ` — ` in the status softened so the line still parses. */
export function statusField(row: Row): string {
	const status = row.status.replaceAll(" — ", ", ")
	const date = row.date && !status.includes(row.date) ? ` ${row.date}` : ""
	const prs = row.prs.length > 0 ? ` (${row.prs.map((n) => `#${n}`).join(", ")})` : ""
	return `${status}${date}${prs}`
}

/** An index line whose bold status held ` — ` was cut mid-run, so its hook opens with an orphan `**`; that one goes. */
export function balanced(hook: string): string {
	return (hook.split("**").length - 1) % 2 === 1 ? hook.replace("**", "") : hook
}

function archiveLine(row: Row): string {
	const hook = clip(balanced(row.hook.trim()) || row.dir, HOOK_MAX)
	return `- [${row.dir}](${row.dir}/${hostFile(row)}) — ${statusField(row)} — ${hook}`
}

/** The generated `archive/index.md`; its hooks were written against `index.md`, so they are repaired as if it moved there. */
export function archiveIndex(targets: readonly Target[], ctx: RepairCtx): string {
	const text = `${[...ARCHIVE_HEADER, "", ...targets.map((t) => archiveLine(t.row))].join("\n")}\n`
	return repairFile(lib.ACTIVE_INDEX, lib.ARCHIVE_INDEX, text, ctx)
}

/** Both index files for `view`, where every target already sits in the archive. */
export function splitIndex(
	view: View,
	targets: readonly Target[],
	base: ReadonlySet<string>,
	ctx: RepairCtx,
): { index: string; archive: string } {
	const moved = new Set(targets.map((t) => t.row.dir))
	return { index: activeIndex(view.read(lib.ACTIVE_INDEX), moved, base), archive: archiveIndex(targets, ctx) }
}

function main(): number {
	const cwd = process.cwd()
	const closures = readClosures(cwd)
	const view = indexView(cwd)
	const base = baseIndexLines(cwd, closures)
	const targets = closedTargets(view, closures, base)
	const pending = targets.filter((t) => !isArchived(t)).map((t) => t.row.dir)
	if (pending.length > 0) throw new Error(`run archive-move.ts first; still in the plan tree: ${pending.slice(0, 5).join(", ")}`)
	const moved = new Set(targets.map((t) => t.row.dir))
	const { index, archive } = splitIndex(view, targets, base, { moved, before: view })
	const files = new Map<string, string>()
	if (index !== view.read(lib.ACTIVE_INDEX)) files.set(lib.ACTIVE_INDEX, index)
	if (archive !== view.read(lib.ARCHIVE_INDEX)) files.set(lib.ARCHIVE_INDEX, archive)
	writeFiles(cwd, files)
	const kept = lib.parseIndex(index).entries.length
	console.log(`split-index: ${targets.length} archive lines, ${kept} active entries kept, ${files.size} file(s) written`)
	return 0
}

if (import.meta.main) process.exit(main())
