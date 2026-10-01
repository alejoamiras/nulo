#!/usr/bin/env bun
/**
 * Makes each directory's plan of record its `plan.md` before the revisions are untracked, then renames
 * the curated files a transcript pattern would catch. A promotion moves the revision over `plan.md` and
 * lists every earlier revision, the replaced `plan.md` first, by permalink under the H1. Every path it
 * moves or replaces must already have a manifest row. Done promotions and renames are skipped, so a
 * rerun changes nothing.
 */
import { writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { git, PROMOTIONS, permalink, planPath, RENAMES, REVISION_RE, type Row, readManifest, rowsByPath } from "./common"
import type { Promotion } from "./untrack"

export type Options = {
	cwd: string
	promotions?: readonly Promotion[]
	renames?: readonly (readonly [string, string])[]
}

/** The line goes after the H1, past any front matter; a file with no H1 gets it first. */
export function insertUnderTitle(text: string, line: string): string {
	const lines = text.split("\n")
	const fm = lines[0] === "---" ? lines.indexOf("---", 1) : -1
	const start = fm + 1
	const h1 = lines.findIndex((l, i) => i >= start && /^# /.test(l))
	const at = h1 === -1 ? start : h1 + 1
	const block = h1 === -1 ? [line] : ["", line]
	if ((lines[at] ?? "").trim() !== "" || h1 === -1) block.push("")
	lines.splice(at, 0, ...block)
	return lines.join("\n")
}

function byRevision(a: string, b: string): number {
	return a.localeCompare(b, "en", { numeric: true })
}

export function earlierLine(rows: readonly Row[]): string | null {
	if (rows.length === 0) return null
	return `Earlier revisions: ${rows.map((r) => `[${posix.basename(r.path)}](${permalink(r)})`).join(", ")}.`
}

function promoteOne(cwd: string, p: Promotion, tracked: ReadonlySet<string>, known: ReadonlyMap<string, Row>): void {
	const from = planPath(p.dir, p.from)
	const target = planPath(p.dir, "plan.md")
	const siblings = [...tracked]
		.filter((f) => posix.dirname(f) === posix.dirname(from) && REVISION_RE.test(posix.basename(f)) && f !== from)
		.sort((a, b) => byRevision(posix.basename(a), posix.basename(b)))
	const earlier = [...(tracked.has(target) ? [target] : []), ...siblings]
	const missing = [from, ...earlier].filter((f) => !known.has(f))
	if (missing.length > 0) throw new Error(`run untrack.ts --record first; no row for:\n  ${missing.join("\n  ")}`)
	const text = git(cwd, "show", `:${from}`)
	const line = earlierLine(earlier.map((f) => known.get(f) as Row))
	git(cwd, "mv", "-f", "--", from, target)
	writeFileSync(join(cwd, target), line === null ? text : insertUnderTitle(text, line))
	git(cwd, "add", "--", target)
}

export function promote(opts: Options): { promoted: string[]; renamed: string[] } {
	const { cwd } = opts
	const known = rowsByPath(readManifest(cwd))
	const tracked = new Set(git(cwd, "ls-files", "-z").split("\0").filter(Boolean))
	const promoted: string[] = []
	for (const p of opts.promotions ?? PROMOTIONS) {
		if (!tracked.has(planPath(p.dir, p.from))) continue
		promoteOne(cwd, p, tracked, known)
		promoted.push(p.dir)
	}
	const renamed: string[] = []
	for (const [from, to] of opts.renames ?? RENAMES) {
		if (!tracked.has(from)) continue
		git(cwd, "mv", "--", from, to)
		renamed.push(from)
	}
	return { promoted, renamed }
}

if (import.meta.main) {
	const { promoted, renamed } = promote({ cwd: process.cwd() })
	console.log(`promoted ${promoted.length} plan(s), renamed ${renamed.length} file(s)`)
}
