/**
 * Fast local enforcement of the complexity-budget baseline (sub-second: one git grep).
 * Chained into `bun run lint` and the pre-commit hook so a violation reds the agent's
 * local loop, not just CI; scripts/ci-cd/complexity-baseline.test.ts is the CI mirror and
 * scripts/ci-cd/complexity-rescore.test.ts holds every accepted stamp to the function's
 * observed value (that one needs Biome, so it is CI + on-demand: `bun run baseline:rescore`).
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
			"between releases. In this PR: `bun run baseline:rescore` to see every drifted stamp, edit each directive " +
			"to its observed value (or refactor), then `bun run baseline:complexity -- --adopt` and review the manifest diff.",
	)
}

const scan = scanTree({ staged })
for (const f of scan.forbidden) {
	problems.push(`${f.file}:${f.line} — forbidden suppression: ${f.why}`)
}

const drift = compareToManifest(manifest, scan.accepted)
if (drift.added.length > 0) {
	problems.push(
		"New or MOVED complexity acceptance(s) — the baseline only shrinks. Refactor the function under the budget " +
			`instead of accepting it:\n  ${drift.added.join("\n  ")}`,
	)
}
if (drift.restamped.length > 0) {
	problems.push(
		"Accepted stamp(s) changed — a stamp is the function's exact observed value. Confirm with `bun run baseline:rescore`, " +
			`then record it: \`bun run baseline:complexity\` (a Biome bump needs \`-- --adopt\`):\n  ${drift.restamped
				.map((r) => `${r.key}: ${r.from} → ${r.to}`)
				.join("\n  ")}`,
	)
}
if (drift.removed.length > 0) {
	problems.push(
		"Accepted function(s) fixed or removed — record the progress: rerun `bun run baseline:complexity` in this PR " +
			`so the manifest matches:\n  ${drift.removed.join("\n  ")}`,
	)
}

if (problems.length > 0) {
	console.error("complexity-baseline check FAILED (CLAUDE.md § Complexity budgets):")
	for (const p of problems) console.error(`\n• ${p}`)
	process.exit(1)
}
console.log("complexity-baseline check OK")
