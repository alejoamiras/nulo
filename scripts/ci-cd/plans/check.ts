#!/usr/bin/env bun
/**
 * The plan-tree gate: `checkTree()` runs every rule over the git index. From the command line,
 * `bun scripts/ci-cd/plans/check.ts [--report]` prints one line per finding, marking those of a rule
 * that only reports, and exits by `verdict()`: 1 on an enforced finding in an enforcing mode, else 0.
 * `--report` always exits 0.
 */
import { createCtx, countByRule, type Env, type Finding, formatFinding, isEnforced, verdict } from "./lib"
import { extractDocs, linkFindings, opaqueFindings, pathTokenFindings } from "./links"
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
		...opaqueFindings(docs),
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
	for (const f of findings) console.log(`${isEnforced(f) ? "" : "(report) "}${formatFinding(f)}`)
	const counts = Object.entries(countByRule(findings)).map(([rule, n]) => `${rule}=${n}`)
	const enforced = findings.filter(isEnforced).length
	console.log(`plans gate: ${findings.length} finding(s), ${enforced} enforced, in ${seconds}s — ${counts.join(" ")}`)
	process.exit(report || verdict(findings, process.env) === "pass" ? 0 : 1)
}
