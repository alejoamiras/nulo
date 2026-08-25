/**
 * JournalReaper — Phase 2 Week 4 contract tests.
 *
 * Drives the reaper against a real OperationJournalService + FakeBrowserApi.
 * Time is controlled via an injected `now()` source on the reaper. The
 * journal service uses its own `Date.now()` for `updatedAt`, so we sleep
 * the test clock by advancing `now` past `updatedAt + grace` and calling
 * `reap()` directly.
 *
 * Boot-and-alarm wiring is exercised separately via the FakeBrowserApi's
 * alarms port. We do NOT exercise chrome's actual alarms minimum-floor;
 * that's a browser-platform concern.
 */

import { fakeBrowser } from "@webext-core/fake-browser"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { JOURNAL_REAPER_ALARM_NAME, JournalReaper } from "./reaper"
import { OperationJournalService } from "./service"
import type { NewOperationInput } from "./spec"

const VALID_INPUT: NewOperationInput = {
	kind: "transfer",
	origin: "popup",
	profileId: "profile-a",
}

async function started(): Promise<{ api: FakeBrowserApi; service: OperationJournalService; logger: LoggerStore }> {
	const api = new FakeBrowserApi()
	api.reset()
	const logger = new LoggerStore(new ConfigStore())
	const service = new OperationJournalService(logger, api)
	const services = new ServiceCollection()
	services.add(service)
	await services.start()
	return { api, service, logger }
}

describe("JournalReaper.reap", () => {
	let api: FakeBrowserApi
	let service: OperationJournalService
	let logger: LoggerStore

	beforeEach(async () => {
		;({ api, service, logger } = await started())
	})

	test("leaves pending records that are still within their grace window", async () => {
		const rec = await service.createOperation(VALID_INPUT)
		const reaper = new JournalReaper(service, api.alarms, logger, () => rec.updatedAt + 1_000)

		await reaper.reap()

		const still = await service.getOperation(rec.id)
		expect(still?.progress.stage).toBe("pending")
	})

	test("reaps a pending record past its grace window to failed:stale_on_resume", async () => {
		const rec = await service.createOperation(VALID_INPUT)
		// `pending` grace = 2 min; jump 3 min forward.
		const reaper = new JournalReaper(service, api.alarms, logger, () => rec.updatedAt + 3 * 60_000)

		await reaper.reap()

		const after = await service.getOperation(rec.id)
		expect(after?.progress.stage).toBe("failed")
		expect(after?.error?.kind).toBe("stale_on_resume")
		expect(after?.terminalAt).not.toBeNull()
	})

	test("reaps a proving record past its grace window with kind=stuck_proving", async () => {
		const rec = await service.createOperation(VALID_INPUT)
		await service.transitionOperation(rec.id, { stage: "simulating" })
		const proving = await service.transitionOperation(rec.id, { stage: "proving", enteredProveAt: Date.now() })
		// `proving` grace = 35 min; jump 40 min forward of the proving transition.
		const reaper = new JournalReaper(service, api.alarms, logger, () => proving.updatedAt + 40 * 60_000)

		await reaper.reap()

		const after = await service.getOperation(rec.id)
		expect(after?.progress.stage).toBe("failed")
		expect(after?.error?.kind).toBe("stuck_proving")
	})

	test("reaps a queued record past its 10-min grace window with kind=stuck_queued", async () => {
		const rec = await service.createOperation({
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "session-1",
			initialStage: { stage: "queued" },
		})
		// `queued` grace = 10 min; jump 11 min forward.
		const reaper = new JournalReaper(service, api.alarms, logger, () => rec.updatedAt + 11 * 60_000)
		await reaper.reap()

		const after = await service.getOperation(rec.id)
		expect(after?.progress.stage).toBe("failed")
		expect(after?.error?.kind).toBe("stuck_queued")
		expect(after?.terminalAt).not.toBeNull()
	})

	test("leaves a fresh queued record alone (within grace window)", async () => {
		const rec = await service.createOperation({
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "session-1",
			initialStage: { stage: "queued" },
		})
		// Within grace — 5 min < 10 min.
		const reaper = new JournalReaper(service, api.alarms, logger, () => rec.updatedAt + 5 * 60_000)
		await reaper.reap()

		const after = await service.getOperation(rec.id)
		expect(after?.progress.stage).toBe("queued")
	})

	test("boot sweep marks a queued record as failed (unconditional, no grace) using stuck_queued kind", async () => {
		const rec = await service.createOperation({
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "session-1",
			initialStage: { stage: "queued" },
		})
		// Fresh: not past grace, but boot sweep is unconditional.
		const reaper = new JournalReaper(service, api.alarms, logger, () => Date.now())
		await reaper.reap({ unconditional: true })

		const after = await service.getOperation(rec.id)
		expect(after?.progress.stage).toBe("failed")
		expect(after?.error?.kind).toBe("stuck_queued")
	})

	// (B-03 PIN) The cold-start boot sweep must NOT fail a record created in the
	// CURRENT SW lifetime — i.e. by the very request that woke the SW after
	// reaper.start() began. bootCutoff is captured at start(); rows with
	// createdAt >= bootCutoff are live and must be skipped. Prior-lifetime rows
	// (createdAt < bootCutoff) still sweep.
	test("boot sweep skips a this-lifetime record (createdAt >= bootCutoff) but reaps a prior one", async () => {
		// A record created "after boot began": make the reaper's clock (bootCutoff
		// source) read BEFORE this record's createdAt.
		const live = await service.createOperation(VALID_INPUT)
		const reaper = new JournalReaper(service, api.alarms, logger, () => live.createdAt - 1_000)

		await reaper.start()

		const after = await service.getOperation(live.id)
		// The live cold-start op must remain pending — not falsely failed.
		expect(after?.progress.stage).toBe("pending")
	})

	test("boot sweep still reaps a genuinely prior-lifetime record (createdAt < bootCutoff)", async () => {
		const stale = await service.createOperation(VALID_INPUT)
		// Boot happened AFTER this record — it is from a prior SW lifetime.
		const reaper = new JournalReaper(service, api.alarms, logger, () => stale.createdAt + 5_000)

		await reaper.start()

		const after = await service.getOperation(stale.id)
		expect(after?.progress.stage).toBe("failed")
		expect(after?.error?.kind).toBe("stale_on_resume")
	})

	test("leaves terminal records alone (succeeded / failed / cancelled)", async () => {
		const recA = await service.createOperation(VALID_INPUT)
		await service.transitionOperation(recA.id, { stage: "simulating" })
		await service.transitionOperation(recA.id, { stage: "proving", enteredProveAt: Date.now() })
		await service.transitionOperation(recA.id, { stage: "submitting" })
		await service.transitionOperation(recA.id, { stage: "succeeded", txHash: "0xhash" })

		const recB = await service.createOperation(VALID_INPUT)
		await service.transitionOperation(recB.id, { stage: "cancelled" })

		// Jump 60min forward — would reap anything non-terminal.
		const reaper = new JournalReaper(service, api.alarms, logger, () => Date.now() + 60 * 60_000)
		await reaper.reap()

		const afterA = await service.getOperation(recA.id)
		const afterB = await service.getOperation(recB.id)
		expect(afterA?.progress.stage).toBe("succeeded")
		expect(afterB?.progress.stage).toBe("cancelled")
	})

	test("survives a per-record transition failure and continues to the next record", async () => {
		const recA = await service.createOperation(VALID_INPUT)
		const recB = await service.createOperation(VALID_INPUT)

		// Sabotage one transition by intercepting the reaper's CAS entry point.
		const spy = vi.spyOn(service, "transitionIfStage")
		spy.mockImplementationOnce(async () => {
			throw new Error("synthetic mid-reap failure")
		})
		// All subsequent calls fall through to the original.
		spy.mockImplementation(async (...args) => {
			spy.mockRestore()
			return service.transitionIfStage(...args)
		})

		const reaper = new JournalReaper(service, api.alarms, logger, () => recA.updatedAt + 3 * 60_000)
		await reaper.reap()
		spy.mockRestore()

		// One of the two should have been reaped; the failure on the
		// other must not have aborted the pass.
		const afterA = await service.getOperation(recA.id)
		const afterB = await service.getOperation(recB.id)
		const stages = [afterA?.progress.stage, afterB?.progress.stage]
		expect(stages.filter((s) => s === "failed").length).toBe(1)
		expect(stages.filter((s) => s === "pending").length).toBe(1)
	})

	test("submitting stage uses a tighter 5min grace window", async () => {
		const rec = await service.createOperation(VALID_INPUT)
		await service.transitionOperation(rec.id, { stage: "simulating" })
		await service.transitionOperation(rec.id, { stage: "proving", enteredProveAt: Date.now() })
		const submitting = await service.transitionOperation(rec.id, { stage: "submitting" })

		// 4min — should NOT reap.
		const earlyReaper = new JournalReaper(service, api.alarms, logger, () => submitting.updatedAt + 4 * 60_000)
		await earlyReaper.reap()
		expect((await service.getOperation(rec.id))?.progress.stage).toBe("submitting")

		// 6min — should reap to failed:stale_on_resume.
		const lateReaper = new JournalReaper(service, api.alarms, logger, () => submitting.updatedAt + 6 * 60_000)
		await lateReaper.reap()
		const after = await service.getOperation(rec.id)
		expect(after?.progress.stage).toBe("failed")
		expect(after?.error?.kind).toBe("stale_on_resume")
	})

	test("(N-07 CAS) a candidate CLAIMED during an earlier candidate's gated transition is not failed", async () => {
		// Two aged queued records; while the reaper's first transition runs, the
		// second record is claimed (queued → pending) — the snapshot-based sweep
		// used to fail it anyway on stale data.
		const queuedInput = {
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "s1",
			initialStage: { stage: "queued" },
		} as NewOperationInput
		const recA = await service.createOperation(queuedInput)
		const recB = await service.createOperation(queuedInput)

		const originalTransitionIfStage = service.transitionIfStage.bind(service)
		const spy = vi.spyOn(service, "transitionIfStage")
		spy.mockImplementationOnce(async (...args) => {
			// During candidate #1's gated transition, #2 gets claimed.
			await service.transitionOperation(recB.id, { stage: "pending" })
			return originalTransitionIfStage(...args)
		})

		const reaper = new JournalReaper(service, api.alarms, logger, () => recA.updatedAt + 11 * 60_000)
		await reaper.reap()
		spy.mockRestore()

		expect((await service.getOperation(recA.id))?.progress.stage).toBe("failed")
		expect((await service.getOperation(recB.id))?.progress.stage).toBe("pending") // spared — claim won
	})

	test("(N-07 CAS) a candidate TOUCHED same-stage during the sweep is not failed on obsolete age", async () => {
		const queuedInput = {
			...VALID_INPUT,
			kind: "dapp_execute",
			origin: "dapp",
			sessionId: "s1",
			initialStage: { stage: "queued" },
		} as NewOperationInput
		const recA = await service.createOperation(queuedInput)
		const recB = await service.createOperation(queuedInput)

		const originalTransitionIfStage = service.transitionIfStage.bind(service)
		const spy = vi.spyOn(service, "transitionIfStage")
		let touched = false
		spy.mockImplementation(async (...args) => {
			// A heartbeat touch lands for the OTHER candidate mid-sweep: same
			// stage, fresh age. Touch whichever record this call is NOT for.
			if (!touched) {
				touched = true
				const otherId = args[0] === recA.id ? recB.id : recA.id
				// Real 2ms separation: Date.now() collides within a tick, and a
				// same-ms touch is invisible to the equality CAS (gc.test.ts lesson).
				await new Promise((r) => setTimeout(r, 2))
				await service.touchOperation(otherId)
			}
			return originalTransitionIfStage(...args)
		})

		const reaper = new JournalReaper(service, api.alarms, logger, () => recA.updatedAt + 11 * 60_000)
		await reaper.reap()
		spy.mockRestore()

		const stages = [(await service.getOperation(recA.id))?.progress.stage, (await service.getOperation(recB.id))?.progress.stage]
		expect(stages.filter((s) => s === "failed")).toHaveLength(1)
		expect(stages.filter((s) => s === "queued")).toHaveLength(1) // the touched one spared on the age CAS
	})

	test("(N-07) the unconditional boot sweep is age-blind: a freshly TOUCHED prior-lifetime record still reaps", async () => {
		const rec = await service.createOperation(VALID_INPUT)
		await service.touchOperation(rec.id) // fresh updatedAt — irrelevant to the boot sweep
		const reaper = new JournalReaper(service, api.alarms, logger, () => rec.updatedAt + 1_000)
		await reaper.reap({ unconditional: true, bootCutoff: Date.now() + 60_000 }) // created before cutoff
		expect((await service.getOperation(rec.id))?.progress.stage).toBe("failed") // crash detection intact
	})
})

describe("JournalReaper.start", () => {
	let api: FakeBrowserApi
	let service: OperationJournalService
	let logger: LoggerStore

	beforeEach(async () => {
		;({ api, service, logger } = await started())
	})

	test("registers the periodic alarm and runs an immediate boot sweep", async () => {
		const rec = await service.createOperation(VALID_INPUT)
		const reaper = new JournalReaper(service, api.alarms, logger, () => rec.updatedAt + 3 * 60_000)

		await reaper.start()

		// Boot sweep happened immediately.
		const after = await service.getOperation(rec.id)
		expect(after?.progress.stage).toBe("failed")

		// Periodic alarm was registered with the canonical name.
		const registered = await fakeBrowser.alarms.get(JOURNAL_REAPER_ALARM_NAME)
		expect(registered?.name).toBe(JOURNAL_REAPER_ALARM_NAME)

		await reaper.stop()
	})

	test("stop clears the registered alarm", async () => {
		const reaper = new JournalReaper(service, api.alarms, logger)
		await reaper.start()
		await reaper.stop()
		const remaining = await fakeBrowser.alarms.get(JOURNAL_REAPER_ALARM_NAME)
		expect(remaining).toBeUndefined()
	})

	test("alarm firing triggers a reap pass", async () => {
		const rec = await service.createOperation(VALID_INPUT)
		const reaper = new JournalReaper(service, api.alarms, logger, () => rec.updatedAt + 3 * 60_000)
		await reaper.start()
		// Boot sweep already failed `rec`. Make a fresh record to observe
		// the alarm-triggered reap fire on something other than rec.
		const rec2 = await service.createOperation(VALID_INPUT)
		// Bump the reaper's clock forward enough to reap rec2 too.
		;(reaper as unknown as { now: () => number }).now = () => rec2.updatedAt + 3 * 60_000

		// fake-browser exposes `onAlarm.trigger` to fan out a synthetic event
		// to all registered listeners. Mirrors the SessionManager test pattern.
		fakeBrowser.alarms.onAlarm.trigger({
			name: JOURNAL_REAPER_ALARM_NAME,
			scheduledTime: Date.now(),
			periodInMinutes: 1,
		} as chrome.alarms.Alarm)

		// Let the fire-and-forget reap complete.
		await new Promise((r) => setTimeout(r, 10))

		expect((await service.getOperation(rec2.id))?.progress.stage).toBe("failed")
		await reaper.stop()
	})

	test("boot sweep is aggressive: reaps RECENT proving records as sw_restart_post_prove", async () => {
		// Repro of the SW-restart-mid-prove bug. The pre-fix boot sweep
		// respected the 35-min `proving` grace window, leaving a recently-
		// started proving record stuck in the "Generating proof" state
		// indefinitely.
		const rec = await service.createOperation(VALID_INPUT)
		const proving = await service
			.transitionOperation(rec.id, { stage: "simulating" })
			.then(() => service.transitionOperation(rec.id, { stage: "proving", enteredProveAt: Date.now() }))

		// Reaper boots <1s after the record entered proving — well within the
		// 35-min grace window. Pre-fix this stayed in `proving`; post-fix the
		// boot sweep marks it failed immediately.
		const reaper = new JournalReaper(service, api.alarms, logger, () => proving.updatedAt + 500)
		await reaper.start()

		const after = await service.getOperation(rec.id)
		expect(after?.progress.stage).toBe("failed")
		expect(after?.error?.kind).toBe("sw_restart_post_prove")
		await reaper.stop()
	})

	test("boot sweep also reaps recent non-proving stages (submitting, simulating, pending) as stale_on_resume", async () => {
		// Boot sweep treats ALL non-terminal records uniformly: a fresh SW
		// can't recover any of them. Non-proving stages use `stale_on_resume`
		// per the documented JobError.kind set.
		const rec = await service.createOperation(VALID_INPUT)
		await service.transitionOperation(rec.id, { stage: "simulating" })
		await service.transitionOperation(rec.id, { stage: "proving", enteredProveAt: Date.now() })
		const submitting = await service.transitionOperation(rec.id, { stage: "submitting" })

		const reaper = new JournalReaper(service, api.alarms, logger, () => submitting.updatedAt + 100)
		await reaper.start()

		const after = await service.getOperation(rec.id)
		expect(after?.progress.stage).toBe("failed")
		expect(after?.error?.kind).toBe("stale_on_resume")
		await reaper.stop()
	})

	test("periodic-tick reap RESPECTS grace window even on recent proving (only boot sweep is aggressive)", async () => {
		// Sanity check that the unconditional behavior is boot-sweep-only.
		// A proving record started 30s ago in the CURRENT SW lifetime
		// should NOT be reaped by the alarm tick.
		const rec = await service.createOperation(VALID_INPUT)
		await service.transitionOperation(rec.id, { stage: "simulating" })
		const proving = await service.transitionOperation(rec.id, { stage: "proving", enteredProveAt: Date.now() })

		const reaper = new JournalReaper(service, api.alarms, logger, () => proving.updatedAt + 30_000)
		// Call reap() directly (NOT through start()) so we get the
		// non-unconditional periodic-tick behavior.
		await reaper.reap()

		const after = await service.getOperation(rec.id)
		expect(after?.progress.stage).toBe("proving")
	})
})
