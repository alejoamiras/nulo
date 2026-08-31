import { spawnSync } from "node:child_process"

/**
 * The two rules that carry a grandfathered suppression baseline. The nested-test-suites
 * rule is deliberately absent: it had zero findings at adoption and must stay clean.
 */
export const BASELINED_RULES = ["noExcessiveCognitiveComplexity", "noExcessiveLinesPerFunction"] as const
export type BaselinedRule = (typeof BASELINED_RULES)[number]

/** Built by concatenation so this file itself never matches the scan. */
const DIRECTIVE_PREFIX = ["biome-ignore", " lint/complexity/"].join("")
const FILE_WIDE_PREFIX = ["biome-ignore-all", " lint/complexity/"].join("")

/** Source pathspecs the scan covers — suppressions can only live in lintable source. */
const SOURCE_PATHSPECS = ["*.ts", "*.mts", "*.cts", "*.tsx", "*.js", "*.mjs", "*.cjs", "*.jsx", "*.vue"]

export interface BaselineManifest {
	biomeVersion: string
	generated: string
	rules: Record<BaselinedRule, Record<string, number>>
}

function gitGrepCount(pattern: string): Map<string, number> {
	const res = spawnSync("git", ["grep", "-c", "-F", pattern, "--", ...SOURCE_PATHSPECS], {
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	})
	// git grep exits 1 on zero matches — only >1 is a real failure.
	if (res.status !== 0 && res.status !== 1) {
		throw new Error(`git grep failed (${res.status}): ${res.stderr}`)
	}
	const counts = new Map<string, number>()
	for (const line of res.stdout.split("\n")) {
		if (!line) continue
		const sep = line.lastIndexOf(":")
		counts.set(line.slice(0, sep), Number(line.slice(sep + 1)))
	}
	return counts
}

/** Counts per-rule × per-file suppression directives across tracked source files. */
export function scanSuppressions(): Record<BaselinedRule, Record<string, number>> {
	const out = {} as Record<BaselinedRule, Record<string, number>>
	for (const rule of BASELINED_RULES) {
		const counts = gitGrepCount(DIRECTIVE_PREFIX + rule)
		out[rule] = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)))
	}
	return out
}

/** File-wide suppressions of any complexity-budget rule are never allowed. */
export function scanFileWideSuppressions(): string[] {
	const hits = new Set<string>()
	for (const rule of [...BASELINED_RULES, "noExcessiveNestedTestSuites"]) {
		for (const file of gitGrepCount(FILE_WIDE_PREFIX + rule).keys()) hits.add(file)
	}
	return [...hits].sort()
}

export function installedBiomeVersion(rootPackageJson: { devDependencies?: Record<string, string> }): string {
	const v = rootPackageJson.devDependencies?.["@biomejs/biome"]
	if (!v) throw new Error("@biomejs/biome not found in root devDependencies")
	return v
}
