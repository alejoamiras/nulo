import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { basename, relative } from "node:path"

/** Specs whose ESM resolution is recorded per summary and compared across engines. */
export const RESOLVE_SPECS = [
	"zod",
	"@aztec/foundation/curves/bn254",
	"@aztec/stdlib/abi",
	"@aztec/aztec.js/wallet",
	"@aztec/bb.js",
	"vue",
	"jsdom",
	"isows",
	"msgpackr",
	"@logtape/logtape",
	"axios",
] as const

/**
 * Packages that declare a `"bun"` export condition, so their ESM entry may legitimately differ
 * per engine. Deliberately a constant with no CLI or config override: widening it is a code
 * change, which the migration gate re-runs the whole matrix for.
 */
export const RESOLVE_ALLOWLIST: ReadonlySet<string> = new Set(["isows", "msgpackr", "@logtape/logtape", "axios"])

/** Flags the tool enforces itself; a forwarded filter carrying one could override the gate. */
export const RESERVED_FLAGS = ["--retry", "--reporter", "--outputFile", "--root", "--config", "--pool", "--watch"] as const

export interface RuntimeRecord {
	execPath: string
	versions: Record<string, string | undefined>
	pool?: string | null
	maxWorkers?: number | null
}

export interface VitestAssertion {
	fullName: string
	status: string
	failureMessages?: string[]
}

export interface VitestFile {
	name: string
	status: string
	message?: string
	assertionResults: VitestAssertion[]
}

export interface VitestJson {
	success: boolean
	numTotalTests: number
	testResults: VitestFile[]
}

export interface RunRecord {
	exitCode: number | null
	signal: string | null
	wallMs: number
	timedOut: boolean
	missingJson: boolean
	success: boolean | null
	runtime: RuntimeRecord | null
	collected: number
	passed: number
	failed: number
	skipped: number
	todo: number
	failing: string[]
	failureMessages: Record<string, string>
	inventoryDigest: string
	/** A `pre`/`post` lifecycle hook failed or timed out (Node reference mode). */
	hookFailed: boolean
}

export interface InventoryEntry {
	statuses: Record<string, number>
	observations: number
	failures: number
}

export type ResolveRecord = { esm: string } | { error: string }

export interface SoakMeta {
	tool: "test-soak@1"
	argv: string[]
	cwd: string
	script: string
	runtimeMode: "script" | "node"
	filters: string[]
	gitSha: string
	gitDirty: boolean
	lockfileSha256: string
	vitestVersion: string
	pool: string | null
	maxWorkers: number | null
	runs: number
	timeoutMin: number
	resolverEngine: "bun" | "node" | null
	resolves: Record<string, ResolveRecord>
}

export interface SoakSummary {
	meta: SoakMeta
	runs: RunRecord[]
	inventory: Record<string, InventoryEntry>
	inventoryDigest: string
	failedRuns: number
}

export interface CompactSummary {
	meta: SoakMeta
	runs: Omit<RunRecord, "failureMessages">[]
	inventoryDigest: string
	failedRuns: number
	failing: Record<string, number>
}

export interface Canonicalizer {
	text(value: string): string
	relFile(absolutePath: string): string
}

/** Rewrites every machine-specific location so summaries compare and commit cleanly. */
export function createCanonicalizer(opts: { repoRoot: string; wsDir: string; tmpDirs?: string[]; home?: string }): Canonicalizer {
	const home = opts.home ?? homedir()
	const tmpDirs = [...(opts.tmpDirs ?? [])].sort((a, b) => b.length - a.length)
	const text = (value: string): string => {
		let out = value.replaceAll("file://", "")
		for (const tmp of tmpDirs) out = out.replaceAll(tmp, "<tmp>")
		out = out.replaceAll(opts.repoRoot, "<repo>")
		if (home) out = out.replaceAll(home, "<home>")
		return out
	}
	const relFile = (absolutePath: string): string => {
		const plain = absolutePath.startsWith("file://") ? absolutePath.slice("file://".length) : absolutePath
		return plain.startsWith(opts.wsDir) ? relative(opts.wsDir, plain) : text(plain)
	}
	return { text, relFile }
}

export function canonicalExecPath(execPath: string, canon: Canonicalizer): string {
	const base = basename(execPath)
	if (base === "bun") return "<bun>"
	if (base === "node") return "<node>"
	return canon.text(execPath)
}

export function sha256(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex")
}

const STATUS_MAP: Record<string, string> = { pending: "skipped", disabled: "skipped" }

export function normalizeStatus(status: string): string {
	return STATUS_MAP[status] ?? status
}

export interface ParsedRun {
	statuses: Map<string, string>
	failing: string[]
	failureMessages: Record<string, string>
	collected: number
	passed: number
	failed: number
	skipped: number
	todo: number
}

/** Flattens vitest's JSON reporter output into per-test statuses keyed `<file> :: <full name>`. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 22) — refactor when touched, never raise
export function parseVitestJson(json: VitestJson, canon: Canonicalizer): ParsedRun {
	const statuses = new Map<string, string>()
	const failing: string[] = []
	const failureMessages: Record<string, string> = {}
	let passed = 0
	let failed = 0
	let skipped = 0
	let todo = 0
	// Identically named tests in one file get deterministic occurrence suffixes (vitest reports
	// assertions in definition order), so none is silently collapsed into another's key. A literal
	// `#` in a name is doubled first, so a real "name #2" can never collide with a generated one.
	const seen = new Map<string, number>()
	for (const file of json.testResults) {
		const rel = canon.relFile(file.name)
		if (file.assertionResults.length === 0 && file.status === "failed") {
			const id = `${rel} :: <file>`
			statuses.set(id, "failed")
			failing.push(id)
			failureMessages[id] = canon.text(file.message ?? "").slice(0, 2000)
			failed += 1
			continue
		}
		for (const assertion of file.assertionResults) {
			const base = `${rel} :: ${assertion.fullName.replaceAll("#", "##")}`
			const occurrence = (seen.get(base) ?? 0) + 1
			seen.set(base, occurrence)
			const id = occurrence === 1 ? base : `${base} #${occurrence}`
			const status = normalizeStatus(assertion.status)
			statuses.set(id, status)
			if (status === "passed") passed += 1
			else if (status === "failed") {
				failed += 1
				failing.push(id)
				failureMessages[id] = canon.text(assertion.failureMessages?.join("\n") ?? "").slice(0, 2000)
			} else if (status === "todo") todo += 1
			else skipped += 1
		}
	}
	failing.sort()
	return { statuses, failing, failureMessages, collected: statuses.size, passed, failed, skipped, todo }
}

export function digestStatuses(statuses: Map<string, string>): string {
	const lines = [...statuses.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, status]) => `${id}\u0000${status}`)
	return sha256(lines.join("\n"))
}

/** Every way a run can fail the gate; a run that produced no engine record is not evidence. */
export function isFailedRun(run: Pick<RunRecord, "exitCode" | "timedOut" | "missingJson" | "success" | "runtime" | "hookFailed">): boolean {
	return run.timedOut || run.missingJson || run.hookFailed || run.exitCode !== 0 || run.success !== true || run.runtime === null
}

export function buildInventory(runs: Map<string, string>[]): { inventory: Record<string, InventoryEntry>; digest: string } {
	const inventory: Record<string, InventoryEntry> = {}
	for (const statuses of runs) {
		for (const [id, status] of statuses) {
			const entry = inventory[id] ?? { statuses: {}, observations: 0, failures: 0 }
			inventory[id] = entry
			entry.statuses[status] = (entry.statuses[status] ?? 0) + 1
			entry.observations += 1
			if (status === "failed") entry.failures += 1
		}
	}
	const ids = Object.keys(inventory).sort()
	const digest = sha256(
		ids
			.map(
				(id) =>
					`${id}\u0000${Object.keys(inventory[id]?.statuses ?? {})
						.sort()
						.join(",")}`,
			)
			.join("\n"),
	)
	return { inventory, digest }
}

const FLIPPED_SCRIPT = /^bun --bun vitest run((?: [A-Za-z0-9_.=/@-]+)*)$/

/** The only script shape the Node reference mode accepts; returns the tokens after `vitest run`. */
export function parseFlippedScript(value: string): string[] | null {
	const match = FLIPPED_SCRIPT.exec(value.trim())
	if (!match) return null
	const rest = match[1] ?? ""
	return rest.trim() === "" ? [] : rest.trim().split(" ")
}

export function findReservedFlag(args: readonly string[]): string | null {
	for (const arg of args) {
		for (const flag of RESERVED_FLAGS) {
			if (arg === flag || arg.startsWith(`${flag}=`) || (flag === "--pool" && arg.startsWith("--pool"))) return arg
		}
	}
	return null
}

export function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
	return sorted[index] ?? 0
}

function runtimeIdentity(record: RuntimeRecord | null): string {
	if (!record) return "<missing>"
	return JSON.stringify({ execPath: record.execPath, bun: record.versions.bun ?? null, node: record.versions.node ?? null })
}

function sameArray(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index])
}

export interface CompareResult {
	ok: boolean
	problems: string[]
	report: string
}

/** `a` is the Node reference, `b` the Bun candidate. Every rule is fail-closed. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 41) — refactor when touched, never raise
export function compareSummaries(a: SoakSummary, b: SoakSummary): CompareResult {
	const problems: string[] = []
	const lines: string[] = []
	const meta = (side: SoakSummary) => side.meta

	if (meta(a).gitDirty) problems.push("reference summary was produced on a dirty tree")
	if (meta(b).gitDirty) problems.push("candidate summary was produced on a dirty tree")
	for (const key of ["gitSha", "lockfileSha256", "vitestVersion", "cwd", "script", "runs"] as const) {
		if (meta(a)[key] !== meta(b)[key]) problems.push(`meta.${key} differs: ${String(meta(a)[key])} vs ${String(meta(b)[key])}`)
	}
	if (!sameArray(meta(a).filters, meta(b).filters))
		problems.push(`filters differ: [${meta(a).filters.join(" ")}] vs [${meta(b).filters.join(" ")}]`)
	if (meta(a).runtimeMode !== "node") problems.push(`reference must be runtimeMode "node", got "${meta(a).runtimeMode}"`)
	if (meta(b).runtimeMode !== "script") problems.push(`candidate must be runtimeMode "script", got "${meta(b).runtimeMode}"`)

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 31) — refactor when touched, never raise
	const checkSide = (side: SoakSummary, label: string, expectBun: boolean) => {
		if (side.runs.length !== side.meta.runs) problems.push(`${label}: ${side.runs.length} run rows for meta.runs=${side.meta.runs}`)
		const identities = new Set(side.runs.map((run) => runtimeIdentity(run.runtime)))
		if (identities.size !== 1) problems.push(`${label}: runtime records are missing or inconsistent (${[...identities].join(" | ")})`)
		for (const [index, run] of side.runs.entries()) {
			const hasBun = Boolean(run.runtime?.versions.bun)
			if (!run.runtime) problems.push(`${label}: run ${index} has no runtime record`)
			else if (hasBun !== expectBun)
				problems.push(`${label}: run ${index} ran on ${hasBun ? "Bun" : "Node"}, expected ${expectBun ? "Bun" : "Node"}`)
		}
		// Never trust the stored count: re-derive it from the rows, then require both to be zero.
		const failedRows = side.runs.filter(isFailedRun).length
		if (failedRows !== 0) problems.push(`${label}: ${failedRows} run row(s) fail the gate`)
		if (side.failedRuns !== failedRows)
			problems.push(`${label}: failedRuns=${side.failedRuns} disagrees with ${failedRows} failing row(s)`)
		if (side.failedRuns !== 0) problems.push(`${label}: failedRuns=${side.failedRuns}, expected 0`)
		for (const [id, entry] of Object.entries(side.inventory)) {
			if (entry.observations !== side.meta.runs)
				problems.push(`${label}: "${id}" observed ${entry.observations}/${side.meta.runs} runs`)
		}
	}
	checkSide(a, "reference", false)
	checkSide(b, "candidate", true)

	const idsA = Object.keys(a.inventory).sort()
	const idsB = Object.keys(b.inventory).sort()
	if (!sameArray(idsA, idsB)) {
		const onlyA = idsA.filter((id) => !(id in b.inventory))
		const onlyB = idsB.filter((id) => !(id in a.inventory))
		problems.push(`inventories differ: ${onlyA.length} only in reference, ${onlyB.length} only in candidate`)
		for (const id of onlyA.slice(0, 20)) lines.push(`  only in reference: ${id}`)
		for (const id of onlyB.slice(0, 20)) lines.push(`  only in candidate: ${id}`)
	}
	for (const id of idsA) {
		const entryA = a.inventory[id]
		const entryB = b.inventory[id]
		if (!entryA || !entryB) continue
		// Exact status-count records: `{passed:1, skipped:29}` must not pass as `{passed:29, skipped:1}`.
		const statusesA = JSON.stringify(Object.entries(entryA.statuses).sort())
		const statusesB = JSON.stringify(Object.entries(entryB.statuses).sort())
		if (statusesA !== statusesB) problems.push(`"${id}": statuses ${statusesA} vs ${statusesB}`)
		if (entryB.failures > entryA.failures)
			problems.push(`"${id}": candidate failed ${entryB.failures}× vs reference ${entryA.failures}×`)
		if (entryA.failures !== entryB.failures) lines.push(`  ${id}: failures ${entryA.failures} → ${entryB.failures}`)
	}

	lines.push(`resolution allowlist (pinned): ${[...RESOLVE_ALLOWLIST].join(", ")}`)
	for (const spec of RESOLVE_SPECS) {
		const recA = a.meta.resolves[spec]
		const recB = b.meta.resolves[spec]
		if (!recA || !recB) {
			problems.push(`no resolution evidence for "${spec}" on ${!recA ? "reference" : "candidate"}`)
			continue
		}
		const same = JSON.stringify(recA) === JSON.stringify(recB)
		if (same) continue
		const allowed = RESOLVE_ALLOWLIST.has(spec)
		lines.push(`  resolution differs${allowed ? " (allowed)" : ""}: ${spec}: ${JSON.stringify(recA)} vs ${JSON.stringify(recB)}`)
		if (!allowed) problems.push(`"${spec}" resolves differently and is not in the pinned allowlist`)
	}

	const wall = (side: SoakSummary) => {
		const ms = side.runs.map((run) => run.wallMs)
		return `min ${Math.min(...ms)} ms · median ${percentile(ms, 50)} ms · p95 ${percentile(ms, 95)} ms`
	}
	const header = [
		`reference ${a.meta.cwd} ${a.meta.script} [${a.meta.runtimeMode}] ${a.meta.runs} runs, failedRuns=${a.failedRuns}, inventory ${idsA.length} tests, digest ${a.inventoryDigest.slice(0, 16)}`,
		`candidate ${b.meta.cwd} ${b.meta.script} [${b.meta.runtimeMode}] ${b.meta.runs} runs, failedRuns=${b.failedRuns}, inventory ${idsB.length} tests, digest ${b.inventoryDigest.slice(0, 16)}`,
		`wall-clock reference: ${a.runs.length ? wall(a) : "n/a"}`,
		`wall-clock candidate: ${b.runs.length ? wall(b) : "n/a"}`,
	]
	const verdict = problems.length === 0 ? "COMPARE OK" : `COMPARE FAILED (${problems.length} problem${problems.length === 1 ? "" : "s"})`
	const report = [...header, ...lines, ...problems.map((problem) => `  ✖ ${problem}`), verdict].join("\n")
	return { ok: problems.length === 0, problems, report }
}

/** The committed form: everything except the per-test inventory and per-run failure messages. */
export function compactSummary(summary: SoakSummary): CompactSummary {
	const failing: Record<string, number> = {}
	for (const [id, entry] of Object.entries(summary.inventory)) if (entry.failures > 0) failing[id] = entry.failures
	return {
		meta: summary.meta,
		runs: summary.runs.map(({ failureMessages: _dropped, ...rest }) => rest),
		inventoryDigest: summary.inventoryDigest,
		failedRuns: summary.failedRuns,
		failing,
	}
}
