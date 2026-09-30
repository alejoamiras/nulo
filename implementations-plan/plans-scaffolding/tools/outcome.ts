#!/usr/bin/env bun
/**
 * Writes each closed plan's `## Outcome` block in place, from `closures.json`: in its host (the table's
 * `outcomeFile`, else a stub `plan.md`), in every nested `plan.md` with the parent's status, and a
 * `Seeds retired` line above the first seed block of every other document in the dir. A block goes
 * directly after byte-0 YAML front matter, else at byte 0, before the H1 either way (A15). A complete
 * block is never touched; an incomplete one gains only its missing fields, at its end.
 *
 * `--date <YYYY-MM-DD>` stamps what it writes. `--verify [--parent <ref>]` checks that every closed host
 * and nested plan holds exactly one complete block placed per A15 (`GRANDFATHERED` excepted), that every
 * follow-up the table names is linked from `follow-ups.md`, that a rerun would change nothing, and, against
 * `<ref>`, that no document of a dir the table does not close gained or lost an Outcome or a seed line.
 */
import { posix } from "node:path"
import type { Row } from "./classify"
import {
	ARCHIVE,
	baseIndexLines,
	clip,
	closedTargets,
	commitView,
	FOLLOW_UPS,
	hostFile,
	indexView,
	readClosures,
	type Target,
	type View,
	writeFiles,
} from "./closed"
import { git, PLANS } from "./common"
import { lib, links, structure } from "./gate"
import { nodes } from "./rewrite-links"

/** Complete blocks written below their H1 before this generator existed; only they are exempt from A15. */
export const GRANDFATHERED: ReadonlySet<string> = new Set(["send-publish-ledger/plan.md", "grant-check-address-case/plan.md"])
export const BLOCK_BUDGET = 1024
const OUTCOME = "Outcome"
const REQUIRED = ["Date", "Status", "Shipped", "Seeds retired"] as const
type Field = (typeof REQUIRED)[number]
const SETEXT_RE = /^ {0,3}(?:=+|-+)[ \t]*$/
const ATX_TOP_RE = /^ {0,3}#{1,2}(?:[ \t]|$)/
/** A front-matter line: blank, indented, a comment, a list item or a `key:`. */
const YAML_LINE_RE = /^(?:$|\s|#|- |[\w"'][^:]*:(?:\s|$))/
const NAME_MAX = 80

export type FollowUp = { name: string; paths: readonly string[] }
export type Options = { stamp: string; followUps: readonly FollowUp[] }
export type EditKind = "stub" | "block" | "fields" | "nested" | "seed"
export type Edit = { text: string; kind: EditKind }
type Values = { date: string; status: string; shipped: string; open: readonly string[]; stamp: string }

/** Link text in place of each link, and no bold markers, so a name reads the same from any file. */
function plain(text: string): string {
	return text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
		.replaceAll("**", "")
		.trim()
}

/** An entry's name: its leading bold title, else its first sentence, clipped. */
function entryName(line: string): string {
	const bold = line.match(/^- \*\*(.+?)\*\*/)?.[1]
	return bold ? plain(bold) : clip(plain(line.slice(2).split(/(?<=[.:;])\s/)[0]).replace(/[.:;]$/, ""), NAME_MAX)
}

/** Each `- ` line of `follow-ups.md`, named, with the repo paths its links resolve to. */
export function followUpEntries(src: string): FollowUp[] {
	return src
		.split("\n")
		.filter((line) => line.startsWith("- "))
		.map((line) => ({
			name: entryName(line),
			paths: links.extract(FOLLOW_UPS, line).links.flatMap((l) => {
				const target = links.resolveHref(FOLLOW_UPS, l.href)
				return target.kind === "repo" && target.path !== null ? [target.path] : []
			}),
		}))
}

function dirRelative(path: string): string {
	return path.startsWith(`${ARCHIVE}/`) ? path.slice(ARCHIVE.length + 1) : path.slice(PLANS.length + 1)
}

/** Names of the entries that link into `dir`, whether it sits in the plan tree or in the archive. */
export function openItems(followUps: readonly FollowUp[], dir: string): string[] {
	const rel = dirRelative(dir)
	const homes = [`${PLANS}/${rel}`, `${ARCHIVE}/${rel}`]
	const inside = (p: string) => homes.some((home) => p === home || p.startsWith(`${home}/`))
	return followUps.filter((f) => f.paths.some(inside)).map((f) => f.name)
}

function prList(prs: readonly number[]): string {
	return prs.map((n) => `#${n}`).join(", ")
}

function ownValues(row: Row, dir: string, opts: Options): Values {
	const shipped = row.prs.length > 0 ? prList(row.prs) : "no PR recorded"
	return { date: row.date ?? "no date recorded", status: row.status, shipped, open: openItems(opts.followUps, dir), stamp: opts.stamp }
}

/** A nested plan closes with its parent; the PRs are the parent's, so the line says whose they are. */
function nestedValues(row: Row, dir: string, opts: Options): Values {
	const shipped = row.prs.length > 0 ? `${prList(row.prs)} (recorded for ${row.dir})` : "no PR recorded"
	return { ...ownValues(row, dir, opts), status: `closed with parent ${row.dir} (${row.status})`, shipped }
}

function fieldLine(field: Field | "Open items", value: string): string {
	return `- **${field}**: ${value}.`
}

function fieldValues(v: Values): Record<Field, string> {
	return {
		Date: v.date,
		Status: v.status,
		Shipped: v.shipped,
		"Seeds retired": `the \`/goal\` and \`/loop\` seeds in this directory are spent and must never be pasted. Generated by plans-scaffolding on ${v.stamp}`,
	}
}

function blockWith(v: Values, open: string): string[] {
	const f = fieldValues(v)
	return [
		`## ${OUTCOME}`,
		"",
		`- **Date**: ${f.Date}. **Status**: ${f.Status}.`,
		fieldLine("Shipped", f.Shipped),
		fieldLine("Open items", open),
		fieldLine("Seeds retired", f["Seeds retired"]),
	]
}

function fits(lines: readonly string[]): boolean {
	return Buffer.byteLength(`${lines.join("\n")}\n`) <= BLOCK_BUDGET
}

/** The block, naming as many open items as fit its 1 KiB and counting the rest. */
function blockLines(v: Values): string[] {
	if (v.open.length === 0) return blockWith(v, "none")
	for (let shown = v.open.length; shown > 0; shown--) {
		const rest = v.open.length - shown
		const named = v.open
			.slice(0, shown)
			.map((n) => `"${n}"`)
			.join("; ")
		const lines = blockWith(v, `follow-ups.md ${named}${rest > 0 ? `; and ${rest} more` : ""}`)
		if (fits(lines)) return lines
	}
	const lines = blockWith(v, `${v.open.length} entries in follow-ups.md`)
	if (!fits(lines)) throw new Error(`an Outcome block for "${v.status}" does not fit ${BLOCK_BUDGET} B`)
	return lines
}

function outcomeCount(file: string, src: string): number {
	return links.extract(file, src).h2.filter((h) => h === OUTCOME).length
}

/** The source line of the first real Outcome h2: where a growing prefix first renders one; -1 without. */
export function outcomeLine(file: string, src: string): number {
	const lines = src.split("\n")
	const upTo = (n: number) => outcomeCount(file, lines.slice(0, n).join("\n"))
	for (let i = 0; i < lines.length; i++) {
		const underline = SETEXT_RE.test(lines[i])
		if ((underline || lines[i].includes(OUTCOME)) && upTo(i + 1) > upTo(i)) return underline ? i - 1 : i
	}
	return -1
}

function topHeadings(src: string): number {
	let n = 0
	new HTMLRewriter()
		.on("h1, h2", {
			element() {
				n++
			},
		})
		.transform(Bun.markdown.html(src, { autolinks: true }))
	return n
}

/** The line that ends the block starting at `head`: the next real h1 or h2, else the line count. */
function blockEnd(src: string, head: number): number {
	const lines = src.split("\n")
	const upTo = (n: number) => topHeadings(lines.slice(0, n).join("\n"))
	for (let i = head + 1; i < lines.length; i++) {
		const underline = i - 1 > head && SETEXT_RE.test(lines[i]) && lines[i - 1].trim() !== ""
		if ((underline || ATX_TOP_RE.test(lines[i])) && upTo(i + 1) > upTo(i)) return underline ? i - 1 : i
	}
	return lines.length
}

/** Lines of byte-0 YAML front matter, its closing `---` included; 0 without it. */
export function frontMatterLines(lines: readonly string[]): number {
	if (lines[0] !== "---") return 0
	const close = lines.indexOf("---", 1)
	return close !== -1 && lines.slice(1, close).every((l) => YAML_LINE_RE.test(l)) ? close + 1 : 0
}

/** A15: the Outcome heading is the first non-blank line after byte-0 front matter, or the file's first line without it. */
export function placedPerA15(file: string, src: string): boolean {
	const lines = src.split("\n")
	const at = frontMatterLines(lines)
	let first = at
	while (at > 0 && first < lines.length && lines[first].trim() === "") first++
	return outcomeLine(file, src) === first
}

function insertBlock(src: string, block: readonly string[]): string {
	const lines = src.split("\n")
	const at = frontMatterLines(lines)
	const tail = lines.slice(at)
	return [...lines.slice(0, at), ...(at > 0 ? [""] : []), ...block, ...(tail[0] === "" ? [] : [""]), ...tail].join("\n")
}

function renderedField(line: string): string {
	return links.extract("outcome.md", `## ${OUTCOME}\n\n${line}\n`).sections[0]?.text ?? ""
}

/** The required fields `section` lacks, each judged by the gate's rule once the other three are supplied. */
function missingFields(section: string, v: Values): Field[] {
	const values = fieldValues(v)
	const rendered = (f: Field) => renderedField(fieldLine(f, values[f]))
	return REQUIRED.filter((field) => {
		const text = [section, ...REQUIRED.filter((f) => f !== field).map(rendered)].join("\n")
		return structure.outcomeState({ sections: [{ heading: OUTCOME, text }] }) !== "complete"
	})
}

/** Appends `fields` after the last text line of the block, before the heading that ends it. */
function appendFields(file: string, src: string, fields: readonly string[]): string {
	const lines = src.split("\n")
	const head = outcomeLine(file, src)
	let last = blockEnd(src, head) - 1
	while (last > head && lines[last].trim() === "") last--
	lines.splice(last + 1, 0, ...(last === head ? ["", ...fields] : fields))
	return lines.join("\n")
}

/** The rendered page as comparable items: adjacent text merged, whitespace-only text dropped. */
function items(file: string, src: string): string[] {
	const out: string[] = []
	let text = ""
	const flush = () => {
		if (text.trim() !== "") out.push(`text ${text}`)
		text = ""
	}
	for (const n of nodes(file, src)) {
		if (n.kind === "text") {
			text += n.text
			continue
		}
		flush()
		if (n.kind === "tag") out.push(`<${n.name} ${JSON.stringify(n.attrs)}`)
		else out.push(n.kind === "end" ? `</${n.name}` : `<!--${n.text}`)
	}
	flush()
	return out
}

/** True when `after` is `before` with one contiguous run of items inserted and nothing else changed. */
function isInsertion(before: readonly string[], after: readonly string[]): boolean {
	if (after.length <= before.length) return false
	let head = 0
	while (head < before.length && before[head] === after[head]) head++
	let tail = 0
	while (tail < before.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
	return head + tail === before.length
}

/** The host with its Outcome written or completed, proved to be an insertion; null when its block is complete. */
function hostEdit(file: string, src: string, v: Values, kind: "block" | "nested"): Edit | null {
	const doc = links.extract(file, src)
	const count = doc.h2.filter((h) => h === OUTCOME).length
	if (count > 1) throw new Error(`${file} has ${count} Outcome blocks`)
	const state = structure.outcomeState(doc)
	if (state === "complete") return null
	const section = () => doc.sections.find((s) => s.heading === OUTCOME)?.text ?? ""
	const fields = () => missingFields(section(), v).map((f) => fieldLine(f, fieldValues(v)[f]))
	const text = state === "none" ? insertBlock(src, blockLines(v)) : appendFields(file, src, fields())
	const complete = outcomeCount(file, text) === 1 && structure.outcomeState(links.extract(file, text)) === "complete"
	if (!complete || !isInsertion(items(file, src), items(file, text)))
		throw new Error(`${file}: the Outcome cannot be written as one complete block inserted into the page`)
	return { text, kind: state === "incomplete" ? "fields" : kind }
}

function stubText(view: View, target: Target, v: Values): string {
	const prefix = `${target.at}/`
	const files = [...view.tracked]
		.filter((p) => p.startsWith(prefix))
		.map((p) => p.slice(prefix.length))
		.sort()
	const odd = files.find((f) => !/^[\w./-]+$/.test(f))
	if (odd !== undefined) throw new Error(`${target.at}: ${odd} would need escaping in a stub link`)
	const list = files.map((f) => `[${f}](${f})`).join(", ")
	const about = `This directory kept no plan of record, so this stub carries its Outcome. Its files: ${list}.`
	return [...blockLines(v), "", `# ${target.row.dir}`, "", about, ""].join("\n")
}

const SEED_RE = /^\/(?:goal|loop)(?:\s|$)/

/** A seed block is a code block of the rendered page (`<pre>`) whose text, leading whitespace aside, starts with `/goal` or `/loop` and then a space or its end. */
export function isSeed(code: string): boolean {
	return SEED_RE.test(code.trimStart())
}

function textUntil(page: readonly string[], from: number, end: string): string {
	let text = ""
	for (let i = from; i < page.length && page[i] !== end; i++) if (page[i].startsWith("text ")) text += page[i].slice(5)
	return text
}

function firstSeed(page: readonly string[]): number {
	return page.findIndex((item, i) => item.startsWith("<pre ") && isSeed(textUntil(page, i + 1, "</pre")))
}

/** True when a blockquote starting `Seeds retired (` ends right before item `at`. */
function retiredBefore(page: readonly string[], at: number): boolean {
	if (page[at - 1] !== "</blockquote") return false
	const start = page.slice(0, at - 1).findLastIndex((item) => item.startsWith("<blockquote "))
	return textUntil(page, start + 1, "</blockquote")
		.trimStart()
		.startsWith("Seeds retired (")
}

function seedSnippet(file: string, stamp: string): string {
	const said = "seeds in this file are spent and must never be pasted."
	if (file.endsWith(".html"))
		return `<blockquote>Seeds retired (${stamp}): the <code>/goal</code> and <code>/loop</code> ${said}</blockquote>`
	return `> Seeds retired (${stamp}): the \`/goal\` and \`/loop\` ${said}`
}

/** Source lines that may open a seed block: a fence whose first text line is a seed, or a seed indented as code. */
function seedOpeners(lines: readonly string[]): { at: number; indent: string }[] {
	return lines.flatMap((line, i) => {
		const fence = line.match(/^(\s*)(?:`{3,}|~{3,})/)
		if (!fence) return /^(?: {4}|\t)/.test(line) && isSeed(line) ? [{ at: i, indent: "" }] : []
		const next = lines.slice(i + 1).find((l) => l.trim() !== "")
		return next !== undefined && isSeed(next) ? [{ at: i, indent: fence[1] }] : []
	})
}

/** Each opener, with the line above it and a blank line after, then without the blank line. */
function markdownPlacements(src: string, snippet: string): string[] {
	const lines = src.split("\n")
	return seedOpeners(lines).flatMap(({ at, indent }) =>
		[[""], []].map((gap) => [...lines.slice(0, at), `${indent}${snippet}`, ...gap, ...lines.slice(at)].join("\n")),
	)
}

function htmlPlacement(src: string, page: readonly string[], at: number, snippet: string): string {
	const ordinal = page.slice(0, at).filter((item) => item.startsWith("<pre ")).length
	let seen = 0
	return new HTMLRewriter()
		.on("pre", {
			element(e) {
				if (seen++ === ordinal) e.before(snippet, { html: true })
			},
		})
		.transform(src)
}

/**
 * The document with a seed line right above its first seed block, proved on the rendered page: the new
 * page is the old one with exactly the line's blockquote inserted there. Null when it has no seed block
 * or already has its line.
 */
export function seedEdit(file: string, src: string, stamp: string): string | null {
	const page = items(file, src)
	const at = firstSeed(page)
	if (at === -1 || retiredBefore(page, at)) return null
	const snippet = seedSnippet(file, stamp)
	const want = JSON.stringify([...page.slice(0, at), ...items(file, snippet), ...page.slice(at)])
	const tries = file.endsWith(".html") ? [htmlPlacement(src, page, at, snippet)] : markdownPlacements(src, snippet)
	const found = tries.find((candidate) => JSON.stringify(items(file, candidate)) === want)
	if (found === undefined) throw new Error(`${file}: no source position puts the seed line right above its first seed block`)
	return found
}

export function hostOf(target: Target): string {
	return `${target.at}/${hostFile(target.row)}`
}

function nestedPlans(view: View, target: Target, host: string): string[] {
	return [...view.tracked].filter((p) => p.startsWith(`${target.at}/`) && p.endsWith("/plan.md") && p !== host).sort()
}

function seedFiles(view: View, target: Target, skip: ReadonlySet<string>): string[] {
	return [...view.tracked].filter((p) => p.startsWith(`${target.at}/`) && lib.isDocument(p) && !skip.has(p) && !lib.isCanonical(p)).sort()
}

function put(edits: Map<string, Edit>, path: string, edit: Edit | null): void {
	if (edit !== null) edits.set(path, edit)
}

function planTarget(view: View, target: Target, opts: Options, edits: Map<string, Edit>): void {
	const host = hostOf(target)
	const own = ownValues(target.row, target.at, opts)
	if (view.tracked.has(host)) put(edits, host, hostEdit(host, view.read(host), own, "block"))
	else if (target.row.outcomeFile === null) put(edits, host, { text: stubText(view, target, own), kind: "stub" })
	else throw new Error(`${host}: the closure table's host is gone`)
	const nested = nestedPlans(view, target, host)
	for (const plan of nested)
		put(edits, plan, hostEdit(plan, view.read(plan), nestedValues(target.row, posix.dirname(plan), opts), "nested"))
	for (const file of seedFiles(view, target, new Set([host, ...nested]))) {
		const text = seedEdit(file, view.read(file), opts.stamp)
		put(edits, file, text === null ? null : { text, kind: "seed" })
	}
}

/** Every file the generator writes for `targets`, keyed by path; empty once every block and seed line is in place. */
export function planOutcomes(view: View, targets: readonly Target[], opts: Options): Map<string, Edit> {
	const edits = new Map<string, Edit>()
	for (const target of targets) planTarget(view, target, opts, edits)
	return edits
}

/** Rows whose owner-answered follow-ups no `follow-ups.md` entry links, so their block would say `none`. */
export function unminedFollowUps(targets: readonly Target[], followUps: readonly FollowUp[]): string[] {
	return targets
		.filter((t) => t.row.followUps.length > 0 && openItems(followUps, t.at).length === 0)
		.map((t) => `${t.row.dir}: closures.json names ${t.row.followUps.join(", ")}, but no follow-ups.md entry links into it`)
}

function blockProblems(view: View, file: string, exempt: boolean): string[] {
	if (!view.tracked.has(file)) return [`${file}: missing`]
	const src = view.read(file)
	const doc = links.extract(file, src)
	const count = doc.h2.filter((h) => h === OUTCOME).length
	if (count !== 1) return [`${file}: ${count} Outcome blocks`]
	if (structure.outcomeState(doc) !== "complete") return [`${file}: its Outcome is incomplete`]
	return exempt || placedPerA15(file, src) ? [] : [`${file}: its Outcome is not where A15 puts it`]
}

/** Why the generated state is wrong or unfinished in `view`: missing, partial or misplaced blocks, unmined follow-ups, a pending rerun. */
export function outcomeProblems(view: View, targets: readonly Target[], opts: Options): string[] {
	const problems: string[] = []
	for (const target of targets) {
		const host = hostOf(target)
		problems.push(...blockProblems(view, host, GRANDFATHERED.has(dirRelative(host))))
		for (const plan of nestedPlans(view, target, host)) problems.push(...blockProblems(view, plan, false))
	}
	problems.push(...unminedFollowUps(targets, opts.followUps))
	try {
		for (const path of planOutcomes(view, targets, opts).keys()) problems.push(`${path}: a rerun would change it`)
	} catch (e) {
		problems.push((e as Error).message)
	}
	return problems
}

/** A document's Outcome sections and whether its first seed block carries the seed line. */
function outcomeMark(file: string, src: string): string {
	const sections = links
		.extract(file, src)
		.sections.filter((s) => s.heading === OUTCOME)
		.map((s) => s.text)
	const page = items(file, src)
	const at = firstSeed(page)
	return JSON.stringify([sections, at !== -1 && retiredBefore(page, at)])
}

/** Documents of dirs the table does not close whose Outcome or seed line differs from `parent`. */
export function untouchedProblems(cwd: string, parent: string, view: View, closed: ReadonlySet<string>): string[] {
	const live = [...view.dirs].filter(
		(d) => /^implementations-plan\/[^/]+$/.test(d) && d !== ARCHIVE && !closed.has(d.slice(PLANS.length + 1)),
	)
	if (live.length === 0) return []
	const changed = git(cwd, "diff", "--cached", "--name-only", "-z", parent, "--", ...live)
		.split("\0")
		.filter(lib.isDocument)
	const before = commitView(cwd, parent)
	return changed
		.filter((p) => outcomeMark(p, before.read(p)) !== outcomeMark(p, view.read(p)))
		.map((p) => `${p}: an Outcome or seed line changed in a dir the closure table does not close`)
}

function flag(argv: readonly string[], name: string): string | undefined {
	const at = argv.indexOf(name)
	return at === -1 ? undefined : argv[at + 1]
}

function verify(cwd: string, view: View, targets: readonly Target[], followUps: readonly FollowUp[], parent?: string): number {
	const closed = new Set(readClosures(cwd).rows.flatMap((r) => (r.class === "closed" ? [r.dir] : [])))
	const problems = [
		...outcomeProblems(view, targets, { stamp: "0000-00-00", followUps }),
		...(parent ? untouchedProblems(cwd, parent, view, closed) : []),
	]
	for (const p of problems) console.log(p)
	const scope = parent ? `against ${parent}` : "without --parent, so the other dirs are unchecked"
	console.log(`outcome --verify: ${targets.length} closed dirs, ${problems.length} problem(s), ${scope}`)
	return problems.length === 0 ? 0 : 1
}

function main(argv: readonly string[]): number {
	const cwd = process.cwd()
	const closures = readClosures(cwd)
	const view = indexView(cwd)
	const targets = closedTargets(view, closures, baseIndexLines(cwd, closures))
	const followUps = followUpEntries(view.read(FOLLOW_UPS))
	if (argv.includes("--verify")) return verify(cwd, view, targets, followUps, flag(argv, "--parent"))
	const stamp = flag(argv, "--date")
	if (!stamp || !/^\d{4}-\d{2}-\d{2}$/.test(stamp)) throw new Error("--date YYYY-MM-DD is required")
	for (const warning of unminedFollowUps(targets, followUps)) console.warn(`warning: ${warning}`)
	const edits = planOutcomes(view, targets, { stamp, followUps })
	writeFiles(cwd, new Map([...edits].map(([path, e]) => [path, e.text])))
	const counts = Object.groupBy([...edits.values()], (e) => e.kind)
	const summary = (["block", "fields", "stub", "nested", "seed"] as const).map((k) => `${k}=${counts[k]?.length ?? 0}`).join(" ")
	console.log(`outcome: ${targets.length} closed dirs, ${edits.size} file(s) written (${summary})`)
	return 0
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
