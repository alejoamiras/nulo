import { describe, expect, test } from "vitest"
import { orderByBlockIndex } from "./service"
import type { IncomingNoteRecord, IncomingTransferRecord } from "./spec"

function record(overrides: Partial<IncomingNoteRecord> = {}): IncomingTransferRecord {
	const siloedNullifier = overrides.siloedNullifier ?? "0xnull"
	return {
		kind: "note",
		id: overrides.id ?? `note:p1|net-1|${siloedNullifier}`,
		siloedNullifier,
		profileId: "p1",
		networkId: "net-1",
		accountAddress: "0xaccount",
		contract: "0xtoken",
		tokenId: 1,
		owner: "0xaccount",
		amountRaw: "100",
		noteHash: "0xnh",
		txHash: "0xtx",
		l2BlockNumber: 0,
		txIndexInBlock: 0,
		indexInTx: 0,
		hidden: false,
		discoveredAt: 1000,
		...overrides,
	}
}

describe("orderByBlockIndex — (block, txIndex, indexInTx) ascending", () => {
	test("orders by l2BlockNumber first", () => {
		const a = record({ l2BlockNumber: 5 })
		const b = record({ l2BlockNumber: 3 })
		expect([a, b].sort(orderByBlockIndex)[0]).toBe(b)
	})
	test("falls back to txIndexInBlock when blocks are equal", () => {
		const a = record({ l2BlockNumber: 1, txIndexInBlock: 4 })
		const b = record({ l2BlockNumber: 1, txIndexInBlock: 1 })
		expect([a, b].sort(orderByBlockIndex)[0]).toBe(b)
	})
	test("falls back to indexInTx when block + txIndex are equal", () => {
		const a = record({ l2BlockNumber: 1, txIndexInBlock: 1, indexInTx: 7 })
		const b = record({ l2BlockNumber: 1, txIndexInBlock: 1, indexInTx: 2 })
		expect([a, b].sort(orderByBlockIndex)[0]).toBe(b)
	})
	test("identical positions → stable sort (zero return)", () => {
		const a = record({ siloedNullifier: "0x1" })
		const b = record({ siloedNullifier: "0x2" })
		expect(orderByBlockIndex(a, b)).toBe(0)
	})
})
