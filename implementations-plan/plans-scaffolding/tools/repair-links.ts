#!/usr/bin/env bun
/**
 * Repairs what the archive move breaks, through one explicit map (closed dir X → `archive/X`): every
 * relative link is resolved from the file's old location, mapped, and re-relativized from its new one,
 * editing only URL tokens in destination positions and proving the rendered page unchanged beyond them.
 * Live docs and the curated and index files also get their `implementations-plan/X` path tokens mapped;
 * `HAND_FIXES` covers what neither pass can read. Code outside the plan tree and permalinks are never
 * touched.
 *
 * It runs after `archive-move.ts`, on the git index. A moved file is always repaired from its text before
 * the move, read from history, so a rerun is a no-op; a moved file that changed since its move is refused.
 */
import { posix } from "node:path"
import {
	ARCHIVE,
	baseIndexLines,
	closedTargets,
	commitView,
	has,
	indexView,
	isArchived,
	mapPath,
	readClosures,
	unmapPath,
	type View,
	writeFiles,
} from "./closed"
import { git, PLANS } from "./common"
import { lib, links, structure } from "./gate"
import { type Edits, prove, rewriteSource } from "./rewrite-links"

/** The move map, and the tree as it was before the move, which old-location readings are judged against. */
export type RepairCtx = { moved: ReadonlySet<string>; before: Pick<View, "tracked" | "dirs"> }

/** Frozen research and audit prose: its links are repaired, its path tokens left as written. */
const FROZEN = [`${PLANS}/`, "audit/", "architecture/", "wallets-architecture-research/", "scripts/ci-cd/plans/"]
/** Release history the gate never judges; neither its links nor its tokens are rewritten. */
const HISTORY: ReadonlySet<string> = new Set(["CHANGELOG.md", "AUDIT.md"])
const LINE_CITE_RE = /:\d+(?:-\d+)?$/
/** A plan-dir token the gate reads as repo-rooted, `./` and `../` runs included; a permalink or any other path tail is not one. */
const TOKEN_RE = /(?<![\w./-])((?:\.{1,2}\/)*)implementations-plan\/([A-Za-z0-9._-]*[A-Za-z0-9_-])(?![A-Za-z0-9_-])/g

/** A literal edit neither pass can make: `from` appears exactly `count` times, and every dir in `dirs` moves. */
type HandFix = { path: string; from: string; to: string; count: number; dirs: readonly string[] }

const RELEASE_DIRS = ["release-prerelease-fix", "required-check-mismatch", "stable-release-0.24.0", "release-pipeline-hardening"]
const SHOTS = `${PLANS}/ux-feedback/design/shots.mjs`

export const HAND_FIXES: readonly HandFix[] = [
	{
		path: "CLAUDE.md",
		from: "`implementations-plan/{release-prerelease-fix,",
		to: "`implementations-plan/archive/{release-prerelease-fix,",
		count: 1,
		dirs: RELEASE_DIRS,
	},
	{
		path: SHOTS,
		from: "implementations-plan/ux-feedback/design/",
		to: "implementations-plan/archive/ux-feedback/design/",
		count: 3,
		dirs: ["ux-feedback"],
	},
	{ path: SHOTS, from: 'path.resolve(here, "../../..")', to: 'path.resolve(here, "../../../..")', count: 1, dirs: ["ux-feedback"] },
	{
		path: `${PLANS}/ux-feedback/design/mocks/build.py`,
		from: "HERE.resolve().parents[3]",
		to: "HERE.resolve().parents[4]",
		count: 1,
		dirs: ["ux-feedback"],
	},
]
const HAND_FIXED: ReadonlySet<string> = new Set(HAND_FIXES.map((f) => f.path))

function occurrences(text: string, needle: string): number {
	return text.split(needle).length - 1
}

function applyHandFix(text: string, fix: HandFix, moved: ReadonlySet<string>): string {
	const moving = fix.dirs.filter((d) => moved.has(d)).length
	if (moving === 0) return text
	if (moving < fix.dirs.length) throw new Error(`${fix.path}: ${fix.from} names ${fix.dirs.join(", ")}, which do not all move`)
	const found = occurrences(text, fix.from)
	if (found === fix.count) return text.replaceAll(fix.from, fix.to)
	if (found === 0 && occurrences(text, fix.to) >= fix.count) return text
	throw new Error(`${fix.path}: expected ${fix.from} ${fix.count} time(s), found ${found}`)
}

/** `path` (its location before the move) with every hand fix for it applied. */
export function applyHandFixes(path: string, text: string, moved: ReadonlySet<string>): string {
	return HAND_FIXES.filter((f) => f.path === path).reduce((out, fix) => applyHandFix(out, fix, moved), text)
}

/** Documents whose `implementations-plan/X` tokens must name a path that exists. */
export function tokenScope(path: string): boolean {
	if (lib.INDEX_FILES.includes(path) || lib.CURATED_FILES.includes(path)) return true
	return lib.isDocument(path) && !HISTORY.has(path) && !FROZEN.some((prefix) => path.startsWith(prefix))
}

/** Documents whose links are repaired: all of them but the release history and transcripts. */
export function linkScope(path: string): boolean {
	return lib.isDocument(path) && !HISTORY.has(path) && !lib.isCanonical(path)
}

export function repairTokens(text: string, moved: ReadonlySet<string>): string {
	return text.replace(TOKEN_RE, (token, prefix: string, dir: string) => (moved.has(dir) ? `${prefix}${ARCHIVE}/${dir}` : token))
}

/** `target` relative to `file`'s dir, keeping the original's trailing slash and leading `./`. */
export function relativeHref(file: string, target: string, original: string): string {
	let rel = posix.relative(`/${posix.dirname(file)}`, `/${target}`) || "."
	if (original.endsWith("/") && !rel.endsWith("/")) rel += "/"
	if (original.startsWith("./") && !rel.startsWith("./") && !rel.startsWith("../")) rel = `./${rel}`
	return rel
}

/**
 * The mapped form of a repo-rooted cite (`implementations-plan/X/plan.md:40`) in an archived document,
 * which the gate reads rooted: only when its relative reading was missing before the move and its rooted
 * one existed. Undefined for any other href.
 */
function rootedCite(from: string, to: string, bare: string, ctx: RepairCtx): string | undefined {
	if (!to.startsWith(`${ARCHIVE}/`) || lib.INDEX_FILES.includes(to) || !bare.startsWith(`${PLANS}/`)) return undefined
	const cite = bare.match(LINE_CITE_RE)?.[0] ?? ""
	const rooted = lib.safeDecodeUri(bare.slice(0, bare.length - cite.length))
	const relative = links.resolveHref(from, bare.slice(0, bare.length - cite.length))
	if (relative.kind === "repo" && relative.path !== null && has(ctx.before, relative.path)) return undefined
	if (rooted !== posix.normalize(rooted) || !has(ctx.before, rooted)) return undefined
	return `${mapPath(ctx.moved, rooted)}${cite}`
}

/** The href a link in `from` needs once the file sits at `to`; undefined when it already points where it should. */
export function linkEdit(from: string, to: string, href: string, ctx: RepairCtx): string | undefined {
	const trimmed = href.trim()
	const target = links.resolveHref(from, trimmed)
	if (target.kind !== "repo" || target.path === null) return undefined
	const suffix = trimmed.match(/[?#].*$/)?.[0] ?? ""
	const bare = trimmed.slice(0, trimmed.length - suffix.length)
	const cited = rootedCite(from, to, bare, ctx)
	const mapped = mapPath(ctx.moved, target.path)
	const now = links.resolveHref(to, trimmed)
	if (cited === undefined && now.kind === "repo" && now.path === mapped) return undefined
	const next = cited ?? (bare.startsWith("/") ? `/${mapped}` : relativeHref(to, mapped, bare))
	if (next === bare) return undefined
	if (bare.includes("%")) throw new Error(`${from}: ${href} is percent-encoded; repair it by hand`)
	return `${next}${suffix}`
}

/** A document's links repaired for its move from `from` to `to` (the same path for a file that stays), proved render-equivalent. */
export function repairLinks(from: string, to: string, src: string, ctx: RepairCtx): string {
	const edits: Edits = new Map()
	for (const { href } of links.extract(from, src).links) {
		const next = linkEdit(from, to, href, ctx)
		if (next !== undefined) edits.set(href, next)
	}
	if (edits.size === 0) return src
	const out = rewriteSource(to, src, edits)
	prove(to, src, out, edits)
	return out
}

/** Every repair a file needs for its move from `from` to `to`: links, then tokens, then hand fixes. */
export function repairFile(from: string, to: string, src: string, ctx: RepairCtx): string {
	const linked = linkScope(to) ? repairLinks(from, to, src, ctx) : src
	const tokens = tokenScope(to) ? repairTokens(linked, ctx.moved) : linked
	return applyHandFixes(from, tokens, ctx.moved)
}

function inScope(path: string, moving: boolean): boolean {
	return HAND_FIXED.has(path) || (moving ? lib.isDocument(path) && !lib.isCanonical(path) : linkScope(path) || tokenScope(path))
}

/**
 * Each repaired file, keyed by its current path. `view` is the tree after the move; `before` the tree
 * before it, where a moved file's source is read. Throws on a moved file that is neither its source nor
 * its repair: it changed after the move.
 */
export function planRepairs(view: View, before: View, moved: ReadonlySet<string>): Map<string, string> {
	const ctx: RepairCtx = { moved, before }
	const out = new Map<string, string>()
	const paths = [...view.tracked].filter((p) => inScope(unmapPath(moved, p), unmapPath(moved, p) !== p))
	view.load(paths)
	before.load(paths.map((p) => unmapPath(moved, p)))
	for (const path of paths) {
		const old = unmapPath(moved, path)
		const source = old === path ? view.read(path) : before.read(old)
		const repaired = repairFile(old, path, source, ctx)
		const current = view.read(path)
		if (repaired === current) continue
		if (current !== source) throw new Error(`${path} changed after its move; regenerate the archive commits`)
		out.set(path, repaired)
	}
	return out
}

/** The committed tree the moved files came from: HEAD while the move is only staged, else the move commit's parent. */
export function treeBeforeMove(cwd: string, view: View, moved: ReadonlySet<string>): View {
	const olds = [...view.tracked].map((p) => unmapPath(moved, p)).filter((p) => !view.tracked.has(p))
	const head = commitView(cwd, "HEAD")
	if (olds.every((p) => head.tracked.has(p))) return head
	const dirs = [...moved].map((d) => `${PLANS}/${d}`)
	const move = git(cwd, "rev-list", "-1", "HEAD", "--", ...dirs).trim()
	const before = commitView(cwd, `${move}^`)
	const missing = olds.filter((p) => !before.tracked.has(p))
	if (missing.length > 0) throw new Error(`the move of ${missing[0]} is not in ${move}; repair runs on one move commit`)
	return before
}

function main(): number {
	const cwd = process.cwd()
	const closures = readClosures(cwd)
	const view = indexView(cwd)
	const targets = closedTargets(view, closures, baseIndexLines(cwd, closures))
	const pending = targets.filter((t) => !isArchived(t)).map((t) => t.row.dir)
	if (pending.length > 0) throw new Error(`run archive-move.ts first; still in the plan tree: ${pending.slice(0, 5).join(", ")}`)
	const moved = new Set(targets.map((t) => t.row.dir))
	const repairs = planRepairs(view, treeBeforeMove(cwd, view, moved), moved)
	writeFiles(cwd, repairs)
	console.log(`repair-links: ${repairs.size} file(s) repaired across ${moved.size} moved dirs`)
	const lessons = Buffer.byteLength(repairs.get(lib.LESSONS_FILE) ?? view.read(lib.LESSONS_FILE))
	if (lessons > structure.LESSONS_BUDGET)
		console.warn(`warning: ${lib.LESSONS_FILE} is ${lessons} B, over its ${structure.LESSONS_BUDGET} B budget`)
	return 0
}

if (import.meta.main) process.exit(main())
