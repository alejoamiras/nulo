/**
 * Pure-node pins for the import stage-trajectory recorder's assembly,
 * formatting, and persistence rules (`helpers/import-stage-timing.ts`).
 * No browser, no fixtures — runs in the smoke suite's node environment.
 *
 * The measurement contract these pin (plan: import-stage-deadlines):
 * one page clock; unobserved (Vue-coalesced or branch-skipped) stages are
 * REPORTED, never zero-duration rows; non-success right-censors the last
 * entry; disabled logging performs zero filesystem writes; a write failure
 * never throws.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
	appendImportRecord,
	assembleTrajectory,
	buildImportRecord,
	buildTraceLostRecord,
	CANONICAL_STAGE_ORDER,
	type FinalObservation,
	formatTrajectoryDiagnostic,
	listUnobservedStages,
	type StageEvent,
	stageLogEnabled,
	stageLogPath,
} from "./helpers/import-stage-timing"

const SUCCESS_HASH = "#/popup/general"

function makeFinal(events: StageEvent[], overrides: Partial<FinalObservation> = {}): FinalObservation {
	return {
		events,
		finalTMs: 10_000,
		hash: SUCCESS_HASH,
		stage: events.at(-1)?.stage ?? "",
		continueScreen: false,
		...overrides,
	}
}

const HAPPY_EVENTS: StageEvent[] = [
	{ stage: "", tMs: 0, baseline: true },
	{ stage: "restoring:profile", tMs: 100 },
	{ stage: "restoring:networks", tMs: 1_100 },
	{ stage: "restoring:tokens", tMs: 1_400 },
	{ stage: "restoring:services", tMs: 2_000 },
	{ stage: "finalizing", tMs: 5_000 },
	{ stage: "finished", tMs: 8_000 },
]

describe("assembleTrajectory", () => {
	test("durations are same-clock diffs; the last entry runs to the final observation", () => {
		const t = assembleTrajectory(HAPPY_EVENTS, 10_000, true)
		expect(t.map((e) => [e.stage, e.durMs])).toEqual([
			["", null],
			["restoring:profile", 1_000],
			["restoring:networks", 300],
			["restoring:tokens", 600],
			["restoring:services", 3_000],
			["finalizing", 3_000],
			["finished", 2_000],
		])
	})

	test("baseline keeps durMs null and is flagged; success never censors", () => {
		const t = assembleTrajectory(HAPPY_EVENTS, 10_000, true)
		expect(t[0]).toMatchObject({ baseline: true, durMs: null })
		expect(t.some((e) => e.rightCensored)).toBe(false)
	})

	test("non-success right-censors exactly the last entry", () => {
		const t = assembleTrajectory(HAPPY_EVENTS.slice(0, 5), 300_000, false)
		expect(t.at(-1)).toMatchObject({ stage: "restoring:services", rightCensored: true })
		expect(t.slice(0, -1).some((e) => e.rightCensored)).toBe(false)
	})

	test("a stale pre-submit terminal stays a baseline row, never a transition", () => {
		// resetBackupState does not reset restoreStage — the arm's baseline seed
		// is the attempt fence: the stale value is present but flagged.
		const t = assembleTrajectory(
			[
				{ stage: "rolled-back", tMs: 0, baseline: true },
				{ stage: "restoring:profile", tMs: 50 },
			],
			1_000,
			true,
		)
		expect(t[0]).toMatchObject({ stage: "rolled-back", baseline: true, durMs: null })
	})
})

describe("listUnobservedStages", () => {
	test("coalesced middles are reported; stages past the furthest observed are not", () => {
		// account-state + chain-sync coalesced/skipped before finished: reported.
		const events: StageEvent[] = [
			{ stage: "", tMs: 0, baseline: true },
			{ stage: "restoring:profile", tMs: 1 },
			{ stage: "finalizing", tMs: 2 },
			{ stage: "finished", tMs: 3 },
		]
		expect(listUnobservedStages(events)).toEqual([
			"restoring:networks",
			"restoring:tokens",
			"restoring:services",
			"restoring:account-state",
			"chain-sync",
		])
	})

	test("an early-failed run reports no unreached stages as unobserved", () => {
		const events: StageEvent[] = [
			{ stage: "", tMs: 0, baseline: true },
			{ stage: "restoring:profile", tMs: 1 },
			{ stage: "restoring:networks", tMs: 2 },
		]
		expect(listUnobservedStages(events)).toEqual([])
	})

	test("non-canonical (terminal/rollback) stages never appear in the gap list", () => {
		const events: StageEvent[] = [
			{ stage: "", tMs: 0, baseline: true },
			{ stage: "restoring:profile", tMs: 1 },
			{ stage: "failed", tMs: 2 },
		]
		expect(listUnobservedStages(events)).toEqual([])
		expect(CANONICAL_STAGE_ORDER).not.toContain("failed")
	})
})

describe("formatTrajectoryDiagnostic", () => {
	test("failure terminal is labeled as a definitive failure with the stage story", () => {
		const msg = formatTrajectoryDiagnostic(
			makeFinal(
				[
					{ stage: "", tMs: 0, baseline: true },
					{ stage: "restoring:profile", tMs: 100 },
					{ stage: "failed", tMs: 900 },
				],
				{ hash: "#/popup/import", stage: "failed" },
			),
			SUCCESS_HASH,
		)
		expect(msg).toContain("IMPORT FAILED")
		expect(msg).toContain('"failed"')
		expect(msg).toContain("restoring:profile")
	})

	test("the Continue-gated screen is labeled DEGRADED partial success, not failure", () => {
		const msg = formatTrajectoryDiagnostic(makeFinal(HAPPY_EVENTS, { hash: "#/popup/import", continueScreen: true }), SUCCESS_HASH)
		expect(msg).toContain("IMPORT DEGRADED (partial success)")
		expect(msg).not.toContain("IMPORT FAILED")
	})

	test("finished + auth-route names the activation fallback", () => {
		const msg = formatTrajectoryDiagnostic(makeFinal(HAPPY_EVENTS, { hash: "#/popup/auth" }), SUCCESS_HASH)
		expect(msg).toContain("activation didn't")
	})

	test("unobserved stages are named in the message", () => {
		const msg = formatTrajectoryDiagnostic(
			makeFinal(
				[
					{ stage: "", tMs: 0, baseline: true },
					{ stage: "restoring:profile", tMs: 1 },
					{ stage: "finished", tMs: 2 },
				],
				{ hash: "#/popup/import" },
			),
			SUCCESS_HASH,
		)
		expect(msg).toContain("Unobserved")
		expect(msg).toContain("restoring:networks")
	})
})

describe("records + persistence", () => {
	const savedLog = process.env.NULO_E2E_STAGE_LOG
	const savedOut = process.env.NULO_E2E_STAGE_LOG_OUT
	afterEach(() => {
		if (savedLog === undefined) delete process.env.NULO_E2E_STAGE_LOG
		else process.env.NULO_E2E_STAGE_LOG = savedLog
		if (savedOut === undefined) delete process.env.NULO_E2E_STAGE_LOG_OUT
		else process.env.NULO_E2E_STAGE_LOG_OUT = savedOut
	})

	const attribution = { runId: "test-run-1", file: "some.test.ts", test: "case", importOrdinal: 1 }

	test("disabled ⇒ zero filesystem writes", () => {
		delete process.env.NULO_E2E_STAGE_LOG
		const dir = mkdtempSync(join(tmpdir(), "nulo-stage-log-"))
		process.env.NULO_E2E_STAGE_LOG_OUT = dir
		expect(stageLogEnabled()).toBe(false)
		const result = appendImportRecord(buildImportRecord({ ...attribution, final: makeFinal(HAPPY_EVENTS), outcome: "success" }))
		expect(result).toBe("disabled")
		expect(readdirSync(dir)).toEqual([])
	})

	test("enabled ⇒ one JSON line per import in the per-run file", () => {
		process.env.NULO_E2E_STAGE_LOG = "1"
		const dir = mkdtempSync(join(tmpdir(), "nulo-stage-log-"))
		process.env.NULO_E2E_STAGE_LOG_OUT = dir
		const record = buildImportRecord({ ...attribution, final: makeFinal(HAPPY_EVENTS), outcome: "success" })
		expect(appendImportRecord(record)).toBe("appended")
		expect(appendImportRecord(record)).toBe("appended")
		const path = stageLogPath(attribution.runId)
		expect(path.startsWith(dir)).toBe(true)
		const lines = readFileSync(path, "utf8").trim().split("\n")
		expect(lines).toHaveLength(2)
		const parsed = JSON.parse(lines[0]) as Record<string, unknown>
		expect(parsed).toMatchObject({ runId: "test-run-1", outcome: "success", rightCensored: false, importOrdinal: 1 })
		expect(Array.isArray(parsed.trajectory)).toBe(true)
	})

	test("a write failure degrades to a status, never a throw", () => {
		process.env.NULO_E2E_STAGE_LOG = "1"
		// A directory path that cannot exist as a parent (a FILE in the middle).
		const dir = mkdtempSync(join(tmpdir(), "nulo-stage-log-"))
		process.env.NULO_E2E_STAGE_LOG_OUT = join(dir, "definitely", "missing", "nested")
		const record = buildImportRecord({ ...attribution, final: makeFinal(HAPPY_EVENTS), outcome: "timeout" })
		expect(() => appendImportRecord(record)).not.toThrow()
		expect(appendImportRecord(record)).toBe("write-failed")
		expect(existsSync(stageLogPath(attribution.runId))).toBe(false)
	})

	test("trace-lost is an explicit tombstone record", () => {
		const record = buildTraceLostRecord(attribution)
		expect(record).toMatchObject({ outcome: "trace-lost", rightCensored: true, trajectory: [] })
	})

	test("timeout outcome right-censors the record's last trajectory entry", () => {
		const record = buildImportRecord({
			...attribution,
			final: makeFinal(HAPPY_EVENTS.slice(0, 5), { hash: "#/popup/import", finalTMs: 300_000 }),
			outcome: "timeout",
		})
		expect(record.rightCensored).toBe(true)
		expect(record.trajectory.at(-1)).toMatchObject({ rightCensored: true })
	})
})
