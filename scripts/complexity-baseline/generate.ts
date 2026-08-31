/**
 * Regenerates the complexity-budget baseline: inserts function-scoped biome-ignore
 * directives above every current offender of the baselined rules, verifies the tree
 * lints clean afterwards, and rewrites manifest.json from an actual source scan.
 *
 * Run from the repo root: `bun run baseline:complexity`. Idempotent — an offender
 * already carrying a directive for the same rule is left untouched. Required after
 * any @biomejs/biome version bump (the manifest pins the version; scores drift
 * between implementations and releases, so allowances must be re-derived).
 */
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { BASELINED_RULES, type BaselinedRule, installedBiomeVersion, scanSuppressions } from "./scan"

const CATEGORY_PREFIX = "lint/complexity/"
const REASONS: Record<BaselinedRule, (n: string) => string> = {
	noExcessiveCognitiveComplexity: (n) => `baseline (score ${n}) — refactor when touched, never raise`,
	noExcessiveLinesPerFunction: (n) => `baseline (${n} lines) — split when touched, never grow`,
}

interface Finding {
	rule: BaselinedRule
	line: number
	value: string
}

function lint(): { path: string; category: string; message: string; line: number }[] {
	const res = spawnSync("bunx", ["biome", "lint", "--reporter=json", "--max-diagnostics=10000", "."], {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	})
	if (!res.stdout) throw new Error(`biome lint produced no output: ${res.stderr}`)
	const report = JSON.parse(res.stdout)
	return (report.diagnostics ?? [])
		.filter((d: { category?: string }) => (d.category ?? "").startsWith(CATEGORY_PREFIX))
		.map((d: { category: string; message: string; location: { path: string; start: { line: number } } }) => ({
			path: d.location.path,
			category: d.category.slice(CATEGORY_PREFIX.length),
			message: d.message,
			line: d.location.start.line,
		}))
}

function isBaselined(category: string): category is BaselinedRule {
	return (BASELINED_RULES as readonly string[]).includes(category)
}

const byFile = new Map<string, Finding[]>()
let skipped = 0
for (const d of lint()) {
	if (!isBaselined(d.category)) continue
	const value = d.message.match(/(\d+)/)?.[1] ?? "?"
	const list = byFile.get(d.path) ?? []
	list.push({ rule: d.category, line: d.line, value })
	byFile.set(d.path, list)
}

let inserted = 0
for (const [path, findings] of byFile) {
	const lines = readFileSync(path, "utf8").split("\n")
	// Bottom-up so earlier insertions never shift later target lines.
	findings.sort((a, b) => b.line - a.line)
	for (const f of findings) {
		const idx = f.line - 1
		const directive = `biome-ignore lint/complexity/${f.rule}: ${REASONS[f.rule](f.value)}`
		const above = lines[idx - 1] ?? ""
		if (above.includes(`biome-ignore lint/complexity/${f.rule}`)) {
			skipped++
			continue
		}
		const indent = lines[idx]?.match(/^[\t ]*/)?.[0] ?? ""
		lines.splice(idx, 0, `${indent}// ${directive}`)
		inserted++
	}
	writeFileSync(path, lines.join("\n"))
}

console.log(`inserted ${inserted} directive(s), ${skipped} already present, across ${byFile.size} file(s)`)

const remaining = lint().filter((d) => isBaselined(d.category))
if (remaining.length > 0) {
	console.error(`ERROR: ${remaining.length} finding(s) survived directive insertion:`)
	for (const d of remaining.slice(0, 20)) console.error(`  ${d.path}:${d.line} ${d.category} — ${d.message}`)
	process.exit(1)
}

const rootPkg = JSON.parse(readFileSync("package.json", "utf8"))
const manifest = {
	biomeVersion: installedBiomeVersion(rootPkg),
	generated: new Date().toISOString().slice(0, 10),
	rules: scanSuppressions(),
}
writeFileSync("scripts/complexity-baseline/manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`)
const totals = BASELINED_RULES.map(
	(r) => `${r}: ${Object.values(manifest.rules[r]).reduce((a, b) => a + b, 0)}`,
).join(", ")
console.log(`manifest written (biome ${manifest.biomeVersion}) — ${totals}`)
