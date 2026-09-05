/**
 * Composition test: the REAL OperationJournalService FSM + the REAL WindowManager
 * (on one FakeBrowserApi) + DappInteractionService started through a
 * ServiceCollection, so `init()` wires the journal subscription for real. No PXE,
 * no proving, no browser (COMPOSITION-TESTS.md D1–D6 trivially hold).
 *
 * Proves the feed-cancel contract end to end in process: a `queued → cancelled`
 * transition closes exactly the cancelled request's window, rejects that
 * request's `execute()` promise with the structured cancel, and leaves a
 * sibling request untouched — including when the cancel lands before the
 * interaction is registered (the reconciliation read).
 */
import { describe, expect, test, vi } from "vitest"
import { JobCancelledError, UserRejectedError } from "@nulo/extension-messaging/errors"
import { FakeBrowserApi, MockClock } from "@nulo/wallet-core/testing"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ServiceCollection } from "@/wallet/base"
import { ProfileService } from "@/wallet/services/profile/service"
import { NetworkService } from "@/wallet/services/network/service"
import { AccountService } from "@/wallet/services/account/service"
import { AccessLevel, DappSessionService } from "@/wallet/services/dapp-session/service"
import { ExecutionService } from "@/wallet/services/execution/service"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { WindowManager } from "@/wallet/services/window-manager/window-manager"
import { DappInteractionService } from "./service"
import type { DappInteraction } from "./spec"

function svc(name: string, methods: Record<string, unknown>) {
	return { name, dependencies: [], async start() {}, ...methods } as never
}

const flush = () => new Promise((r) => setTimeout(r, 0))

type Outcome = { ok: unknown } | { err: unknown }
const settleOf = (p: Promise<unknown>): Promise<Outcome> =>
	p.then(
		(ok) => ({ ok }),
		(err) => ({ err }),
	)

const SESSION = {
	id: "s1",
	profileId: "p1",
	chainId: "1",
	dappMetadata: { name: "dapp.example", url: "https://dapp.example" },
	permissions: [],
	accounts: [],
	// Lowest level so an empty operation list still needs the popup.
	confirmationLevel: AccessLevel.None,
	expiry: Number.MAX_SAFE_INTEGER,
}

async function makeHarness() {
	const api = new FakeBrowserApi()
	api.reset()
	const clock = new MockClock()
	const logger = new LoggerStore(new ConfigStore())
	const journal = new OperationJournalService(logger, api)
	const manager = new WindowManager(api.windows, clock, logger)
	const dapp = new DappInteractionService(logger, manager)

	// `isConfirmationNeeded` awaits this; parking it holds `execute()` between
	// its pre-popup journal read and the interaction's registration.
	let profileGate: Promise<void> = Promise.resolve()

	const collection = new ServiceCollection()
	collection.add(
		svc(ProfileService.name, {
			getActiveProfile: async () => {
				await profileGate
				return { id: "p1" }
			},
			getProfiles: async () => [{ id: "p1" }],
			refreshSession: async () => {},
			captureExecutionFence: async () => ({ profileId: "p1", epoch: 0 }),
		}),
	)
	collection.add(svc(NetworkService.name, { registerChainPurgeSubscriber: () => {}, isNetworkLive: async () => true }))
	collection.add(svc(AccountService.name, {}))
	collection.add(svc(DappSessionService.name, { tryGetDappSession: async () => SESSION }))
	collection.add(svc(ExecutionService.name, { executeOperations: vi.fn(async () => []) }))
	collection.add(journal)
	collection.add(dapp)
	await collection.start()

	const storage = (dapp as unknown as { storage: Map<string, DappInteraction> }).storage
	const createSpy = vi.spyOn(api.windows, "create")
	const removeSpy = vi.spyOn(api.windows, "remove")

	const queuedRecord = () =>
		journal.createOperation({
			kind: "dapp_execute",
			origin: "dapp",
			profileId: "p1",
			sessionId: SESSION.id,
			initialStage: { stage: "queued" },
		})
	const execute = (queuedJournalId: string) =>
		settleOf(dapp.execute({ sessionId: SESSION.id, operations: [] }, undefined, { queuedJournalId }))
	const windowIdOf = async (createIndex: number) => (await createSpy.mock.results[createIndex]?.value)?.id as number | undefined
	const interactionFor = (journalId: string) => [...storage.values()].find((x) => x.hooks?.queuedJournalId === journalId)

	return {
		journal,
		dapp,
		storage,
		removeSpy,
		queuedRecord,
		execute,
		windowIdOf,
		interactionFor,
		parkProfile: () => {
			let release!: () => void
			profileGate = new Promise<void>((r) => {
				release = r
			})
			return release
		},
	}
}

describe("DappInteractionService × OperationJournalService × WindowManager (feed cancel closes the popup)", () => {
	test("cancelling A closes A's window only, rejects A with JobCancelledError{jobId}, cleans A up, leaves B open; a late reject of A is a no-op", async () => {
		const h = await makeHarness()
		const recA = await h.queuedRecord()
		const recB = await h.queuedRecord()

		const outcomeA = h.execute(recA.id)
		const outcomeB = h.execute(recB.id)
		await flush()
		await flush()
		const windowA = await h.windowIdOf(0)
		const windowB = await h.windowIdOf(1)
		expect(windowA).toBeTypeOf("number")
		expect(windowB).toBeTypeOf("number")
		const interactionA = h.interactionFor(recA.id)
		expect(interactionA).toBeDefined()
		expect(h.interactionFor(recB.id)).toBeDefined()

		await h.journal.transitionOperation(recA.id, { stage: "cancelled" })

		const resultA = await outcomeA
		expect("err" in resultA && resultA.err).toBeInstanceOf(JobCancelledError)
		expect(("err" in resultA ? (resultA.err as JobCancelledError) : undefined)?.details).toEqual({ jobId: recA.id })
		expect(h.removeSpy).toHaveBeenCalledTimes(1)
		expect(h.removeSpy).toHaveBeenCalledWith(windowA)
		await flush()
		expect(h.interactionFor(recA.id)).toBeUndefined()
		expect(h.interactionFor(recB.id)).toBeDefined()

		// The popup's own unload-time reject after the SW closed it: harmless.
		await h.dapp.rejectInteraction((interactionA as DappInteraction).id, "User rejected")
		expect(h.removeSpy).toHaveBeenCalledTimes(1)

		// B is still live and settles on its own terms.
		await h.dapp.rejectInteraction((h.interactionFor(recB.id) as DappInteraction).id, "User rejected")
		const resultB = await outcomeB
		expect("err" in resultB && resultB.err).toBeInstanceOf(UserRejectedError)
		expect(h.removeSpy).toHaveBeenCalledWith(windowB)
	})

	test("registration gap: a cancel landing before the interaction is registered still closes the popup (reconciliation read)", async () => {
		const h = await makeHarness()
		const recC = await h.queuedRecord()

		const release = h.parkProfile()
		const outcomeC = h.execute(recC.id)
		await flush()
		await flush()
		// Parked inside isConfirmationNeeded: past the pre-popup short-circuit,
		// before registration. The subscription fires here and finds nothing.
		expect(h.interactionFor(recC.id)).toBeUndefined()
		await h.journal.transitionOperation(recC.id, { stage: "cancelled" })
		expect(h.removeSpy).not.toHaveBeenCalled()

		release()
		const resultC = await outcomeC
		expect("err" in resultC && resultC.err).toBeInstanceOf(JobCancelledError)
		expect(("err" in resultC ? (resultC.err as JobCancelledError) : undefined)?.details).toEqual({ jobId: recC.id })
		// The window was created after the handle settled; the manager closes it.
		await flush()
		await flush()
		const windowC = await h.windowIdOf(0)
		expect(h.removeSpy).toHaveBeenCalledWith(windowC)
		expect(h.interactionFor(recC.id)).toBeUndefined()
	})
})
