#!/usr/bin/env bun
/**
 * The plan-tree gate: `checkTree()` runs every rule over the git index. From the command line,
 * `bun scripts/ci-cd/plans/check.ts [--report]` prints one line per finding and exits 1 when there is
 * any; `--report` prints the same and exits 0.
 */
import { createCtx, countByRule, type Env, type Finding, formatFinding } from "./lib"
import { extractDocs, linkFindings, pathTokenFindings } from "./links"
import { loadBases, permalinkAncestryFindings, permalinkFindings } from "./permalinks"
import {
	archiveStructureFindings,
	curatedBudgetFindings,
	documentTypeFindings,
	hygieneFindings,
	indexStructureFindings,
	localPathFindings,
	nestedIgnoreFindings,
	trackedArtifactFindings,
} from "./structure"

export function checkTree(opts: { cwd?: string; env?: Env } = {}): Finding[] {
	const ctx = createCtx(opts)
	const docs = extractDocs(ctx)
	const bases = loadBases(ctx)
	const findings = [
		...trackedArtifactFindings(ctx),
		...hygieneFindings(ctx),
		...nestedIgnoreFindings(ctx),
		...documentTypeFindings(ctx),
		...linkFindings(ctx, docs),
		...pathTokenFindings(ctx),
		...permalinkFindings(docs, bases),
		...permalinkAncestryFindings(ctx, bases),
		...indexStructureFindings(ctx, docs),
		...archiveStructureFindings(ctx, docs),
		...curatedBudgetFindings(ctx, docs, bases),
		...localPathFindings(ctx),
	]
	return findings.sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line)
}

if (import.meta.main) {
	const report = process.argv.includes("--report")
	const started = performance.now()
	const findings = checkTree()
	const seconds = ((performance.now() - started) / 1000).toFixed(2)
	for (const f of findings) console.log(formatFinding(f))
	const counts = Object.entries(countByRule(findings)).map(([rule, n]) => `${rule}=${n}`)
	console.log(`plans gate: ${findings.length} finding(s) in ${seconds}s — ${counts.join(" ")}`)
	process.exit(report || findings.length === 0 ? 0 : 1)
}
