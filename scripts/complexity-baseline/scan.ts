import { spawnSync } from "node:child_process"

/**
 * The two rules that carry a grandfathered suppression baseline. The nested-test-suites
 * rule is deliberately absent: it had zero findings at adoption and must stay clean.
 */
export const BASELINED_RULES = ["noExcessiveCognitiveComplexity", "noExcessiveLinesPerFunction"] as const
export type BaselinedRule = (typeof BASELINED_RULES)[number]

const BUDGET_RULES = new Set<string>([...BASELINED_RULES, "noExcessiveNestedTestSuites"])

/**
 * Matches every Biome suppression form that could reach a budget rule: single-line,
 * file-wide (-all) and range (-start/-end) variants, flexible whitespace, and the
 * bare `lint:` / group `lint/complexity:` scopes that suppress budget rules implicitly.
 */
const SUPPRESSION_RE = /biome-ignore(-all|-start|-end)?\s+lint(?:\/([A-Za-z0-9]+))?(?:\/([A-Za-z0-9]+))?\s*:/

export type Classified =
	| { kind: "baselined"; rule: BaselinedRule }
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
	return { kind: "baselined", rule: rule as BaselinedRule }
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

export interface ScanResult {
	ruleCounts: Record<BaselinedRule, Record<string, number>>
	forbidden: { file: string; line: number; why: string }[]
}

/**
 * Scans tracked source for suppressions reaching budget rules. Default reads the
 * working tree; `staged: true` reads the index (`git grep --cached`) — what a commit
 * actually captures, so the pre-commit hook can't be split-staged past.
 */
export function scanTree(opts: { staged?: boolean } = {}): ScanResult {
	const flags = opts.staged ? ["--cached"] : []
	const res = spawnSync("git", ["grep", ...flags, "-nF", "biome-ignore", "--", ...SOURCE_PATHSPECS], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	})
	// git grep exits 1 on zero matches — only >1 is a real failure.
	if (res.status !== 0 && res.status !== 1) throw new Error(`git grep failed (${res.status}): ${res.stderr}`)
	const ruleCounts = Object.fromEntries(BASELINED_RULES.map((r) => [r, {}])) as ScanResult["ruleCounts"]
	const forbidden: ScanResult["forbidden"] = []
	for (const hit of res.stdout.split("\n")) {
		if (!hit) continue
		const first = hit.indexOf(":")
		const second = hit.indexOf(":", first + 1)
		const file = hit.slice(0, first)
		const lineNo = Number(hit.slice(first + 1, second))
		const c = classifySuppressionLine(hit.slice(second + 1))
		if (c === null) continue
		if (c.kind === "forbidden") forbidden.push({ file, line: lineNo, why: c.why })
		else ruleCounts[c.rule][file] = (ruleCounts[c.rule][file] ?? 0) + 1
	}
	for (const rule of BASELINED_RULES) {
		// Byte-order sort — locale-independent so regeneration is reproducible across machines.
		ruleCounts[rule] = Object.fromEntries(
			Object.entries(ruleCounts[rule]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
		)
	}
	return { ruleCounts, forbidden }
}

export interface BaselineManifest {
	biomeVersion: string
	generated: string
	rules: Record<BaselinedRule, Record<string, number>>
}

export interface ManifestDrift {
	grew: string[]
	shrank: string[]
}

/** Diffs an actual scan against the pinned manifest, per rule × file. */
export function compareToManifest(manifest: BaselineManifest, actual: ScanResult["ruleCounts"]): ManifestDrift {
	const grew: string[] = []
	const shrank: string[] = []
	for (const rule of BASELINED_RULES) {
		const pinned = manifest.rules[rule] ?? {}
		const files = new Set([...Object.keys(pinned), ...Object.keys(actual[rule])])
		for (const file of files) {
			const was = pinned[file] ?? 0
			const now = actual[rule][file] ?? 0
			if (now > was) grew.push(`${rule} ${file}: ${was} → ${now}`)
			else if (now < was) shrank.push(`${rule} ${file}: ${was} → ${now}`)
		}
	}
	return { grew, shrank }
}

export function installedBiomeVersion(rootPackageJson: { devDependencies?: Record<string, string> }): string {
	const v = rootPackageJson.devDependencies?.["@biomejs/biome"]
	if (!v) throw new Error("@biomejs/biome not found in root devDependencies")
	return v
}
