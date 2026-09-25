/**
 * The plan-tree gate's shared types and git access. The rule modules import this one and nothing here
 * imports them, so their top-level constants never see an uninitialized binding.
 *
 * Every check reads the git index (`git ls-files`, `git grep --cached`), never the filesystem, because
 * `git rm --cached` leaves untracked files on disk: a filesystem check would pass locally and fail on
 * CI's fresh checkout.
 */
import { spawnSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type RuleId =
	| "tracked-artifact"
	| "hygiene-files"
	| "nested-ignore"
	| "link-untracked"
	| "link-missing"
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
	"link-untracked",
	"link-missing",
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

export function runGit(cwd: string, args: readonly string[]): GitResult {
	// A partial clone would otherwise fetch a missing object on demand, and the gate must stay offline.
	const env = { ...process.env, GIT_NO_LAZY_FETCH: "1" }
	const res = spawnSync("git", args, { cwd, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120_000 })
	return { ok: res.status === 0, status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

export interface Ctx {
	cwd: string
	env: Env
	tracked: Set<string>
	dirs: Set<string>
	git(...args: string[]): GitResult
	read(path: string): string
}

export function trackedFiles(cwd = process.cwd()): Set<string> {
	const res = runGit(cwd, ["ls-files", "-z"])
	if (!res.ok) throw new Error(`git ls-files failed: ${res.stderr.trim()}`)
	return new Set(res.stdout.split("\0").filter(Boolean))
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
	const tracked = trackedFiles(cwd)
	return {
		cwd,
		env: opts.env ?? process.env,
		tracked,
		dirs: ancestorDirs(tracked),
		git: (...args) => runGit(cwd, args),
		read(path) {
			try {
				return readFileSync(join(cwd, path), "utf8")
			} catch {
				// A tracked file deleted in the working tree reads as empty; the index still lists it.
				return ""
			}
		},
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

/**
 * Enforce locally and on pull requests; elsewhere (push, nightly, release) only report, so a docs slip
 * never blocks a publish.
 */
export function mode(env: Env = process.env): "enforce" | "report" {
	if (env.GITHUB_ACTIONS !== "true") return "enforce"
	return env.GITHUB_BASE_REF ? "enforce" : "report"
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
		if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? whole
		const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
		return Number.isFinite(code) ? String.fromCodePoint(code) : whole
	})
}

/** First 1-based line of `src` holding any of `needles`; 1 when none does. */
export function lineOf(src: string, needles: readonly string[]): number {
	const lines = src.split("\n")
	for (let i = 0; i < lines.length; i++) {
		if (needles.some((n) => n !== "" && lines[i].includes(n))) return i + 1
	}
	return 1
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
