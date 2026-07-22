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
})
