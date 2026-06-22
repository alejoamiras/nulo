/**
 * Unit tests for `tryCreateQueuedJournal` — message-arrival queued-record
 * creation with cap + pre-auth gates.
 *
 * Plan v6 §Tests #13-#16 (queued-record creation, cap behaviour) +
 * post-impl review fix for atomic-cap under burst (codex + opus F1).
 */
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { WalletMessage } from "@aztec/wallet-sdk/types"
import type { ActiveSession } from "@aztec/wallet-sdk/extension/handlers"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { OperationJournalService } from "@/wallet/services/operation-journal/service"
import { MAX_QUEUED_GLOBAL, MAX_QUEUED_PER_SESSION, tryCreateQueuedJournal, type TryCreateQueuedJournalDeps } from "./queued-journal"

function makeSession(sessionId = "session-A"): ActiveSession {
	return {
		sessionId,
		origin: "https://example.test",
		chainInfo: { chainId: "0x539", version: "0x1" },
	} as unknown as ActiveSession
}

function makeSendTxMessage(messageId = "msg-1"): WalletMessage {
	return {
		messageId,
		type: "sendTx",
		args: [
			{
				calls: [{ name: "drip_to_public" }],
			},
			{},
		],
	} as unknown as WalletMessage
}

function makeNonSendTxMessage(): WalletMessage {
	return {
		messageId: "msg-x",
		type: "getAccounts",
		args: [],
	} as unknown as WalletMessage
}

function makeDeps(overrides: Partial<TryCreateQueuedJournalDeps> = {}): {
	deps: TryCreateQueuedJournalDeps
	journal: OperationJournalService
	api: FakeBrowserApi
	profile: ReturnType<typeof makeProfileStub>
	dappSession: ReturnType<typeof makeDappSessionStub>
	networkSvc: ReturnType<typeof makeNetworkStub>
} {
	const api = new FakeBrowserApi()
	api.reset()
	const logger = new LoggerStore(new ConfigStore())
	const journal = new OperationJournalService(logger, api)
	const services = new ServiceCollection()
	services.add(journal)
	void services.start()

	const profile = makeProfileStub()
	const dappSession = makeDappSessionStub()
	const networkSvc = makeNetworkStub()

	const deps: TryCreateQueuedJournalDeps = {
		journal,
		profile: profile as never,
		dappSession: dappSession as never,
		networkSvc: networkSvc as never,
		logger,
		...overrides,
	}
	return { deps, journal, api, profile, dappSession, networkSvc }
}

function makeProfileStub() {
	return {
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		getActiveProfile: vi.fn<() => Promise<any>>(async () => ({ id: "profile-1" })),
	}
}

function makeDappSessionStub(opts: { name?: string | null } = { name: "Example Dapp" }) {
	// `null` distinguishes "explicitly omit dappMetadata" from "default name" —
	// passing `undefined` would trigger the default parameter, so callers must
	// pass `{ name: null }` to simulate a session created before dappMetadata
	// was populated.
	const metadata = opts.name === null ? undefined : { name: opts.name }
	return {
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		tryGetDappSessionByOriginAndChain: vi.fn<() => Promise<any>>(async () => ({
			accounts: ["aztec:1338:0xabc"],
			capabilityGrants: [{ capability: { type: "transaction" } }, { capability: { type: "accounts" } }],
			dappMetadata: metadata,
		})),
	}
}

function makeNetworkStub() {
	return {
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		getNetworks: vi.fn<() => Promise<any[]>>(async () => [{ id: "network-row-1", chainId: 1338 }]),
	}
}

describe("tryCreateQueuedJournal", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("creates a queued record for sendTx with all gates passing", async () => {
		const { deps, journal } = makeDeps()
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeDefined()
		const rec = await journal.getOperation(id as string)
		expect(rec?.kind).toBe("dapp_execute")
		expect(rec?.origin).toBe("dapp")
		expect(rec?.sessionId).toBe("session-A")
		expect(rec?.networkId).toBe("network-row-1")
		expect(rec?.title).toBe("drip_to_public")
		expect(rec?.subtitle).toBe("Example Dapp")
		expect(rec?.progress.stage).toBe("queued")
	})

	test("subtitle falls back to 'Unknown dapp' when session has no dappMetadata.name", async () => {
		// QA-reported: subtitle previously used `session.origin` (the full URL),
		// surfacing raw URLs in the activity-card chip when the second tx hit
		// the queued path during speed-runs. Mirrors `dapp-interaction/service.ts:309`
		// so the queued record's chip matches what the live-claim record's
		// chip would have been.
		const { deps, journal } = makeDeps({ dappSession: makeDappSessionStub({ name: null }) as never })
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeDefined()
		const rec = await journal.getOperation(id as string)
		expect(rec?.subtitle).toBe("Unknown dapp")
	})

	test("skips when no active profile (wallet locked)", async () => {
		const { deps, profile, journal } = makeDeps()
		profile.getActiveProfile.mockResolvedValueOnce(null)
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeUndefined()
		expect(await journal.countOperations({ stage: "queued" })).toBe(0)
	})

	test("skips when no dapp session for origin/chain", async () => {
		const { deps, dappSession, journal } = makeDeps()
		dappSession.tryGetDappSessionByOriginAndChain.mockResolvedValueOnce(null)
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeUndefined()
		expect(await journal.countOperations({ stage: "queued" })).toBe(0)
	})

	test("skips when dapp session has no accounts", async () => {
		const { deps, dappSession, journal } = makeDeps()
		dappSession.tryGetDappSessionByOriginAndChain.mockResolvedValueOnce({ accounts: [], capabilityGrants: [] })
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeUndefined()
		expect(await journal.countOperations({ stage: "queued" })).toBe(0)
	})

	test("skips when dapp session lacks `transaction` capability grant", async () => {
		const { deps, dappSession, journal } = makeDeps()
		dappSession.tryGetDappSessionByOriginAndChain.mockResolvedValueOnce({
			accounts: ["aztec:1338:0xabc"],
			capabilityGrants: [{ capability: { type: "accounts" } }],
		})
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeUndefined()
		expect(await journal.countOperations({ stage: "queued" })).toBe(0)
	})

	test("skips when networkService can't resolve a Network row for the session's chainId", async () => {
		const { deps, networkSvc, journal } = makeDeps()
		networkSvc.getNetworks.mockResolvedValueOnce([])
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeUndefined()
		expect(await journal.countOperations({ stage: "queued" })).toBe(0)
	})

	test("per-session cap: skips creation once MAX_QUEUED_PER_SESSION queued records exist for this session", async () => {
		const { deps, journal } = makeDeps()
		// Fill the cap with queued records for THIS session.
		for (let i = 0; i < MAX_QUEUED_PER_SESSION; i++) {
			await journal.createOperation({
				kind: "dapp_execute",
				origin: "dapp",
				profileId: "profile-1",
				sessionId: "session-A",
				initialStage: { stage: "queued" },
			})
		}
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeUndefined()
		// Cap should hold — count unchanged.
		expect(await journal.countOperations({ sessionId: "session-A", stage: "queued" })).toBe(MAX_QUEUED_PER_SESSION)
	})

	test("per-session cap is per-session: a different session can still create when cap reached on another", async () => {
		const { deps, journal } = makeDeps()
		for (let i = 0; i < MAX_QUEUED_PER_SESSION; i++) {
			await journal.createOperation({
				kind: "dapp_execute",
				origin: "dapp",
				profileId: "profile-1",
				sessionId: "session-A",
				initialStage: { stage: "queued" },
			})
		}
		// Try a different session: should succeed.
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession("session-B"), deps)
		expect(id).toBeDefined()
	})

	test("global cap: skips creation once MAX_QUEUED_GLOBAL queued records exist across all sessions", async () => {
		const { deps, journal } = makeDeps()
		// Fill the global cap across many sessions (4 records × 8 sessions = 32 = MAX_QUEUED_GLOBAL).
		const sessionsToFill = MAX_QUEUED_GLOBAL / MAX_QUEUED_PER_SESSION
		for (let s = 0; s < sessionsToFill; s++) {
			for (let i = 0; i < MAX_QUEUED_PER_SESSION; i++) {
				await journal.createOperation({
					kind: "dapp_execute",
					origin: "dapp",
					profileId: "profile-1",
					sessionId: `session-${s}`,
					initialStage: { stage: "queued" },
				})
			}
		}
		// A fresh session with 0 of its own queued records still hits the global cap.
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession("fresh-session"), deps)
		expect(id).toBeUndefined()
	})

	test("ATOMIC cap: N concurrent arrivals all serialize through the lock; total created ≤ MAX_QUEUED_PER_SESSION", async () => {
		// This pins the fix for codex + opus F1. Without the queuedCreationLock,
		// 20 parallel arrivals would all read the same `count` value (0) and
		// all create records, blowing the cap. WITH the lock, they serialize:
		// the first MAX_QUEUED_PER_SESSION succeed, the rest see a count ≥ cap
		// and return undefined.
		const { deps, journal } = makeDeps()
		const N = 20 // > MAX_QUEUED_PER_SESSION
		const results = await Promise.all(Array.from({ length: N }, () => tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)))
		const created = results.filter((r): r is string => r !== undefined).length
		const skipped = results.length - created
		expect(created).toBeLessThanOrEqual(MAX_QUEUED_PER_SESSION)
		expect(created + skipped).toBe(N)
		expect(await journal.countOperations({ sessionId: "session-A", stage: "queued" })).toBe(created)
	})

	test("primary method extraction: uses `args[0].calls[0].name` when present", async () => {
		const { deps, journal } = makeDeps()
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect((await journal.getOperation(id as string))?.title).toBe("drip_to_public")
	})

	test("falls back to 'Transaction' title when calls have no method names", async () => {
		const { deps, journal } = makeDeps()
		const message = {
			messageId: "m",
			type: "sendTx",
			args: [{ calls: [{}] }, {}],
		} as unknown as WalletMessage
		const id = await tryCreateQueuedJournal(message, makeSession(), deps)
		expect((await journal.getOperation(id as string))?.title).toBe("Transaction")
	})

	test("returns undefined on errors thrown by the journal (best-effort visibility)", async () => {
		const { deps, journal } = makeDeps()
		const spy = vi.spyOn(journal, "createOperation").mockRejectedValueOnce(new Error("storage write failed"))
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeUndefined()
		spy.mockRestore()
	})

	test("non-sendTx message: extractPrimaryMethod returns undefined and we still create a Transaction record", async () => {
		// Note: callers are expected to gate by message.type === "sendTx" themselves.
		// tryCreateQueuedJournal doesn't enforce that — exercises the title fallback.
		const { deps, journal } = makeDeps()
		const id = await tryCreateQueuedJournal(makeNonSendTxMessage(), makeSession(), deps)
		expect(id).toBeDefined()
		expect((await journal.getOperation(id as string))?.title).toBe("Transaction")
	})
})
