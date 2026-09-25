/**
 * The plan-tree gate's shared types and git access. The rule modules import this one and nothing here
 * imports them, so their top-level constants never see an uninitialized binding.
 *
 * Paths come from `git ls-files -s` and contents from those entries' blobs (`git cat-file --batch`,
 * `git grep --cached`), never from the working tree: `git rm --cached` leaves files on disk and an edit
 * can sit unstaged, so a working-tree read judges a different tree than the one being committed. A
 * symlink's target is never followed and a gitlink is never read. The one input git itself takes from
 * disk is `ls-files -ci`'s ignore rules (`trackedArtifactFindings`).
 */
import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"

export type RuleId =
	| "tracked-artifact"
	| "hygiene-files"
	| "nested-ignore"
	| "document-type"
	| "link-untracked"
	| "link-missing"
	| "link-opaque"
	| "permalink-shape"
	| "permalink-base"
	| "permalink-ancestry"
	| "path-token"
	| "index-structure"
	| "archive-structure"
	| "curated-budget"
	| "local-path"

export const RULE_IDS: readonly RuleId[] = [
	"tracked-artifact",
	"hygiene-files",
	"nested-ignore",
	"document-type",
	"link-untracked",
	"link-missing",
	"link-opaque",
	"permalink-shape",
	"permalink-base",
	"permalink-ancestry",
	"path-token",
	"index-structure",
	"archive-structure",
	"curated-budget",
	"local-path",
]

export type Finding = { rule: RuleId; file: string; line: number; detail: string; fix: string }
export type Link = { href: string; line: number }
export type Env = Record<string, string | undefined>

export const PLANS = "implementations-plan"
export const ARCHIVE = `${PLANS}/archive`
export const ACTIVE_INDEX = `${PLANS}/index.md`
export const ARCHIVE_INDEX = `${ARCHIVE}/index.md`
export const INDEX_FILES: readonly string[] = [ACTIVE_INDEX, `${PLANS}/README.md`, ARCHIVE_INDEX]
export const LESSONS_FILE = `${PLANS}/lessons.md`
export const CURATED_FILES: readonly string[] = [LESSONS_FILE, `${PLANS}/follow-ups.md`]

/** Transcript and draft shapes the plans `.gitignore` keeps out of the tree; `lessons/` is exempt. */
export const CANONICAL_PATTERNS: readonly string[] = ["audit-*.md", "plan-*.md", "_*.md", "eli5.html"]
export const LESSONS_REINCLUDE = "!**/lessons/**"
export const ARCHIVE_IGNORE = "/archive/"

const CANONICAL_RES = CANONICAL_PATTERNS.map((glob) => new RegExp(`^${glob.replaceAll(".", "\\.").replaceAll("*", ".*")}$`))

export type GitResult = { ok: boolean; status: number | null; stdout: string; stderr: string }

/** A partial clone would otherwise fetch a missing object on demand, and the gate must stay offline. */
const GIT_ENV = { ...process.env, GIT_NO_LAZY_FETCH: "1" }
const MAX_OUTPUT = 1024 * 1024 * 1024

export function runGit(cwd: string, args: readonly string[]): GitResult {
	const res = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", maxBuffer: MAX_OUTPUT, timeout: 120_000 })
	return { ok: res.status === 0, status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

export const REGULAR_MODES: ReadonlySet<string> = new Set(["100644", "100755"])

export interface Ctx {
	cwd: string
	env: Env
	tracked: Set<string>
	dirs: Set<string>
	/** Each tracked path's git mode: `REGULAR_MODES`, 120000 for a symlink, 160000 for a gitlink. */
	modes: Map<string, string>
	git(...args: string[]): GitResult
	/** The staged blob as text; "" for an untracked path, a symlink or a gitlink. */
	read(path: string): string
	/** Batches many blobs into one `git cat-file --batch`, so the `read`s that follow are lookups. */
	load(paths: Iterable<string>): void
}

type Entry = { mode: string; oid: string }

function indexEntries(cwd: string): Map<string, Entry> {
	const res = runGit(cwd, ["ls-files", "-s", "-z"])
	if (!res.ok) throw new Error(`git ls-files failed: ${res.stderr.trim()}`)
	const entries = new Map<string, Entry>()
	for (const record of res.stdout.split("\0")) {
		const m = record.match(/^(\d{6}) ([0-9a-f]+) \d\t(.+)$/s)
		// A conflicted path has one entry per stage; the first stands for it.
		if (m && !entries.has(m[3])) entries.set(m[3], { mode: m[1], oid: m[2] })
	}
	return entries
}

function readBlobs(cwd: string, oids: readonly string[]): Map<string, string> {
	const res = spawnSync("git", ["cat-file", "--batch"], {
		cwd,
		env: GIT_ENV,
		input: `${oids.join("\n")}\n`,
		maxBuffer: MAX_OUTPUT,
		timeout: 120_000,
	})
	if (res.status !== 0) throw new Error(`git cat-file --batch failed: ${res.stderr?.toString().trim()}`)
	const out = res.stdout
	const blobs = new Map<string, string>()
	let at = 0
	for (const oid of oids) {
		const eol = out.indexOf(0x0a, at)
		const header = out.toString("latin1", at, eol)
		const size = header.startsWith(`${oid} blob `) ? Number(header.slice(oid.length + 6)) : Number.NaN
		// A blob a partial clone lacks cannot be judged, so the run fails instead of reading it as empty.
		if (!Number.isSafeInteger(size)) throw new Error(`git cat-file --batch: ${header}`)
		blobs.set(oid, out.toString("utf8", eol + 1, eol + 1 + size))
		at = eol + 1 + size + 1
	}
	return blobs
}

function ancestorDirs(files: Iterable<string>): Set<string> {
	const dirs = new Set<string>()
	for (const file of files) {
		for (let at = file.indexOf("/"); at !== -1; at = file.indexOf("/", at + 1)) dirs.add(file.slice(0, at))
	}
	return dirs
}

export function createCtx(opts: { cwd?: string; env?: Env } = {}): Ctx {
	const cwd = opts.cwd ?? process.cwd()
	const entries = indexEntries(cwd)
	const blobs = new Map<string, string>()
	const regular = (path: string) => {
		const entry = entries.get(path)
		return entry && REGULAR_MODES.has(entry.mode) ? entry : undefined
	}
	const load = (paths: Iterable<string>) => {
		const oids = new Set<string>()
		for (const path of paths) {
			const oid = regular(path)?.oid
			if (oid && !blobs.has(oid)) oids.add(oid)
		}
		if (oids.size > 0) for (const [oid, text] of readBlobs(cwd, [...oids])) blobs.set(oid, text)
	}
	const tracked = new Set(entries.keys())
	return {
		cwd,
		env: opts.env ?? process.env,
		tracked,
		dirs: ancestorDirs(tracked),
		modes: new Map([...entries].map(([path, entry]) => [path, entry.mode])),
		git: (...args) => runGit(cwd, args),
		load,
		read(path) {
			const oid = regular(path)?.oid
			if (!oid) return ""
			if (!blobs.has(oid)) load([path])
			return blobs.get(oid) ?? ""
		},
	}
}

export function isDocument(path: string): boolean {
	return path.endsWith(".md") || path.endsWith(".html")
}

export function safeDecodeUri(text: string): string {
	try {
		return decodeURIComponent(text)
	} catch {
		return text
	}
}

/** True for a path the plans `.gitignore` keeps out: a canonical basename anywhere below the plans dir, outside `lessons/`. */
export function isCanonical(path: string): boolean {
	if (!path.startsWith(`${PLANS}/`)) return false
	const parts = path.slice(PLANS.length + 1).split("/")
	if (parts.slice(0, -1).includes("lessons")) return false
	const base = parts[parts.length - 1]
	return CANONICAL_RES.some((re) => re.test(base))
}

/** A tracked path or a directory holding one. */
export function existsInIndex(ctx: Ctx, path: string): boolean {
	const clean = path.replace(/\/+$/, "")
	return ctx.tracked.has(clean) || ctx.dirs.has(clean)
}

export type IndexEntry = { line: number; name: string; target: string; status: string; hook: string }

const INDEX_ENTRY_RE = /^- \[([^\]]+)\]\(([^)\s]+)\) — (.+?) — (.+)$/

/** Entries of an index in the `- [name](target) — status — hook` format; `malformed` lists entry-shaped lines that miss it. */
export function parseIndex(src: string): { entries: IndexEntry[]; malformed: number[] } {
	const entries: IndexEntry[] = []
	const malformed: number[] = []
	src.split("\n").forEach((text, i) => {
		if (!text.startsWith("- [")) return
		const m = text.match(INDEX_ENTRY_RE)
		if (m) entries.push({ line: i + 1, name: m[1], target: m[2], status: m[3].trim(), hook: m[4] })
		else malformed.push(i + 1)
	})
	return { entries, malformed }
}

/** Top-level plan dirs the active index lists, or null before the archive split, when there is no active set yet. */
export function activePlanDirs(ctx: Ctx): Set<string> | null {
	if (!ctx.tracked.has(ARCHIVE_INDEX)) return null
	const { entries } = parseIndex(ctx.read(ACTIVE_INDEX))
	return new Set(entries.map((e) => e.target.split("/")[0]))
}

/** Names of the directories directly below `parent` that hold tracked files. */
export function childDirs(ctx: Ctx, parent: string): string[] {
	const prefix = `${parent}/`
	return [...ctx.dirs].filter((d) => d.startsWith(prefix) && !d.slice(prefix.length).includes("/")).map((d) => d.slice(prefix.length))
}

const PULL_REQUEST_EVENTS: ReadonlySet<string> = new Set(["pull_request", "pull_request_target"])

/**
 * Enforce locally and on pull-request events; every other Actions event (push, nightly, release,
 * dispatch) only reports, so a docs slip never blocks a publish. The event name decides, not
 * `GITHUB_BASE_REF`: a pull request whose base ref came through empty still enforces.
 */
export function mode(env: Env = process.env): "enforce" | "report" {
	if (env.GITHUB_ACTIONS !== "true") return "enforce"
	return PULL_REQUEST_EVENTS.has(env.GITHUB_EVENT_NAME ?? "") ? "enforce" : "report"
}

/** `reportOnly` holds every mode to a report. */
export function verdict(findings: readonly Finding[], env: Env, reportOnly: boolean): "pass" | "fail" {
	return findings.length > 0 && !reportOnly && mode(env) === "enforce" ? "fail" : "pass"
}

export function lineOf(src: string, needles: readonly string[], fallback = 1): number {
	const lines = src.split("\n")
	for (let i = 0; i < lines.length; i++) {
		if (needles.some((n) => n !== "" && lines[i].includes(n))) return i + 1
	}
	return fallback
}

export function formatFinding(f: Finding): string {
	return `${f.rule} ${f.file}:${f.line} — ${f.detail} → ${f.fix}`
}

export function countByRule(findings: readonly Finding[]): Record<RuleId, number> {
	const counts = Object.fromEntries(RULE_IDS.map((id) => [id, 0])) as Record<RuleId, number>
	for (const f of findings) counts[f.rule]++
	return counts
}

/** Appends the findings to the Actions step summary, when there is one. */
export function writeSummary(findings: readonly Finding[], env: Env = process.env, limit = 50): boolean {
	const path = env.GITHUB_STEP_SUMMARY
	if (!path) return false
	const counts = Object.entries(countByRule(findings)).filter(([, n]) => n > 0)
	const lines = [
		`### Plan tree gate (${mode(env)}): ${findings.length} finding(s)`,
		"",
		...counts.map(([rule, n]) => `- \`${rule}\`: ${n}`),
		"",
		...findings.slice(0, limit).map((f) => `- ${formatFinding(f)}`),
		findings.length > limit ? `- … ${findings.length - limit} more; run \`bun scripts/ci-cd/plans/check.ts --report\`` : "",
		"",
	]
	appendFileSync(path, lines.join("\n"))
	return true
}
