import { describe, expect, test } from "vitest"
import type { IncomingNoteRecord, IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"
import type { OperationRecord } from "@/wallet/services/operation-journal/spec"
import type { Tx } from "@/wallet/services/transaction/spec"
import { buildActivityRows } from "./activity-rows"

function tx(updatedAt: number, hash: string): Tx {
	return { hash, updatedAt, account: "0xa", calls: [] } as unknown as Tx
}

function journal(overrides: Partial<OperationRecord>): OperationRecord {
	return {
		id: "j1",
		kind: "transfer",
		origin: "popup",
		profileId: "p1",
		accountAddress: "0xa",
		networkId: "net-1",
		progress: { stage: "cancelled" },
		error: null,
		terminalAt: 1_000,
		attempts: 0,
		createdAt: 0,
		updatedAt: 1_000,
		...overrides,
	} as OperationRecord
}

function incoming(overrides: Partial<IncomingNoteRecord>): IncomingTransferRecord {
	const siloedNullifier = overrides.siloedNullifier ?? "0xn1"
	return {
		kind: "note",
		id: overrides.id ?? `note:p1|net-1|${siloedNullifier}`,
		siloedNullifier,
		profileId: "p1",
		networkId: "net-1",
		accountAddress: "0xa",
		contract: "0xt",
		tokenId: 1,
		owner: "0xa",
		amountRaw: "100",
		noteHash: "0xh",
		txHash: "0xtx",
		l2BlockNumber: 1,
		txIndexInBlock: 0,
		indexInTx: 0,
		hidden: false,
		discoveredAt: 1_000,
		...overrides,
	}
}

describe("buildActivityRows — three-source merge", () => {
	test("empty input → empty output", () => {
		expect(buildActivityRows({ transactions: [], terminalJournalOps: [], incomingTransfers: [] })).toEqual([])
	})

	test("merges tx + journal + incoming into one list", () => {
		const rows = buildActivityRows({
			transactions: [tx(3_000, "0xtx1")],
			terminalJournalOps: [journal({ terminalAt: 2_000 })],
			incomingTransfers: [incoming({ discoveredAt: 1_000 })],
			accountAddress: "0xa",
		})
		expect(rows).toHaveLength(3)
		expect(rows.map((r) => r.type)).toEqual(["tx", "journal", "incoming"])
	})

	test("sorts newest-first by sortKey across types", () => {
		const rows = buildActivityRows({
			transactions: [tx(1_000, "0xtx-old")],
			terminalJournalOps: [journal({ id: "j-new", terminalAt: 5_000 })],
			incomingTransfers: [incoming({ siloedNullifier: "0xn-mid", discoveredAt: 3_000 })],
			accountAddress: "0xa",
		})
		expect(rows.map((r) => r.sortKey)).toEqual([5_000, 3_000, 1_000])
	})

	test("journal scoping: drops succeeded stage", () => {
		const rows = buildActivityRows({
			transactions: [],
			terminalJournalOps: [journal({ progress: { stage: "succeeded", txHash: "0xchain" } })],
			incomingTransfers: [],
			accountAddress: "0xa",
		})
		expect(rows).toHaveLength(0)
	})

	test("journal scoping: drops non-activity kinds", () => {
		const rows = buildActivityRows({
			transactions: [],
			terminalJournalOps: [journal({ kind: "token_import" } as unknown as Partial<OperationRecord>)],
			incomingTransfers: [],
			accountAddress: "0xa",
		})
		expect(rows).toHaveLength(0)
	})

	test("journal scoping: drops other-account records", () => {
		const rows = buildActivityRows({
			transactions: [],
			terminalJournalOps: [journal({ accountAddress: "0xother" })],
			incomingTransfers: [],
			accountAddress: "0xa",
		})
		expect(rows).toHaveLength(0)
	})

	test("journal scoping: drops non-terminal records", () => {
		const rows = buildActivityRows({
			transactions: [],
			terminalJournalOps: [journal({ terminalAt: null, progress: { stage: "proving", enteredProveAt: 0 } })],
			incomingTransfers: [],
			accountAddress: "0xa",
		})
		expect(rows).toHaveLength(0)
	})

	test("incoming rows are passed through (service-layer-filtered)", () => {
		const rows = buildActivityRows({
			transactions: [],
			terminalJournalOps: [],
			incomingTransfers: [incoming({ siloedNullifier: "0xa" }), incoming({ siloedNullifier: "0xb", discoveredAt: 2_000 })],
		})
		expect(rows).toHaveLength(2)
		expect(rows.every((r) => r.type === "incoming")).toBe(true)
	})

	test("each row carries a unique key per source", () => {
		const rows = buildActivityRows({
			transactions: [tx(1_000, "0xtx1")],
			terminalJournalOps: [journal({ id: "j1" })],
			incomingTransfers: [incoming({ siloedNullifier: "0xn1" })],
			accountAddress: "0xa",
		})
		const keys = rows.map((r) => r.key)
		expect(new Set(keys).size).toBe(keys.length)
		expect(keys).toContain("tx:0xtx1")
		expect(keys).toContain("journal:j1")
		expect(keys).toContain("incoming:note:p1|net-1|0xn1")
	})

	// ── Cross-account render-scope filters (defense-in-depth) ──

	test("tx scoping: drops other-account tx when accountAddress is supplied", () => {
		const rows = buildActivityRows({
			transactions: [{ ...tx(3_000, "0xmine"), account: "0xa" } as Tx, { ...tx(2_000, "0xtheirs"), account: "0xother" } as Tx],
			terminalJournalOps: [],
			incomingTransfers: [],
			accountAddress: "0xa",
		})
		expect(rows.map((r) => (r.type === "tx" ? r.tx.hash : ""))).toEqual(["0xmine"])
	})

	test("tx scoping: drops wrong-chain tx when chainId is supplied", () => {
		const rows = buildActivityRows({
			transactions: [
				{ ...tx(3_000, "0xright"), account: "0xa", chainId: 1 } as Tx,
				{ ...tx(2_000, "0xwrong"), account: "0xa", chainId: 2 } as Tx,
			],
			terminalJournalOps: [],
			incomingTransfers: [],
			accountAddress: "0xa",
			chainId: 1,
		})
		expect(rows.map((r) => (r.type === "tx" ? r.tx.hash : ""))).toEqual(["0xright"])
	})

	test("incoming scoping: drops other-account incoming when accountAddress is supplied", () => {
		const rows = buildActivityRows({
			transactions: [],
			terminalJournalOps: [],
			incomingTransfers: [
				incoming({ siloedNullifier: "0xmine" }),
				incoming({ siloedNullifier: "0xtheirs", accountAddress: "0xother" }),
			],
			accountAddress: "0xa",
		})
		expect(rows.map((r) => (r.type === "incoming" && r.inc.kind === "note" ? r.inc.siloedNullifier : ""))).toEqual(["0xmine"])
	})

	test("incoming scoping: drops wrong-network incoming when networkId is supplied", () => {
		const rows = buildActivityRows({
			transactions: [],
			terminalJournalOps: [],
			incomingTransfers: [
				incoming({ siloedNullifier: "0xhere", networkId: "net-1" }),
				incoming({ siloedNullifier: "0xelsewhere", networkId: "net-2" }),
			],
			accountAddress: "0xa",
			networkId: "net-1",
		})
		expect(rows.map((r) => (r.type === "incoming" && r.inc.kind === "note" ? r.inc.siloedNullifier : ""))).toEqual(["0xhere"])
	})
})

/** Wraps a record so every string-keyed property read is logged, in order. */
function recorded<T extends object>(target: T, log: string[]): T {
	return new Proxy(target, {
		get(t, key, receiver) {
			if (typeof key === "string") log.push(key)
			return Reflect.get(t, key, receiver)
		},
	})
}

describe("buildActivityRows — scope pins", () => {
	const scoped = { accountAddress: "0xa", chainId: 1, networkId: "net-1", profileId: "p1" }

	test("tx: a foreign profile is dropped; an unstamped one stays", () => {
		const rows = buildActivityRows({
			transactions: [
				{ ...tx(3_000, "0xmine"), chainId: 1, profileId: "p1" } as Tx,
				{ ...tx(2_000, "0xtheirs"), chainId: 1, profileId: "p2" } as Tx,
				{ ...tx(1_000, "0xunstamped"), chainId: 1 } as Tx,
			],
			terminalJournalOps: [],
			incomingTransfers: [],
			...scoped,
		})
		expect(rows.map((r) => r.key)).toEqual(["tx:0xmine", "tx:0xunstamped"])
	})

	test("tx: chain id 0 is a known chain, not an unknown one", () => {
		const rows = buildActivityRows({
			transactions: [{ ...tx(3_000, "0xzero"), chainId: 0 } as Tx, { ...tx(2_000, "0xone"), chainId: 1 } as Tx],
			terminalJournalOps: [],
			incomingTransfers: [],
			accountAddress: "0xa",
			chainId: 0,
		})
		expect(rows.map((r) => r.key)).toEqual(["tx:0xzero"])
	})

	test("an unknown scope keeps every tx and every incoming record", () => {
		const rows = buildActivityRows({
			transactions: [{ ...tx(3_000, "0xany"), account: "0xother", chainId: 9, profileId: "p9" } as Tx],
			terminalJournalOps: [],
			incomingTransfers: [incoming({ siloedNullifier: "0xany", accountAddress: "0xother", networkId: "net-9", profileId: "p9" })],
		})
		expect(rows.map((r) => r.key)).toEqual(["tx:0xany", "incoming:note:p1|net-1|0xany"])
	})

	test("a terminal journal row from another network is kept: History reads by profile, not network", () => {
		const rows = buildActivityRows({
			transactions: [],
			terminalJournalOps: [
				journal({ id: "here", networkId: "net-1" }),
				journal({ id: "there", networkId: "net-2", terminalAt: 900 }),
			],
			incomingTransfers: [],
			...scoped,
		})
		expect(rows.map((r) => r.key)).toEqual(["journal:here", "journal:there"])
	})

	test("an incoming record stamped with another profile is kept under a known scope: History has no incoming profile guard", () => {
		const rows = buildActivityRows({
			transactions: [],
			terminalJournalOps: [],
			incomingTransfers: [
				incoming({ siloedNullifier: "0xmine" }),
				incoming({ siloedNullifier: "0xtheirs", profileId: "p2", discoveredAt: 900 }),
			],
			...scoped,
		})
		expect(rows.map((r) => r.key)).toEqual(["incoming:note:p1|net-1|0xmine", "incoming:note:p1|net-1|0xtheirs"])
	})
})

describe("buildActivityRows — read order", () => {
	const scoped = { accountAddress: "0xa", chainId: 1, networkId: "net-1", profileId: "p1" }
	const txReads = (over: Record<string, unknown>, scope: Record<string, unknown> = scoped) => {
		const log: string[] = []
		buildActivityRows({
			transactions: [recorded({ ...tx(1, "0xh"), chainId: 1, profileId: "p1", ...over } as Tx, log)],
			terminalJournalOps: [],
			incomingTransfers: [],
			...scope,
		})
		return log
	}
	const incomingReads = (over: Partial<IncomingNoteRecord>) => {
		const log: string[] = []
		buildActivityRows({ transactions: [], terminalJournalOps: [], incomingTransfers: [recorded(incoming(over), log)], ...scoped })
		return log
	}

	test("a tx stops at the first failed check, and a kept one reads its key after its scope", () => {
		expect(txReads({ account: "0xother" })).toEqual(["account"])
		expect(txReads({ chainId: 2 })).toEqual(["account", "chainId"])
		expect(txReads({ profileId: "p2" })).toEqual(["account", "chainId", "profileId"])
		expect(txReads({})).toEqual(["account", "chainId", "profileId", "hash", "updatedAt"])
		expect(txReads({}, {})).toEqual(["profileId", "hash", "updatedAt"])
	})

	test("an incoming record stops at the first failed check, and a kept one reads its sort key before its id", () => {
		expect(incomingReads({ accountAddress: "0xother" })).toEqual(["accountAddress"])
		expect(incomingReads({ networkId: "net-2" })).toEqual(["accountAddress", "networkId"])
		expect(incomingReads({})).toEqual(["accountAddress", "networkId", "blockTimestamp", "discoveredAt", "id"])
		expect(incomingReads({ blockTimestamp: 7 })).toEqual(["accountAddress", "networkId", "blockTimestamp", "blockTimestamp", "id"])
	})
})
