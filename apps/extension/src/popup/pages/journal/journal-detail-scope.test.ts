import { describe, expect, test, vi } from "vitest"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import { bindJournalDetailUpdates, type JournalDetailScope, readJournalDetail } from "./journal-detail-scope"

const ID = "0123456789abcdef"
const ACCOUNT = `0x${"0a".repeat(32)}`
const OTHER_ACCOUNT = `0x${"0b".repeat(32)}`
const SCOPE: JournalDetailScope = { profileId: "p1", networkId: "testnet", accountAddress: ACCOUNT }

function failedSend(overrides: Partial<OperationRecord> = {}): OperationRecord {
	return {
		id: ID,
		kind: "transfer",
		origin: "popup",
		profileId: "p1",
		networkId: "testnet",
		accountAddress: ACCOUNT,
		progress: {
			stage: "failed",
			from: "submitting",
			txHash: `0x${"1f".repeat(32)}`,
			submittedEndpointUrl: "https://rpc.testnet.example",
		},
		error: { kind: "transfer", message: "fetch failed", normalizedRaw: null },
		terminalAt: 2,
		attempts: 0,
		createdAt: 1,
		updatedAt: 2,
		...overrides,
	}
}

function journalHolding(record: OperationRecord | undefined) {
	return { getOperation: vi.fn(async (_id: string) => record) }
}

/** An event source that exposes its listeners, so a test can see what a bind left behind. */
function eventSource<T>() {
	const listeners = new Set<(payload: T) => void>()
	return {
		listeners,
		add: (callback: (payload: T) => void) => {
			listeners.add(callback)
		},
		remove: (callback: (payload: T) => void) => {
			listeners.delete(callback)
		},
		invoke: (payload: T) => {
			for (const callback of listeners) callback(payload)
		},
	}
}

function journalEvents() {
	return { onOperationUpdated: eventSource<OperationRecord>(), onConnected: eventSource<void>() }
}

describe("readJournalDetail", () => {
	test("a record of the popup's profile, network and account is shown", async () => {
		const record = failedSend()
		const client = journalHolding(record)
		expect(await readJournalDetail(client, ID, () => SCOPE)).toBe(record)
		expect(client.getOperation).toHaveBeenCalledWith(ID)
	})

	test.each([
		["profile", { profileId: "p2" }],
		["network", { networkId: "mainnet" }],
		["account", { accountAddress: OTHER_ACCOUNT }],
	])("a record of another %s is not", async (_name, overrides) => {
		expect(await readJournalDetail(journalHolding(failedSend(overrides)), ID, () => SCOPE)).toBeUndefined()
	})

	test("a read that returns after a scope switch is judged against the new scope", async () => {
		let answer: (record: OperationRecord) => void = () => {}
		const client = { getOperation: vi.fn(() => new Promise<OperationRecord | undefined>((resolve) => (answer = resolve))) }
		let scope = SCOPE
		const read = readJournalDetail(client, ID, () => scope)
		scope = { ...SCOPE, accountAddress: OTHER_ACCOUNT }
		answer(failedSend())
		expect(await read).toBeUndefined()
	})

	test.each([
		["missing", undefined],
		["not an activity-feed kind", failedSend({ kind: "token_import" })],
		["still in flight", failedSend({ progress: { stage: "proving", enteredProveAt: 1 }, error: null, terminalAt: null })],
	])("a record that is %s is not shown", async (_name, record) => {
		expect(await readJournalDetail(journalHolding(record), ID, () => SCOPE)).toBeUndefined()
	})
})

describe("bindJournalDetailUpdates", () => {
	test("an update to its record and a reconnect each reload it; another record's update does not", () => {
		const client = journalEvents()
		const reload = vi.fn()
		bindJournalDetailUpdates(client, () => ID, reload)

		client.onOperationUpdated.invoke(failedSend({ id: "fedcba9876543210" }))
		expect(reload).not.toHaveBeenCalled()
		client.onOperationUpdated.invoke(failedSend())
		expect(reload).toHaveBeenCalledTimes(1)
		client.onConnected.invoke()
		expect(reload).toHaveBeenCalledTimes(2)
	})

	test("after the unbind neither listener remains and neither event reloads", () => {
		const client = journalEvents()
		const reload = vi.fn()
		const unbind = bindJournalDetailUpdates(client, () => ID, reload)
		expect(client.onOperationUpdated.listeners.size).toBe(1)
		expect(client.onConnected.listeners.size).toBe(1)

		unbind()
		expect(client.onOperationUpdated.listeners.size).toBe(0)
		expect(client.onConnected.listeners.size).toBe(0)
		client.onOperationUpdated.invoke(failedSend())
		client.onConnected.invoke()
		expect(reload).not.toHaveBeenCalled()
	})
})
