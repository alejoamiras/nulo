#!/usr/bin/env bun
/**
 * Repoints every link in a kept document that targets a transcript to a permalink at that transcript's
 * manifest row, so the link survives untracking with its bytes pinned.
 *
 * Only URL tokens in destination positions change (`](…)`, `]: …`, `href=`, `src=`), and never one
 * inside code. Each file is proved before it is written: its rendered page, node by node, equals the
 * old page with the same URL attributes substituted; every text and code node is unchanged; and its
 * links, in order, are exactly the old ones mapped. `--verify <commit>` re-derives a rewrite commit
 * from its parent and re-runs the proofs. A rerun on a rewritten tree changes nothing.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { git, PLANS, PROMOTIONS, permalink, planPath, type Row, readManifest, rowsByPath } from "./common"
import { html, lib, links } from "./gate"
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

/** A node of the rendered page; attribute values are decoded, and an end tag names its start's index. */
type Node =
	| { kind: "tag"; name: string; attrs: [string, string][] }
	| { kind: "end"; name: string; start: number }
	| { kind: "text"; text: string; code: boolean }
	| { kind: "comment"; text: string }

const URL_ATTRIBUTES: ReadonlySet<string> = new Set(["href", "src"])
const CODE_ELEMENTS: ReadonlySet<string> = new Set(["code", "pre"])

function render(file: string, src: string): string {
	return file.endsWith(".html") ? src : Bun.markdown.html(src, { autolinks: true })
}

export function nodes(file: string, src: string): Node[] {
	const out: Node[] = []
	let code = 0
	new HTMLRewriter()
		.on("*", {
			element(e) {
				const start = out.length
				const name = e.tagName.toLowerCase()
				out.push({ kind: "tag", name, attrs: [...e.attributes].map(([n, v]) => [n, html.decodeEntities(v)]) })
				if (!e.canHaveContent) return
				if (CODE_ELEMENTS.has(name)) code++
				e.onEndTag(() => {
					if (CODE_ELEMENTS.has(name)) code--
					out.push({ kind: "end", name, start })
				})
			},
		})
		.onDocument({
			text: (t) => void out.push({ kind: "text", text: t.text, code: code > 0 }),
			comments: (c) => void out.push({ kind: "comment", text: c.text }),
		})
		.transform(render(file, src))
	return out
}

/** The page as one string, adjacent text merged, so a dropped link joins its text to its neighbours. */
function serialize(ns: readonly Node[]): string {
	return ns
		.map((n) => {
			if (n.kind === "tag") return `<${n.name}${n.attrs.map(([a, v]) => ` ${a}=${JSON.stringify(v)}`).join("")}>`
			if (n.kind === "end") return `</${n.name}>`
			return n.kind === "comment" ? `<!--${n.text}-->` : n.text
		})
		.join("")
}

function textOf(ns: readonly Node[], codeOnly: boolean): string {
	return ns
		.flatMap((n) => (n.kind === "text" && (!codeOnly || n.code) ? [n.text] : n.kind === "comment" ? [`<!--${n.text}-->`] : []))
		.join("")
}

/** The old page with the planned URL attributes substituted, and each de-linked `<a>` unwrapped. */
export function substituted(ns: readonly Node[], edits: Edits): Node[] {
	const dropped = new Set<number>()
	const out = ns.map((n, i): Node => {
		if (n.kind !== "tag") return n
		const attrs = n.attrs.map(([a, v]): [string, string] => {
			const to = URL_ATTRIBUTES.has(a) ? edits.get(v) : undefined
			if (to === null && n.name === "a") dropped.add(i)
			return [a, typeof to === "string" ? to : v]
		})
		return { ...n, attrs }
	})
	return out.filter((n, i) => !dropped.has(i) && !(n.kind === "end" && dropped.has(n.start)))
}

type Span = { start: number; end: number; put: string }

/** Every place in the source a destination-shaped token spells `old`; code may hold some of them. */
function candidates(src: string, old: string, to: string | null): Span[] {
	const url = escapeRe(old)
	if (to === null) {
		return [...src.matchAll(new RegExp(`\\[([^\\]\\n]*)\\]\\(<?${url}>?\\)`, "g"))].map((m) => ({
			start: m.index ?? 0,
			end: (m.index ?? 0) + m[0].length,
			put: m[1],
		}))
	}
	const shapes = [
		new RegExp(`(\\]\\([ \\t]*<?)${url}(?=>?(?:[ \\t]|\\)))`, "g"),
		new RegExp(`^( {0,3}\\[[^\\]\\n]+\\]:[ \\t]*<?)${url}(?=>?(?:[ \\t]|$))`, "gm"),
		new RegExp(`(\\b(?:href|src)[ \\t]*=[ \\t]*["']?)${url}(?=["'\\s>])`, "gi"),
	]
	const starts = new Set(shapes.flatMap((re) => [...src.matchAll(re)].map((m) => (m.index ?? 0) + m[1].length)))
	return [...starts].map((start) => ({ start, end: start + old.length, put: to }))
}

function applySpans(src: string, spans: readonly Span[]): string {
	return [...spans].sort((a, b) => b.start - a.start).reduce((s, x) => s.slice(0, x.start) + x.put + s.slice(x.end), src)
}

/**
 * Rewrites only the tokens that are link destinations: each candidate is tried alone and kept when it
 * leaves every text, code and comment node as it was and changes the page's tags.
 */
export function rewriteSource(file: string, src: string, edits: Edits): string {
	const base = nodes(file, src)
	const [text, code, tags] = [textOf(base, false), textOf(base, true), serialize(base.filter((n) => n.kind === "tag"))]
	const kept = [...edits].flatMap(([old, to]) =>
		candidates(src, old, to).filter((span) => {
			const trial = nodes(file, applySpans(src, [span]))
			return (
				textOf(trial, false) === text && textOf(trial, true) === code && serialize(trial.filter((n) => n.kind === "tag")) !== tags
			)
		}),
	)
	return applySpans(src, kept)
}

/**
 * Throws unless the rewrite changed exactly the planned URLs and nothing a reader sees: the new page
 * equals the old one with its URL attributes substituted, every text and code node is unchanged, and
 * the links are the old ones mapped.
 */
export function prove(file: string, oldSrc: string, newSrc: string, edits: Edits): void {
	const [before, after] = [nodes(file, oldSrc), nodes(file, newSrc)]
	if (serialize(after) !== serialize(substituted(before, edits)))
		throw new Error(`${file}: the rewrite changes the rendered page beyond its URLs`)
	if (textOf(after, false) !== textOf(before, false) || textOf(after, true) !== textOf(before, true))
		throw new Error(`${file}: the rewrite changes the rendered page beyond its URLs (a text or code node)`)
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
	const out = rewriteSource(file, src, edits)
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
