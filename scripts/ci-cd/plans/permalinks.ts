/**
 * Permalink rules. A permalink pins an exact commit of this repository, and that commit must be one of
 * the allowlisted bases, each an ancestor of `dev`. GitHub serves a fork network's commits under the
 * parent's URL, so shape alone proves nothing about where a SHA came from.
 */
import type { Doc } from "./links"
import { type Ctx, type Finding, isCanonical, lineOf } from "./lib"

export const BASES_FILE = "scripts/ci-cd/plans/permalink-bases.json"
export const DEV_REF = "refs/remotes/origin/dev"
/** A file or directory at a full SHA; only `tree` may name the repository root itself. */
export const PERMALINK_RE =
	/^https:\/\/github\.com\/alejoamiras\/nulo\/(?:blob\/([0-9a-f]{40})\/[A-Za-z0-9._/-]+(?:#L\d+)?|tree\/([0-9a-f]{40})(?:\/[A-Za-z0-9._/-]+)?)$/

function permalinkSha(href: string): string | null {
	const m = href.match(PERMALINK_RE)
	return m ? (m[1] ?? m[2]) : null
}
const CANDIDATE_RE = /^https?:\/\/(?:www\.)?github\.com\/[^/]+\/nulo\/(?:blob|tree)\//i
const FULL_SHA_RE = /^[0-9a-f]{40}$/

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
	if (!CANDIDATE_RE.test(href)) return null
	const sha = permalinkSha(href)
	if (sha === null) {
		return {
			rule: "permalink-shape",
			file: doc.path,
			line,
			detail: `${href} is not https://github.com/alejoamiras/nulo/(blob|tree)/<40-hex sha>/<path>`,
			fix: "pin a full SHA of this repository",
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
 */
function prepareDev(ctx: Ctx): Finding | null {
	if (ctx.env.GITHUB_ACTIONS === "true") {
		const fetched = ctx.git("fetch", "--no-tags", "--filter=tree:0", "origin", `+refs/heads/dev:${DEV_REF}`)
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
	if (ctx.env.GITHUB_ACTIONS === "true" && !ctx.env.GITHUB_BASE_REF) return []
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
