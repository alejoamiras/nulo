/**
 * Fast local enforcement of the complexity-budget baseline (sub-second: one git grep).
 * Chained into `bun run lint` and the pre-commit hook so a violation reds the agent's
 * local loop, not just CI; scripts/ci-cd/complexity-baseline.test.ts is the CI mirror.
 */
import { readFileSync } from "node:fs"
import { type BaselineManifest, compareToManifest, installedBiomeVersion, scanTree } from "./scan"

const manifest: BaselineManifest = JSON.parse(readFileSync("scripts/complexity-baseline/manifest.json", "utf8"))
const rootPkg = JSON.parse(readFileSync("package.json", "utf8"))

// --staged scans the index instead of the working tree — the pre-commit hook uses it
// so what gets checked is exactly what the commit captures (split-staging can't evade).
const staged = process.argv.includes("--staged")

const problems: string[] = []

const installed = installedBiomeVersion(rootPkg)
if (manifest.biomeVersion !== installed) {
	problems.push(
		`Biome ${installed} installed but the baseline was generated under ${manifest.biomeVersion} — scores drift ` +
			"between releases. Regenerate in this PR: `bun run baseline:complexity -- --adopt` and review the manifest diff.",
	)
}

const scan = scanTree({ staged })
for (const f of scan.forbidden) {
	problems.push(`${f.file}:${f.line} — forbidden suppression: ${f.why}`)
}

const drift = compareToManifest(manifest, scan.ruleCounts)
if (drift.grew.length > 0) {
	problems.push(
		"New complexity suppression(s) — the baseline only shrinks. Refactor the function under the budget " +
			`instead of suppressing:\n  ${drift.grew.join("\n  ")}`,
	)
}
if (drift.shrank.length > 0) {
	problems.push(
		"Baseline offender(s) fixed — record the progress: rerun `bun run baseline:complexity` in this PR " +
			`so the manifest matches:\n  ${drift.shrank.join("\n  ")}`,
	)
}

if (problems.length > 0) {
	console.error("complexity-baseline check FAILED (CLAUDE.md § Complexity budgets):")
	for (const p of problems) console.error(`\n• ${p}`)
	process.exit(1)
}
console.log("complexity-baseline check OK")
