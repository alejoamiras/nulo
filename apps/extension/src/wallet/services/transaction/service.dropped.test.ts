/**
 * DROPPED-receipt debounce + resurrection pins for `TransactionService`.
 *
 * `getTxReceipt` answers DROPPED for any hash the queried node does not know,
 * so behind a load-balanced RPC a just-submitted tx transiently reads as
 * dropped (observed live: a confirmed testnet tx persisted as Dropped 667ms
 * after a successful `sendTx`). These tests pin the three defenses: the
 * submission grace window, the consecutive-observation threshold, and the
 * in-session resurrection watch — plus the D16-parity rule that Dropped rows
 * are never re-armed from storage.
 *
 * Real service lifecycle over `svc()` stubs; fake timers drive the 1s sync
 * worker tick-by-tick (each 1000ms advance = one poll of every due tx).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { ACCOUNT_SERVICE_NAME } from "@/wallet/services/account/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { ProfileDeletionState } from "@/wallet/services/profile/profile-deletion-state"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { svc } from "../composition-harness"
import {
	DROPPED_GRACE_MS,
	DROPPED_RECHECK_INTERVAL_MS,
	DROPPED_RESURRECTION_WINDOW_MS,
	TRANSACTION_STORAGE_ROOT,
	TransactionService,
	TxExecutionResult,
	TxStatus,
	isDroppedFinal,
	type Tx,
} from "./service"

const ACCOUNT = "0xacc"
const ENDPOINT = "https://rpc.example.test"
const HASH = `0x${"11".repeat(32)}`

const dropped = () => ({ status: "dropped", error: "Tx dropped by P2P node" })
const stillPending = () => ({ status: "pending" })
const mined = () => ({
	status: "proposed",
	executionResult: "success",
	blockHash: { toString: () => "0xb10c" },
	blockNumber: 7,
	transactionFee: 123n,
})

describe("TransactionService — DROPPED debounce + resurrection", () => {
	let api: FakeBrowserApi
	let service: TransactionService
	let updates: Tx[]
	// Per-tick receipt script: shift from the queue, else serve the default.
	let receiptQueue: unknown[]
	let defaultReceipt: () => unknown
	let getTxReceipt: ReturnType<typeof vi.fn>

	const buildService = async () => {
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, { getActiveProfile: async () => ({ id: "p1" }), getDeletionState: () => new ProfileDeletionState() }),
		)
		services.add(
			svc(ACCOUNT_SERVICE_NAME, {
				onAccountDeleted: new EventHandler(),
				getAccount: async () => undefined,
				// Two profiles share ACCOUNT (same-seed derivation) so a scoped purge
				// takes the not-sole-owner ambiguous-marking path.
				getAccountsByAddress: async () => [
					{ profileId: "p1", address: ACCOUNT },
					{ profileId: "p2", address: ACCOUNT },
				],
			}),
		)
		services.add(
			svc(NETWORK_SERVICE_NAME, {
				getNodeForUrl: async () => ({ getTxReceipt }),
				getNode: async () => ({ getTxReceipt }),
				reportEndpointFailure: () => {},
			}),
		)
		const built = new TransactionService(new LoggerStore(new ConfigStore()), api)
		services.add(built)
		await services.start()
		return built
	}

	beforeEach(async () => {
		vi.useFakeTimers()
		api = new FakeBrowserApi()
		api.reset()
		receiptQueue = []
		defaultReceipt = dropped
		getTxReceipt = vi.fn(async () => (receiptQueue.length ? receiptQueue.shift() : defaultReceipt()))
		service = await buildService()
		updates = []
		service.onTransactionUpdated.add((tx) => updates.push({ ...tx }))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	const add = (hash = HASH) => service.addTransaction({ type: 0 } as never, 1, ACCOUNT, [], "0", 0 as never, hash, ENDPOINT)
	const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms)

	test("DROPPED inside the grace window never finalizes; past grace + streak it does", async () => {
		await add()

		// 10 consecutive dropped answers, all inside the grace window: the streak
		// threshold alone must NOT finalize.
		await tick(10_000)
		expect(getTxReceipt.mock.calls.length).toBeGreaterThanOrEqual(9)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Pending)
		expect(updates).toHaveLength(0)

		// Cross the grace boundary (still consistently dropped) → terminal.
		await tick(DROPPED_GRACE_MS - 10_000 + 2_000)
		const tx = await service.getTransaction(HASH)
		expect(tx.status).toBe(TxStatus.Dropped)
		expect(tx.error).toBe("Tx dropped by P2P node")
		expect(updates).toHaveLength(1)
		expect(service.getPendingForAccount(ACCOUNT)).toHaveLength(0)
	})

	test("streak must be CONSECUTIVE — any non-dropped answer resets it", async () => {
		defaultReceipt = stillPending
		await add()
		// Age the tx past the grace window on pending answers.
		await tick(DROPPED_GRACE_MS + 2_000)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Pending)

		// dropped ×2, then a pending answer (reset), then dropped ×2 → still short
		// of the 3-consecutive threshold at every point.
		receiptQueue = [dropped(), dropped(), stillPending(), dropped(), dropped()]
		await tick(5_000)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Pending)

		// A third consecutive dropped finalizes.
		receiptQueue = [dropped()]
		await tick(1_000)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Dropped)
	})

	test("a late mine RESURRECTS a dropped tx within the watch window", async () => {
		await add()
		await tick(DROPPED_GRACE_MS + 2_000)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Dropped)

		defaultReceipt = mined
		await tick(DROPPED_RECHECK_INTERVAL_MS + 1_000)

		const tx = await service.getTransaction(HASH)
		expect(tx.status).toBe(TxStatus.Proposed)
		expect(tx.executionResult).toBe(TxExecutionResult.Success)
		expect(tx.block).toEqual({ hash: "0xb10c", number: 7 })
		expect(tx.fee).toBe("123")
		expect(tx.error).toBeUndefined()
	})

	test("the watch expires: a mine surfacing after the window does NOT resurrect", async () => {
		await add()
		await tick(DROPPED_GRACE_MS + 2_000)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Dropped)

		// Ride out the whole resurrection window on dropped answers.
		await tick(DROPPED_RESURRECTION_WINDOW_MS + 5_000)
		const callsAfterExpiry = getTxReceipt.mock.calls.length

		// Expiry re-emits the row unchanged as the "Dropped is now FINAL" signal
		// destructive consumers (authwit reconcile-removal) gate on.
		expect(updates).toHaveLength(2)
		expect(updates[1].status).toBe(TxStatus.Dropped)
		expect(isDroppedFinal(updates[1])).toBe(true)

		defaultReceipt = mined
		await tick(60_000)
		expect(getTxReceipt.mock.calls.length).toBe(callsAfterExpiry)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Dropped)
	})

	test("a watched tx whose receipt reads PENDING re-arms into the fast poller", async () => {
		await add()
		await tick(DROPPED_GRACE_MS + 2_000)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Dropped)

		// The pool sees it again: the next recheck flips the row back to Pending
		// AND resumes every-tick polling — it must not strand in neither map.
		defaultReceipt = stillPending
		await tick(DROPPED_RECHECK_INTERVAL_MS + 1_000)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Pending)
		expect(service.getPendingForAccount(ACCOUNT)).toHaveLength(1)

		defaultReceipt = mined
		await tick(2_000)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Proposed)
	})

	test("an in-flight receipt resolving after purge cannot resurrect the row", async () => {
		await add()
		let release = () => {}
		const gate = new Promise<void>((r) => {
			release = r
		})
		getTxReceipt.mockImplementationOnce(async () => {
			await gate
			return mined()
		})
		// The poll starts and parks on the gate mid-tick.
		await tick(1_000)
		await service.purgeForAccounts([ACCOUNT])
		expect(await service.getTransactions(ACCOUNT)).toHaveLength(0)

		release()
		await tick(0)
		expect(await service.getTransactions(ACCOUNT)).toHaveLength(0)
		expect(updates).toHaveLength(0)
	})

	test("isDroppedFinal: only an aged Dropped row is final", () => {
		const young = { status: TxStatus.Dropped, updatedAt: Date.now() }
		expect(isDroppedFinal(young)).toBe(false)
		expect(isDroppedFinal({ ...young, updatedAt: Date.now() - DROPPED_RESURRECTION_WINDOW_MS - 1_000 })).toBe(true)
		expect(isDroppedFinal({ status: TxStatus.Pending, updatedAt: 0 })).toBe(false)
	})

	test("non-dropped transitions are untouched by the debounce", async () => {
		receiptQueue = [stillPending(), stillPending(), mined()]
		defaultReceipt = mined
		await add()
		await tick(3_000)

		const tx = await service.getTransaction(HASH)
		expect(tx.status).toBe(TxStatus.Proposed)
		expect(tx.executionResult).toBe(TxExecutionResult.Success)
		expect(service.getPendingForAccount(ACCOUNT)).toHaveLength(0)
	})

	test("purge clears the resurrection watch — a purged tx cannot come back", async () => {
		await add()
		await tick(DROPPED_GRACE_MS + 2_000)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Dropped)

		await service.purgeForAccounts([ACCOUNT])
		const callsAfterPurge = getTxReceipt.mock.calls.length

		defaultReceipt = mined
		await tick(DROPPED_RECHECK_INTERVAL_MS * 2)
		expect(getTxReceipt.mock.calls.length).toBe(callsAfterPurge)
		expect(await service.getTransactions(ACCOUNT)).toHaveLength(0)
	})

	test("ambiguous-marking evicts a dropped tx from the watch — no poll, no un-marking", async () => {
		await add()
		await tick(DROPPED_GRACE_MS + 2_000)
		expect((await service.getTransaction(HASH)).status).toBe(TxStatus.Dropped)

		// Deleting profile p1 while p2 shares the address: the unscoped row is
		// marked ambiguous instead of deleted. It must leave the watch — a late
		// mine may NOT resurrect it (the write would erase the ambiguous flag).
		await service.purgeForAccounts([ACCOUNT], "p1")
		expect((await service.getTransaction(HASH)).ambiguous).toBe(true)

		const callsAfterMark = getTxReceipt.mock.calls.length
		defaultReceipt = mined
		await tick(DROPPED_RECHECK_INTERVAL_MS * 2)
		expect(getTxReceipt.mock.calls.length).toBe(callsAfterMark)
		const after = await service.getTransaction(HASH)
		expect(after.status).toBe(TxStatus.Dropped)
		expect(after.ambiguous).toBe(true)
	})

	test("Dropped rows are NOT re-armed from storage on restart (D16 parity)", async () => {
		// A freshly-dropped row already in storage (as after a SW restart — or a
		// restored backup, whose `submittedEndpointUrl` is attacker-controlled).
		const hash2 = `0x${"22".repeat(32)}`
		const row: Tx = {
			chainId: 1,
			account: ACCOUNT,
			nonce: "0",
			feePaymentMethod: 0 as never,
			hash: hash2,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			status: TxStatus.Dropped,
			error: "Tx dropped by P2P node",
			origin: { type: 0 } as never,
			calls: [],
			submittedEndpointUrl: ENDPOINT,
		}
		await api.storage.local.set({ [`${TRANSACTION_STORAGE_ROOT}@${hash2}`]: JSON.stringify(row) })

		const restarted = await buildService()
		defaultReceipt = mined
		getTxReceipt.mockClear()
		await tick(60_000)

		expect(getTxReceipt).not.toHaveBeenCalled()
		expect((await restarted.getTransaction(hash2)).status).toBe(TxStatus.Dropped)
	})
})
