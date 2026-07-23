/**
 * Unit tests for `claimOrCreateDappExecuteJournal` — the decision tree that
 * decides whether to claim a pre-allocated queued journal record (queued →
 * pending) or create a fresh one, and how to surface cancellations safely.
 *
 * Plan v6 §Tests #22-#28 + post-impl review fixes. Covers:
 *   - no queuedJournalId           → create new
 *   - record reaped (not found)    → create new
 *   - record stage === "queued"     → claim succeeds; controller registered
 *   - record stage IS NOT queued    → throw JobCancelledSentinel
 *   - transition fails + record now cancelled → throw JobCancelledSentinel
 *   - transition fails + record still queued  → re-throw original error
 *   - controller is registered immediately (no awaitable gap)
 */
import { JobCancelledSentinel } from "@nulo/wallet-core/jobs"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { OriginType, type LocalTxOrigin } from "@/wallet/services/transaction/spec"
import { claimOrCreateDappExecuteJournal, type ClaimHelperDeps } from "./claim-helper"

const ORIGIN: LocalTxOrigin = { type: OriginType.DAPP, name: "test-dapp" }

function makeDeps(overrides: Partial<ClaimHelperDeps> = {}): {
	deps: ClaimHelperDeps
	journal: ReturnType<typeof makeJournal>
	activeControllers: Map<string, AbortController>
	createFreshRecord: ReturnType<typeof vi.fn>
} {
	const journal = makeJournal()
	const activeControllers = new Map<string, AbortController>()
	const createFreshRecord = vi.fn(async () => "fresh-id")
	const deps: ClaimHelperDeps = {
		operationJournal: journal as never,
		activeControllers,
		createFreshRecord,
		logger: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
		...overrides,
	}
	return { deps, journal, activeControllers, createFreshRecord }
}

function makeJournal() {
	const getOperation = vi.fn(async (_id: string) => null as unknown)
	const transitionOperation = vi.fn(async (_id: string, _progress: unknown, _error?: unknown) => undefined as unknown)
	return { getOperation, transitionOperation }
}

const INPUT_NO_QUEUED = {
	networkId: "net1",
	accountAddress: "0xabc",
	origin: ORIGIN,
	calls: [{ method: "drip_to_public" }],
}

describe("claimOrCreateDappExecuteJournal", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("no queuedJournalId → calls createFreshRecord, registers controller, returns the new id", async () => {
		const { deps, createFreshRecord, activeControllers, journal } = makeDeps()
		const result = await claimOrCreateDappExecuteJournal(deps, INPUT_NO_QUEUED)

		expect(createFreshRecord).toHaveBeenCalledOnce()
		expect(journal.getOperation).not.toHaveBeenCalled()
		expect(journal.transitionOperation).not.toHaveBeenCalled()
		expect(result.journalId).toBe("fresh-id")
		expect(result.controller).toBeInstanceOf(AbortController)
		expect(activeControllers.has("fresh-id")).toBe(true)
	})

	test("queuedJournalId set + record not found (reaped) → falls back to createFreshRecord", async () => {
		const { deps, createFreshRecord, activeControllers, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce(null)

		const result = await claimOrCreateDappExecuteJournal(deps, {
			...INPUT_NO_QUEUED,
			queuedJournalId: "reaped-id",
		})

		expect(journal.getOperation).toHaveBeenCalledWith("reaped-id")
		expect(createFreshRecord).toHaveBeenCalledOnce()
		expect(journal.transitionOperation).not.toHaveBeenCalled()
		expect(result.journalId).toBe("fresh-id")
		expect(activeControllers.has("fresh-id")).toBe(true)
		expect(activeControllers.has("reaped-id")).toBe(false)
	})

	test("queuedJournalId set + record at queued stage → claims via transitionOperation, registers controller", async () => {
		const { deps, createFreshRecord, activeControllers, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "queued" } })

		const result = await claimOrCreateDappExecuteJournal(deps, {
			...INPUT_NO_QUEUED,
			queuedJournalId: "queued-id",
		})

		expect(journal.transitionOperation).toHaveBeenCalledWith("queued-id", { stage: "pending" })
		expect(createFreshRecord).not.toHaveBeenCalled()
		expect(result.journalId).toBe("queued-id")
		expect(activeControllers.has("queued-id")).toBe(true)
	})

	// ── BLOCKER-1 (fix a): cross-account claim refusal (fail-closed) ──

	test("queued record account MATCHES the send → claims normally (check does not over-fire)", async () => {
		const { deps, createFreshRecord, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "queued" }, accountAddress: "0xabc" })

		const result = await claimOrCreateDappExecuteJournal(deps, { ...INPUT_NO_QUEUED, queuedJournalId: "queued-id" })

		expect(journal.transitionOperation).toHaveBeenCalledWith("queued-id", { stage: "pending" })
		expect(createFreshRecord).not.toHaveBeenCalled()
		expect(result.journalId).toBe("queued-id")
	})

	test("queued record account MISMATCHES the send → REFUSES the claim, creates a fresh correctly-scoped record", async () => {
		const { deps, createFreshRecord, activeControllers, journal } = makeDeps()
		// Session [A,B] mis-scoped this queued record to A (0xB), but the send is from 0xabc.
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "queued" }, accountAddress: "0xB" })

		const result = await claimOrCreateDappExecuteJournal(deps, { ...INPUT_NO_QUEUED, queuedJournalId: "mis-scoped-id" })

		// Never transitions the foreign record → foreign card never shows this send's progress.
		expect(journal.transitionOperation).not.toHaveBeenCalled()
		expect(createFreshRecord).toHaveBeenCalledOnce()
		expect(result.journalId).toBe("fresh-id")
		expect(activeControllers.has("fresh-id")).toBe(true)
	})

	test("mismatch WITH a reuseController → drops the mis-scoped pre-acquire entry before creating fresh", async () => {
		const { deps, createFreshRecord, activeControllers, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "queued" }, accountAddress: "0xB" })
		const preController = new AbortController()
		activeControllers.set("mis-scoped-id", preController)

		const result = await claimOrCreateDappExecuteJournal(deps, {
			...INPUT_NO_QUEUED,
			queuedJournalId: "mis-scoped-id",
			reuseController: preController,
		})

		expect(createFreshRecord).toHaveBeenCalledOnce()
		expect(activeControllers.has("mis-scoped-id")).toBe(false) // orphaned controller dropped
		expect(result.journalId).toBe("fresh-id")
	})

	// v3: pre-acquire controller reuse.
	test("reuseController set + record at queued → REUSES the pre-acquire controller (not a fresh one)", async () => {
		const { deps, activeControllers, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "queued" } })
		const preController = new AbortController()
		// Simulate the pre-acquire registration done by acquireExecutionSlot.
		activeControllers.set("queued-id", preController)

		const result = await claimOrCreateDappExecuteJournal(deps, {
			...INPUT_NO_QUEUED,
			queuedJournalId: "queued-id",
			reuseController: preController,
		})

		expect(result.controller).toBe(preController)
		expect(activeControllers.get("queued-id")).toBe(preController)
	})

	test("reuseController set + record reaped (not found) → drops the orphaned pre-acquire entry, creates fresh under the new id", async () => {
		const { deps, activeControllers, createFreshRecord, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce(null) // reaped
		createFreshRecord.mockResolvedValueOnce("fresh-id")
		const preController = new AbortController()
		activeControllers.set("queued-id", preController)

		const result = await claimOrCreateDappExecuteJournal(deps, {
			...INPUT_NO_QUEUED,
			queuedJournalId: "queued-id",
			reuseController: preController,
		})

		// The stale queuedJournalId entry is gone (no leak)...
		expect(activeControllers.has("queued-id")).toBe(false)
		// ...and a fresh controller is registered under the new id.
		expect(result.journalId).toBe("fresh-id")
		expect(activeControllers.has("fresh-id")).toBe(true)
		expect(result.controller).not.toBe(preController)
	})

	test("queuedJournalId set + record at cancelled stage → throws JobCancelledSentinel without transitioning", async () => {
		const { deps, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "cancelled" } })

		await expect(claimOrCreateDappExecuteJournal(deps, { ...INPUT_NO_QUEUED, queuedJournalId: "cancelled-id" })).rejects.toBeInstanceOf(
			JobCancelledSentinel,
		)
		expect(journal.transitionOperation).not.toHaveBeenCalled()
	})

	test("queuedJournalId set + record at failed stage → throws JobCancelledSentinel", async () => {
		const { deps, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "failed" } })

		await expect(claimOrCreateDappExecuteJournal(deps, { ...INPUT_NO_QUEUED, queuedJournalId: "failed-id" })).rejects.toBeInstanceOf(
			JobCancelledSentinel,
		)
	})

	test("transition fails + recheck shows cancelled → throws JobCancelledSentinel (cancel won the mutex race)", async () => {
		const { deps, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "queued" } })
		journal.transitionOperation.mockRejectedValueOnce(new Error("IllegalTransitionError: queued → pending"))
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "cancelled" } })

		await expect(claimOrCreateDappExecuteJournal(deps, { ...INPUT_NO_QUEUED, queuedJournalId: "raced-id" })).rejects.toBeInstanceOf(
			JobCancelledSentinel,
		)
		// Two getOperation calls: pre-claim + recheck after transition error.
		expect(journal.getOperation).toHaveBeenCalledTimes(2)
	})

	test("transition fails + recheck shows still queued → re-throws original error (storage failure, NOT cancelled)", async () => {
		const { deps, journal } = makeDeps()
		const storageErr = new Error("storage.set() failed: quota exceeded")
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "queued" } })
		journal.transitionOperation.mockRejectedValueOnce(storageErr)
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "queued" } })

		await expect(claimOrCreateDappExecuteJournal(deps, { ...INPUT_NO_QUEUED, queuedJournalId: "storage-fail" })).rejects.toBe(
			storageErr,
		)
		// Critical: NOT JobCancelledSentinel — preserving observability for
		// genuine storage failures (codex round-5).
	})

	test("controller is registered synchronously immediately after the await on transitionOperation resolves", async () => {
		const { deps, activeControllers, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "queued" } })
		// As soon as transitionOperation's `await` resolves, the next line
		// MUST be activeControllers.set(...). Test this by checking the map
		// is populated by the time the helper returns its resolved value.
		journal.transitionOperation.mockImplementationOnce(async () => {
			// At this point in the helper, activeControllers MUST NOT yet
			// have the controller — `set()` happens AFTER the await.
			expect(activeControllers.has("immediate-id")).toBe(false)
			return undefined
		})

		const result = await claimOrCreateDappExecuteJournal(deps, {
			...INPUT_NO_QUEUED,
			queuedJournalId: "immediate-id",
		})

		// After the helper returns, the controller is registered.
		expect(activeControllers.has("immediate-id")).toBe(true)
		expect(result.controller).toBe(activeControllers.get("immediate-id"))
	})

	test("returned controller is the same one stored in activeControllers (cancelJob path will find it)", async () => {
		const { deps, activeControllers, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "queued" } })

		const result = await claimOrCreateDappExecuteJournal(deps, {
			...INPUT_NO_QUEUED,
			queuedJournalId: "match-id",
		})
		expect(activeControllers.get("match-id")).toBe(result.controller)
	})

	test("createFreshRecord returning undefined → no controller registered", async () => {
		const { deps, activeControllers, createFreshRecord } = makeDeps()
		createFreshRecord.mockResolvedValueOnce(undefined)
		const result = await claimOrCreateDappExecuteJournal(deps, INPUT_NO_QUEUED)
		expect(result.journalId).toBeUndefined()
		expect(result.controller).toBeUndefined()
		expect(activeControllers.size).toBe(0)
	})

	test("queuedJournalId set + record already at PENDING → skips claim transition, registers controller (silent-path fast-forward)", async () => {
		// Silent path in DappInteractionService.execute pre-transitions
		// queued → pending so the UI doesn't show "Queued..." for a sendTx
		// that never opens a popup. The claim helper must recognize this
		// state and NOT throw + NOT re-transition + still register the
		// controller. Opus post-impl F7.
		const { deps, activeControllers, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "pending" } })

		const result = await claimOrCreateDappExecuteJournal(deps, {
			...INPUT_NO_QUEUED,
			queuedJournalId: "silent-prefast-id",
		})

		// No transitionOperation call — the record was already at pending.
		expect(journal.transitionOperation).not.toHaveBeenCalled()
		// Controller registered + returned, same as queued claim path.
		expect(result.journalId).toBe("silent-prefast-id")
		expect(activeControllers.has("silent-prefast-id")).toBe(true)
	})

	test("queuedJournalId set + record at simulating → throws JobCancelledSentinel (not a valid pre-claim state)", async () => {
		// `simulating` is past the pending pre-claim stages. The helper must
		// reject — silent-path only fast-forwards to pending, never past it.
		const { deps, journal } = makeDeps()
		journal.getOperation.mockResolvedValueOnce({ progress: { stage: "simulating" } })
		await expect(
			claimOrCreateDappExecuteJournal(deps, { ...INPUT_NO_QUEUED, queuedJournalId: "weird-stage-id" }),
		).rejects.toBeInstanceOf(JobCancelledSentinel)
	})
})
