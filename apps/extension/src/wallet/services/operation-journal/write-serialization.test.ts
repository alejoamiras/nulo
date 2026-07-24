/**
 * Serialization of the journal's read-then-write paths.
 *
 * `transitionOperation`, `setOperationMeta` and `deleteOperation` all load a row
 * and then write it, so they share one lock. Without it the interleavings below
 * lose data: a delete landing mid-transition is undone when the transition's
 * write lands on the deleted row, and a metadata update writes a snapshot that
 * predates a transition, discarding its stage change.
 *
 * These tests were written against the unserialized behavior and inverted when
 * the lock was added; each drives a competing write into the other's load→write
 * gap and asserts the result is now the serialized one.
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
 * surface (`dapp_execute` + `dapp` + sessionId), which is exactly where these
 * races actually occur.
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
 * competing write can be driven at the other's load→write gap.
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

describe("OperationJournal — read-then-write serialization", () => {
	let api: FakeBrowserApi
	let service: OperationJournalService

	beforeEach(async () => {
		;({ api, service } = await started())
	})

	test("a delete issued mid-transition takes effect — the record is not resurrected", async () => {
		const rec = await service.createOperation(INPUT)
		const { release, gated } = gateNextWrite(api)

		// Transition loads the row and blocks on its write, holding the lock.
		const transition = service.transitionOperation(rec.id, PENDING)
		await vi.waitFor(() => expect(gated()).toBe(true))

		// The delete now queues behind it instead of slipping into the gap.
		const deletion = service.deleteOperation(rec.id)

		release()
		await transition
		await deletion

		expect(await service.getOperation(rec.id)).toBeUndefined()
	})

	test("a metadata update and a transition both survive — neither overwrites the other", async () => {
		const rec = await service.createOperation(INPUT)
		const { release, gated } = gateNextWrite(api)

		// Meta loads the row (stage `queued`) and blocks on its write.
		const meta = service.setOperationMeta(rec.id, { title: "renamed" })
		await vi.waitFor(() => expect(gated()).toBe(true))

		// The transition waits for the lock rather than being clobbered by meta's
		// now-stale snapshot.
		const transition = service.transitionOperation(rec.id, PENDING)

		release()
		await meta
		await transition

		const after = await service.getOperation(rec.id)
		expect(after?.title).toBe("renamed")
		expect(after?.progress.stage).toBe("pending")
	})
})
