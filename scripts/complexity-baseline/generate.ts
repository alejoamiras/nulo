/**
 * Regenerates the complexity-budget baseline: inserts function-scoped biome-ignore
 * directives above every current offender of the baselined rules, verifies the tree
 * lints clean afterwards, and rewrites manifest.json from an actual source scan.
 *
 * Run from the repo root: `bun run baseline:complexity`. Idempotent. By default it
 * REFUSES to grow the baseline — growth is only legitimate when adopting the policy
 * or after a @biomejs/biome bump re-flags previously-clean functions; both are the
 * explicit `--adopt` mode, and the manifest diff is the reviewable record.
 */
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import {
	type BaselineManifest,
	BASELINED_RULES,
	type BaselinedRule,
	compareToManifest,
	installedBiomeVersion,
	scanTree,
} from "./scan"

const CATEGORY_PREFIX = "lint/complexity/"
const MANIFEST_PATH = "scripts/complexity-baseline/manifest.json"
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
	const notPrinted = report.summary?.diagnosticsNotPrinted ?? 0
	if (notPrinted > 0) {
		throw new Error(`biome truncated ${notPrinted} diagnostic(s) — raise --max-diagnostics, the baseline would be incomplete`)
	}
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

const adopt = process.argv.includes("--adopt")

const byFile = new Map<string, Finding[]>()
for (const d of lint()) {
	if (!isBaselined(d.category)) continue
	const value = d.message.match(/(\d+)/)?.[1] ?? "?"
	const list = byFile.get(d.path) ?? []
	list.push({ rule: d.category, line: d.line, value })
	byFile.set(d.path, list)
}

let inserted = 0
let skipped = 0
for (const [path, findings] of byFile) {
	const lines = readFileSync(path, "utf8").split("\n")
	// Bottom-up so earlier insertions never shift later target lines.
	findings.sort((a, b) => b.line - a.line)
	for (const f of findings) {
		const idx = f.line - 1
		const above = lines[idx - 1] ?? ""
		if (above.includes(`biome-ignore lint/complexity/${f.rule}`)) {
			skipped++
			continue
		}
		const indent = lines[idx]?.match(/^[\t ]*/)?.[0] ?? ""
		lines.splice(idx, 0, `${indent}// biome-ignore lint/complexity/${f.rule}: ${REASONS[f.rule](f.value)}`)
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

const scan = scanTree()
if (scan.forbidden.length > 0) {
	console.error("ERROR: forbidden suppression form(s) in the tree — fix these before regenerating:")
	for (const f of scan.forbidden) console.error(`  ${f.file}:${f.line} — ${f.why}`)
	process.exit(1)
}

if (existsSync(MANIFEST_PATH)) {
	const committed: BaselineManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
	const drift = compareToManifest(committed, scan.ruleCounts)
	if (drift.grew.length > 0 && !adopt) {
		console.error("ERROR: regeneration would GROW the baseline — refusing without --adopt. New debt:")
		for (const g of drift.grew) console.error(`  ${g}`)
		console.error("Refactor the function(s) under budget instead; --adopt is only for policy adoption or a Biome version bump.")
		process.exit(1)
	}
}

const rootPkg = JSON.parse(readFileSync("package.json", "utf8"))
const manifest: BaselineManifest = {
	biomeVersion: installedBiomeVersion(rootPkg),
	generated: new Date().toISOString().slice(0, 10),
	rules: scan.ruleCounts,
}
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, "\t")}\n`)
const totals = BASELINED_RULES.map((r) => `${r}: ${Object.values(manifest.rules[r]).reduce((a, b) => a + b, 0)}`).join(", ")
console.log(`manifest written (biome ${manifest.biomeVersion}) — ${totals}`)
