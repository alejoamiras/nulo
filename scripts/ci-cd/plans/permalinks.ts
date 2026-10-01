/**
 * Permalink rules. A permalink pins an exact commit of this repository, and that commit must be one of
 * the allowlisted bases, each an ancestor of `dev`. GitHub serves a fork network's commits under the
 * parent's URL, so shape alone proves nothing about where a SHA came from.
 */
import type { Doc } from "./links"
import { type Ctx, type Finding, isCanonical, lineOf, mode, safeDecodeUri } from "./lib"

export const BASES_FILE = "scripts/ci-cd/plans/permalink-bases.json"
export const DEV_REF = "refs/remotes/origin/dev"
/** A file or directory at a full SHA; only `tree` may name the repository root itself. */
export const PERMALINK_RE =
	/^https:\/\/github\.com\/alejoamiras\/nulo\/(?:blob\/([0-9a-f]{40})(?:\/[A-Za-z0-9._-]+)+(?:#L\d+)?|tree\/([0-9a-f]{40})(?:\/[A-Za-z0-9._-]+)*)$/
const GITHUB_HOSTS: ReadonlySet<string> = new Set(["github.com", "www.github.com"])
const FULL_SHA_RE = /^[0-9a-f]{40}$/

function parseUrl(href: string): URL | null {
	try {
		return new URL(href.trim(), "https://relative.invalid/")
	} catch {
		return null
	}
}

/**
 * The SHA a permalink pins, or null unless the link is canonical as written: no `.` or `..` segment, and
 * unchanged by a browser's normalization. `…/blob/GOOD/../../blob/BAD/…` has the shape and opens BAD.
 */
function permalinkSha(href: string): string | null {
	const m = href.match(PERMALINK_RE)
	if (!m || href.split(/[/#]/).some((s) => s === "." || s === "..")) return null
	return parseUrl(href)?.href === href ? (m[1] ?? m[2]) : null
}

function namesNuloView(path: string): boolean {
	const [, , repo, view] = path.split(/[\\/]/).map((s) => safeDecodeUri(s).toLowerCase())
	return repo === "nulo" && (view === "blob" || view === "tree")
}

/**
 * A link to this repository's files in any spelling a browser takes to GitHub: protocol-relative, `/\`,
 * http, `www.`, any case, a trailing-dot host. The path is read as written and as resolved, so dot
 * segments cannot walk a nulo link out of the candidate set.
 */
function isCandidate(href: string): boolean {
	const url = parseUrl(href)
	if (!url || !/^https?:$/.test(url.protocol) || !GITHUB_HOSTS.has(url.hostname.replace(/\.$/, ""))) return false
	const written = href
		.trim()
		.replace(/^[a-z][a-z0-9+.-]*:/i, "")
		.replace(/^[\\/]{2}[^\\/?#]*/, "")
		.replace(/[?#].*$/, "")
	return namesNuloView(url.pathname) || namesNuloView(written)
}

/** Allowlisted SHAs mapped to their line in the bases file. */
export type Bases = Map<string, number>

export function loadBases(ctx: Ctx): Bases {
	if (!ctx.tracked.has(BASES_FILE)) return new Map()
	const src = ctx.read(BASES_FILE)
	const shas = Object.keys(JSON.parse(src) as Record<string, string>)
	return new Map(shas.map((sha) => [sha, lineOf(src, [`"${sha}"`])]))
}

export function isAllowedPermalink(href: string, bases: Bases): boolean {
	const sha = permalinkSha(href)
	return sha !== null && bases.has(sha)
}

function judgePermalink(doc: Doc, href: string, line: number, bases: Bases): Finding | null {
	if (!isCandidate(href)) return null
	const sha = permalinkSha(href)
	if (sha === null) {
		return {
			rule: "permalink-shape",
			file: doc.path,
			line,
			detail: `${href} is not the canonical https://github.com/alejoamiras/nulo/(blob|tree)/<40-hex sha>/<path>`,
			fix: "write that URL, at a full SHA of this repository",
		}
	}
	if (bases.has(sha)) return null
	return {
		rule: "permalink-base",
		file: doc.path,
		line,
		detail: `${sha} is not in ${BASES_FILE}`,
		fix: "pin an allowlisted SHA, or add a dev commit there",
	}
}

export function permalinkFindings(docs: ReadonlyMap<string, Doc>, bases: Bases): Finding[] {
	const findings: Finding[] = []
	for (const doc of docs.values()) {
		if (isCanonical(doc.path)) continue
		for (const link of doc.links) {
			const found = judgePermalink(doc, link.href, link.line, bases)
			if (found) findings.push(found)
		}
	}
	return findings
}

function ancestry(file: string, line: number, detail: string, fix: string): Finding {
	return { rule: "permalink-ancestry", file, line, detail, fix }
}

/**
 * Makes `dev`'s commit graph available: a pull-request run fetches it by name (commits only) and fails
 * closed; a local run uses the existing ref. The PR base is never the anchor: on a stacked PR it is a
 * parent arc, whose commits may never reach `dev`.
 *
 * A shallow checkout is unshallowed: once anything has fetched dev's tip at depth 1 (the complexity
 * ratchet does, earlier in the same job), a plain fetch adds nothing and dev's history stops at it.
 */
function prepareDev(ctx: Ctx): Finding | null {
	if (ctx.env.GITHUB_ACTIONS === "true") {
		const shallow = ctx.git("rev-parse", "--is-shallow-repository").stdout.trim() === "true"
		const deepen = shallow ? ["--unshallow"] : []
		const fetched = ctx.git("fetch", "--no-tags", "--filter=tree:0", ...deepen, "origin", `+refs/heads/dev:${DEV_REF}`)
		if (fetched.ok) return null
		return ancestry(BASES_FILE, 1, `cannot fetch dev: ${fetched.stderr.trim().split("\n").pop() ?? "fetch failed"}`, "re-run the job")
	}
	if (ctx.git("rev-parse", "--verify", "-q", `${DEV_REF}^{commit}`).ok) return null
	return ancestry(BASES_FILE, 1, "origin/dev is not available locally", "git fetch origin dev")
}

function judgeBase(ctx: Ctx, sha: string, line: number): Finding | null {
	if (!FULL_SHA_RE.test(sha)) return ancestry(BASES_FILE, line, `${sha} is not a full SHA`, "list full 40-hex SHAs")
	if (!ctx.git("cat-file", "-e", `${sha}^{commit}`).ok) {
		return ancestry(
			BASES_FILE,
			line,
			`${sha} is not reachable from dev here`,
			"git fetch origin dev; if it still fails, the commit is not on dev",
		)
	}
	if (ctx.git("merge-base", "--is-ancestor", sha, DEV_REF).ok) return null
	return ancestry(BASES_FILE, line, `${sha} is not an ancestor of dev`, "pin a commit that is on dev (git fetch origin dev if dev moved)")
}

export function permalinkAncestryFindings(ctx: Ctx, bases: Bases): Finding[] {
	// Push, nightly and release runs only report and never touch the network.
	if (mode(ctx.env) === "report") return []
	if (bases.size === 0) return []
	const unavailable = prepareDev(ctx)
	if (unavailable) return [unavailable]
	const findings: Finding[] = []
	for (const [sha, line] of bases) {
		const found = judgeBase(ctx, sha, line)
		if (found) findings.push(found)
	}
	return findings
}
