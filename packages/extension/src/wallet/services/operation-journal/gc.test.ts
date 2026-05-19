/**
 * JournalGC — terminal-record cap-and-sweep contract tests.
 *
 * Drives the GC against a real OperationJournalService + FakeBrowserApi.
 * Caps are dialed down via the constructor option so each test seeds a
 * realistic number of records without time-skewing or N=50 fixtures.
 *
 * Note: each `service.createOperation` increments `Date.now()`, so the
 * order of creation maps to the order of `terminalAt` — newest record is
 * the most recently transitioned, oldest is the first. The GC keeps the
 * newest `cap` entries per scope.
 */

import { fakeBrowser } from "@webext-core/fake-browser"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { JournalGC } from "./gc"
import { OperationJournalService } from "./service"
import type { NewOperationInput } from "./spec"

const TRANSFER: NewOperationInput = {
	kind: "transfer",
	origin: "popup",
	profileId: "profile-a",
	accountAddress: "0xacc1",
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

async function makeSucceeded(service: OperationJournalService, input: NewOperationInput): Promise<string> {
	const rec = await service.createOperation(input)
	await service.transitionOperation(rec.id, { stage: "simulating" })
	await service.transitionOperation(rec.id, { stage: "proving", enteredProveAt: Date.now() })
	await service.transitionOperation(rec.id, { stage: "submitting" })
	await service.transitionOperation(rec.id, { stage: "succeeded", txHash: `0x${rec.id}` })
	return rec.id
}

describe("JournalGC.sweep", () => {
	let api: FakeBrowserApi
	let service: OperationJournalService
	let logger: LoggerStore

	beforeEach(async () => {
		;({ api, service, logger } = await started())
	})

	test("evicts oldest beyond cap; keeps newest within cap", async () => {
		// Stamp terminalAt with a manual nowFn so we get distinct, monotonically
		// increasing timestamps even when records terminate within the same
		// Date.now() tick. We pin terminalAt by writing directly through the
		// storage primitive — service-level transitions reuse Date.now() and
		// would collide.
		const ids: string[] = []
		for (let i = 0; i < 5; i++) ids.push(await makeSucceeded(service, TRANSFER))

		// Re-stamp terminalAt deterministically: id index 0 = oldest, 4 = newest.
		for (let i = 0; i < ids.length; i++) {
			const op = await service.getOperation(ids[i])
			if (!op) throw new Error("setup: record vanished")
			await api.storage.session.set({
				[`nulo:journal@${op.id}`]: JSON.stringify({ ...op, terminalAt: 1_000_000 + i * 10 }),
			})
		}

		const gc = new JournalGC(service, api.alarms, logger, { capPerScope: 3 })
		await gc.sweep()

		const remaining = await service.getOperations({ isTerminal: true })
		expect(remaining).toHaveLength(3)
		// The 3 newest (highest terminalAt) should survive: ids[2], ids[3], ids[4].
		expect(remaining.map((r) => r.id).sort()).toEqual(ids.slice(2).sort())
	})

	test("groups under cap are left alone", async () => {
		for (let i = 0; i < 3; i++) await makeSucceeded(service, TRANSFER)
		const gc = new JournalGC(service, api.alarms, logger, { capPerScope: 5 })

		await gc.sweep()

		const remaining = await service.getOperations({ isTerminal: true })
		expect(remaining).toHaveLength(3)
	})

	test("non-terminal records are never touched", async () => {
		const inflight = await service.createOperation(TRANSFER)
		await service.transitionOperation(inflight.id, { stage: "simulating" })
		// Also pile up terminal records to trip the cap.
		for (let i = 0; i < 4; i++) await makeSucceeded(service, TRANSFER)
		const gc = new JournalGC(service, api.alarms, logger, { capPerScope: 1 })

		await gc.sweep()

		const still = await service.getOperation(inflight.id)
		expect(still?.progress.stage).toBe("simulating")
		expect(still?.terminalAt).toBeNull()
	})

	test("per (profile, account) isolation: one busy scope does not evict another's history", async () => {
		const SCOPE_A: NewOperationInput = { kind: "transfer", origin: "popup", profileId: "p-a", accountAddress: "0xA" }
		const SCOPE_B: NewOperationInput = { kind: "transfer", origin: "popup", profileId: "p-a", accountAddress: "0xB" }

		// Scope A overflows the cap; scope B is small.
		for (let i = 0; i < 5; i++) await makeSucceeded(service, SCOPE_A)
		for (let i = 0; i < 2; i++) await makeSucceeded(service, SCOPE_B)
		const gc = new JournalGC(service, api.alarms, logger, { capPerScope: 3 })

		await gc.sweep()

		const surviving = await service.getOperations({ isTerminal: true })
		const aCount = surviving.filter((r) => r.accountAddress === "0xA").length
		const bCount = surviving.filter((r) => r.accountAddress === "0xB").length
		expect(aCount).toBe(3)
		expect(bCount).toBe(2)
	})

	test("alarm tick fires sweep; stop() removes alarm + listener", async () => {
		for (let i = 0; i < 4; i++) await makeSucceeded(service, TRANSFER)
		const gc = new JournalGC(service, api.alarms, logger, { capPerScope: 2 })
		const sweepSpy = vi.spyOn(gc, "sweep")

		await gc.start()
		// start() runs an immediate boot sweep.
		expect(sweepSpy).toHaveBeenCalledTimes(1)
		expect((await service.getOperations({ isTerminal: true })).length).toBe(2)

		// Pile up again, then synthesize an alarm tick via fake-browser.
		for (let i = 0; i < 3; i++) await makeSucceeded(service, TRANSFER)
		fakeBrowser.alarms.onAlarm.trigger({
			name: "nulo:journal:gc",
			scheduledTime: Date.now(),
			periodInMinutes: 60,
		})
		// Yield for the fire-and-forget catch chain inside onAlarmFired.
		await Promise.resolve()
		await Promise.resolve()
		expect(sweepSpy).toHaveBeenCalledTimes(2)

		await gc.stop()
		// After stop, no further alarms should drive sweeps.
		fakeBrowser.alarms.onAlarm.trigger({
			name: "nulo:journal:gc",
			scheduledTime: Date.now(),
			periodInMinutes: 60,
		})
		await Promise.resolve()
		expect(sweepSpy).toHaveBeenCalledTimes(2)
	})
})
