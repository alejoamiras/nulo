#!/usr/bin/env bun
/**
 * Repoint legacy branch protection's required status checks BY NAME, per branch.
 *
 * Required contexts are matched by the exact check-run name, so renaming an aggregator job
 * breaks merges on that branch until the protection lists the new name. The two writes
 * (rename, add) are deliberately narrow: only `required_status_checks` is touched — never
 * signatures, never merge methods — each branch's `strict` flag and every unrelated check keep
 * their values, and nothing is written unless the live state still equals a snapshot the owner
 * reviewed beforehand (`--expect`). Needs a `gh` login with admin rights on the repo.
 *
 *   required-checks.sh print --branch dev [--json]           # read-only; save the JSON as the snapshot
 *   required-checks.sh --apply --branch dev --expect <file>   # rename per RENAMES, verify, print rollback
 *   required-checks.sh --add a,b --branch dev --expect <file> # append checks (app_id = GitHub Actions)
 */
import { parseArgs } from "node:util"

export type Check = { context: string; app_id: number }
export type RequiredChecks = { strict: boolean; checks: Check[] }

/** GitHub Actions' app id — the producer every aggregator job reports under. */
export const GITHUB_ACTIONS_APP_ID = 15368

/** Old aggregator name → new. Idempotent: an already-renamed context is left alone. */
export const RENAMES: Readonly<Record<string, string>> = {
	"smoke-e2e-status": "extension-smoke-e2e-status",
	"network-e2e-status": "extension-network-e2e-status",
	"contracts-status": "bridge-contracts-status",
}

const byContext = (a: Check, b: Check) => a.context.localeCompare(b.context)

/** The comparable shape: `strict` + checks sorted by name, `contexts` (deprecated mirror) dropped. */
export function normalize(rc: { strict: boolean; checks: Check[] }): RequiredChecks {
	return {
		strict: Boolean(rc.strict),
		checks: rc.checks.map((c) => ({ context: c.context, app_id: c.app_id })).sort(byContext),
	}
}

export function planRename(current: RequiredChecks, renames: Readonly<Record<string, string>> = RENAMES): RequiredChecks {
	const checks = current.checks.map((c) => (renames[c.context] ? { ...c, context: renames[c.context] } : c))
	return normalize({ strict: current.strict, checks: dedupe(checks) })
}

export function planAdd(current: RequiredChecks, names: string[], appId = GITHUB_ACTIONS_APP_ID): RequiredChecks {
	const checks = [...current.checks]
	for (const name of names) if (!checks.some((c) => c.context === name)) checks.push({ context: name, app_id: appId })
	return normalize({ strict: current.strict, checks })
}

function dedupe(checks: Check[]): Check[] {
	const seen = new Set<string>()
	return checks.filter((c) => (seen.has(c.context) ? false : (seen.add(c.context), true)))
}

/** Live state must equal the reviewed snapshot exactly (order-insensitive), or nothing is written. */
export function expectationMatches(live: RequiredChecks, expected: RequiredChecks): { ok: boolean; diff: string } {
	const a = JSON.stringify(normalize(live))
	const b = JSON.stringify(normalize(expected))
	return a === b ? { ok: true, diff: "" } : { ok: false, diff: `live:     ${a}\nexpected: ${b}` }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function gh(args: string[], input?: string): Promise<string> {
	const proc = Bun.spawn(["gh", ...args], { stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe" })
	const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
	if (code !== 0) throw new Error(`gh ${args.join(" ")} failed (${code}): ${err.trim()}`)
	return out
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		args: Bun.argv.slice(2),
		allowPositionals: true,
		options: {
			branch: { type: "string" },
			json: { type: "boolean", default: false },
			apply: { type: "boolean", default: false },
			add: { type: "string" },
			expect: { type: "string" },
		},
	})
	const branch = values.branch
	if (!branch) throw new Error("--branch <dev|main> is required")
	const repo = (await gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])).trim()
	const endpoint = `repos/${repo}/branches/${branch}/protection/required_status_checks`
	const live = normalize(JSON.parse(await gh(["api", endpoint])) as RequiredChecks)

	if (positionals[0] === "print" || (!values.apply && !values.add)) {
		console.log(values.json ? JSON.stringify(live, null, 2) : `${repo}@${branch}: strict=${live.strict}\n${live.checks.map((c) => `  ${c.context} (app ${c.app_id})`).join("\n")}`)
		return
	}

	if (!values.expect) throw new Error("--apply/--add require --expect <snapshot.json> (from `print --json`, reviewed beforehand)")
	const expected = normalize(JSON.parse(await Bun.file(values.expect).text()) as RequiredChecks)
	const match = expectationMatches(live, expected)
	if (!match.ok) throw new Error(`refusing: live protection on ${branch} differs from the reviewed snapshot\n${match.diff}`)

	const plan = values.add ? planAdd(live, values.add.split(",").map((s) => s.trim()).filter(Boolean)) : planRename(live)
	if (JSON.stringify(plan) === JSON.stringify(live)) {
		console.log(`${repo}@${branch}: nothing to change`)
		return
	}
	const backup = `${values.expect}.pre-apply.${Date.now()}.json`
	await Bun.write(backup, JSON.stringify({ strict: live.strict, checks: live.checks }, null, 2))
	await gh(["api", "--method", "PATCH", endpoint, "--input", "-"], JSON.stringify({ strict: plan.strict, checks: plan.checks }))
	const after = normalize(JSON.parse(await gh(["api", endpoint])) as RequiredChecks)
	const verified = expectationMatches(after, plan)
	if (!verified.ok) throw new Error(`write did not verify on ${branch}\n${verified.diff}\nrollback: gh api --method PATCH ${endpoint} --input ${backup}`)
	console.log(`${repo}@${branch}: applied\n${after.checks.map((c) => `  ${c.context}`).join("\n")}\nrollback: gh api --method PATCH ${endpoint} --input ${backup}`)
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`required-checks: ${e instanceof Error ? e.message : String(e)}`)
		process.exit(1)
	})
}
