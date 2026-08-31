#!/usr/bin/env bun
// Unit-layer soak driver: runs a workspace's real `test` script N times (retry-0), records which
// engine ran every run, and compares a Node reference against a Bun candidate fail-closed.
//
//   bun scripts/ci-cd/test-soak/cli.ts soak --cwd <ws> [--script test] [--runtime script|node] --runs N --out <full.json> [--timeout <min>] [-- <vitest filters>]
//   bun scripts/ci-cd/test-soak/cli.ts compare <reference-full.json> <candidate-full.json>
//   bun scripts/ci-cd/test-soak/cli.ts compact <full.json> --out <compact.json>
import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
	type Canonicalizer,
	type CompactSummary,
	RESOLVE_SPECS,
	type ResolveRecord,
	type RunRecord,
	type RuntimeRecord,
	type SoakSummary,
	type VitestJson,
	buildInventory,
	canonicalExecPath,
	compactSummary,
	compareSummaries,
	createCanonicalizer,
	digestStatuses,
	findReservedFlag,
	isFailedRun,
	parseFlippedScript,
	parseVitestJson,
	sha256,
} from "./lib"

const here = dirname(fileURLToPath(import.meta.url))
export const REPORTER_PATH = join(here, "runtime-reporter.mjs")
const RESOLVER_PATH = join(here, "resolve-esm.mjs")
const BASELINES_DIR = "implementations-plan/vitest-on-bun/lessons/baselines"

export interface RunOnceOptions {
	/** Full argv of the command that starts vitest; the enforced flags are appended after it. */
	launcher: string[]
	spawnCwd: string
	timeoutMs: number
	repoRoot: string
	wsDir: string
	/** Lifecycle hooks run before/after the launcher (the Node reference mode's explicit `pre`/`post`). */
	before?: string[][]
	after?: string[][]
}

export interface RunOutcome {
	run: RunRecord
	statuses: Map<string, string>
}

let activeGroup: number | null = null
function killGroup(pid: number): void {
	try {
		process.kill(-pid, "SIGKILL")
	} catch {
		try {
			process.kill(pid, "SIGKILL")
		} catch {
			// Already gone.
		}
	}
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		if (activeGroup !== null) killGroup(activeGroup)
		process.exit(130)
	})
}

const KILL_GRACE_MS = 5_000

/**
 * Resolves when the child has exited. On timeout the child's whole process group is killed and
 * the exit is awaited for a bounded grace period; whether the exit was observed or not, the
 * group kill is retried before returning, and every exit path sweeps residual group members.
 */
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<{ code: number | null; signal: string | null; timedOut: boolean }> {
	return new Promise((resolvePromise) => {
		let settled = false
		let timedOut = false
		const exited = new Promise<{ code: number | null; signal: string | null }>((resolveExit) => {
			child.on("exit", (code, signal) => resolveExit({ code, signal: signal ?? null }))
			child.on("error", () => resolveExit({ code: null, signal: "ERROR" }))
		})
		const finish = (code: number | null, signal: string | null) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			if (child.pid) killGroup(child.pid)
			resolvePromise({ code, signal, timedOut })
		}
		const timer = setTimeout(() => {
			timedOut = true
			if (child.pid) killGroup(child.pid)
			const grace = new Promise<{ code: number | null; signal: string | null }>((resolveGrace) =>
				setTimeout(() => resolveGrace({ code: null, signal: "SIGKILL" }), KILL_GRACE_MS),
			)
			Promise.race([exited, grace]).then(({ signal }) => finish(null, signal ?? "SIGKILL"))
		}, timeoutMs)
		exited.then(({ code, signal }) => finish(code, signal))
	})
}

/** Lifecycle hooks get the same process-group + timeout treatment as the run itself. */
async function runHook(argv: string[], cwd: string, timeoutMs: number): Promise<{ status: number | null; timedOut: boolean }> {
	const [cmd, ...args] = argv
	if (!cmd) return { status: 0, timedOut: false }
	const child = spawn(cmd, args, { cwd, detached: true, stdio: ["ignore", "inherit", "inherit"] })
	activeGroup = child.pid ?? null
	const exit = await waitForExit(child, timeoutMs)
	activeGroup = null
	return { status: exit.code, timedOut: exit.timedOut }
}

function emptyRun(partial: Partial<RunRecord>): RunRecord {
	return {
		exitCode: null,
		signal: null,
		wallMs: 0,
		timedOut: false,
		missingJson: true,
		success: null,
		runtime: null,
		collected: 0,
		passed: 0,
		failed: 0,
		skipped: 0,
		todo: 0,
		failing: [],
		failureMessages: {},
		inventoryDigest: digestStatuses(new Map()),
		hookFailed: false,
		...partial,
	}
}

/** One retry-0 run of the launcher with the enforced reporter flags appended LAST. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 19) — refactor when touched, never raise
export async function runOnce(opts: RunOnceOptions): Promise<RunOutcome> {
	const tmp = mkdtempSync(join(tmpdir(), "test-soak-"))
	const canon: Canonicalizer = createCanonicalizer({ repoRoot: opts.repoRoot, wsDir: opts.wsDir, tmpDirs: [tmp] })
	const resultsFile = join(tmp, "results.json")
	const argv = [
		...opts.launcher,
		"--retry=0",
		"--reporter=default",
		"--reporter=json",
		`--outputFile=${resultsFile}`,
		`--reporter=${REPORTER_PATH}`,
	]
	const started = Date.now()
	try {
		for (const hook of opts.before ?? []) {
			const pre = await runHook(hook, opts.spawnCwd, opts.timeoutMs)
			if (pre.status !== 0 || pre.timedOut) {
				return {
					run: emptyRun({ exitCode: pre.status, timedOut: pre.timedOut, hookFailed: true, wallMs: Date.now() - started }),
					statuses: new Map(),
				}
			}
		}
		const [cmd, ...args] = argv
		if (!cmd) throw new Error("empty launcher")
		const child = spawn(cmd, args, { cwd: opts.spawnCwd, detached: true, stdio: ["ignore", "pipe", "pipe"] })
		activeGroup = child.pid ?? null
		let tail = ""
		const keepTail = (chunk: Buffer) => {
			tail = (tail + chunk.toString()).slice(-4000)
		}
		child.stdout?.on("data", keepTail)
		child.stderr?.on("data", keepTail)
		const exit = await waitForExit(child, opts.timeoutMs)
		activeGroup = null
		let hookFailed = false
		if (!exit.timedOut) {
			for (const hook of opts.after ?? []) {
				const post = await runHook(hook, opts.spawnCwd, opts.timeoutMs)
				if (post.status !== 0 || post.timedOut) hookFailed = true
			}
		}
		const wallMs = Date.now() - started

		let runtime: RuntimeRecord | null = null
		const runtimeFile = join(tmp, "runtime.json")
		if (existsSync(runtimeFile)) {
			const raw = JSON.parse(readFileSync(runtimeFile, "utf8")) as RuntimeRecord
			runtime = { ...raw, execPath: canonicalExecPath(raw.execPath, canon) }
		}
		const base = { exitCode: exit.code, signal: exit.signal, wallMs, timedOut: exit.timedOut, runtime, hookFailed }
		if (!existsSync(resultsFile)) {
			return { run: emptyRun({ ...base, failureMessages: { "<run>": canon.text(tail).slice(-2000) } }), statuses: new Map() }
		}
		let json: VitestJson
		try {
			json = JSON.parse(readFileSync(resultsFile, "utf8")) as VitestJson
		} catch {
			return { run: emptyRun({ ...base, failureMessages: { "<run>": "results.json is not valid JSON" } }), statuses: new Map() }
		}
		const parsed = parseVitestJson(json, canon)
		return {
			run: {
				...base,
				missingJson: false,
				success: json.success === true,
				collected: parsed.collected,
				passed: parsed.passed,
				failed: parsed.failed,
				skipped: parsed.skipped,
				todo: parsed.todo,
				failing: parsed.failing,
				failureMessages: parsed.failureMessages,
				inventoryDigest: digestStatuses(parsed.statuses),
			},
			statuses: parsed.statuses,
		}
	} finally {
		activeGroup = null
		rmSync(tmp, { recursive: true, force: true })
	}
}

/** Runs the launcher N times, sequentially. */
export async function runLoop(
	opts: RunOnceOptions & { runs: number; onRun?: (index: number, run: RunRecord) => void },
): Promise<RunOutcome[]> {
	const outcomes: RunOutcome[] = []
	for (let index = 0; index < opts.runs; index += 1) {
		const outcome = await runOnce(opts)
		outcomes.push(outcome)
		opts.onRun?.(index, outcome.run)
	}
	return outcomes
}

function git(args: string[], cwd: string): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" })
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`)
	return result.stdout.trim()
}

function vitestVersion(wsDir: string): string {
	const require = createRequire(join(wsDir, "package.json"))
	const manifest = JSON.parse(readFileSync(require.resolve("vitest/package.json"), "utf8")) as { version: string }
	return manifest.version
}

function resolveEsm(engine: "bun" | "node", wsDir: string, canon: Canonicalizer): Record<string, ResolveRecord> {
	const argv =
		engine === "bun"
			? ["bun", RESOLVER_PATH, wsDir, ...RESOLVE_SPECS]
			: ["node", "--experimental-import-meta-resolve", RESOLVER_PATH, wsDir, ...RESOLVE_SPECS]
	const [cmd, ...args] = argv
	const result = spawnSync(cmd as string, args, { cwd: wsDir, encoding: "utf8" })
	if (result.status !== 0) throw new Error(`resolve-esm (${engine}) failed: ${result.stderr}`)
	const parsed = JSON.parse(result.stdout) as { engine: "bun" | "node"; resolves: Record<string, ResolveRecord> }
	if (parsed.engine !== engine) throw new Error(`resolve-esm ran on ${parsed.engine}, expected ${engine}`)
	const canonical: Record<string, ResolveRecord> = {}
	for (const [spec, record] of Object.entries(parsed.resolves)) {
		canonical[spec] = "esm" in record ? { esm: canon.text(record.esm) } : { error: canon.text(record.error) }
	}
	return canonical
}

interface SoakArgs {
	cwd: string
	script: string
	runtime: "script" | "node"
	runs: number
	out: string
	timeoutMin: number
	filters: string[]
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 25) — refactor when touched, never raise
export function parseSoakArgs(argv: string[]): SoakArgs {
	const args: SoakArgs = { cwd: "", script: "test", runtime: "script", runs: 0, out: "", timeoutMin: 20, filters: [] }
	let index = 0
	while (index < argv.length) {
		const arg = argv[index] as string
		const next = () => {
			index += 1
			const value = argv[index]
			if (value === undefined) throw new Error(`${arg} needs a value`)
			return value
		}
		if (arg === "--") {
			args.filters = argv.slice(index + 1)
			break
		}
		if (arg === "--cwd") args.cwd = next()
		else if (arg === "--script") args.script = next()
		else if (arg === "--runtime") {
			const value = next()
			if (value !== "script" && value !== "node") throw new Error(`--runtime must be script|node, got ${value}`)
			args.runtime = value
		} else if (arg === "--runs") args.runs = Number.parseInt(next(), 10)
		else if (arg === "--out") args.out = next()
		else if (arg === "--timeout") args.timeoutMin = Number.parseFloat(next())
		else throw new Error(`unknown option ${arg}`)
		index += 1
	}
	if (!args.cwd) throw new Error("--cwd is required")
	if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error("--runs must be a positive integer")
	if (!args.out) throw new Error("--out is required")
	const reserved = findReservedFlag(args.filters)
	if (reserved) throw new Error(`forwarded filter "${reserved}" carries a reserved flag`)
	return args
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 16) — refactor when touched, never raise
async function soak(argv: string[]): Promise<number> {
	const args = parseSoakArgs(argv)
	const wsDir = resolve(args.cwd)
	const repoRoot = git(["rev-parse", "--show-toplevel"], wsDir)
	const canon = createCanonicalizer({ repoRoot, wsDir })
	const manifest = JSON.parse(readFileSync(join(wsDir, "package.json"), "utf8")) as { scripts?: Record<string, string> }
	const scriptValue = manifest.scripts?.[args.script]
	if (!scriptValue) throw new Error(`${relative(repoRoot, wsDir)} has no "${args.script}" script`)

	let launcher: string[]
	let before: string[][] = []
	let after: string[][] = []
	if (args.runtime === "script") {
		launcher = ["bun", "--no-install", "run", "--cwd", wsDir, args.script, "--", ...args.filters]
	} else {
		const tokens = parseFlippedScript(scriptValue)
		if (tokens === null) throw new Error(`--runtime node needs a script of the form "bun --bun vitest run [...]", got "${scriptValue}"`)
		const pre = manifest.scripts?.[`pre${args.script}`]
		const post = manifest.scripts?.[`post${args.script}`]
		before = pre ? [["bun", "--no-install", "run", "--cwd", wsDir, `pre${args.script}`]] : []
		after = post ? [["bun", "--no-install", "run", "--cwd", wsDir, `post${args.script}`]] : []
		launcher = ["bun", "--no-install", "run", "--cwd", wsDir, "vitest", "run", ...tokens, ...args.filters]
	}

	const gitSha = git(["rev-parse", "HEAD"], repoRoot)
	const gitDirty = git(["status", "--porcelain", "--", ".", `:!${BASELINES_DIR}`], repoRoot) !== ""
	const lockfileSha256 = sha256(readFileSync(join(repoRoot, "bun.lock")))
	const timeoutMs = Math.round(args.timeoutMin * 60_000)

	console.log(`soak ${relative(repoRoot, wsDir)} ${args.script} [${args.runtime}] ×${args.runs} (timeout ${args.timeoutMin} min)`)
	const outcomes = await runLoop({
		launcher,
		spawnCwd: wsDir,
		timeoutMs,
		repoRoot,
		wsDir,
		before,
		after,
		runs: args.runs,
		onRun: (index, run) => {
			const engine = run.runtime?.versions.bun
				? `bun ${run.runtime.versions.bun}`
				: run.runtime
					? `node ${run.runtime.versions.node ?? "?"}`
					: "no runtime record"
			const verdict = isFailedRun(run) ? "FAILED" : "ok"
			console.log(
				`  run ${index + 1}/${args.runs}: ${verdict} exit=${run.exitCode ?? run.signal} ${run.wallMs} ms ${run.collected} tests (${run.failed} failed) [${engine}]`,
			)
		},
	})
	const runs = outcomes.map((outcome) => outcome.run)
	const engines = new Set(runs.map((run) => (run.runtime ? (run.runtime.versions.bun ? "bun" : "node") : "missing")))
	const resolverEngine = engines.size === 1 && !engines.has("missing") ? ([...engines][0] as "bun" | "node") : null
	const resolves = resolverEngine ? resolveEsm(resolverEngine, wsDir, canon) : {}
	const built = buildInventory(outcomes.map((outcome) => outcome.statuses))
	const first = runs[0]?.runtime ?? null
	const summary: SoakSummary = {
		meta: {
			tool: "test-soak@1",
			argv: ["soak", ...argv].map((value) => canon.text(value)),
			cwd: relative(repoRoot, wsDir),
			script: args.script,
			runtimeMode: args.runtime,
			filters: args.filters.map((filter) => canon.text(filter)),
			gitSha,
			gitDirty,
			lockfileSha256,
			vitestVersion: vitestVersion(wsDir),
			pool: first?.pool ?? null,
			maxWorkers: first?.maxWorkers ?? null,
			runs: args.runs,
			timeoutMin: args.timeoutMin,
			resolverEngine,
			resolves,
		},
		runs,
		inventory: built.inventory,
		inventoryDigest: built.digest,
		failedRuns: runs.filter(isFailedRun).length,
	}
	mkdirSync(dirname(resolve(args.out)), { recursive: true })
	writeFileSync(resolve(args.out), `${JSON.stringify(summary, null, "\t")}\n`)
	console.log(
		`wrote ${args.out}: failedRuns=${summary.failedRuns}, inventory ${Object.keys(summary.inventory).length} tests, digest ${summary.inventoryDigest.slice(0, 16)}`,
	)
	return summary.failedRuns === 0 ? 0 : 1
}

function compare(argv: string[]): number {
	const [aPath, bPath, ...rest] = argv
	if (!aPath || !bPath || rest.length) throw new Error("compare <reference-full.json> <candidate-full.json>")
	const a = JSON.parse(readFileSync(aPath, "utf8")) as SoakSummary
	const b = JSON.parse(readFileSync(bPath, "utf8")) as SoakSummary
	const result = compareSummaries(a, b)
	console.log(result.report)
	return result.ok ? 0 : 1
}

function compact(argv: string[]): number {
	let input = ""
	let out = ""
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index] as string
		if (arg === "--out") {
			out = argv[index + 1] ?? ""
			index += 1
		} else input = arg
	}
	if (!input || !out) throw new Error("compact <full.json> --out <compact.json>")
	const full = JSON.parse(readFileSync(input, "utf8")) as SoakSummary
	const compacted: CompactSummary = compactSummary(full)
	mkdirSync(dirname(resolve(out)), { recursive: true })
	writeFileSync(resolve(out), `${JSON.stringify(compacted, null, "\t")}\n`)
	console.log(`wrote ${out}`)
	return 0
}

async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv
	if (command === "soak") return soak(rest)
	if (command === "compare") return compare(rest)
	if (command === "compact") return compact(rest)
	console.error("usage: cli.ts soak|compare|compact …")
	return 2
}

if (import.meta.main) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error))
			process.exit(2)
		},
	)
}
