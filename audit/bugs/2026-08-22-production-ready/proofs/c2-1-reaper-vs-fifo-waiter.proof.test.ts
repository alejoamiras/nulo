/**
 * BUG PROOF — C2-1: the journal reaper's 10-minute `queued` grace assumes a
 * queued record means "handler crashed", but same-session dApp requests queue
 * in the wallet-sdk FIFO BEHIND the head request's approval popup (hard
 * ceiling: INTERACTION_TIMEOUT_MS = 10 min). A legitimately-waiting sibling
 * therefore crosses the grace while its pipeline is fully alive, gets reaped
 * `stuck_queued` → failed, and is rejected at claim time even if the user
 * approves its popup.
 *
 * The reaper's own comment (reaper.ts:72-77) states the premise:
 * "A queued record that survives 10 minutes means background.ts either
 * crashed or somehow lost the handler" — false for FIFO siblings.
 *
 * Unit scope: demonstrates the current unconditional age-based sweep of an
 * aged queued record whose worker is alive; the FIFO-alive context is
 * documented in the audit report.
 *
 * RED today: the record transitions to failed. GREEN after fix (grace keyed on
 * claim-eligibility, or FIFO waiters heartbeated): stays queued.
 */
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ServiceCollection } from "@nulo/wallet-core/base"
import { beforeAll, describe, expect, test } from "vitest"
import { OperationJournalService } from "../../../../apps/extension/src/wallet/services/operation-journal/service"
import { JournalReaper } from "../../../../apps/extension/src/wallet/services/operation-journal/reaper"

// Minimal chrome stub: the Port-based messaging base touches
// `chrome.runtime.onConnect` at construction under the node environment.
beforeAll(() => {
	;(globalThis as { chrome?: unknown }).chrome ??= {
		runtime: {
			id: "proof",
			onConnect: { addListener: () => {}, removeListener: () => {} },
			onMessage: { addListener: () => {}, removeListener: () => {} },
			sendMessage: async () => ({}),
			connect: () => ({ postMessage() {}, disconnect() {}, onMessage: { addListener() {} }, onDisconnect: { addListener() {} } }),
			getContexts: async () => [],
		},
	}
})

const logger = { log: () => {}, child: () => logger } as never

describe("C2-1: reaper must not fail queued records that are merely waiting in a live FIFO", () => {
	test("a queued record older than the grace window with a live worker survives the tick", async () => {
		const browserApi = new FakeBrowserApi()
		const journal = new OperationJournalService(logger, browserApi)
		const services = new ServiceCollection()
		services.add(journal)
		await services.start()

		const record = await journal.createOperation({
			kind: "dapp_execute",
			origin: "dapp",
			profileId: "p1",
			sessionId: "s1",
			initialStage: { stage: "queued" },
		} as never)

		// Age the record past the 10-min queued grace WITHOUT any stage change —
		// exactly the state of a FIFO sibling behind a long head-of-line popup.
		const area = browserApi.storage.local as unknown as {
			get(k?: string | null): Promise<Record<string, unknown>>
			set(entries: Record<string, unknown>): Promise<void>
		}
		const key = `nulo:journal@${record.id}`
		const stored = JSON.parse((await area.get(key))[key] as string) as { createdAt: number; updatedAt: number }
		stored.createdAt = Date.now() - 11 * 60_000
		stored.updatedAt = Date.now() - 11 * 60_000
		await area.set({ [key]: JSON.stringify(stored) })

		const reaper = new JournalReaper(journal, browserApi.alarms, logger)
		await reaper.reap({ unconditional: false })

		const after = await journal.getOperation(record.id)
		// CORRECT behavior: still queued — the pipeline is alive, only the popup
		// chain ahead of it is slow. RED today: transitioned to failed
		// (stuck_queued), so claim time will reject an operation the user may
		// still explicitly approve.
		expect(after?.progress.stage).toBe("queued")
	})
})
