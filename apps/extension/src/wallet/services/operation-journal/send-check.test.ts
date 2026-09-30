/**
 * The check behind a failed send that may have reached the network: what it reads and where, when
 * it answers, and what it refuses to do once the row's profile is locked, the row is gone or the
 * check has stopped. Fakes only; receipts are shaped as `AztecNode.getTxReceipt` answers them.
 */
import { describe, expect, test, vi } from "vitest"
import type { SendCheckOutcome } from "@nulo/wallet-core/jobs"
import { MockClock } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ExecutionFence } from "@/wallet/services/profile/profile-deletion-state"
import { DROPPED_RESURRECTION_WINDOW_MS } from "@/wallet/services/transaction/service"
import { SEND_CHECK_TICK_MS, SendCheck } from "./send-check"
import type { OperationFilter, OperationRecord } from "./service"

const T0 = 1_750_000_000_000
// Below the field modulus, so `TxHash.fromString` parses them.
const HASH = `0x${"1f".repeat(32)}`
const OTHER_HASH = `0x${"2e".repeat(32)}`
const URL = "https://rpc.submit.example"
const ACCOUNT = `0x${"0c".repeat(32)}`

function failedRow(overrides: Partial<OperationRecord> = {}): OperationRecord {
	return {
		id: "op-1",
		kind: "transfer",
		origin: "popup",
		profileId: "p1",
		progress: { stage: "failed", from: "submitting", txHash: HASH, submittedEndpointUrl: URL },
		error: { kind: "transfer", message: "fetch failed", normalizedRaw: null },
		terminalAt: T0,
		attempts: 0,
		createdAt: T0 - 90_000,
		updatedAt: T0,
		accountAddress: ACCOUNT,
		networkId: "net1",
		...overrides,
	}
}

const reaped = { kind: "stale_on_resume", message: "Job declared lost", normalizedRaw: null }

const mined = (status: string, executionResult = "success") => ({
	txHash: HASH,
	status,
	executionResult,
	transactionFee: 1234n,
	blockHash: `0x${"b1".repeat(32)}`,
	blockNumber: 42,
	slotNumber: 42,
	txIndexInBlock: 0,
	epochNumber: 1,
})
const dropped = () => ({ txHash: HASH, status: "dropped", error: "Tx dropped by P2P node" })
const pending = () => ({ txHash: HASH, status: "pending" })

function deferred<T>() {
	let resolve: (value: T) => void = () => {}
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** The journal surface the check uses, over a Map. `holdLock` models its transition lock held by
 *  another writer: `setSendCheck` waits for the release before it judges the row and `isLive`. */
class FakeJournal {
	public readonly onOperationUpdated = new EventHandler<OperationRecord>()
	public readonly onOperationDeleted = new EventHandler<OperationRecord>()
	public readonly writes: { id: string; check: SendCheckOutcome }[] = []
	private readonly rows = new Map<string, OperationRecord>()
	private lockHeld: Promise<void> | undefined

	public constructor(rows: OperationRecord[]) {
		for (const row of rows) this.rows.set(row.id, row)
	}

	public async getOperation(id: string): Promise<OperationRecord | undefined> {
		return this.rows.get(id)
	}

	public async getOperations(filter?: OperationFilter): Promise<OperationRecord[]> {
		return [...this.rows.values()].filter((op) => filter?.stage === undefined || op.progress.stage === filter.stage)
	}

	public async setSendCheck(id: string, txHash: string, check: SendCheckOutcome, isLive: () => boolean): Promise<boolean> {
		await this.lockHeld
		const row = this.rows.get(id)
		if (row?.progress.stage !== "failed") return false
		if (row.progress.txHash !== txHash || row.progress.check !== undefined || !isLive()) return false
		const updated: OperationRecord = { ...row, progress: { ...row.progress, check } }
		this.rows.set(id, updated)
		this.writes.push({ id, check })
		this.onOperationUpdated.invoke(updated)
		return true
	}

	/** Another writer's transition, as the reaper's lands. */
	public put(row: OperationRecord): void {
		this.rows.set(row.id, row)
		this.onOperationUpdated.invoke(row)
	}

	public remove(id: string): void {
		const row = this.rows.get(id)
		if (!row) return
		this.rows.delete(id)
		this.onOperationDeleted.invoke(row)
	}

	public holdLock(): () => void {
		const held = deferred<void>()
		this.lockHeld = held.promise
		return () => {
			this.lockHeld = undefined
			held.resolve()
		}
	}
}

function makeHarness(rows: OperationRecord[] = [failedRow()]) {
	const clock = new MockClock(T0)
	const journal = new FakeJournal(rows)
	let serial = 1
	let session: { profileId: string; serial: number } | undefined = { profileId: "p1", serial }
	const profile = {
		captureExecutionFence: vi.fn(async (): Promise<ExecutionFence> => {
			if (!session) throw new Error("Wallet locked")
			return { profileId: session.profileId, epoch: 0, session: session.serial }
		}),
		isFenceLive: (fence: ExecutionFence) => session?.serial === fence.session && session.profileId === fence.profileId,
	}
	const getTxReceipt = vi.fn(async (_hash: { toString(): string }): Promise<unknown> => pending())
	const network = {
		getSingleAttemptNodeForUrl: vi.fn(async (_url: string) => ({ getTxReceipt }) as never),
		getNodeForUrl: vi.fn(),
		getNode: vi.fn(),
	}
	const balances = { refreshAccountBalances: vi.fn(async (_account: string) => {}) }
	const logs: unknown[][] = []
	const logger = {
		log: (...args: unknown[]) => {
			logs.push(args)
		},
	}
	const check = new SendCheck({ journal, network, profile, balances, logger, clock })
	return {
		check,
		clock,
		journal,
		profile,
		network,
		getTxReceipt,
		balances,
		logs,
		lock: () => {
			session = undefined
		},
		unlock: (profileId = "p1") => {
			serial += 1
			session = { profileId, serial }
		},
		/** `count` firings of the check's timer, each followed by everything it settles. */
		tick: async (count = 1) => {
			for (let i = 0; i < count; i++) {
				clock.advance(SEND_CHECK_TICK_MS)
				await settle()
			}
		},
	}
}

const watched = (check: SendCheck) => (check as unknown as { watches: Map<string, unknown> }).watches.size

describe("SendCheck: the answer", () => {
	test.each(["proposed", "checkpointed", "proven", "finalized"])(
		"a %s receipt that succeeded writes sent once and refreshes the account",
		async (status) => {
			const h = makeHarness()
			h.getTxReceipt.mockResolvedValue(mined(status))
			await h.check.start()
			await h.tick()
			expect(h.journal.writes).toEqual([{ id: "op-1", check: "sent" }])
			expect(h.balances.refreshAccountBalances).toHaveBeenCalledWith(ACCOUNT)
			await h.tick(3)
			expect(h.getTxReceipt).toHaveBeenCalledTimes(1)
		},
	)

	test("a mined receipt that reverted writes reverted and refreshes the account", async () => {
		const h = makeHarness()
		h.getTxReceipt.mockResolvedValue(mined("checkpointed", "reverted"))
		await h.check.start()
		await h.tick()
		expect(h.journal.writes).toEqual([{ id: "op-1", check: "reverted" }])
		expect(h.balances.refreshAccountBalances).toHaveBeenCalledWith(ACCOUNT)
	})

	test.each([
		["DROPPED", dropped],
		["Pending", pending],
	])("%s is never an answer: every tick for two minutes, then every 15 s", async (_label, receipt) => {
		const h = makeHarness()
		h.getTxReceipt.mockImplementation(async () => receipt())
		await h.check.start()
		await h.tick(24)
		expect(h.getTxReceipt).toHaveBeenCalledTimes(24)
		await h.tick(12)
		expect(h.getTxReceipt).toHaveBeenCalledTimes(28)
		expect(h.journal.writes).toEqual([])
		expect(h.balances.refreshAccountBalances).not.toHaveBeenCalled()
	})

	test("a receipt read that throws is no answer: the row is read again at the same cadence", async () => {
		const h = makeHarness()
		h.getTxReceipt.mockRejectedValue(new Error("fetch failed"))
		await h.check.start()
		await h.tick(36)
		expect(h.getTxReceipt).toHaveBeenCalledTimes(28)
		expect(h.journal.writes).toEqual([])
	})
})

describe("SendCheck: the window's last read", () => {
	const nearTheEnd = () => failedRow({ terminalAt: T0 - DROPPED_RESURRECTION_WINDOW_MS + 20_000 })

	test.each([
		["DROPPED", async () => dropped()],
		["no answer", async () => Promise.reject(new Error("fetch failed"))],
	])("%s at the first read past thirty minutes writes unconfirmed, and the watch ends", async (_label, answer) => {
		const h = makeHarness([nearTheEnd()])
		h.getTxReceipt.mockImplementation(answer)
		await h.check.start()
		await h.tick(3)
		expect(h.getTxReceipt).toHaveBeenCalledTimes(1)
		expect(h.journal.writes).toEqual([])
		await h.tick()
		expect(h.journal.writes).toEqual([{ id: "op-1", check: "unconfirmed" }])
		expect(h.balances.refreshAccountBalances).not.toHaveBeenCalled()
		await h.tick(6)
		expect(h.getTxReceipt).toHaveBeenCalledTimes(2)
	})

	test("a mined answer at the last read wins", async () => {
		const h = makeHarness([failedRow({ terminalAt: T0 - DROPPED_RESURRECTION_WINDOW_MS })])
		h.getTxReceipt.mockResolvedValue(mined("proven"))
		await h.check.start()
		await h.tick()
		expect(h.journal.writes).toEqual([{ id: "op-1", check: "sent" }])
	})
})

describe("SendCheck: where it dials", () => {
	test("the receipt is read on the row's recorded endpoint, for the row's hash, never the active node", async () => {
		const h = makeHarness()
		await h.check.start()
		await h.tick()
		expect(h.network.getSingleAttemptNodeForUrl).toHaveBeenCalledWith(URL)
		expect(h.getTxReceipt.mock.calls[0]?.[0].toString()).toBe(HASH)
		expect(h.network.getNodeForUrl).not.toHaveBeenCalled()
		expect(h.network.getNode).not.toHaveBeenCalled()
	})

	test("a row with no recorded endpoint is written unconfirmed without a dial", async () => {
		const h = makeHarness([failedRow({ progress: { stage: "failed", from: "submitting", txHash: HASH } })])
		await h.check.start()
		await h.tick()
		expect(h.journal.writes).toEqual([{ id: "op-1", check: "unconfirmed" }])
		expect(h.network.getSingleAttemptNodeForUrl).not.toHaveBeenCalled()
	})

	test("a row of another profile waits, undialed, until that profile is the unlocked one", async () => {
		const h = makeHarness([failedRow({ profileId: "p2" })])
		await h.check.start()
		await h.tick(3)
		expect(h.network.getSingleAttemptNodeForUrl).not.toHaveBeenCalled()
		h.unlock("p2")
		await h.tick()
		expect(h.network.getSingleAttemptNodeForUrl).toHaveBeenCalledTimes(1)
	})

	test("restart, locked, unlock, resume: nothing is dialed while locked, then the row is read at once", async () => {
		const h = makeHarness([failedRow({ terminalAt: T0 - 3 * 60_000, error: reaped })])
		h.lock()
		await h.check.start()
		await h.tick(4)
		expect(h.profile.captureExecutionFence).toHaveBeenCalledTimes(4)
		expect(h.network.getSingleAttemptNodeForUrl).not.toHaveBeenCalled()
		h.unlock()
		await h.tick()
		expect(h.network.getSingleAttemptNodeForUrl).toHaveBeenCalledTimes(1)
	})
})

describe("SendCheck: one guard on every dial and write", () => {
	test("a lock while the node is looked up: no receipt read, no write, no refresh", async () => {
		const h = makeHarness()
		h.getTxReceipt.mockResolvedValue(mined("proven"))
		const node = deferred<never>()
		h.network.getSingleAttemptNodeForUrl.mockImplementationOnce(() => node.promise)
		await h.check.start()
		await h.tick()
		h.lock()
		node.resolve({ getTxReceipt: h.getTxReceipt } as never)
		await h.tick(3)
		expect(h.network.getSingleAttemptNodeForUrl).toHaveBeenCalledTimes(1)
		expect(h.getTxReceipt).not.toHaveBeenCalled()
		expect(h.journal.writes).toEqual([])
		expect(h.balances.refreshAccountBalances).not.toHaveBeenCalled()
	})

	test("a lock while the receipt is read: its answer is dropped, no write, no refresh", async () => {
		const h = makeHarness()
		const receipt = deferred<unknown>()
		h.getTxReceipt.mockImplementationOnce(() => receipt.promise)
		await h.check.start()
		await h.tick()
		h.lock()
		receipt.resolve(mined("proven"))
		await h.tick(3)
		expect(h.getTxReceipt).toHaveBeenCalledTimes(1)
		expect(h.journal.writes).toEqual([])
		expect(h.balances.refreshAccountBalances).not.toHaveBeenCalled()
	})

	test("a lock and an unlock while the write waits for the journal: written once, on the next live tick", async () => {
		const h = makeHarness()
		h.getTxReceipt.mockResolvedValue(mined("proven"))
		const release = h.journal.holdLock()
		await h.check.start()
		await h.tick()
		h.lock()
		h.unlock()
		release()
		await settle()
		expect(h.journal.writes).toEqual([])
		await h.tick()
		expect(h.journal.writes).toEqual([{ id: "op-1", check: "sent" }])
		expect(h.balances.refreshAccountBalances).toHaveBeenCalledTimes(1)
		await h.tick(3)
		expect(h.getTxReceipt).toHaveBeenCalledTimes(2)
	})

	test("stop() while the write waits for the journal: nothing written, nothing left watched", async () => {
		const h = makeHarness()
		h.getTxReceipt.mockResolvedValue(mined("proven"))
		const release = h.journal.holdLock()
		await h.check.start()
		await h.tick()
		h.check.stop()
		release()
		await h.tick(3)
		expect(h.journal.writes).toEqual([])
		expect(h.balances.refreshAccountBalances).not.toHaveBeenCalled()
		expect(h.getTxReceipt).toHaveBeenCalledTimes(1)
		expect(h.clock.pendingCount).toBe(0)
		expect(watched(h.check)).toBe(0)
	})

	test("a read that settles after stop() writes nothing", async () => {
		const h = makeHarness()
		const receipt = deferred<unknown>()
		h.getTxReceipt.mockImplementationOnce(() => receipt.promise)
		await h.check.start()
		await h.tick()
		expect(h.getTxReceipt).toHaveBeenCalledTimes(1)
		h.check.stop()
		receipt.resolve(mined("proven"))
		await settle()
		expect(h.journal.writes).toEqual([])
		expect(h.balances.refreshAccountBalances).not.toHaveBeenCalled()
	})

	test("a row deleted between reads is never dialed again", async () => {
		const h = makeHarness()
		await h.check.start()
		await h.tick()
		h.journal.remove("op-1")
		await h.tick(6)
		expect(h.network.getSingleAttemptNodeForUrl).toHaveBeenCalledTimes(1)
	})

	test("a row deleted while its node is looked up is not read", async () => {
		const h = makeHarness()
		const node = deferred<never>()
		h.network.getSingleAttemptNodeForUrl.mockImplementationOnce(() => node.promise)
		await h.check.start()
		await h.tick()
		expect(h.network.getSingleAttemptNodeForUrl).toHaveBeenCalledTimes(1)
		h.journal.remove("op-1")
		node.resolve({ getTxReceipt: h.getTxReceipt } as never)
		await settle()
		expect(h.getTxReceipt).not.toHaveBeenCalled()
	})

	test("a read slower than two ticks is never overlapped", async () => {
		const h = makeHarness()
		const receipt = deferred<unknown>()
		h.getTxReceipt.mockImplementationOnce(() => receipt.promise)
		await h.check.start()
		await h.tick(3)
		expect(h.getTxReceipt).toHaveBeenCalledTimes(1)
		receipt.resolve(pending())
		await settle()
		await h.tick()
		expect(h.getTxReceipt).toHaveBeenCalledTimes(2)
	})
})

describe("SendCheck: which rows it watches", () => {
	test("start() resumes the unanswered rows only: one inside its window, due at once, and one past it for its last read", async () => {
		const inside = failedRow({ id: "inside", terminalAt: T0 - 10 * 60_000, error: reaped })
		const past = failedRow({
			id: "past",
			terminalAt: T0 - 40 * 60_000,
			progress: { stage: "failed", from: "submitting", txHash: OTHER_HASH, submittedEndpointUrl: URL },
		})
		const answered = failedRow({
			id: "answered",
			progress: { stage: "failed", from: "submitting", txHash: HASH, submittedEndpointUrl: URL, check: "sent" },
		})
		const neverSent = failedRow({ id: "never-sent", progress: { stage: "failed", from: "proving" } })
		const h = makeHarness([inside, past, answered, neverSent])
		h.getTxReceipt.mockImplementation(async () => dropped())
		await h.check.start()
		await h.tick()
		expect(h.getTxReceipt.mock.calls.map(([hash]) => hash.toString()).sort()).toEqual([HASH, OTHER_HASH].sort())
		expect(h.journal.writes).toEqual([{ id: "past", check: "unconfirmed" }])
	})

	test("a row the reaper fails at submitting after start() is watched", async () => {
		const h = makeHarness([])
		await h.check.start()
		h.journal.put(failedRow({ error: reaped }))
		await h.tick()
		expect(h.network.getSingleAttemptNodeForUrl).toHaveBeenCalledWith(URL)
	})
})

describe("SendCheck: logging", () => {
	test("no log line, at any level, carries the hash or the endpoint", async () => {
		const h = makeHarness()
		h.getTxReceipt.mockRejectedValueOnce(new Error(`receipt for ${HASH} from ${URL} failed`))
		h.getTxReceipt.mockResolvedValueOnce(mined("proven"))
		await h.check.start()
		await h.tick(2)
		expect(h.journal.writes).toEqual([{ id: "op-1", check: "sent" }])
		expect(h.logs.length).toBeGreaterThan(0)
		const text = JSON.stringify(h.logs, (_key, value: unknown) => {
			if (value instanceof Error) return { message: value.message, stack: value.stack }
			return typeof value === "bigint" ? value.toString() : value
		})
		expect(text).not.toContain(HASH.slice(0, 10))
		expect(text).not.toContain(URL)
	})
})
