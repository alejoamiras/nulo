/**
 * Unit tests for `tryCreateQueuedJournal` — message-arrival queued-record
 * creation with cap + pre-auth gates.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { WalletMessage } from "@aztec-labs/wallet-sdk/types"
import { ScopeViolationError } from "@nulo/extension-messaging/errors"
import { MAX_QUEUED_GLOBAL, MAX_QUEUED_PER_SESSION, failQueuedForError, tryCreateQueuedJournal } from "./queued-journal"
import { makeAccountStub, makeDappSessionStub, makeDeps, makeSession } from "./queued-journal.fixtures"

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
		networkSvc.getNetworksRaw.mockResolvedValueOnce([])
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

/**
 * Which account the record is filed under.
 *
 * The record must name the account the send will actually go out as, so it
 * resolves through the same rule the dispatcher uses: a session-authorized
 * explicit sender, else the first WALLET-ordered session account. It used to
 * take `session.accounts[0]`, which is an unrelated ordering, so a
 * multi-account session filed the operation under the wrong account.
 */
describe("tryCreateQueuedJournal — record account", () => {
	const ADDR_A = "0xaaa"
	const ADDR_B = "0xbbb"

	/** Session lists B first while wallet order is [A, B], so the two rules disagree. */
	function depsWithSessionOrder() {
		return makeDeps({
			dappSession: {
				tryGetDappSessionByOriginAndChain: vi.fn(async () => ({
					accounts: [`aztec:1338:${ADDR_B}`, `aztec:1338:${ADDR_A}`],
					capabilityGrants: [{ capability: { type: "transaction" } }],
					dappMetadata: { name: "Example Dapp" },
				})),
			} as never,
			account: makeAccountStub([ADDR_A, ADDR_B]) as never,
		})
	}

	function sendTxFrom(from: string): WalletMessage {
		return {
			messageId: "msg-from",
			type: "sendTx",
			args: [{ calls: [{ name: "transfer" }] }, { from }],
		} as unknown as WalletMessage
	}

	test("an explicit `from` is honored", async () => {
		const { deps, journal } = depsWithSessionOrder()

		const id = await tryCreateQueuedJournal(sendTxFrom(ADDR_A), makeSession(), deps)

		expect((await journal.getOperation(id as string))?.accountAddress).toBe(ADDR_A)
	})

	test("NO_FROM files under the first WALLET-ordered session account, not the first listed", async () => {
		const { deps, journal } = depsWithSessionOrder()

		const id = await tryCreateQueuedJournal(sendTxFrom("NO_FROM"), makeSession(), deps)

		// The session lists B first; wallet order is [A, B], so A wins.
		expect((await journal.getOperation(id as string))?.accountAddress).toBe(ADDR_A)
	})

	test("a sender outside the session is left un-journaled rather than filed under someone else", async () => {
		const { deps, journal } = depsWithSessionOrder()

		const id = await tryCreateQueuedJournal(sendTxFrom("0xstranger"), makeSession(), deps)

		expect(id).toBeUndefined()
		expect(await journal.countOperations({ stage: "queued" })).toBe(0)
	})

	test("a switch racing journal creation is refused: active profile ≠ the session's stamp", async () => {
		// The message rode a session stamped profile-1, but by the time the
		// journal path runs, profile-2 is active — no record may be persisted
		// under either profile (the dispatch guard rejects the message itself).
		const { deps, profile, journal } = makeDeps()
		profile.getActiveProfile.mockResolvedValue({ id: "profile-2" })
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeUndefined()
		expect(await journal.countOperations({ stage: "queued" })).toBe(0)
	})

	test("pre-persist belt: a switch landing during the anchored reads is caught at the persist lock", async () => {
		// First read (entry check) sees the stamped profile; the re-read inside
		// the creation lock sees the switch — the record must not persist.
		const { deps, profile, journal } = makeDeps()
		profile.getActiveProfile.mockResolvedValueOnce({ id: "profile-1" }).mockResolvedValue({ id: "profile-2" })
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeUndefined()
		expect(await journal.countOperations({ stage: "queued" })).toBe(0)
	})

	test("the network read is anchored to the stamped profile, not the live one", async () => {
		const { deps, networkSvc } = makeDeps()
		await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(networkSvc.getNetworksRaw).toHaveBeenCalledWith("profile-1", expect.anything())
	})

	test("the dapp-session lookup is anchored to the stamped profile (silently revertible without this pin)", async () => {
		const { deps, dappSession } = makeDeps()
		await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(dappSession.tryGetDappSessionByOriginAndChain).toHaveBeenCalledWith(expect.anything(), expect.anything(), "profile-1")
	})
})

describe("failQueuedForError — CAS against a concurrent claim (N-07)", () => {
	const refusal = new ScopeViolationError("Scope violation: sendTx call not permitted by granted transaction scope")

	test("a record claimed (queued→pending) is NOT failed — the lock-held re-read stands down (regression control)", async () => {
		const { deps, journal } = makeDeps()
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		expect(id).toBeDefined()
		// The claim lands first. A racy read-then-transition with a stale
		// "queued" snapshot would now legally run pending→failed; the CAS's
		// re-read under the transition lock must stand down instead. Stub the
		// LEGACY read path so a reverted implementation reads a stale snapshot.
		await journal.transitionOperation(id as string, { stage: "pending" })
		const staleSnapshot = { id, progress: { stage: "queued" } }
		vi.spyOn(journal, "getOperation").mockResolvedValueOnce(staleSnapshot as never)
		await failQueuedForError(journal, id as string, refusal, deps.logger)
		vi.restoreAllMocks()
		expect((await journal.getOperation(id as string))?.progress.stage).toBe("pending")
	})

	test.each([
		["a scope refusal", "scope_refused", refusal],
		["any other failure", "popup_bound", new Error("session gone")],
	])("a still-queued record failed by %s gets the %s kind and the error's message", async (_name, kind, error) => {
		const { deps, journal } = makeDeps()
		const id = await tryCreateQueuedJournal(makeSendTxMessage(), makeSession(), deps)
		await failQueuedForError(journal, id as string, error, deps.logger)
		const rec = await journal.getOperation(id as string)
		expect({ stage: rec?.progress.stage, kind: rec?.error?.kind, message: rec?.error?.message }).toEqual({
			stage: "failed",
			kind,
			message: error.message,
		})
	})

	test("a missing record is a silent no-op (regression control)", async () => {
		const { deps, journal } = makeDeps()
		await failQueuedForError(journal, "no-such-id", refusal, deps.logger)
		expect(await journal.countOperations({ stage: "failed" })).toBe(0)
	})
})
