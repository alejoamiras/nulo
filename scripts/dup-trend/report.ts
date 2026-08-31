/**
 * Duplication trend report (jscpd) — an advisory instrument, never a gate.
 * Clone identity is too unstable to ratchet (boundaries shift whenever either
 * side is edited), so duplication is watched as a trend: nightly's `dup-trend`
 * job pipes this into the step summary; locally it's `bun run audit:dup`.
 * Escalation (a diff-scoped new-clone check) is built only if the trend worsens.
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Exact-pinned (immutable) — bump manually, keeping the version ≥7 days old on npm. */
export const JSCPD_VERSION = "5.0.16"

const SCAN_PATHS = ["apps", "packages", "scripts"]
const IGNORE = [
	"**/node_modules/**",
	"**/dist/**",
	"**/target/**",
	"**/*.d.ts",
	"**/*.json",
	"**/*.md",
	"**/*.svg",
	"**/*.css",
	"**/*.scss",
	"**/types/**",
	"**/artifacts/**",
	"**/storybook-static/**",
].join(",")

const TEST_PATH_RE = /\.test\.|\/tests\/|\/e2e\/|__tests__|\.spec\.|vitest\.setup/

export interface JscpdReport {
	duplicates: { format: string; lines: number; firstFile: { name: string }; secondFile: { name: string } }[]
	statistics: {
		total: {
			sources: number
			lines: number
			clones: number
			duplicatedLines: number
			percentage: number
			percentageTokens: number
		}
	}
}

/** Renders the jscpd JSON report as the markdown trend summary. */
export function formatDupReport(report: JscpdReport): string {
	const t = report.statistics.total
	let prod = 0
	let prodLines = 0
	let test = 0
	let testLines = 0
	let mixed = 0
	const prodPairs = new Map<string, { clones: number; lines: number }>()
	for (const c of report.duplicates) {
		const a = c.firstFile.name
		const b = c.secondFile.name
		const aTest = TEST_PATH_RE.test(a)
		const bTest = TEST_PATH_RE.test(b)
		if (aTest && bTest) {
			test++
			testLines += c.lines
		} else if (!aTest && !bTest) {
			prod++
			prodLines += c.lines
			const key = a === b ? `${a} (internal)` : [a, b].sort().join(" ↔ ")
			const e = prodPairs.get(key) ?? { clones: 0, lines: 0 }
			e.clones++
			e.lines += c.lines
			prodPairs.set(key, e)
		} else {
			mixed++
		}
	}
	const top = [...prodPairs.entries()].sort((x, y) => y[1].lines - x[1].lines).slice(0, 10)
	const out: string[] = []
	out.push("## Duplication trend (jscpd, advisory)")
	out.push("")
	out.push("| files | lines | clones | dup lines | % lines | % tokens |")
	out.push("|--:|--:|--:|--:|--:|--:|")
	out.push(
		`| ${t.sources} | ${t.lines} | ${t.clones} | ${t.duplicatedLines} | ${t.percentage.toFixed(2)}% | ${t.percentageTokens.toFixed(2)}% |`,
	)
	out.push("")
	out.push(
		`Split: **production ${prod} clones / ${prodLines} lines** · test↔test ${test} / ${testLines} · mixed ${mixed}.`,
	)
	out.push("")
	out.push("### Top production clone pairs")
	out.push("")
	out.push("| dup lines | clones | pair |")
	out.push("|--:|--:|---|")
	for (const [pair, e] of top) out.push(`| ${e.lines} | ${e.clones} | \`${pair}\` |`)
	out.push("")
	return out.join("\n")
}

function main(): void {
	const outDir = mkdtempSync(join(tmpdir(), "jscpd-"))
	const res = spawnSync(
		"bunx",
		[
			`jscpd@${JSCPD_VERSION}`,
			...SCAN_PATHS,
			"--ignore",
			IGNORE,
			"--min-tokens",
			"50",
			"--reporters",
			"json,silent",
			"--output",
			outDir,
		],
		{ encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
	if (res.error || res.status !== 0) {
		console.error(`jscpd failed (status ${res.status}): ${res.stderr || res.error}`)
		process.exit(1)
	}
	const report: JscpdReport = JSON.parse(readFileSync(join(outDir, "jscpd-report.json"), "utf8"))
	console.log(formatDupReport(report))
}

if (import.meta.main) main()
