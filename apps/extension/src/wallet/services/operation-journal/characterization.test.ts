/**
 * Characterization pins for the journal's UNLOCKED write paths.
 *
 * `transitionOperation` serializes on `transitionLock`; `deleteOperation` and
 * `setOperationMeta` do not — even though both are load-then-write on the same
 * row, which the `transitionLock` doc explicitly says MUST take the lock.
 *
 * These two tests pin the resulting races as they behave TODAY (both are
 * bugs). They are the "before" half of the fix: when the delete/meta paths are
 * serialized, both expectations below invert, and that inversion is the proof
 * the fix landed. Do not "fix" these tests by loosening them — flip them.
 */

import type { JobProgress } from "@nulo/wallet-core/jobs"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { OperationJournalService } from "./service"
import type { NewOperationInput } from "./spec"

/**
 * A dApp-arrival record: `initialStage: "queued"` is reserved for the wallet-sdk
 * surface (`dapp_execute` + `dapp` + sessionId), which is exactly where the
 * unserialized delete/claim races below actually occur.
 */
const INPUT: NewOperationInput = {
	kind: "dapp_execute",
	origin: "dapp",
	profileId: "profile-a",
	sessionId: "session-1",
	initialStage: { stage: "queued" },
}
const PENDING: JobProgress = { stage: "pending" }

async function started(): Promise<{ api: FakeBrowserApi; service: OperationJournalService }> {
	const api = new FakeBrowserApi()
	api.reset()
	const service = new OperationJournalService(new LoggerStore(new ConfigStore()), api)
	const services = new ServiceCollection()
	services.add(service)
	await services.start()
	return { api, service }
}

/**
 * Hold the NEXT `storage.set` until the returned `release` is called, so a
 * competing write can be driven to completion inside the gap between a
 * caller's load and its write.
 */
function gateNextWrite(api: FakeBrowserApi): { release: () => void; gated: () => boolean } {
	let release!: () => void
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	let armed = true
	let reached = false
	const original = api.storage.local.set.bind(api.storage.local)
	vi.spyOn(api.storage.local, "set").mockImplementation(async (entries) => {
		if (armed) {
			armed = false
			reached = true
			await gate
		}
		return original(entries)
	})
	return { release, gated: () => reached }
}

describe("OperationJournal — unlocked-write characterization", () => {
	let api: FakeBrowserApi
	let service: OperationJournalService

	beforeEach(async () => {
		;({ api, service } = await started())
	})

	test("(BUG PIN) a delete that lands mid-transition is undone — the record is resurrected", async () => {
		const rec = await service.createOperation(INPUT)
		const { release, gated } = gateNextWrite(api)

		// Transition loads the row, then blocks on its write.
		const transition = service.transitionOperation(rec.id, PENDING)
		await vi.waitFor(() => expect(gated()).toBe(true))

		// Delete runs to completion in that gap — unserialized, so nothing stops it.
		await service.deleteOperation(rec.id)
		expect(await service.getOperation(rec.id)).toBeUndefined()

		// The transition's write now lands on a deleted row and revives it.
		release()
		await transition

		expect(await service.getOperation(rec.id)).toBeDefined()
	})

	test("(BUG PIN) setOperationMeta writes a stale snapshot, discarding a concurrent transition", async () => {
		const rec = await service.createOperation(INPUT)

		// Meta loads the row (stage `queued`), then blocks on its write.
		const { release, gated } = gateNextWrite(api)
		const meta = service.setOperationMeta(rec.id, { title: "renamed" })
		await vi.waitFor(() => expect(gated()).toBe(true))

		// A full transition completes inside the gap.
		await service.transitionOperation(rec.id, PENDING)
		expect((await service.getOperation(rec.id))?.progress.stage).toBe("pending")

		// Meta's stale snapshot overwrites it — the stage change is lost.
		release()
		await meta

		const after = await service.getOperation(rec.id)
		expect(after?.title).toBe("renamed")
		expect(after?.progress.stage).toBe("queued")
	})
})
