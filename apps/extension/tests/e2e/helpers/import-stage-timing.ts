/**
 * Pure assembly/formatting + env-gated persistence for the full-backup
 * import stage-trajectory recorder (`importFullBackup`'s wait half).
 *
 * Everything here is Node-side and pure except `appendImportRecord`, which
 * is gated on `NULO_E2E_STAGE_LOG=1` and MUST never throw into the import
 * wait — a lost measurement is a console line, not a test failure.
 *
 * Timing contract (LEDGER ENTRY importFullBackup-300s (e2e-deflake) FIX):
 * every timestamp is the PAGE's `performance.now()` clock, including the
 * final observation — durations are same-clock diffs. A stage with no DOM
 * mutation of its own (Vue can coalesce consecutive assignments into one
 * render) is reported in `unobservedStages`, never as a zero-duration row.
 * On a non-success outcome the last entry's duration is right-censored.
 */
import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** One raw observation from the page-side MutationObserver buffer. */
export interface StageEvent {
	stage: string
	tMs: number
	/** The pre-submit seed read — excluded from terminal labeling and envelopes. */
	baseline?: boolean
}

/** What the single post-settle read returns alongside the event buffer. */
export interface FinalObservation {
	events: StageEvent[]
	finalTMs: number
	hash: string
	stage: string
	/** The Continue-gated summary screen (degraded PARTIAL SUCCESS — never a failure terminal). */
	continueScreen: boolean
}

export interface TrajectoryEntry {
	stage: string
	atMs: number
	/** Same-clock diff to the next entry (or the final observation). Null on the baseline. */
	durMs: number | null
	baseline?: boolean
	rightCensored?: boolean
}

export interface ImportStageRecord {
	runId: string
	file: string
	test: string
	importOrdinal: number
	retryEnv: string
	mode: "proverless" | "prover-on"
	trajectory: TrajectoryEntry[]
	unobservedStages: string[]
	outcome: "success" | "timeout" | "error" | "trace-lost"
	/** On a trace-lost tombstone: what the WAIT itself concluded — a lost
	 *  trace on a successful import must stay distinguishable from a lost
	 *  trace on a dead-page timeout (arc code-review F2). */
	waitOutcome?: "success" | "timeout" | "error"
	rightCensored: boolean
	finalHash?: string
	continueScreen?: boolean
}

/** The forward stage order (`useFullBackupImport.ts` RestoreStage union, minus
 *  the never-assigned `"picked"` and the terminal/rollback fork). Used ONLY to
 *  report gaps — interpretation (coalesced vs branch-skipped) happens at
 *  envelope-table time, not here. */
export const CANONICAL_STAGE_ORDER = [
	"restoring:profile",
	"restoring:networks",
	"restoring:tokens",
	"restoring:services",
	"finalizing",
	"restoring:account-state",
	"chain-sync",
	"finished",
] as const

const FAILURE_TERMINAL_STAGES = new Set(["failed", "rollback-failed", "rolled-back"])

/** Build duration-annotated trajectory entries from the raw buffer + the final
 *  observation timestamp. The baseline entry keeps `durMs: null` (its span is
 *  pre-submit noise); the last non-baseline entry is measured to `finalTMs`
 *  and right-censored when the outcome was not success. */
export function assembleTrajectory(events: StageEvent[], finalTMs: number, outcomeIsSuccess: boolean): TrajectoryEntry[] {
	const out: TrajectoryEntry[] = []
	for (let i = 0; i < events.length; i++) {
		const ev = events[i]
		const next = events[i + 1]
		if (ev.baseline) {
			out.push({ stage: ev.stage, atMs: ev.tMs, durMs: null, baseline: true })
			continue
		}
		const endMs = next ? next.tMs : finalTMs
		const entry: TrajectoryEntry = { stage: ev.stage, atMs: ev.tMs, durMs: Math.max(0, endMs - ev.tMs) }
		if (!next && !outcomeIsSuccess) entry.rightCensored = true
		out.push(entry)
	}
	return out
}

/** Canonical stages missing from the observed set, up to (not beyond) the
 *  furthest observed canonical stage — stages past that point were never
 *  reached, which is a different truth than "advanced without a mutation". */
export function listUnobservedStages(events: StageEvent[]): string[] {
	const observed = new Set(events.filter((e) => !e.baseline).map((e) => e.stage))
	let furthest = -1
	for (let i = 0; i < CANONICAL_STAGE_ORDER.length; i++) {
		if (observed.has(CANONICAL_STAGE_ORDER[i])) furthest = i
	}
	if (furthest < 0) return []
	return CANONICAL_STAGE_ORDER.slice(0, furthest).filter((s) => !observed.has(s))
}

function fmtMs(ms: number | null): string {
	if (ms === null) return "—"
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}

/** The human diagnostic for a lapse (or any non-success read): the full stage
 *  story plus a label for the known silent-burn shapes. Feeds
 *  `withTimeoutMessage` — TIMEOUT-only relabeling; other errors keep identity. */
export function formatTrajectoryDiagnostic(final: FinalObservation, successHash: string): string {
	const trajectory = assembleTrajectory(final.events, final.finalTMs, false)
	const chain = trajectory
		.map((t) => `${t.baseline ? "baseline:" : ""}${t.stage || '""'}(${fmtMs(t.durMs)}${t.rightCensored ? "+, censored" : ""})`)
		.join(" → ")
	const unobserved = listUnobservedStages(final.events)
	// The attempt fence, applied to LABELS: only post-baseline transitions may
	// classify. With a baseline-seeded trace and zero transitions, the DOM's
	// current stage IS the (possibly stale) baseline — falling back to it
	// would label a prior attempt's terminal as this attempt's failure (codex
	// post-impl round 1). `final.stage` is used only when no trace exists.
	const postBaseline = final.events.filter((e) => !e.baseline)
	const lastStage = postBaseline.at(-1)?.stage ?? (final.events.length === 0 ? final.stage : "")
	let label = `success hash ${successHash} never observed`
	if (FAILURE_TERMINAL_STAGES.has(lastStage)) {
		label = `IMPORT FAILED — product terminal "${lastStage}" reached; the remaining wait was never going to succeed`
	} else if (final.continueScreen) {
		label = "IMPORT DEGRADED (partial success) — Continue-gated summary screen shown; it never auto-routes"
	} else if (lastStage === "finished" && final.hash === "#/popup/auth") {
		label = "import finished, activation didn't — routed to #/popup/auth (bounded recovery fallback)"
	} else if (lastStage === "finished") {
		label = `import finished but the route never settled (hash=${final.hash || '""'})`
	}
	return [
		`full-backup import did not reach ${successHash} within 300s.`,
		`Diagnosis: ${label}.`,
		`Stage trajectory: ${chain || "<no stage transitions observed>"}.`,
		unobserved.length ? `Unobserved (coalesced or branch-skipped) stages: ${unobserved.join(", ")}.` : "",
		`Final: stage=${final.stage || '""'} hash=${final.hash || '""'} continueScreen=${final.continueScreen}.`,
	]
		.filter(Boolean)
		.join(" ")
}

/** Assemble the one-object-per-import measurement record. */
export function buildImportRecord(opts: {
	runId: string
	file: string
	test: string
	importOrdinal: number
	final: FinalObservation
	outcome: ImportStageRecord["outcome"]
}): ImportStageRecord {
	const success = opts.outcome === "success"
	return {
		runId: opts.runId,
		file: opts.file,
		test: opts.test,
		importOrdinal: opts.importOrdinal,
		retryEnv: process.env.NULO_E2E_RETRY ?? "default",
		mode: process.env.NULO_E2E_PROVERLESS ? "proverless" : "prover-on",
		trajectory: assembleTrajectory(opts.final.events, opts.final.finalTMs, success),
		unobservedStages: listUnobservedStages(opts.final.events),
		outcome: opts.outcome,
		rightCensored: !success,
		finalHash: opts.final.hash,
		continueScreen: opts.final.continueScreen,
	}
}

/** The record written when the page died (or the bounded read lapsed) before
 *  the buffer could be read — an explicit tombstone, never silence. */
export function buildTraceLostRecord(opts: {
	runId: string
	file: string
	test: string
	importOrdinal: number
	waitOutcome: "success" | "timeout" | "error"
}): ImportStageRecord {
	return {
		runId: opts.runId,
		file: opts.file,
		test: opts.test,
		importOrdinal: opts.importOrdinal,
		retryEnv: process.env.NULO_E2E_RETRY ?? "default",
		mode: process.env.NULO_E2E_PROVERLESS ? "proverless" : "prover-on",
		trajectory: [],
		unobservedStages: [],
		outcome: "trace-lost",
		waitOutcome: opts.waitOutcome,
		rightCensored: true,
	}
}

export function stageLogEnabled(): boolean {
	return process.env.NULO_E2E_STAGE_LOG === "1"
}

/** Per-fork output path: vitest runs one fork per test file, so a
 *  runId-suffixed file gives each fork sole ownership (no shared-file
 *  truncation or interleaving questions). Default dir honors TMPDIR via
 *  `os.tmpdir()` (real disk on the dev box; `/tmp` in CI, where the
 *  `nulo-probes-*` failure-artifact glob matches). */
export function stageLogPath(runId: string): string {
	const dir = process.env.NULO_E2E_STAGE_LOG_OUT || tmpdir()
	return join(dir, `nulo-probes-import-stages-${runId}.jsonl`)
}

/** Append one record. Disabled ⇒ zero filesystem writes. A write failure is
 *  a console line, never a throw — measurement must not fail the import. */
export function appendImportRecord(record: ImportStageRecord): "appended" | "disabled" | "write-failed" {
	if (!stageLogEnabled()) return "disabled"
	try {
		appendFileSync(stageLogPath(record.runId), `${JSON.stringify(record)}\n`)
		return "appended"
	} catch (err) {
		console.log(`[import-stage-timing] record write failed (measurement lost, test unaffected): ${String(err)}`)
		return "write-failed"
	}
}
