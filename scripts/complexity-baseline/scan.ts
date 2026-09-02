import { spawnSync } from "node:child_process"

/**
 * The two rules that carry an accepted-suppression baseline. The nested-test-suites
 * rule is deliberately absent: it had zero findings at adoption and must stay clean.
 */
export const BASELINED_RULES = ["noExcessiveCognitiveComplexity", "noExcessiveLinesPerFunction"] as const
export type BaselinedRule = (typeof BASELINED_RULES)[number]

const BUDGET_RULES = new Set<string>([...BASELINED_RULES, "noExcessiveNestedTestSuites"])

/**
 * Detects every Biome suppression form that could reach a budget rule, ANYWHERE on a line:
 * single-line, file-wide (-all) and range (-start/-end) variants, flexible whitespace, and the
 * bare `lint:` / group `lint/complexity:` scopes that suppress budget rules implicitly.
 */
const SUPPRESSION_RE = /biome-ignore(-all|-start|-end)?\s+lint(?:\/([A-Za-z0-9]+))?(?:\/([A-Za-z0-9]+))?\s*:/

/**
 * The ONLY legal form for a budget-rule suppression: a whole `//` comment line whose reason is
 * `accepted at score N — <sentence>` (cognitive) or `accepted at N lines — <sentence>` (length).
 * The stamp is the function's exact observed value (the rescore audit holds it to that); the
 * sentence is why the complexity is essential at that site — the check here is syntactic
 * (length, no placeholder words); specificity stays review-enforced.
 */
const ACCEPTED_RE =
	/^\s*\/\/\s*biome-ignore\s+lint\/complexity\/(noExcessiveCognitiveComplexity|noExcessiveLinesPerFunction)\s*:\s*accepted at (?:score (\d+)|(\d+) lines) — (.+?)\s*$/
const MIN_SENTENCE = 12
const PLACEHOLDER_RE = /\b(?:todo|tbd|fixme|xxx|placeholder)\b/i
/** The generator's fail-closed marker for a function a Biome bump newly flags. */
export const MARKER_PREFIX = "JUSTIFICATION REQUIRED"
export const LEGACY_PREFIX = "baseline ("

export type Classified =
	| { kind: "baselined"; rule: BaselinedRule; accepted: number }
	| { kind: "forbidden"; why: string }
	| null

/**
 * Classifies one source line's suppression comment against the budget policy.
 * Returns null for suppressions that cannot affect a budget rule.
 */
export function classifySuppressionLine(line: string): Classified {
	const m = line.match(SUPPRESSION_RE)
	if (!m) return null
	const [, variant, group, rule] = m
	const reachesBudget = group === undefined || (group === "complexity" && (rule === undefined || BUDGET_RULES.has(rule)))
	if (!reachesBudget) return null
	if (variant !== undefined) {
		return { kind: "forbidden", why: `file-wide/range suppression (biome-ignore${variant}) covering complexity budgets` }
	}
	if (group === undefined) {
		return { kind: "forbidden", why: "bare `lint` suppression — suppresses every rule incl. complexity budgets; scope it to one rule" }
	}
	if (rule === undefined) {
		return { kind: "forbidden", why: "group-level `lint/complexity` suppression — scope it to one rule" }
	}
	if (rule === "noExcessiveNestedTestSuites") {
		return { kind: "forbidden", why: "noExcessiveNestedTestSuites had zero findings at adoption — restructure, never suppress" }
	}
	return classifyAcceptedForm(line, rule as BaselinedRule)
}

function classifyAcceptedForm(line: string, rule: BaselinedRule): Classified {
	const reason = line.slice(line.indexOf(":") + 1).trim()
	if (reason.startsWith(LEGACY_PREFIX)) {
		return { kind: "forbidden", why: "legacy `baseline (…)` text — replace with `accepted at score N — <why>` (or `N lines`) or refactor" }
	}
	if (reason.startsWith(MARKER_PREFIX)) {
		return { kind: "forbidden", why: "generator marker — a human must justify (`accepted at … — <why>`) or refactor this function" }
	}
	const m = line.match(ACCEPTED_RE)
	if (!m) {
		return { kind: "forbidden", why: "reason must be a whole `//` comment reading `accepted at score N — <one specific sentence>` (or `accepted at N lines — …`)" }
	}
	const [, matchedRule, score, lines, sentence] = m
	if (matchedRule !== rule) return { kind: "forbidden", why: "suppression rule and accepted form disagree" }
	const unitIsScore = score !== undefined
	if (unitIsScore !== (rule === "noExcessiveCognitiveComplexity")) {
		return { kind: "forbidden", why: `${rule} takes \`accepted at ${rule === "noExcessiveCognitiveComplexity" ? "score N" : "N lines"} — …\`` }
	}
	if (sentence.length < MIN_SENTENCE || PLACEHOLDER_RE.test(sentence)) {
		return { kind: "forbidden", why: "the accepted sentence must say why THIS function's complexity is essential (no placeholders)" }
	}
	return { kind: "baselined", rule, accepted: Number(score ?? lines) }
}

/**
 * Lintable-source pathspecs. `*.d.ts` is excluded to mirror Biome's scope — the
 * generated types headers carry sanctioned bare-lint suppressions Biome never reads.
 */
const SOURCE_PATHSPECS = [
	"*.ts",
	"*.mts",
	"*.cts",
	"*.tsx",
	"*.js",
	"*.mjs",
	"*.cjs",
	"*.jsx",
	"*.vue",
	":(exclude)*.d.ts",
]

/** One accepted directive as the tree carries it. `anchor` (the declaration line under the
 *  directive) is its identity in the manifest — a directive moved onto another function is a
 *  different entry, not the same count. */
export interface AcceptedDirective {
	file: string
	line: number
	rule: BaselinedRule
	accepted: number
	anchor: string
}

export interface ScanResult {
	ruleCounts: Record<BaselinedRule, Record<string, number>>
	accepted: AcceptedDirective[]
	forbidden: { file: string; line: number; why: string }[]
}

/** How many lines under a directive may be other suppressions before the declaration (paired
 *  length + cognitive directives on one function). */
const ANCHOR_LOOKAHEAD = 3

/**
 * Scans tracked source for suppressions reaching budget rules. Default reads the
 * working tree; `staged: true` reads the index (`git grep --cached`) — what a commit
 * actually captures, so the pre-commit hook can't be split-staged past.
 */
export function scanTree(opts: { staged?: boolean } = {}): ScanResult {
	const flags = opts.staged ? ["--cached"] : []
	const res = spawnSync("git", ["grep", ...flags, "-nF", `-A${ANCHOR_LOOKAHEAD}`, "biome-ignore", "--", ...SOURCE_PATHSPECS], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	})
	// git grep exits 1 on zero matches — only >1 is a real failure.
	if (res.status !== 0 && res.status !== 1) throw new Error(`git grep failed (${res.status}): ${res.stderr}`)
	const parsed = parseGrepWithContext(res.stdout)
	const ruleCounts = Object.fromEntries(BASELINED_RULES.map((r) => [r, {}])) as ScanResult["ruleCounts"]
	const accepted: AcceptedDirective[] = []
	const forbidden: ScanResult["forbidden"] = []
	for (const hit of parsed.matches) {
		const c = classifySuppressionLine(hit.content)
		if (c === null) continue
		if (c.kind === "forbidden") {
			forbidden.push({ file: hit.file, line: hit.line, why: c.why })
			continue
		}
		ruleCounts[c.rule][hit.file] = (ruleCounts[c.rule][hit.file] ?? 0) + 1
		accepted.push({ file: hit.file, line: hit.line, rule: c.rule, accepted: c.accepted, anchor: anchorFor(parsed, hit.file, hit.line) })
	}
	for (const rule of BASELINED_RULES) {
		// Byte-order sort — locale-independent so regeneration is reproducible across machines.
		ruleCounts[rule] = Object.fromEntries(Object.entries(ruleCounts[rule]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
	}
	accepted.sort(compareDirectives)
	return { ruleCounts, accepted, forbidden }
}

interface GrepLine {
	file: string
	line: number
	content: string
}
interface ParsedGrep {
	matches: GrepLine[]
	/** Every line git printed (matches and context), keyed `file:line`. */
	byKey: Map<string, string>
}

/** `git grep -n -A<N>` prints `file:line:content` for matches, `file-line-content` for context
 *  lines and `--` between groups; file names cannot contain `:` or `-` ambiguity because the
 *  line number is the first all-digit field after the last matching separator position. */
export function parseGrepWithContext(stdout: string): ParsedGrep {
	const matches: GrepLine[] = []
	const byKey = new Map<string, string>()
	for (const raw of stdout.split("\n")) {
		if (!raw || raw === "--") continue
		const m = raw.match(/^(.+?)([:-])(\d+)\2(.*)$/)
		if (!m) continue
		const [, file, sep, lineNo, content] = m
		const line = Number(lineNo)
		byKey.set(`${file}:${line}`, content)
		if (sep === ":") matches.push({ file, line, content })
	}
	return { matches, byKey }
}

/** The first non-suppression line under the directive, trimmed — the declaration it applies to. */
function anchorFor(parsed: ParsedGrep, file: string, line: number): string {
	for (let offset = 1; offset <= ANCHOR_LOOKAHEAD; offset++) {
		const next = parsed.byKey.get(`${file}:${line + offset}`)
		if (next === undefined) break
		if (SUPPRESSION_RE.test(next)) continue
		return next.trim()
	}
	return "<no declaration within reach>"
}

export function compareDirectives(a: AcceptedDirective, b: AcceptedDirective): number {
	const ka = `${a.file} ${a.rule} ${a.anchor}`
	const kb = `${b.file} ${b.rule} ${b.anchor}`
	return ka < kb ? -1 : ka > kb ? 1 : 0
}

/** The manifest's per-acceptance record: identity (file, rule, anchor) + the stamped value. */
export interface ManifestEntry {
	file: string
	rule: BaselinedRule
	anchor: string
	accepted: number
}

export interface BaselineManifest {
	biomeVersion: string
	generated: string
	/** Derived, readable summary — the ratchet's authority is `accepted`. */
	rules: Record<BaselinedRule, Record<string, number>>
	accepted: ManifestEntry[]
}

export interface ManifestDrift {
	/** Entries in the tree but not in the manifest (a new or MOVED acceptance). */
	added: string[]
	/** Entries in the manifest but not in the tree (an acceptance removed or moved away). */
	removed: string[]
	/** Same identity, different stamp — `file: N → M`. */
	restamped: { key: string; from: number; to: number }[]
	/** Convenience for the shrink-only messages: `added` also counts as growth. */
	grew: string[]
	shrank: string[]
}

const entryKey = (e: ManifestEntry) => `${e.rule} ${e.file} — ${e.anchor}`

/** Diffs an actual scan against the pinned manifest, acceptance by acceptance. */
export function compareToManifest(manifest: BaselineManifest, actual: AcceptedDirective[]): ManifestDrift {
	const pinned = new Map((manifest.accepted ?? []).map((e) => [entryKey(e), e]))
	const seen = new Map(actual.map((e) => [entryKey(e), e]))
	const added: string[] = []
	const removed: string[] = []
	const restamped: ManifestDrift["restamped"] = []
	for (const [key, e] of seen) {
		const was = pinned.get(key)
		if (!was) added.push(`${key} (accepted at ${e.accepted})`)
		else if (was.accepted !== e.accepted) restamped.push({ key, from: was.accepted, to: e.accepted })
	}
	for (const key of pinned.keys()) if (!seen.has(key)) removed.push(key)
	return { added, removed, restamped, grew: added, shrank: removed }
}

export function toManifestEntries(accepted: AcceptedDirective[]): ManifestEntry[] {
	return accepted.map(({ file, rule, anchor, accepted: stamp }) => ({ file, rule, anchor, accepted: stamp }))
}

export function installedBiomeVersion(rootPackageJson: { devDependencies?: Record<string, string> }): string {
	const v = rootPackageJson.devDependencies?.["@biomejs/biome"]
	if (!v) throw new Error("@biomejs/biome not found in root devDependencies")
	return v
}
