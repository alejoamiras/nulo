import { describe, expect, it } from "vitest"
import {
	type BridgeJournalRecord,
	type DepositJournalRecord,
	type KV,
	type WithdrawJournalRecord,
	JOURNAL_KEY,
	LEGACY_KEYS,
	MAX_RECORDS,
	assetKindOf,
	capRecords,
	clearLegacyKeys,
	deriveDepositStage,
	deriveWithdrawStage,
	loadJournal,
	patchRecord,
	pruneCompleted,
	rekeyRecord,
	removeRecord,
	upsertRecord,
} from "./journal"

function memKV(initial: Record<string, string> = {}): KV & { store: Map<string, string> } {
	const store = new Map(Object.entries(initial))
	return {
		store,
		getItem: (k) => store.get(k) ?? null,
		setItem: (k, v) => void store.set(k, v),
		removeItem: (k) => void store.delete(k),
	}
}

const DEPLOY = { chainId: 11155111, portal: "0xportal", bridge: "0xbridge" }

function deposit(id: string, over: Partial<DepositJournalRecord> = {}): DepositJournalRecord {
	return {
		schema: 1,
		id,
		direction: "deposit",
		isPrivate: false,
		amount: "100",
		createdAt: 1,
		updatedAt: 1,
		recipient: "0xaztec",
		secretHashHex: id,
		...DEPLOY,
		...over,
	}
}

function withdraw(id: string, over: Partial<WithdrawJournalRecord> = {}): WithdrawJournalRecord {
	return {
		schema: 1,
		id,
		direction: "withdraw",
		isPrivate: false,
		amount: "40",
		createdAt: 1,
		updatedAt: 1,
		recipientL1: "0xeth",
		exitTxHash: id,
		...DEPLOY,
		...over,
	}
}

describe("journal CRUD", () => {
	it("upserts multiple records and patches one without touching the others", () => {
		const kv = memKV()
		upsertRecord(kv, deposit("0xaaa"))
		upsertRecord(kv, deposit("0xbbb"))
		patchRecord(kv, "0xaaa", { leafIndex: "42" })
		const records = loadJournal(kv)
		expect(records).toHaveLength(2)
		expect((records.find((r) => r.id === "0xaaa") as DepositJournalRecord).leafIndex).toBe("42")
		expect((records.find((r) => r.id === "0xbbb") as DepositJournalRecord).leafIndex).toBeUndefined()
	})

	it("upsert replaces by id instead of duplicating", () => {
		const kv = memKV()
		upsertRecord(kv, deposit("0xaaa"))
		upsertRecord(kv, deposit("0xaaa", { amount: "999" }))
		const records = loadJournal(kv)
		expect(records).toHaveLength(1)
		expect(records[0].amount).toBe("999")
	})

	it("patch on a missing id is a no-op", () => {
		const kv = memKV()
		upsertRecord(kv, deposit("0xaaa"))
		expect(patchRecord(kv, "0xnope", { leafIndex: "1" })).toBeUndefined()
		expect(loadJournal(kv)).toHaveLength(1)
	})

	it("rekey upgrades a provisional withdraw to its exitTxHash id", () => {
		const kv = memKV()
		upsertRecord(kv, withdraw("wd-pending-x", { exitTxHash: undefined }))
		rekeyRecord(kv, "wd-pending-x", withdraw("0xexit1"))
		const records = loadJournal(kv)
		expect(records).toHaveLength(1)
		expect(records[0].id).toBe("0xexit1")
	})

	it("remove deletes only the targeted record", () => {
		const kv = memKV()
		upsertRecord(kv, deposit("0xaaa"))
		upsertRecord(kv, withdraw("0xexit"))
		removeRecord(kv, "0xaaa")
		expect(loadJournal(kv).map((r) => r.id)).toEqual(["0xexit"])
	})
})

describe("schema-2 fuel records", () => {
	const fuel = {
		amount: "250000000000000000",
		secret: "0xf00d",
		secretHashHex: "0xfeed",
		minOutput: "450000000000000000000",
	}

	it("a fueled deposit round-trips through the journal with its fuel block intact", () => {
		const kv = memKV()
		upsertRecord(kv, deposit("0xfueled", { schema: 2, fuel }))
		const [rec] = loadJournal(kv) as DepositJournalRecord[]
		expect(rec.schema).toBe(2)
		expect(rec.fuel).toEqual(fuel)
	})

	it("schema-1 and schema-2 records coexist in one journal; schema-1 loads byte-identically", () => {
		const kv = memKV()
		const legacy = deposit("0xlegacy")
		upsertRecord(kv, legacy)
		upsertRecord(kv, deposit("0xfueled", { schema: 2, fuel }))
		const records = loadJournal(kv)
		expect(records).toHaveLength(2)
		// upsert stamps updatedAt; every OTHER field of the schema-1 record is untouched.
		const { updatedAt: _, ...loaded } = records.find((r) => r.id === "0xlegacy") as DepositJournalRecord
		const { updatedAt: __, ...expected } = legacy
		expect(loaded).toEqual(expected)
	})

	it("updating fuel progress (received/claimAttempt/consumed) persists via updateRecord", () => {
		const kv = memKV()
		upsertRecord(kv, deposit("0xfueled", { schema: 2, fuel }))
		patchRecord(kv, "0xfueled", {
			fuel: { ...fuel, leafIndex: "7", received: "487000000000000000000", claimAttempt: true, consumed: true },
		} as Partial<DepositJournalRecord>)
		const [rec] = loadJournal(kv) as DepositJournalRecord[]
		expect(rec.fuel?.received).toBe("487000000000000000000")
		expect(rec.fuel?.claimAttempt).toBe(true)
		expect(rec.fuel?.consumed).toBe(true)
	})
})

describe("assetKind (Fuel variant)", () => {
	it("defaults to bridge-token when absent; reads fee-juice when set; withdraws are always token", () => {
		expect(assetKindOf(deposit("0xtoken"))).toBe("bridge-token")
		expect(assetKindOf(deposit("0xfuel", { assetKind: "fee-juice" }))).toBe("fee-juice")
		expect(assetKindOf(withdraw("0xexit"))).toBe("bridge-token")
	})

	it("a fee-juice deposit round-trips through the journal with its variant + binding intact", () => {
		const kv = memKV()
		upsertRecord(kv, deposit("0xfj", { assetKind: "fee-juice", portal: "0xfjportal", bridge: "0xfjL2" }))
		const [rec] = loadJournal(kv) as DepositJournalRecord[]
		expect(assetKindOf(rec)).toBe("fee-juice")
		expect(rec.portal).toBe("0xfjportal")
	})

	it("REGRESSION: a pre-Fuel journal (no assetKind) loads EVERY record, each as bridge-token (additive)", () => {
		const kv = memKV({
			[JOURNAL_KEY]: JSON.stringify({
				schema: 1,
				records: [
					deposit("0xa"),
					deposit("0xb", { schema: 2, fuel: { amount: "1", secret: "0x1", secretHashHex: "0x2", minOutput: "3" } }),
					withdraw("0xc"),
				],
			}),
		})
		const records = loadJournal(kv)
		expect(records.map((r) => r.id).sort()).toEqual(["0xa", "0xb", "0xc"])
		for (const r of records) expect(assetKindOf(r)).toBe("bridge-token")
	})
})

describe("multi-tab safety (per-record merge)", () => {
	it("a writer with a stale in-memory snapshot cannot erase a record another writer just added", () => {
		const kv = memKV()
		// Tab A creates record A. Tab B, which read the journal BEFORE A existed (stale snapshot),
		// now writes record B — upsert re-reads at write time, so A must survive.
		upsertRecord(kv, deposit("0xfromA"))
		upsertRecord(kv, deposit("0xfromB"))
		expect(
			loadJournal(kv)
				.map((r) => r.id)
				.sort(),
		).toEqual(["0xfromA", "0xfromB"])
	})
})

describe("parse hardening + cap priority", () => {
	it("corrupt JSON yields an empty journal, never a crash", () => {
		const kv = memKV({ [JOURNAL_KEY]: "{not json" })
		expect(loadJournal(kv)).toEqual([])
	})

	it("wrong schema or non-array records yields empty", () => {
		const kv = memKV({ [JOURNAL_KEY]: JSON.stringify({ schema: 2, records: [deposit("0xa")] }) })
		expect(loadJournal(kv)).toEqual([])
	})

	it("garbage entries inside the array are dropped", () => {
		const kv = memKV({
			[JOURNAL_KEY]: JSON.stringify({ schema: 1, records: [deposit("0xa"), null, 7, { direction: "deposit" }] }),
		})
		expect(loadJournal(kv).map((r) => r.id)).toEqual(["0xa"])
	})

	it("a COMPLETED-junk flood never evicts an unfinished record (prioritized retention)", () => {
		const live = deposit("0xlive", { updatedAt: 5 })
		const junk: BridgeJournalRecord[] = Array.from({ length: MAX_RECORDS + 50 }, (_, i) =>
			deposit(`0xjunk${i}`, { completedAt: 1000 + i, updatedAt: 1000 + i }),
		)
		const capped = capRecords([...junk, live])
		expect(capped.some((r) => r.id === "0xlive")).toBe(true)
		// The evicted ones are the OLDEST completed.
		expect(capped.some((r) => r.id === "0xjunk0")).toBe(false)
	})

	it("an UNFINISHED-junk flood cannot evict a live record either — unfinished records are never dropped", () => {
		const live = deposit("0xlive", { updatedAt: 1 }) // oldest of all
		const junk: BridgeJournalRecord[] = Array.from({ length: MAX_RECORDS + 50 }, (_, i) =>
			deposit(`0xjunk${i}`, { updatedAt: 1000 + i }),
		)
		const capped = capRecords([...junk, live])
		expect(capped.some((r) => r.id === "0xlive")).toBe(true)
		expect(capped.filter((r) => !r.completedAt)).toHaveLength(MAX_RECORDS + 51)
	})
})

describe("prune + legacy cleanup", () => {
	it("pruneCompleted drops only old completed records", () => {
		const kv = memKV()
		upsertRecord(kv, deposit("0xold", { completedAt: 1000 }))
		upsertRecord(kv, deposit("0xfresh", { completedAt: 9000 }))
		upsertRecord(kv, deposit("0xinflight"))
		pruneCompleted(kv, 5000, 10_000)
		expect(
			loadJournal(kv)
				.map((r) => r.id)
				.sort(),
		).toEqual(["0xfresh", "0xinflight"])
	})

	it("clearLegacyKeys deletes the pre-journal single-pending keys (no migration)", () => {
		const kv = memKV({
			[LEGACY_KEYS[0]]: JSON.stringify({ secret: "0x1", recipient: "0xr", amount: "5" }),
			[LEGACY_KEYS[1]]: JSON.stringify({ exitTxHash: "0xe" }),
		})
		clearLegacyKeys(kv)
		expect(kv.getItem(LEGACY_KEYS[0])).toBeNull()
		expect(kv.getItem(LEGACY_KEYS[1])).toBeNull()
	})
})

describe("stage derivation (never persisted)", () => {
	it("deposit milestone table", () => {
		expect(deriveDepositStage(deposit("a"))).toBe("depositing")
		expect(deriveDepositStage(deposit("a", { depositTxHash: "0xd" }))).toBe("depositing")
		expect(deriveDepositStage(deposit("a", { leafIndex: "7" }))).toBe("syncing")
		expect(deriveDepositStage(deposit("a", { leafIndex: "7" }), { claimable: true })).toBe("claimable")
		expect(deriveDepositStage(deposit("a", { leafIndex: "7", claimTxHash: "0xc" }))).toBe("claiming")
		expect(deriveDepositStage(deposit("a", { leafIndex: "7", claimTxHash: "0xc", completedAt: 1 }))).toBe("done")
	})

	it("withdraw milestone table", () => {
		expect(deriveWithdrawStage(withdraw("a", { exitTxHash: undefined }))).toBe("exiting")
		expect(deriveWithdrawStage(withdraw("a"))).toBe("proving")
		expect(deriveWithdrawStage(withdraw("a"), { proven: true })).toBe("consumable")
		expect(deriveWithdrawStage(withdraw("a", { consumeTxHash: "0xc" }))).toBe("consuming")
		expect(deriveWithdrawStage(withdraw("a", { consumeTxHash: "0xc", completedAt: 1 }))).toBe("done")
	})
})
