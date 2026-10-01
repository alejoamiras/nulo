import { posix } from "node:path"
import { type Block, blockLines, itemHrefs, topBlocks } from "./entries"
import { type Doc, resolveHref } from "./links"
import {
	ACTIVE_INDEX,
	ARCHIVE,
	ARCHIVE_IGNORE,
	ARCHIVE_INDEX,
	activePlanDirs,
	CANONICAL_PATTERNS,
	type Ctx,
	CURATED_FILES,
	childDirs,
	type Finding,
	INDEX_FILES,
	type IndexEntry,
	isCanonical,
	isDocument,
	LESSONS_FILE,
	LESSONS_REINCLUDE,
	lineOf,
	PLANS,
	parseIndex,
	REGULAR_MODES,
	type RuleId,
} from "./lib"
import { type Bases, isAllowedPermalink } from "./permalinks"

const GITIGNORE = `${PLANS}/.gitignore`
const IGNORE = `${PLANS}/.ignore`
/** git reads `.gitignore`; ripgrep also reads `.ignore` and `.rgignore`, above it in precedence. */
const IGNORE_FILES: ReadonlySet<string> = new Set([".gitignore", ".ignore", ".rgignore"])
/** Shrink-only: a nested ignore file can override the lessons re-include, so each one is a reviewed exception. */
export const NESTED_IGNORE_ALLOWLIST: readonly string[] = [`${PLANS}/vitest-on-bun/lessons/baselines/full/.gitignore`]
/** The dirs `local-path` covers before the archive split names an active set. */
export const PRE_SPLIT_ACTIVE: readonly string[] = ["plans-scaffolding"]
export const LESSONS_BUDGET = 8192
export const CLOSING_STATUS = "closed, awaiting archive"
/** A home segment counts only where a path starts; the lookbehind keeps URL and relative paths out. */
const LOCAL_PATH_RE = /(?<![\w.-])(?:\/(?:Users|home)\/\w|\/mnt\/[\w.-]+\/\w|\/root(?![\w.-]))|\b[A-Za-z]:\\{1,2}[Uu]sers\\{1,2}\w/
const REPO_ISSUE_RE = /^https:\/\/github\.com\/alejoamiras\/nulo\/(?:issues|pull)\/\d+(?:#[\w-]+)?$/
const OUTCOME_FIELDS = [/\bDate\s*:/, /\bStatus\s*:/, /\b(?:Shipped|Delivered)\s*:/, /\bSeeds retired\s*:/i]
const NON_REGULAR: Readonly<Record<string, string>> = { "120000": "a symlink", "160000": "a gitlink" }

function finding(rule: RuleId, file: string, line: number, detail: string, fix: string): Finding {
	return { rule, file, line, detail, fix }
}

export function trackedArtifactFindings(ctx: Ctx): Finding[] {
	// `--exclude-standard` reads the ignore files from the working tree, the one input not taken from the
	// index; CI's checkout equals the commit, so only a local run with unstaged ignore edits can differ.
	const res = ctx.git("ls-files", "-ci", "--exclude-standard", "-z", "--", PLANS)
	if (!res.ok) throw new Error(`git ls-files -ci failed: ${res.stderr.trim()}`)
	const ignored = new Set(res.stdout.split("\0").filter(Boolean))
	const findings: Finding[] = []
	for (const path of ctx.tracked) {
		if (!path.startsWith(`${PLANS}/`)) continue
		if (!ignored.has(path) && !isCanonical(path)) continue
		const why = ignored.has(path) ? "is tracked although ignored" : "is a transcript or draft shape and is tracked"
		findings.push(finding("tracked-artifact", path, 1, `${path} ${why}`, "git rm --cached it and link it by permalink"))
	}
	return findings
}

function trimmedLines(ctx: Ctx, path: string): string[] {
	return ctx.tracked.has(path)
		? ctx
				.read(path)
				.split("\n")
				.map((l) => l.trim())
		: []
}

function gitignoreFindings(ctx: Ctx): Finding[] {
	const lines = trimmedLines(ctx, GITIGNORE)
	const findings: Finding[] = []
	for (const required of [...CANONICAL_PATTERNS, LESSONS_REINCLUDE]) {
		if (!lines.includes(required))
			findings.push(finding("hygiene-files", GITIGNORE, 1, `missing \`${required}\``, "restore the canonical line"))
	}
	lines.forEach((line, i) => {
		if (line.startsWith("!") && line !== LESSONS_REINCLUDE) {
			findings.push(finding("hygiene-files", GITIGNORE, i + 1, `\`${line}\` re-includes a transcript shape`, "delete the negation"))
		}
	})
	return findings
}

/** Any other pattern could hide an active plan from search, and a negation could undo the archive's. */
function ignoreFindings(ctx: Ctx): Finding[] {
	const lines = trimmedLines(ctx, IGNORE)
	const findings: Finding[] = []
	if (!lines.includes(ARCHIVE_IGNORE)) {
		findings.push(
			finding("hygiene-files", IGNORE, 1, `missing \`${ARCHIVE_IGNORE}\``, "restore it so default search skips closed plans"),
		)
	}
	lines.forEach((line, i) => {
		if (line !== "" && line !== ARCHIVE_IGNORE) {
			findings.push(finding("hygiene-files", IGNORE, i + 1, `\`${line}\` is not \`${ARCHIVE_IGNORE}\``, "delete the line"))
		}
	})
	return findings
}

export function hygieneFindings(ctx: Ctx): Finding[] {
	return [...gitignoreFindings(ctx), ...ignoreFindings(ctx)]
}

export function nestedIgnoreFindings(ctx: Ctx): Finding[] {
	return [...ctx.tracked]
		.filter(
			(p) =>
				p.startsWith(`${PLANS}/`) &&
				IGNORE_FILES.has(posix.basename(p)) &&
				p !== GITIGNORE &&
				p !== IGNORE &&
				!NESTED_IGNORE_ALLOWLIST.includes(p),
		)
		.map((p) =>
			finding(
				"nested-ignore",
				p,
				1,
				"a nested ignore file can swallow lessons/ or hide plans from search",
				"delete it; the plans .gitignore and .ignore cover the tree",
			),
		)
}

/** A document or plan-tree path whose content is not a file: the gate reads neither a symlink's target nor a gitlink. */
export function documentTypeFindings(ctx: Ctx): Finding[] {
	const findings: Finding[] = []
	for (const [path, mode] of ctx.modes) {
		if (REGULAR_MODES.has(mode) || (!isDocument(path) && !path.startsWith(`${PLANS}/`))) continue
		const kind = NON_REGULAR[mode] ?? `mode ${mode}`
		findings.push(finding("document-type", path, 1, `${path} is ${kind}, which the gate does not read`, "commit the file itself"))
	}
	return findings
}

export type OutcomeState = "none" | "incomplete" | "complete"

/** Only an h2 whose text is exactly `Outcome` counts: not a fenced example, not `Outcome & Quality Bar`. */
export function outcomeState(doc: Pick<Doc, "sections"> | undefined): OutcomeState {
	const section = doc?.sections.find((s) => s.heading === "Outcome")
	if (!section) return "none"
	return OUTCOME_FIELDS.every((re) => re.test(section.text)) ? "complete" : "incomplete"
}

function indexHost(indexFile: string, entry: IndexEntry): string {
	return posix.normalize(posix.join(posix.dirname(indexFile), entry.target))
}

function judgeActiveEntry(ctx: Ctx, docs: ReadonlyMap<string, Doc>, entry: IndexEntry, seen: Set<string>): Finding[] {
	const host = indexHost(ACTIVE_INDEX, entry)
	const dir = entry.target.split("/")[0]
	const at = (detail: string, fix: string) => finding("index-structure", ACTIVE_INDEX, entry.line, detail, fix)
	const out: Finding[] = []
	if (host.startsWith(`${ARCHIVE}/`) || dir === "archive")
		out.push(at(`${entry.name} points into archive/`, "move the line to archive/index.md"))
	if (seen.has(dir)) out.push(at(`${dir} is listed twice`, "keep one line per plan"))
	seen.add(dir)
	if (!ctx.tracked.has(host)) return [...out, at(`${entry.target} is not in the git index`, "point the line at the plan's host file")]
	const state = outcomeState(docs.get(host))
	const closing = entry.status === CLOSING_STATUS
	if (closing && state !== "complete")
		out.push(at(`${entry.name} is "${CLOSING_STATUS}" without a complete Outcome`, "write the Outcome block"))
	if (!closing && state !== "none")
		out.push(at(`${entry.name} has an Outcome but is listed as active`, `set its status to "${CLOSING_STATUS}"`))
	return out
}

export function indexStructureFindings(ctx: Ctx, docs: ReadonlyMap<string, Doc>): Finding[] {
	// Before the archive split every plan still shares one index, so there is no active set to check.
	if (!ctx.tracked.has(ARCHIVE_INDEX)) return []
	const { entries, malformed } = parseIndex(ctx.read(ACTIVE_INDEX))
	const findings = malformed.map((line) =>
		finding("index-structure", ACTIVE_INDEX, line, "not `- [name](target) — status — hook`", "reformat the line"),
	)
	const seen = new Set<string>()
	for (const entry of entries) findings.push(...judgeActiveEntry(ctx, docs, entry, seen))
	for (const dir of childDirs(ctx, PLANS)) {
		if (dir !== "archive" && !seen.has(dir)) {
			findings.push(
				finding("index-structure", `${PLANS}/${dir}`, 1, `${dir} has no line in index.md`, "add its index line, or archive it"),
			)
		}
	}
	return findings
}

export function archiveStructureFindings(ctx: Ctx, docs: ReadonlyMap<string, Doc>): Finding[] {
	const dirs = childDirs(ctx, ARCHIVE)
	if (dirs.length === 0 && !ctx.tracked.has(ARCHIVE_INDEX)) return []
	const { entries, malformed } = parseIndex(ctx.tracked.has(ARCHIVE_INDEX) ? ctx.read(ARCHIVE_INDEX) : "")
	const findings = malformed.map((line) =>
		finding("archive-structure", ARCHIVE_INDEX, line, "not `- [name](target) — status — hook`", "reformat the line"),
	)
	const listed = new Set(entries.map((e) => e.target.split("/")[0]))
	for (const dir of dirs) {
		if (!listed.has(dir))
			findings.push(finding("archive-structure", `${ARCHIVE}/${dir}`, 1, `${dir} has no line in archive/index.md`, "add its line"))
	}
	for (const entry of entries) {
		const host = indexHost(ARCHIVE_INDEX, entry)
		if (!ctx.tracked.has(host)) {
			findings.push(
				finding(
					"archive-structure",
					ARCHIVE_INDEX,
					entry.line,
					`${entry.target} is not in the git index`,
					"point the line at the Outcome host",
				),
			)
		} else if (outcomeState(docs.get(host)) !== "complete") {
			findings.push(
				finding(
					"archive-structure",
					host,
					1,
					"no complete `## Outcome` (Date, Status, Shipped|Delivered, Seeds retired)",
					"generate the Outcome block",
				),
			)
		}
	}
	return findings
}

type LinkVerdict = "plans" | "permalink" | "issue" | "outside"

function classifyCuratedLink(file: string, href: string, bases: Bases): LinkVerdict | null {
	const target = resolveHref(file, href)
	if (target.kind === "anchor") return null
	if (target.kind === "repo") return target.path?.startsWith(`${PLANS}/`) ? "plans" : "outside"
	if (isAllowedPermalink(href, bases)) return "permalink"
	return REPO_ISSUE_RE.test(href) ? "issue" : "outside"
}

function isEvidence(href: string, bases: Bases): boolean {
	const verdict = classifyCuratedLink(LESSONS_FILE, href, bases)
	return verdict === "plans" || verdict === "permalink"
}

type Flag = { block: number; below: boolean; detail: string; fix: string }

/** Past the first entry only headings and entries may stand at the top level; free text above it is a preamble. */
function flagEntries(blocks: readonly Block[], hrefs: readonly string[][], bases: Bases): Flag[] {
	const flags: Flag[] = []
	let item = 0
	blocks.forEach((block, i) => {
		if (block.kind === "other" && item > 0)
			flags.push({ block: i, below: false, detail: "text outside any entry", fix: "make it an entry, or move it above the first" })
		if (block.kind !== "item") return
		if (!hrefs[item].some((href) => isEvidence(href, bases)))
			flags.push({
				block: i,
				below: false,
				detail: "the entry links no evidence",
				fix: "link its archived lessons log or an allowlisted permalink",
			})
		if (block.multiline) flags.push({ block: i, below: true, detail: "an entry runs past one line", fix: "fold it into one line" })
		item++
	})
	return flags
}

function nextTextLine(lines: readonly string[], start: number): number {
	for (let i = start; i < lines.length; i++) if (lines[i].trim() !== "") return i + 1
	return start + 1
}

/** One line per lessons entry, each carrying its evidence link, as the Markdown parser reads the whole file. */
function lessonsEntryFindings(src: string, bases: Bases): Finding[] {
	const blocks = topBlocks(src)
	const hrefs = itemHrefs(src)
	if (hrefs.length !== blocks.filter((b) => b.kind === "item").length) {
		return [
			finding(
				"curated-budget",
				LESSONS_FILE,
				1,
				"raw HTML list items blur which entry owns a link",
				"write every entry as a Markdown item",
			),
		]
	}
	const flags = flagEntries(blocks, hrefs, bases)
	if (flags.length === 0) return []
	const starts = blockLines(src, Math.max(...flags.map((f) => f.block)) + 1)
	const lines = src.split("\n")
	return flags.map((f) => {
		const start = starts[f.block] ?? 1
		return finding("curated-budget", LESSONS_FILE, f.below ? nextTextLine(lines, start) : start, f.detail, f.fix)
	})
}

export function curatedBudgetFindings(ctx: Ctx, docs: ReadonlyMap<string, Doc>, bases: Bases): Finding[] {
	const findings: Finding[] = []
	for (const file of CURATED_FILES) {
		if (!ctx.tracked.has(file)) continue
		const src = ctx.read(file)
		if (file === LESSONS_FILE) {
			const size = Buffer.byteLength(src)
			if (size > LESSONS_BUDGET)
				findings.push(
					finding("curated-budget", file, 1, `${size} B is over the ${LESSONS_BUDGET} B budget`, "retire or merge entries"),
				)
			findings.push(...lessonsEntryFindings(src, bases))
		}
		for (const link of docs.get(file)?.links ?? []) {
			if (classifyCuratedLink(file, link.href, bases) !== "outside") continue
			findings.push(
				finding(
					"curated-budget",
					file,
					link.line,
					`${link.href} leaves the plan tree`,
					"link into implementations-plan/ or an allowlisted permalink",
				),
			)
		}
	}
	return findings
}

function localPathScope(ctx: Ctx): (path: string) => boolean {
	const active = activePlanDirs(ctx) ?? new Set(PRE_SPLIT_ACTIVE)
	return (path) => {
		if (INDEX_FILES.includes(path) || CURATED_FILES.includes(path)) return true
		if (!path.startsWith(`${PLANS}/`)) return false
		const rest = path.slice(PLANS.length + 1)
		return rest.includes("/") && active.has(rest.split("/")[0])
	}
}

function scanForHomePaths(path: string, src: string): Finding[] {
	const findings: Finding[] = []
	src.split("\n").forEach((line, i) => {
		if (LOCAL_PATH_RE.test(line))
			findings.push(finding("local-path", path, i + 1, "an absolute home path", "write it repo-relative or with ~"))
	})
	return findings
}

export function localPathFindings(ctx: Ctx): Finding[] {
	const paths = [...ctx.tracked].filter(localPathScope(ctx))
	ctx.load(paths)
	const findings: Finding[] = []
	for (const path of paths) {
		const src = ctx.read(path)
		if (src.includes("\0")) {
			// A binary asset carries no prose. A document with a NUL is still scanned, and flagged, because
			// git then diffs it as binary and hides its text from review.
			if (!isDocument(path)) continue
			findings.push(
				finding(
					"local-path",
					path,
					lineOf(src, ["\0"]),
					"a NUL byte makes git treat this document as binary",
					"remove the NUL byte",
				),
			)
		}
		findings.push(...scanForHomePaths(path, src))
	}
	return findings
}
