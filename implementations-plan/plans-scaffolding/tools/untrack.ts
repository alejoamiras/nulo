#!/usr/bin/env bun
/**
 * The evidence manifest and the untracking it licenses.
 *
 * `--record` appends one `{path, sha, blob}` row per path this migration removes or replaces, before any
 * of them changes: `blob` is the path's blob at HEAD, and `sha` the first base where the path holds that
 * exact blob. Existing rows are re-verified first and never rewritten. With no flag the tool runs
 * `git rm --cached` on every tracked transcript that has a row, and refuses one that has none.
 * `--verify` proves every row against its commit, every commit against `dev`, and that every path the
 * branch deletes or promotes away has a row. `--dry-run` prints what record and apply would do.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
	BASES_FILE,
	blobIds,
	DELETED,
	DEV_REF,
	git,
	MANIFEST,
	PLANS,
	PROMOTIONS,
	planPath,
	type Row,
	readManifest,
	rowsByPath,
	UNTRACK_BASE,
	writeManifest,
} from "./common"
import { lib } from "./gate"

export type Promotion = { dir: string; from: string }
/** `bases` are tried before the merge-base with `origin/dev`, which is always the last resort. */
export type Options = { cwd: string; bases?: readonly string[]; promotions?: readonly Promotion[] }

const HEX40 = /^[0-9a-f]{40}$/

function lines0(out: string): string[] {
	return out.split("\0").filter(Boolean)
}

function trackedPlans(cwd: string): Set<string> {
	return new Set(lines0(git(cwd, "ls-files", "-z", "--", PLANS)))
}

/** Tracked paths the plans `.gitignore` files cover; info/exclude and global excludes are machine-local and ignored. */
function ignoredTracked(cwd: string): string[] {
	return lines0(git(cwd, "ls-files", "-ci", "--exclude-per-directory=.gitignore", "-z", "--", PLANS))
}

/** Tracked transcripts and drafts: the canonical shapes, plus anything a `.gitignore` already covers. */
export function transcripts(cwd: string): string[] {
	const tracked = trackedPlans(cwd)
	return [...new Set([...[...tracked].filter(lib.isCanonical), ...ignoredTracked(cwd).filter((p) => tracked.has(p))])].sort()
}

/** Every path to record: the transcripts, each `plan.md` a pending promotion replaces, and the ignore files the hygiene step deletes. */
export function removalSet(cwd: string, promotions: readonly Promotion[] = PROMOTIONS): string[] {
	const tracked = trackedPlans(cwd)
	const replaced = promotions
		.filter((p) => tracked.has(planPath(p.dir, p.from)) && tracked.has(planPath(p.dir, "plan.md")))
		.map((p) => planPath(p.dir, "plan.md"))
	return [...new Set([...transcripts(cwd), ...replaced, ...DELETED.filter((p) => tracked.has(p))])].sort()
}

function mergeBase(cwd: string): string {
	return git(cwd, "merge-base", "HEAD", DEV_REF).trim()
}

/** Rows whose blob is not at their commit. */
export function unverifiedRows(cwd: string, rows: readonly Row[]): Row[] {
	const ids = blobIds(
		cwd,
		rows.map((r) => `${r.sha}:${r.path}`),
	)
	return rows.filter((r, i) => ids[i] !== r.blob)
}

function readBases(cwd: string): Record<string, string> {
	return JSON.parse(readFileSync(join(cwd, BASES_FILE), "utf8")) as Record<string, string>
}

function allowBases(cwd: string, shas: Iterable<string>): string[] {
	const bases = readBases(cwd)
	const added = [...new Set(shas)].filter((sha) => !(sha in bases))
	if (added.length === 0) return []
	for (const sha of added) {
		bases[sha] = "a later untrack base: each transcript that landed after the first one is byte-identical here (untrack-manifest.json)"
	}
	writeFileSync(join(cwd, BASES_FILE), `${JSON.stringify(bases, null, "\t")}\n`)
	return added
}

/** Pins each path to the first base holding its HEAD blob; a path no base holds stops the run. */
function pinRows(cwd: string, paths: readonly string[], bases: readonly string[]): Row[] {
	const heads = blobIds(
		cwd,
		paths.map((p) => `HEAD:${p}`),
	)
	const shas: (string | undefined)[] = paths.map(() => undefined)
	for (const base of bases) {
		const ids = blobIds(
			cwd,
			paths.map((p) => `${base}:${p}`),
		)
		ids.forEach((id, i) => {
			if (shas[i] === undefined && id !== null && id === heads[i]) shas[i] = base
		})
	}
	const unpinned = paths.filter((_, i) => shas[i] === undefined)
	if (unpinned.length > 0) throw new Error(`no base holds the HEAD blob of:\n  ${unpinned.join("\n  ")}`)
	return paths.map((path, i) => ({ path, sha: shas[i] as string, blob: heads[i] as string }))
}

export function record(opts: Options): { added: Row[]; bases: string[] } {
	const { cwd } = opts
	const rows = readManifest(cwd)
	const stale = unverifiedRows(cwd, rows)
	if (stale.length > 0) throw new Error(`manifest rows no longer verify:\n  ${stale.map((r) => r.path).join("\n  ")}`)
	if (!lib.runGit(cwd, ["diff", "--cached", "--quiet", "--", PLANS]).ok)
		throw new Error(`staged changes under ${PLANS}: commit them before recording, since rows pin HEAD`)
	const known = rowsByPath(rows)
	const todo = removalSet(cwd, opts.promotions).filter((p) => !known.has(p))
	const added = todo.length === 0 ? [] : pinRows(cwd, todo, [...(opts.bases ?? [UNTRACK_BASE]), mergeBase(cwd)])
	if (added.length > 0) writeManifest(cwd, [...rows, ...added])
	return {
		added,
		bases: allowBases(
			cwd,
			added.map((r) => r.sha),
		),
	}
}

/** `git rm --cached` for every tracked transcript, all of them recorded first. */
export function apply(opts: Options): string[] {
	const { cwd } = opts
	const known = rowsByPath(readManifest(cwd))
	const remove = transcripts(cwd)
	const unrecorded = remove.filter((p) => !known.has(p))
	if (unrecorded.length > 0) throw new Error(`run --record first; no row for:\n  ${unrecorded.join("\n  ")}`)
	for (let i = 0; i < remove.length; i += 200) git(cwd, "rm", "--cached", "-q", "--", ...remove.slice(i, i + 200))
	const left = lines0(git(cwd, "ls-files", "-ci", "--exclude-standard", "-z", "--", PLANS))
	if (left.length > 0) throw new Error(`still tracked although ignored:\n  ${left.join("\n  ")}`)
	return remove
}

function shapeProblems(rows: readonly Row[]): string[] {
	const problems: string[] = []
	const seen = new Set<string>()
	rows.forEach((r, i) => {
		if (!HEX40.test(r.sha) || !HEX40.test(r.blob) || !r.path.startsWith(`${PLANS}/`)) problems.push(`row ${i} is malformed`)
		if (seen.has(r.path)) problems.push(`${r.path} has two rows`)
		if (i > 0 && rows[i - 1].path > r.path) problems.push(`${r.path} is out of order`)
		seen.add(r.path)
	})
	return problems
}

function baseProblems(cwd: string, rows: readonly Row[]): string[] {
	if (!lib.runGit(cwd, ["rev-parse", "--verify", "-q", DEV_REF]).ok) return [`${DEV_REF} is missing: fetch dev`]
	const allowed = readBases(cwd)
	const problems: string[] = []
	for (const sha of new Set(rows.map((r) => r.sha))) {
		if (!(sha in allowed)) problems.push(`${sha} is not in ${BASES_FILE}`)
		if (!lib.runGit(cwd, ["merge-base", "--is-ancestor", sha, DEV_REF]).ok) problems.push(`${sha} is not an ancestor of dev`)
	}
	return problems
}

/** Paths the branch deletes, renames away from a transcript name, or replaces by promotion. */
export function removedOnBranch(cwd: string, promotions: readonly Promotion[] = PROMOTIONS): string[] {
	const fields = lines0(git(cwd, "diff", "--name-status", "-M", "-z", `${DEV_REF}...HEAD`, "--", PLANS))
	const removed: string[] = []
	for (let i = 0; i < fields.length; ) {
		const status = fields[i]
		const renamed = status.startsWith("R") || status.startsWith("C")
		const source = fields[i + 1]
		if (status === "D" || (status.startsWith("R") && lib.isCanonical(source))) removed.push(source)
		i += renamed ? 3 : 2
	}
	const base = mergeBase(cwd)
	for (const p of promotions) {
		const [was, isNow, hadPlan] = blobIds(cwd, [
			`${base}:${planPath(p.dir, p.from)}`,
			`HEAD:${planPath(p.dir, p.from)}`,
			`${base}:${planPath(p.dir, "plan.md")}`,
		])
		if (was !== null && isNow === null) removed.push(planPath(p.dir, p.from), ...(hadPlan ? [planPath(p.dir, "plan.md")] : []))
	}
	return [...new Set(removed)].sort()
}

export function verify(opts: Options): string[] {
	const { cwd } = opts
	const rows = readManifest(cwd)
	const known = rowsByPath(rows)
	return [
		...shapeProblems(rows),
		...unverifiedRows(cwd, rows).map((r) => `${r.path}: blob ${r.blob} is not at ${r.sha}`),
		...baseProblems(cwd, rows),
		...removedOnBranch(cwd, opts.promotions)
			.filter((p) => !known.has(p))
			.map((p) => `${p} leaves the tree without a row`),
	]
}

function main(argv: readonly string[]): number {
	const cwd = process.cwd()
	if (argv.includes("--verify")) {
		const problems = verify({ cwd })
		for (const p of problems) console.log(p)
		console.log(`untrack --verify: ${readManifest(cwd).length} rows, ${problems.length} problem(s)`)
		return problems.length === 0 ? 0 : 1
	}
	if (argv.includes("--dry-run")) {
		const known = rowsByPath(readManifest(cwd))
		const unrecorded = removalSet(cwd).filter((p) => !known.has(p))
		for (const p of unrecorded) console.log(`record ${p}`)
		for (const p of transcripts(cwd)) console.log(`untrack ${p}`)
		return 0
	}
	if (argv.includes("--record")) {
		const { added, bases } = record({ cwd })
		console.log(`recorded ${added.length} row(s) in ${MANIFEST}${bases.length ? `; allowlisted ${bases.join(", ")}` : ""}`)
		return 0
	}
	console.log(`untracked ${apply({ cwd }).length} path(s)`)
	return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
