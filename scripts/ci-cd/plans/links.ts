/**
 * Link and path-token rules. Links come from the rendered HTML, so code spans and fences are never
 * links while inline, reference-style, autolinked and raw HTML links all are; `.html` files go straight
 * to the rewriter.
 */
import { posix } from "node:path"
import {
	ARCHIVE,
	activePlanDirs,
	type Ctx,
	CURATED_FILES,
	decodeEntities,
	existsInIndex,
	type Finding,
	INDEX_FILES,
	isCanonical,
	isDocument,
	type Link,
	lineOf,
	PLANS,
	REGULAR_MODES,
	safeDecodeUri,
} from "./lib"

export type Section = { heading: string; text: string }
export type Doc = { path: string; src: string; links: Link[]; h2: string[]; sections: Section[] }
export type Target = { kind: "external" } | { kind: "anchor" } | { kind: "repo"; path: string | null }

/** Live docs outside the plan tree whose links must all resolve. */
const LIVE_DOCS = [
	/^[^/]+\.md$/,
	/^legal\//,
	/^apps\/.+\/README\.md$/,
	/^packages\/[^/]+\/README\.md$/,
	/^\.claude\/skills\//,
	/^\.github\/README\.md$/,
]
const HISTORY_DOCS = new Set(["CHANGELOG.md", "AUDIT.md"])
/** Frozen research and audit trees are out of the path-token scan, like the release history; so are this gate's fixtures. */
const PATH_TOKEN_EXCLUDES = [
	":!implementations-plan",
	":!audit",
	":!architecture",
	":!wallets-architecture-research",
	":!CHANGELOG.md",
	":!AUDIT.md",
	":!scripts/ci-cd/plans",
]
/** The attributes that load or link a resource; `srcset` holds a list of them. */
const URL_ATTRIBUTES: readonly [tag: string, attrs: readonly string[]][] = [
	["a", ["href"]],
	["area", ["href"]],
	["link", ["href"]],
	["img", ["src", "srcset"]],
	["source", ["src", "srcset"]],
	["script", ["src"]],
	["iframe", ["src"]],
	["embed", ["src"]],
	["video", ["src", "poster"]],
	["audio", ["src"]],
	["track", ["src"]],
	["object", ["data"]],
]

/** GitHub renders GFM autolink literals, so a bare `https://` or `www.` URL is a link there too. */
function renderMarkdown(src: string): string {
	return Bun.markdown.html(src, { autolinks: true })
}

/** Each candidate's URL runs to whitespace, and its descriptors to the next comma. */
export function srcsetUrls(value: string): string[] {
	const urls: string[] = []
	let rest = value
	for (;;) {
		rest = rest.replace(/^[\s,]+/, "")
		const url = rest.match(/^\S+/)?.[0]
		if (url === undefined) return urls
		urls.push(url.replace(/,+$/, ""))
		rest = url.endsWith(",") ? rest.slice(url.length) : rest.slice(url.length).replace(/^[^,]*/, "")
	}
}

type RawLink = { needle: string; href: string }

function urlsOf(attr: string, value: string): RawLink[] {
	if (attr !== "srcset") return [{ needle: value, href: decodeEntities(value) }]
	return srcsetUrls(decodeEntities(value)).map((href) => ({ needle: href, href }))
}

export function extract(file: string, src: string): { links: Link[]; h2: string[]; sections: Section[] } {
	const html = file.endsWith(".html") ? src : renderMarkdown(src)
	const raw: RawLink[] = []
	const sections: Section[] = []
	let current: Section | null = null
	let inHeading = false
	const rewriter = new HTMLRewriter()
	for (const [tag, attrs] of URL_ATTRIBUTES) {
		rewriter.on(tag, {
			element(e) {
				for (const attr of attrs) {
					const value = e.getAttribute(attr)
					if (value !== null) raw.push(...urlsOf(attr, value))
				}
			},
		})
	}
	rewriter
		.on("h2", {
			element(e) {
				current = { heading: "", text: "" }
				sections.push(current)
				inHeading = true
				e.onEndTag(() => {
					inHeading = false
				})
			},
		})
		.onDocument({
			text(t) {
				if (current === null) return
				if (inHeading) current.heading += t.text
				else current.text += t.text
			},
		})
		.transform(html)
	const decodedSections = sections.map((s) => ({ heading: decodeEntities(s.heading).trim(), text: decodeEntities(s.text) }))
	const links = raw.map(({ needle, href }) => ({ href, line: linkLine(src, needle, href) }))
	return { links, h2: decodedSections.map((s) => s.heading), sections: decodedSections }
}

/** An autolinked `www.` URL gains an `http://` its source never had, so the bare form is the fallback needle. */
function linkLine(src: string, needle: string, href: string): number {
	return lineOf(src, [needle, href, safeDecodeUri(href)], 0) || lineOf(src, [href.replace(/^(?:https?:\/\/|mailto:)/, "")])
}

/** A symlinked or gitlinked document is a `document-type` finding and is never read as one. */
export function extractDocs(ctx: Ctx): Map<string, Doc> {
	const paths = [...ctx.tracked].filter((p) => isDocument(p) && REGULAR_MODES.has(ctx.modes.get(p) ?? ""))
	ctx.load(paths)
	const docs = new Map<string, Doc>()
	for (const path of paths) {
		const src = ctx.read(path)
		docs.set(path, { path, src, ...extract(path, src) })
	}
	return docs
}

/** Where a link points, resolved from its file: repo paths are relative, or repo-rooted with a leading `/`. */
export function resolveHref(from: string, href: string): Target {
	const trimmed = href.trim()
	if (trimmed === "" || trimmed.startsWith("#")) return { kind: "anchor" }
	// No dot in the scheme: `plan.md:40` is a broken file cite, not a URL.
	if (/^[a-z][a-z0-9+-]*:/i.test(trimmed) || trimmed.startsWith("//")) return { kind: "external" }
	const bare = safeDecodeUri(trimmed.replace(/[?#].*$/, ""))
	const joined = bare.startsWith("/") ? bare.slice(1) : posix.join(posix.dirname(from), bare)
	const normal = posix.normalize(joined).replace(/\/+$/, "")
	if (normal === ".." || normal.startsWith("../")) return { kind: "repo", path: null }
	return { kind: "repo", path: normal === "." ? "" : normal }
}

/** How far `link-missing` reaches from a file: every target, targets inside the plan tree only, or none. */
export function missingScope(ctx: Ctx, file: string): "full" | "plans" | null {
	if (INDEX_FILES.includes(file) || CURATED_FILES.includes(file)) return "full"
	if (file.startsWith(`${PLANS}/`)) {
		const active = activePlanDirs(ctx)
		const dir = file.slice(PLANS.length + 1).split("/")[0]
		// Until the archive split there is no active set, and archived prose keeps its already-broken outside links.
		return active?.has(dir) ? "full" : "plans"
	}
	if (HISTORY_DOCS.has(file)) return null
	return LIVE_DOCS.some((re) => re.test(file)) ? "full" : null
}

const LINE_CITE_RE = /:\d+(?:-\d+)?$/

/**
 * The plan-tree paths a link in frozen plan prose may mean. Reviewers cited code repo-rooted
 * (`apps/x.ts`), often with a `:line` suffix; those cites were broken before any move and stay history.
 * Any reading that lands in the plan tree is checked with the suffix dropped, because that target is
 * what a move has to keep.
 */
function planTreeTargets(from: string, href: string, topLevel: ReadonlySet<string>): string[] {
	const bare = href
		.trim()
		.replace(/[?#].*$/, "")
		.replace(LINE_CITE_RE, "")
	const decoded = safeDecodeUri(bare)
	const rooted = !/^\.{0,2}\//.test(decoded) && topLevel.has(decoded.split("/")[0])
	if (rooted && !decoded.startsWith(`${PLANS}/`)) return []
	const relative = resolveHref(from, bare)
	const readings = [rooted ? posix.normalize(decoded) : null, relative.kind === "repo" ? relative.path : null]
	return readings.filter((p): p is string => p?.startsWith(`${PLANS}/`) === true)
}

type LinkScope = { kind: "full" | "plans" | null; topLevel: ReadonlySet<string> }

function judgeLink(ctx: Ctx, doc: Doc, link: Link, scope: LinkScope): Finding | null {
	const target = resolveHref(doc.path, link.href)
	if (target.kind !== "repo") return null
	const base = { file: doc.path, line: link.line }
	if (target.path !== null && isCanonical(target.path)) {
		return {
			...base,
			rule: "link-untracked",
			detail: `links ${target.path}, which the plans .gitignore keeps out`,
			fix: "link it by permalink",
		}
	}
	if (scope.kind === null) return null
	if (target.path === null) {
		return scope.kind === "full"
			? { ...base, rule: "link-missing", detail: `${link.href} escapes the repository`, fix: "point it inside the repo" }
			: null
	}
	const candidates = scope.kind === "plans" ? planTreeTargets(doc.path, link.href, scope.topLevel) : [target.path]
	if (candidates.length === 0 || candidates.some((p) => p === "" || existsInIndex(ctx, p))) return null
	return {
		...base,
		rule: "link-missing",
		detail: `${link.href} → ${candidates[0]} is not in the git index`,
		fix: "fix the path or link a permalink",
	}
}

export function linkFindings(ctx: Ctx, docs: ReadonlyMap<string, Doc>): Finding[] {
	const topLevel = new Set([...ctx.tracked].map((p) => p.split("/")[0]))
	const findings: Finding[] = []
	for (const doc of docs.values()) {
		// A transcript is already a tracked-artifact finding and leaves the tree with its links.
		if (isCanonical(doc.path)) continue
		const scope = { kind: missingScope(ctx, doc.path), topLevel }
		for (const link of doc.links) {
			const found = judgeLink(ctx, doc, link, scope)
			if (found) findings.push(found)
		}
	}
	return findings
}

export const BRACE_CAP = 256

/** `a/{b,c}/d` → `a/b/d`, `a/c/d`, every group expanding; null once the results would pass `BRACE_CAP`, before they exist. */
export function expandBraces(token: string): string[] | null {
	const done: string[] = []
	const queue = [token]
	for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
		const m = next.match(/\{([^{}]*)\}/)
		if (!m || m.index === undefined) {
			done.push(next)
			continue
		}
		const alternatives = m[1].split(",")
		if (done.length + queue.length + alternatives.length > BRACE_CAP) return null
		const head = next.slice(0, m.index)
		const tail = next.slice(m.index + m[0].length)
		for (const alt of alternatives) queue.push(`${head}${alt}${tail}`)
	}
	return done
}

const TOKEN_RE = /implementations-plan\/[A-Za-z0-9._/{},*<>-]*/g

/** Plan paths named in a line of text; templates (`<plan>`, globs) are not paths. `overflow` holds tokens past the brace cap. */
export function pathTokens(text: string): { paths: string[]; overflow: string[] } {
	const paths: string[] = []
	const overflow: string[] = []
	for (const raw of text.match(TOKEN_RE) ?? []) {
		const expanded = expandBraces(raw)
		if (expanded === null) overflow.push(raw)
		for (const token of expanded ?? []) {
			const clean = token.replace(/[.,]+$/, "").replace(/\/+$/, "")
			if (!/[*<>{}]/.test(clean) && !clean.endsWith("...")) paths.push(clean)
		}
	}
	return { paths, overflow }
}

function tokenResolves(ctx: Ctx, token: string, isCode: boolean): boolean {
	if (existsInIndex(ctx, token)) return true
	// Code comments may keep naming a plan after it closes: the archived copy satisfies them.
	return isCode && existsInIndex(ctx, `${ARCHIVE}${token.slice(PLANS.length)}`)
}

function hitFindings(ctx: Ctx, file: string, line: number, text: string): Finding[] {
	const isCode = !isDocument(file)
	const where = isCode ? "at HEAD or under archive/" : "at HEAD"
	const { paths, overflow } = pathTokens(text)
	const at = (detail: string, fix: string): Finding => ({ rule: "path-token", file, line, detail, fix })
	return [
		...overflow.map((raw) => at(`${raw} expands to more than ${BRACE_CAP} paths`, "spell the paths out")),
		...[...new Set(paths)]
			.filter((token) => !tokenResolves(ctx, token, isCode))
			.map((token) => at(`${token} does not resolve ${where}`, "repoint it or link a permalink")),
	]
}

export function pathTokenFindings(ctx: Ctx): Finding[] {
	// `-a`: a NUL byte would otherwise make git skip the whole file as binary.
	const grep = ctx.git("grep", "--cached", "-n", "-a", "-E", "implementations-plan/", "--", ".", ...PATH_TOKEN_EXCLUDES)
	// Exit status 1 is "no match", not an error.
	if (grep.status === 1) return []
	if (!grep.ok) throw new Error(`git grep failed: ${grep.stderr.trim()}`)
	const findings: Finding[] = []
	for (const hit of grep.stdout.split("\n")) {
		// dotAll: a CRLF line keeps its `\r`, which `.` alone would not match.
		const m = hit.match(/^([^:]+):(\d+):(.*)$/s)
		if (m) findings.push(...hitFindings(ctx, m[1], Number(m[2]), m[3]))
	}
	return findings
}
