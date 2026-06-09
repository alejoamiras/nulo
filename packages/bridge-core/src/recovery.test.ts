import { describe, expect, it } from "vitest"
import {
	DEPOSITS_KEY,
	type DepositRecord,
	findDeposit,
	findWithdrawal,
	type KV,
	loadDeposits,
	loadWithdrawals,
	removeRecord,
	updateRecord,
	upsertRecord,
	type WithdrawalRecord,
} from "./recovery"

function memKV(): KV {
	const store = new Map<string, string>()
	return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }
}

const dep = (id: string, over: Partial<DepositRecord> = {}): DepositRecord => ({
	id,
	direction: "l1ToL2",
	token: "0xUSDC",
	amount: "1000000",
	aztecRecipient: "0xrecip",
	isPrivate: false,
	secretHashHex: "0xsh",
	encryptedSecret: "blob",
	stage: "deposited",
	createdAt: 1,
	...over,
})

describe("recovery", () => {
	it("empty store yields empty arrays", () => {
		const kv = memKV()
		expect(loadDeposits(kv)).toEqual([])
		expect(loadWithdrawals(kv)).toEqual([])
	})

	it("upsert + load round-trips", () => {
		const kv = memKV()
		upsertRecord(kv, dep("a"))
		expect(loadDeposits(kv)).toHaveLength(1)
		expect(findDeposit(kv, "a")?.amount).toBe("1000000")
	})

	it("upsert replaces by id (no dupes)", () => {
		const kv = memKV()
		upsertRecord(kv, dep("a", { amount: "1" }))
		upsertRecord(kv, dep("a", { amount: "2" }))
		expect(loadDeposits(kv)).toHaveLength(1)
		expect(findDeposit(kv, "a")?.amount).toBe("2")
	})

	it("updateRecord patches stage + fields", () => {
		const kv = memKV()
		upsertRecord(kv, dep("a"))
		updateRecord(kv, DEPOSITS_KEY, "a", { stage: "claimed", messageLeafIndex: "7" })
		const r = findDeposit(kv, "a")
		expect(r?.stage).toBe("claimed")
		expect(r?.messageLeafIndex).toBe("7")
	})

	it("updateRecord on a missing id is a no-op", () => {
		const kv = memKV()
		upsertRecord(kv, dep("a"))
		updateRecord(kv, DEPOSITS_KEY, "ghost", { stage: "claimed" })
		expect(findDeposit(kv, "a")?.stage).toBe("deposited")
	})

	it("removeRecord drops the entry", () => {
		const kv = memKV()
		upsertRecord(kv, dep("a"))
		upsertRecord(kv, dep("b"))
		removeRecord(kv, DEPOSITS_KEY, "a")
		expect(loadDeposits(kv).map((r) => r.id)).toEqual(["b"])
	})

	it("deposits + withdrawals use separate keys", () => {
		const kv = memKV()
		upsertRecord(kv, dep("a"))
		const w: WithdrawalRecord = {
			id: "w",
			direction: "l2ToL1",
			recipientL1: "0xL1",
			amount: "5",
			encryptedSecret: "b",
			isPrivate: true,
			stage: "burned",
			createdAt: 2,
		}
		upsertRecord(kv, w)
		expect(loadDeposits(kv)).toHaveLength(1)
		expect(loadWithdrawals(kv)).toHaveLength(1)
		expect(findWithdrawal(kv, "w")?.recipientL1).toBe("0xL1")
	})

	it("tolerates corrupt JSON (returns empty)", () => {
		const kv = memKV()
		kv.setItem(DEPOSITS_KEY, "{not json")
		expect(loadDeposits(kv)).toEqual([])
	})

	it("preserves large amounts as strings (bigint-safe)", () => {
		const kv = memKV()
		const big = "123456789012345678901234567890"
		upsertRecord(kv, dep("a", { amount: big }))
		expect(findDeposit(kv, "a")?.amount).toBe(big)
	})
})
