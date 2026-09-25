/**
 * Link and path-token rules. Links come from the rendered HTML, so code spans and fences are never
 * links while inline, reference-style and raw HTML links all are; `.html` files go straight to the
 * rewriter.
 */
import { posix } from "node:path"
import {
	ARCHIVE,
	type Ctx,
	CURATED_FILES,
	decodeEntities,
	existsInIndex,
	type Finding,
	INDEX_FILES,
	isCanonical,
	type Link,
	lineOf,
	PLANS,
	activePlanDirs,
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

function renderMarkdown(src: string): string {
	return Bun.markdown.html(src)
}

function safeDecodeUri(text: string): string {
	try {
		return decodeURIComponent(text)
	} catch {
		return text
	}
}

export function extract(file: string, src: string): { links: Link[]; h2: string[]; sections: Section[] } {
	const html = file.endsWith(".html") ? src : renderMarkdown(src)
	const raw: string[] = []
	const sections: Section[] = []
	let current: Section | null = null
	let inHeading = false
	new HTMLRewriter()
		.on("a[href]", { element: (e) => void raw.push(e.getAttribute("href") ?? "") })
		.on("img[src]", { element: (e) => void raw.push(e.getAttribute("src") ?? "") })
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
	const links = raw.map((r) => {
		const href = decodeEntities(r)
		return { href, line: lineOf(src, [r, href, safeDecodeUri(href)]) }
	})
	return { links, h2: decodedSections.map((s) => s.heading), sections: decodedSections }
}

export function extractDocs(ctx: Ctx): Map<string, Doc> {
	const docs = new Map<string, Doc>()
	for (const path of ctx.tracked) {
		if (!path.endsWith(".md") && !path.endsWith(".html")) continue
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

/**
 * Frozen plan prose cites code the way reviewers wrote it: repo-rooted (`apps/x.ts`), often with a
 * `:line` suffix. Those links were broken before any move and stay history; only links that mean a
 * place in the plan tree are checked there.
 */
function citesRepoRoot(href: string, topLevel: ReadonlySet<string>): boolean {
	const path = safeDecodeUri(href.replace(/[?#].*$/, ""))
	if (/:\d+(?:-\d+)?$/.test(path)) return true
	return !path.startsWith(".") && !path.startsWith("/") && topLevel.has(path.split("/")[0])
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
	if (scope.kind === "plans" && (!target.path.startsWith(`${PLANS}/`) || citesRepoRoot(link.href, scope.topLevel))) return null
	if (target.path === "" || existsInIndex(ctx, target.path)) return null
	return {
		...base,
		rule: "link-missing",
		detail: `${link.href} → ${target.path} is not in the git index`,
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

/** `a/{b,c}/d` → `a/b/d`, `a/c/d`; every group expands. */
export function expandBraces(token: string): string[] {
	const match = token.match(/\{([^{}]*)\}/)
	if (!match || match.index === undefined) return [token]
	const head = token.slice(0, match.index)
	const tail = token.slice(match.index + match[0].length)
	return match[1].split(",").flatMap((alt) => expandBraces(`${head}${alt}${tail}`))
}

const TOKEN_RE = /implementations-plan\/[A-Za-z0-9._/{},*<>-]*/g

/** Plan paths named in a line of text; templates (`<plan>`, globs) are not paths. */
export function pathTokens(text: string): string[] {
	const out: string[] = []
	for (const raw of text.match(TOKEN_RE) ?? []) {
		for (const token of expandBraces(raw)) {
			const clean = token.replace(/[.,]+$/, "").replace(/\/+$/, "")
			if (!/[*<>{}]/.test(clean) && !clean.endsWith("...")) out.push(clean)
		}
	}
	return out
}

function tokenResolves(ctx: Ctx, token: string, isCode: boolean): boolean {
	if (existsInIndex(ctx, token)) return true
	// Code comments may keep naming a plan after it closes: the archived copy satisfies them.
	return isCode && existsInIndex(ctx, `${ARCHIVE}${token.slice(PLANS.length)}`)
}

export function pathTokenFindings(ctx: Ctx): Finding[] {
	const grep = ctx.git("grep", "--cached", "-n", "-I", "-E", "implementations-plan/", "--", ".", ...PATH_TOKEN_EXCLUDES)
	// Exit status 1 is "no match", not an error.
	if (grep.status === 1) return []
	if (!grep.ok) throw new Error(`git grep failed: ${grep.stderr.trim()}`)
	const findings: Finding[] = []
	for (const hit of grep.stdout.split("\n")) {
		const m = hit.match(/^([^:]+):(\d+):(.*)$/)
		if (!m) continue
		const [, file, line, text] = m
		const isCode = !file.endsWith(".md") && !file.endsWith(".html")
		for (const token of new Set(pathTokens(text))) {
			if (tokenResolves(ctx, token, isCode)) continue
			const where = isCode ? "at HEAD or under archive/" : "at HEAD"
			findings.push({
				rule: "path-token",
				file,
				line: Number(line),
				detail: `${token} does not resolve ${where}`,
				fix: "repoint it or link a permalink",
			})
		}
	}
	return findings
}
