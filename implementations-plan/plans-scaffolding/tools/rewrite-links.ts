#!/usr/bin/env bun
/**
 * Repoints every link in a kept document that targets a transcript to a permalink at that transcript's
 * manifest row, so the link survives untracking with its bytes pinned.
 *
 * Only URL tokens in destination positions change (`](…)`, `]: …`, `href=`, `src=`). Each file is
 * proved twice before it is written: its rendered HTML equals the old rendering with the same URL
 * substitutions, so no code span, fence or link text moved; and its links, in order, are exactly the
 * old ones mapped. `--verify <commit>` re-derives a rewrite commit from its parent and re-runs both
 * proofs. A rerun on a rewritten tree changes nothing.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { git, PLANS, PROMOTIONS, permalink, planPath, type Row, readManifest, rowsByPath } from "./common"
import { lib, links } from "./gate"
import type { Promotion } from "./untrack"

/** A link whose target was never committed, so no permalink exists: it becomes plain text. */
export const DELINKS: readonly { file: string; href: string }[] = [
	{ file: `${PLANS}/dapp-interaction-lock-fix-v1/plan.md`, href: "audit-codex-round-4.md" },
]
/** A link that names its own directory twice; the file it means sits beside the document's directory. */
export const FIXES: readonly { file: string; href: string; to: string }[] = [
	{ file: `${PLANS}/token-identity/lessons/phase-1.md`, href: "../token-identity/deployments.md", to: "../deployments.md" },
]

/** old href → new href, or null to drop the link and keep its text. */
export type Edits = Map<string, string | null>
export type Context = { rows: ReadonlyMap<string, Row>; replacedPlans: ReadonlySet<string> }

/** Each promoted `plan.md` whose directory had one before: its links to `plan.md` mean the replaced text. */
export function replacedPlans(rows: ReadonlyMap<string, Row>, promotions: readonly Promotion[] = PROMOTIONS): Set<string> {
	return new Set(
		promotions
			.filter((p) => rows.has(planPath(p.dir, "plan.md")) && rows.has(planPath(p.dir, p.from)))
			.map((p) => planPath(p.dir, "plan.md")),
	)
}

function escapeRe(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function pinned(file: string, href: string, row: Row): string {
	const fragment = href.match(/#.*$/)?.[0] ?? ""
	if (fragment !== "" && !/^#L\d+$/.test(fragment)) throw new Error(`${file}: ${href} carries a fragment a permalink cannot keep`)
	return permalink(row) + fragment
}

function editFor(file: string, href: string, ctx: Context): string | null | undefined {
	if (DELINKS.some((d) => d.file === file && d.href === href)) return null
	const fix = FIXES.find((f) => f.file === file && f.href === href)
	if (fix) return fix.to
	const target = links.resolveHref(file, href)
	if (target.kind !== "repo" || target.path === null) return undefined
	if (target.path === file && ctx.replacedPlans.has(file)) return pinned(file, href, ctx.rows.get(file) as Row)
	if (!lib.isCanonical(target.path)) return undefined
	const row = ctx.rows.get(target.path)
	if (!row) throw new Error(`${file}: ${href} → ${target.path} has no manifest row`)
	return pinned(file, href, row)
}

export function plannedEdits(file: string, hrefs: readonly string[], ctx: Context): Edits {
	const edits: Edits = new Map()
	for (const href of hrefs) {
		const to = editFor(file, href, ctx)
		if (to !== undefined) edits.set(href, to)
	}
	return edits
}

export function rewriteSource(src: string, edits: Edits): string {
	let out = src
	for (const [old, to] of edits) {
		const url = escapeRe(old)
		if (to === null) {
			out = out.replace(new RegExp(`\\[([^\\]\\n]*)\\]\\(<?${url}>?\\)`, "g"), (_, text: string) => text)
			continue
		}
		const put = (_: string, head: string) => head + to
		out = out
			.replace(new RegExp(`(\\]\\([ \\t]*<?)${url}(?=>?(?:[ \\t]|\\)))`, "g"), put)
			.replace(new RegExp(`^( {0,3}\\[[^\\]\\n]+\\]:[ \\t]*<?)${url}(?=>?(?:[ \\t]|$))`, "gm"), put)
			.replace(new RegExp(`(\\b(?:href|src)[ \\t]*=[ \\t]*["']?)${url}(?=["'\\s>])`, "gi"), put)
	}
	return out
}

function render(file: string, src: string): string {
	return file.endsWith(".html") ? src : Bun.markdown.html(src, { autolinks: true })
}

function escapeHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
}

/** The old rendering with the same substitutions applied to its attributes: what the new file must render to. */
export function expectedRendering(file: string, oldSrc: string, edits: Edits): string {
	let html = render(file, oldSrc)
	for (const [old, to] of edits) {
		const url = escapeRe(escapeHtml(old))
		html =
			to === null
				? html.replace(new RegExp(`<a href="${url}">([\\s\\S]*?)</a>`, "g"), (_, text: string) => text)
				: html.replace(new RegExp(`(\\b(?:href|src)=["']?)${url}(?=["'\\s>])`, "g"), (_, head: string) => head + escapeHtml(to))
	}
	return html
}

/** Throws unless the rewrite changed exactly the planned URLs and nothing a reader sees. */
export function prove(file: string, oldSrc: string, newSrc: string, edits: Edits): void {
	if (render(file, newSrc) !== expectedRendering(file, oldSrc, edits))
		throw new Error(`${file}: the rewrite changes the rendered page beyond its URLs`)
	const mapped = links
		.extract(file, oldSrc)
		.links.flatMap((l) => (edits.has(l.href) ? (edits.get(l.href) === null ? [] : [edits.get(l.href) as string]) : [l.href]))
	const got = links.extract(file, newSrc).links.map((l) => l.href)
	if (JSON.stringify(got) !== JSON.stringify(mapped)) throw new Error(`${file}: its links are not the old ones mapped`)
}

function context(cwd: string, promotions?: readonly Promotion[]): Context {
	const rows = rowsByPath(readManifest(cwd))
	return { rows, replacedPlans: replacedPlans(rows, promotions) }
}

/** The rewritten text of one document, proved, or null when it has nothing to rewrite. */
export function rewriteDocument(file: string, src: string, ctx: Context): string | null {
	if (lib.isCanonical(file)) return null
	const edits = plannedEdits(
		file,
		links.extract(file, src).links.map((l) => l.href),
		ctx,
	)
	if (edits.size === 0) return null
	const out = rewriteSource(src, edits)
	prove(file, src, out, edits)
	return out
}

export function rewriteLinks(opts: { cwd: string; promotions?: readonly Promotion[] }): { files: string[]; links: number } {
	const { cwd } = opts
	const ctx = context(cwd, opts.promotions)
	const tree = lib.createCtx({ cwd })
	const docs = links.extractDocs(tree)
	const files: string[] = []
	let count = 0
	for (const doc of docs.values()) {
		const out = rewriteDocument(doc.path, doc.src, ctx)
		if (out === null) continue
		if (git(cwd, "status", "--porcelain", "--", doc.path) !== "") throw new Error(`${doc.path} has uncommitted edits`)
		writeFileSync(join(cwd, doc.path), out)
		git(cwd, "add", "--", doc.path)
		files.push(doc.path)
		count += doc.links.filter((l) => plannedEdits(doc.path, [l.href], ctx).size > 0).length
	}
	return { files, links: count }
}

/** Re-derives `commit` from its parent: every document it touched is the parent's text rewritten and proved. */
export function verifyCommit(opts: { cwd: string; commit: string; promotions?: readonly Promotion[] }): string[] {
	const { cwd, commit } = opts
	const ctx = context(cwd, opts.promotions)
	const changed = git(cwd, "diff", "--name-only", "-z", `${commit}^`, commit).split("\0").filter(Boolean)
	const problems: string[] = []
	for (const file of changed) {
		if (!lib.isDocument(file)) {
			problems.push(`${file} is not a document`)
			continue
		}
		try {
			const before = git(cwd, "show", `${commit}^:${file}`)
			const after = git(cwd, "show", `${commit}:${file}`)
			if (rewriteDocument(file, before, ctx) !== after) problems.push(`${file} differs from its re-derived rewrite`)
		} catch (e) {
			problems.push((e as Error).message)
		}
	}
	return problems
}

function main(argv: readonly string[]): number {
	const cwd = process.cwd()
	const at = argv.indexOf("--verify")
	if (at !== -1) {
		const commit = argv[at + 1]
		if (!commit) throw new Error("--verify needs the rewrite commit")
		const problems = verifyCommit({ cwd, commit })
		for (const p of problems) console.log(p)
		const files = git(cwd, "diff", "--name-only", `${commit}^`, commit).trim().split("\n").filter(Boolean).length
		console.log(`rewrite-links --verify ${commit}: ${files} file(s), ${problems.length} problem(s)`)
		return problems.length === 0 ? 0 : 1
	}
	const { files, links: n } = rewriteLinks({ cwd })
	console.log(`rewrote ${n} link(s) in ${files.length} file(s)`)
	for (const f of files) console.log(`  ${f}`)
	return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
