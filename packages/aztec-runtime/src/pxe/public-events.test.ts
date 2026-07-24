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
import { describe, expect, test } from "vitest"
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
/** A pinned checkpoint hash for the dual-anchor class gate (codex R4 #7). Small field element. */
const CHECKPOINT_HASH = BlockHash.fromString(`0x${"0".repeat(62)}c1`).toString()

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
	/** Overrides `contractInstance` for the "checkpointed" anchor only (dual-anchor gate — codex R3 #7). */
	checkpointedInstance?: { currentContractClassId: Fr } | undefined
	getContractThrows?: boolean
	/** `getBlockHashMembershipWitness` result: truthy = the queried hash IS an archive member
	 *  (ancestor); `undefined` (default when unset & `membershipWitness` omitted) → non-member. */
	membershipWitness?: unknown
	onMembershipQuery?: (referenceBlock: unknown, blockHash: unknown) => void
}): AztecNode {
	return {
		getBlockNumber: async (tip?: string) => {
			if (tip === "finalized") return BlockNumber(opts.finalized ?? 100)
			return BlockNumber(opts.checkpointed ?? 100)
		},
		getBlockData: async () => ({
			header: { getBlockNumber: () => opts.checkpointed ?? 100 },
			blockHash: { toString: () => "0xcheckpointtip" },
		}),
		getBlockHashMembershipWitness: async (referenceBlock: unknown, blockHash: unknown) => {
			opts.onMembershipQuery?.(referenceBlock, blockHash)
			return opts.membershipWitness
		},
		getPublicLogsByTags: async (query: unknown) => {
			opts.onQuery?.(query)
			if (opts.throwOnQuery) throw opts.throwOnQuery
			return [opts.page ?? []]
		},
		getContract: async (_addr: unknown, anchor?: unknown) => {
			if (opts.getContractThrows) throw new Error("node RPC timeout")
			// "finalized" is the symbolic tag; the checkpointed anchor is now the pinned BlockHash object.
			if (anchor !== "finalized" && "checkpointedInstance" in opts) return opts.checkpointedInstance
			return opts.contractInstance
		},
	} as unknown as AztecNode
}

const ADDR_A = AztecAddress.fromBigIntUnsafe(0xa1n).toString()
const ADDR_B = AztecAddress.fromBigIntUnsafe(0xb2n).toString()
const ZERO_ADDR = AztecAddress.ZERO.toString()

// The tag + bundled-Token-class-id memos stay WARM across tests on purpose: each is a heavy bb.js
// Poseidon compute (the class id hashes every function in the Token artifact), and recomputing per
// test multiplied the bb.js load ~10× — which corrupted the shared bb.js WASM (`std::bad_cast`)
// under the concurrent full-suite run. The one reset-behavior test resets inline instead.

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

	test("empty page → scannedThrough null, hasMore false, dropped false (genuine EOF)", async () => {
		const node = makeNode({ page: [], checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {})
		expect(result.events).toEqual([])
		expect(result.scannedThrough).toBeNull()
		expect(result.hasMore).toBe(false)
		expect(result.dropped).toBe(false) // EOF, NOT a validator drop (codex R1 Critical #2)
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
		expect(result.dropped).toBe(true) // a DROP, not EOF — reconciliation must not treat it as complete
	})

	test("first log at/before afterCursor is rejected (whole page dropped)", async () => {
		const page = [makeLog({ from: ADDR_A, to: ADDR_B, amount: 1n, blockNumber: 5, txIndexWithinBlock: 0, logIndexWithinTx: 0 })]
		const node = makeNode({ page, checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {
			afterCursor: { blockNumber: 5, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
		})
		expect(result.events).toEqual([])
		expect(result.scannedThrough).toBeNull()
		expect(result.dropped).toBe(true)
	})

	test("cursor/log beyond the checkpointed tip is rejected (whole page dropped)", async () => {
		const page = [makeLog({ from: ADDR_A, to: ADDR_B, amount: 1n, blockNumber: 99, txIndexWithinBlock: 0, logIndexWithinTx: 0 })]
		const node = makeNode({ page, checkpointed: 10 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {})
		expect(result.events).toEqual([])
		expect(result.scannedThrough).toBeNull()
		expect(result.dropped).toBe(true)
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

	test("a PINNED toBlock (< checkpointed) bounds the query to it, not the live checkpointed", async () => {
		// The whole multi-page scan must page against ONE fixed tip (codex R1 Critical #1 / High #3).
		let captured: { toBlock?: number } | undefined
		const node = makeNode({ page: [], checkpointed: 100, onQuery: (q) => (captured = q as { toBlock?: number }) })
		await fetchPublicTokenTransferEvents(node, CONTRACT, { toBlock: 60 })
		expect(Number(captured?.toBlock)).toBe(61) // exclusive: pinned 60 + 1
	})

	test("a PINNED toBlock ABOVE the node's checkpointed → DEFERRED (dropped), no truncated query (codex R2 #3)", async () => {
		// The old code clamped to checkpointed and scanned a truncated window — during reconciliation
		// that EOFs early and DELETES canonical records in the unscanned tail. Now we defer instead.
		let queried = false
		const node = makeNode({
			page: [],
			checkpointed: 40,
			onQuery: () => {
				queried = true
			},
		})
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, { toBlock: 999 })
		expect(result.dropped).toBe(true)
		expect(result.scannedThrough).toBeNull()
		expect(queried).toBe(false) // never issued the truncated query
	})

	test("a log beyond the PINNED toBlock (but ≤ checkpointed) drops the page", async () => {
		const page = [makeLog({ from: ADDR_A, to: ADDR_B, amount: 1n, blockNumber: 70, txIndexWithinBlock: 0, logIndexWithinTx: 0 })]
		const node = makeNode({ page, checkpointed: 100 })
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, { toBlock: 60 })
		expect(result.events).toEqual([])
		expect(result.scannedThrough).toBeNull()
		expect(result.dropped).toBe(true)
	})
})

describe("fetchPublicTokenTransferEvents — boundary-ancestry probe (codex R3 #1)", () => {
	test("member witness → returns empty (no log query); queries membership with (referenceBlock, boundaryHash)", async () => {
		let logQueried = false
		let membershipArgs: { ref?: unknown; hash?: unknown } = {}
		const node = makeNode({
			checkpointed: 100,
			membershipWitness: { leafIndex: 5n }, // truthy → the boundary IS an ancestor of the checkpoint
			onQuery: () => {
				logQueried = true
			},
			onMembershipQuery: (ref, hash) => {
				membershipArgs = { ref, hash }
			},
		})
		const result = await fetchPublicTokenTransferEvents(node, CONTRACT, {
			referenceBlock: BlockHash.random().toString(),
			verifyAncestorHash: BlockHash.random().toString(),
		})
		expect(result).toEqual({ events: [], scannedThrough: null, hasMore: false, dropped: false })
		expect(logQueried).toBe(false) // pure verification — no getPublicLogsByTags
		expect(membershipArgs.ref).toBeDefined()
		expect(membershipArgs.hash).toBeDefined()
	})

	test("NON-member (undefined witness) → THROWS (boundary is on a different fork than the checkpoint)", async () => {
		const node = makeNode({ checkpointed: 100, membershipWitness: undefined })
		await expect(
			fetchPublicTokenTransferEvents(node, CONTRACT, {
				referenceBlock: BlockHash.random().toString(),
				verifyAncestorHash: BlockHash.random().toString(),
			}),
		).rejects.toThrow(/not an ancestor/)
	})

	test("verifyAncestorHash without a referenceBlock anchor → throws (misuse guard)", async () => {
		const node = makeNode({ checkpointed: 100, membershipWitness: { leafIndex: 1n } })
		await expect(fetchPublicTokenTransferEvents(node, CONTRACT, { verifyAncestorHash: BlockHash.random().toString() })).rejects.toThrow(
			/requires a referenceBlock/,
		)
	})
})

describe("getPublicScanTips", () => {
	test("returns checkpointed number + hash + finalized number", async () => {
		const node = makeNode({ checkpointed: 30, finalized: 12 })
		const tips = await getPublicScanTips(node)
		expect(tips).toEqual({ checkpointedBlockNumber: 30, checkpointedBlockHash: "0xcheckpointtip", finalizedBlockNumber: 12 })
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
		expect(await resolveTokenClassStatus(node, CONTRACT, CHECKPOINT_HASH)).toBe("standard")
	})

	test("upgraded/foreign class (current class != bundled) → non-standard (node-direct)", async () => {
		const node = makeNode({ contractInstance: { currentContractClassId: Fr.random() } })
		expect(await resolveTokenClassStatus(node, CONTRACT, CHECKPOINT_HASH)).toBe("non-standard")
	})

	test("unresolvable contract (node returns undefined) → unresolved (fail closed)", async () => {
		const node = makeNode({ contractInstance: undefined })
		expect(await resolveTokenClassStatus(node, CONTRACT, CHECKPOINT_HASH)).toBe("unresolved")
	})

	test("node getContract throw → unresolved (transient, fail closed, not cached)", async () => {
		const node = makeNode({ getContractThrows: true })
		expect(await resolveTokenClassStatus(node, CONTRACT, CHECKPOINT_HASH)).toBe("unresolved")
	})

	test("(codex R3 #7) standard at finalized but MALICIOUS at checkpointed → non-standard (dual-anchor)", async () => {
		const bundled = await getBundledTokenClassId()
		const node = makeNode({
			contractInstance: { currentContractClassId: bundled }, // finalized: still the standard Token
			checkpointedInstance: { currentContractClassId: Fr.random() }, // checkpointed: upgraded to a foreign class
		})
		expect(await resolveTokenClassStatus(node, CONTRACT, CHECKPOINT_HASH)).toBe("non-standard")
	})

	test("(codex R3 #7) unresolvable at checkpointed (undefined) → unresolved (fail closed at either anchor)", async () => {
		const bundled = await getBundledTokenClassId()
		const node = makeNode({
			contractInstance: { currentContractClassId: bundled },
			checkpointedInstance: undefined,
		})
		expect(await resolveTokenClassStatus(node, CONTRACT, CHECKPOINT_HASH)).toBe("unresolved")
	})

	test("(codex R3 #7) bundled class at BOTH anchors → standard", async () => {
		const bundled = await getBundledTokenClassId()
		const node = makeNode({
			contractInstance: { currentContractClassId: bundled },
			checkpointedInstance: { currentContractClassId: bundled },
		})
		expect(await resolveTokenClassStatus(node, CONTRACT, CHECKPOINT_HASH)).toBe("standard")
	})
})

describe("Transfer event metadata sanity", () => {
	test("bundled Token exposes the Transfer event selector 0x70a1894e", () => {
		expect(TokenContract.events.Transfer.eventSelector.toString()).toBe("0x70a1894e")
		expect(TokenContract.events.Transfer.fieldNames).toEqual(["from", "to", "amount"])
	})
})
