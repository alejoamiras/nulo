/**
 * Phase 1 unit tests for the public `Transfer` event indexer (D1) + class gate (D2).
 *
 * Covers the gate's named scenarios: tag memo; fixture-page decode incl. `from`-sentinel variants;
 * malformed-log skip; NON-monotonic page rejection; cursor-beyond-checkpointed-tip rejection;
 * partial-page `scannedThrough`; empty-page `null`; `fromBlock` honored; cursor zod round-trip;
 * class-id constant matches the bundled artifact; upgraded-class → gate-fails-closed (node-direct).
 */
import { BlockNumber } from "@aztec/foundation/branded-types"
import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { BlockHash } from "@aztec/stdlib/block"
import { getContractClassFromArtifact } from "@aztec/stdlib/contract"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { LogResult } from "@aztec/stdlib/logs"
import { TxHash } from "@aztec/stdlib/tx"
import { TokenContract, TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	_resetPublicEventMemosForTests,
	fetchPublicTokenTransferEvents,
	getBundledTokenClassId,
	getPublicScanTips,
	getTransferLogTag,
	PRIVATE_ADDRESS_MAGIC_VALUE,
	PublicEventCursorSchema,
	type PublicEventCursor,
	resolveTokenClassStatus,
} from "./public-events"

const CONTRACT = AztecAddress.fromBigIntUnsafe(0xc0ffeen).toString()

/** A well-formed `Transfer` log at a given position. `logData = [tag, from, to, amount]`. */
function makeLog(opts: {
	from: string
	to: string
	amount: bigint
	blockNumber: number
	txIndexWithinBlock: number
	logIndexWithinTx: number
	logData?: Fr[]
}): LogResult {
	const fromField = AztecAddress.fromStringUnsafe(opts.from).toField()
	const toField = AztecAddress.fromStringUnsafe(opts.to).toField()
	return {
		logData: opts.logData ?? [Fr.random(), fromField, toField, new Fr(opts.amount)],
		blockNumber: BlockNumber(opts.blockNumber),
		blockHash: BlockHash.random(),
		blockTimestamp: BigInt(1_700_000_000 + opts.blockNumber),
		txHash: TxHash.fromBigInt(BigInt(opts.blockNumber * 1000 + opts.txIndexWithinBlock)),
		txIndexWithinBlock: opts.txIndexWithinBlock,
		logIndexWithinTx: opts.logIndexWithinTx,
	} as LogResult
}

/** Fake node serving a single page of logs, with configurable checkpointed tip. */
function makeNode(opts: {
	page?: LogResult[]
	checkpointed?: number
	finalized?: number
	onQuery?: (query: unknown) => void
	throwOnQuery?: Error
	contractInstance?: { currentContractClassId: Fr } | undefined
	getContractThrows?: boolean
}): AztecNode {
	return {
		getBlockNumber: async (tip?: string) => {
			if (tip === "finalized") return BlockNumber(opts.finalized ?? 100)
			return BlockNumber(opts.checkpointed ?? 100)
		},
		getPublicLogsByTags: async (query: unknown) => {
			opts.onQuery?.(query)
			if (opts.throwOnQuery) throw opts.throwOnQuery
			return [opts.page ?? []]
		},
		getContract: async () => {
			if (opts.getContractThrows) throw new Error("node RPC timeout")
			return opts.contractInstance
		},
	} as unknown as AztecNode
}

const ADDR_A = AztecAddress.fromBigIntUnsafe(0xa1n).toString()
const ADDR_B = AztecAddress.fromBigIntUnsafe(0xb2n).toString()
const ZERO_ADDR = AztecAddress.ZERO.toString()

beforeEach(() => _resetPublicEventMemosForTests())
afterEach(() => _resetPublicEventMemosForTests())

describe("getTransferLogTag (memo)", () => {
	test("returns the same memoized promise across calls", () => {
		const a = getTransferLogTag()
		const b = getTransferLogTag()
		expect(a).toBe(b)
	})

	test("resolves to a stable tag; reset yields an equal fresh tag", async () => {
		const first = await getTransferLogTag()
		_resetPublicEventMemosForTests()
		const second = await getTransferLogTag()
		expect(first.equals(second)).toBe(true)
	})
})

describe("PublicEventCursor zod round-trip", () => {
	test("parses a well-formed cursor and rejects negatives", () => {
		const cursor: PublicEventCursor = { blockNumber: 5, txIndexWithinBlock: 2, logIndexWithinTx: 1 }
		expect(PublicEventCursorSchema.parse(cursor)).toEqual(cursor)
		expect(() => PublicEventCursorSchema.parse({ blockNumber: -1, txIndexWithinBlock: 0, logIndexWithinTx: 0 })).toThrow()
	})
})

describe("fetchPublicTokenTransferEvents — decode", () => {
	test("decodes a full page incl. from-sentinel variants (pub, private, mint)", async () => {
		const page = [
			makeLog({ from: ADDR_A, to: ADDR_B, amount: 1000n, blockNumber: 2, txIndexWithinBlock: 0, logIndexWithinTx: 0 }),
			makeLog({
				from: PRIVATE_ADDRESS_MAGIC_VALUE,
				to: ADDR_B,
				amount: 42n,
				blockNumber: 2,
				txIndexWithinBlock: 1,
				logIndexWithinTx: 0,
			}),
			makeLog({ from: ZERO_ADDR, to: ADDR_B, amount: 7n, blockNumber: 3, txIndexWithinBlock: 0, logIndexWithinTx: 2 }),
		]
		const node = makeNode({ page, checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {})
		expect(result.events).toHaveLength(3)
		expect(result.events[0].from).toBe(ADDR_A)
		expect(result.events[0].to).toBe(ADDR_B)
		expect(result.events[0].amountRaw).toBe("1000")
		expect(result.events[1].from).toBe(PRIVATE_ADDRESS_MAGIC_VALUE)
		expect(result.events[2].from).toBe(ZERO_ADDR)
		expect(result.events[2].logIndexWithinTx).toBe(2)
	})

	test("empty page → scannedThrough null, hasMore false", async () => {
		const node = makeNode({ page: [], checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {})
		expect(result.events).toEqual([])
		expect(result.scannedThrough).toBeNull()
		expect(result.hasMore).toBe(false)
	})

	test("partial page (< MAX) advances scannedThrough to the last log; hasMore false", async () => {
		const page = [
			makeLog({ from: ADDR_A, to: ADDR_B, amount: 1n, blockNumber: 4, txIndexWithinBlock: 0, logIndexWithinTx: 0 }),
			makeLog({ from: ADDR_A, to: ADDR_B, amount: 2n, blockNumber: 4, txIndexWithinBlock: 3, logIndexWithinTx: 1 }),
		]
		const node = makeNode({ page, checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {})
		expect(result.scannedThrough).toEqual({ blockNumber: 4, txIndexWithinBlock: 3, logIndexWithinTx: 1 })
		expect(result.hasMore).toBe(false)
	})

	test("exactly-full page (20 logs) → hasMore true", async () => {
		const page = Array.from({ length: 20 }, (_, i) =>
			makeLog({ from: ADDR_A, to: ADDR_B, amount: BigInt(i + 1), blockNumber: 5, txIndexWithinBlock: i, logIndexWithinTx: 0 }),
		)
		const node = makeNode({ page, checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {})
		expect(result.events).toHaveLength(20)
		expect(result.hasMore).toBe(true)
	})

	test("malformed individual log is skipped, valid ones kept; scannedThrough still advances", async () => {
		const good = makeLog({ from: ADDR_A, to: ADDR_B, amount: 1n, blockNumber: 6, txIndexWithinBlock: 0, logIndexWithinTx: 0 })
		// A log whose payload has too few fields to decode the struct.
		const bad = makeLog({
			from: ADDR_A,
			to: ADDR_B,
			amount: 1n,
			blockNumber: 6,
			txIndexWithinBlock: 1,
			logIndexWithinTx: 0,
			logData: [Fr.random()],
		})
		const node = makeNode({ page: [good, bad], checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {})
		expect(result.events).toHaveLength(1)
		expect(result.scannedThrough).toEqual({ blockNumber: 6, txIndexWithinBlock: 1, logIndexWithinTx: 0 })
	})
})

describe("fetchPublicTokenTransferEvents — hostile-page validation", () => {
	test("NON-monotonic page is dropped whole (no events, no advance)", async () => {
		const page = [
			makeLog({ from: ADDR_A, to: ADDR_B, amount: 1n, blockNumber: 5, txIndexWithinBlock: 2, logIndexWithinTx: 0 }),
			makeLog({ from: ADDR_A, to: ADDR_B, amount: 2n, blockNumber: 5, txIndexWithinBlock: 1, logIndexWithinTx: 0 }),
		]
		const node = makeNode({ page, checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {})
		expect(result.events).toEqual([])
		expect(result.scannedThrough).toBeNull()
	})

	test("first log at/before afterCursor is rejected (whole page dropped)", async () => {
		const page = [makeLog({ from: ADDR_A, to: ADDR_B, amount: 1n, blockNumber: 5, txIndexWithinBlock: 0, logIndexWithinTx: 0 })]
		const node = makeNode({ page, checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {
			afterCursor: { blockNumber: 5, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
		})
		expect(result.events).toEqual([])
		expect(result.scannedThrough).toBeNull()
	})

	test("cursor/log beyond the checkpointed tip is rejected (whole page dropped)", async () => {
		const page = [makeLog({ from: ADDR_A, to: ADDR_B, amount: 1n, blockNumber: 99, txIndexWithinBlock: 0, logIndexWithinTx: 0 })]
		const node = makeNode({ page, checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {})
		expect(result.events).toEqual([])
		expect(result.scannedThrough).toBeNull()
	})

	test("a referenceBlock-reorg throw propagates (D6 detection, not swallowed)", async () => {
		const node = makeNode({ checkpointed: 10, throwOnQuery: new Error("referenceBlock reorged out") })
		await expect(fetchPublicTokenTransferEvents(node, CONTRACT, { referenceBlock: BlockHash.random().toString() })).rejects.toThrow(
			/reorged out/,
		)
	})
})

describe("fetchPublicTokenTransferEvents — query construction", () => {
	test("fromBlock is honored and toBlock = checkpointed + 1 (exclusive)", async () => {
		let captured: { fromBlock?: number; toBlock?: number } | undefined
		const node = makeNode({
			page: [],
			checkpointed: 42,
			onQuery: (q) => {
				captured = q as { fromBlock?: number; toBlock?: number }
			},
		})
		await fetchPublicTokenTransferEvents(node, CONTRACT, { fromBlock: 7 })
		expect(Number(captured?.fromBlock)).toBe(7)
		expect(Number(captured?.toBlock)).toBe(43)
	})
})

describe("getPublicScanTips", () => {
	test("returns checkpointed + finalized as plain numbers", async () => {
		const node = makeNode({ checkpointed: 30, finalized: 12 })
		const tips = await getPublicScanTips(node)
		expect(tips).toEqual({ checkpointedBlockNumber: 30, finalizedBlockNumber: 12 })
	})
})

describe("class gate (D2)", () => {
	test("class-id constant matches a fresh recompute from the bundled artifact", async () => {
		const id = await getBundledTokenClassId()
		const recomputed = (await getContractClassFromArtifact(TokenContractArtifact)).id
		expect(id.equals(recomputed)).toBe(true)
	})

	test("standard token (current class == bundled) → standard", async () => {
		const bundled = await getBundledTokenClassId()
		const node = makeNode({ contractInstance: { currentContractClassId: bundled } })
		expect(await resolveTokenClassStatus(node, CONTRACT)).toBe("standard")
	})

	test("upgraded/foreign class (current class != bundled) → non-standard (node-direct)", async () => {
		const node = makeNode({ contractInstance: { currentContractClassId: Fr.random() } })
		expect(await resolveTokenClassStatus(node, CONTRACT)).toBe("non-standard")
	})

	test("unresolvable contract (node returns undefined) → unresolved (fail closed)", async () => {
		const node = makeNode({ contractInstance: undefined })
		expect(await resolveTokenClassStatus(node, CONTRACT)).toBe("unresolved")
	})

	test("node getContract throw → unresolved (transient, fail closed, not cached)", async () => {
		const node = makeNode({ getContractThrows: true })
		expect(await resolveTokenClassStatus(node, CONTRACT)).toBe("unresolved")
	})
})

describe("Transfer event metadata sanity", () => {
	test("bundled Token exposes the Transfer event selector 0x70a1894e", () => {
		expect(TokenContract.events.Transfer.eventSelector.toString()).toBe("0x70a1894e")
		expect(TokenContract.events.Transfer.fieldNames).toEqual(["from", "to", "amount"])
	})
})
