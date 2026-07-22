/**
 * Unit tests for `PublicEventIndexer` — the injected paging collaborator (D3). Drives a fake
 * `PublicEventReader` and asserts: multi-page accumulation, the page budget, cross-page cursor
 * monotonicity, the empty/partial-page stops, `referenceBlock`-throw propagation, and the
 * recipient filter / single-page probe.
 */
import { describe, expect, test, vi } from "vitest"
import type { PublicEventReader } from "./public-event-indexer"
import { DEFAULT_MAX_PAGES_PER_SCAN, PublicEventIndexer, comparePublicPositions } from "./public-event-indexer"
import type { PublicTransferEvent, PublicTransferFetchArgs, PublicTransferPage } from "@nulo/aztec-runtime/pxe/public-events"

const noop = () => {}

function ev(overrides: Partial<PublicTransferEvent> = {}): PublicTransferEvent {
	return {
		from: "0xfrom",
		to: "0xa",
		amountRaw: "1",
		txHash: "0xtx",
		l2BlockNumber: 5,
		blockHash: "0xbh",
		blockTimestamp: 1,
		txIndexWithinBlock: 0,
		logIndexWithinTx: 0,
		...overrides,
	}
}

function page(events: PublicTransferEvent[], hasMore = false): PublicTransferPage {
	const last = events[events.length - 1]
	return {
		events,
		scannedThrough: last
			? { blockNumber: last.l2BlockNumber, txIndexWithinBlock: last.txIndexWithinBlock, logIndexWithinTx: last.logIndexWithinTx }
			: null,
		hasMore,
	}
}

function makeReader(responses: Array<PublicTransferPage | Error>) {
	const fetchArgs: PublicTransferFetchArgs[] = []
	const reader: PublicEventReader = {
		fetchTransferPage: async (_n, _c, args) => {
			fetchArgs.push(args)
			const next = responses.shift()
			if (next === undefined) return { events: [], scannedThrough: null, hasMore: false }
			if (next instanceof Error) throw next
			return next
		},
		getScanTips: async () => ({ checkpointedBlockNumber: 100, checkpointedBlockHash: "0xcp", finalizedBlockNumber: 50 }),
		getTokenClassStatus: async () => "standard",
	}
	return { reader, fetchArgs }
}

describe("comparePublicPositions", () => {
	test("orders by (block, txIndex, logIndex)", () => {
		expect(
			comparePublicPositions(
				{ blockNumber: 1, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
				{ blockNumber: 2, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			),
		).toBeLessThan(0)
		expect(
			comparePublicPositions(
				{ blockNumber: 2, txIndexWithinBlock: 3, logIndexWithinTx: 0 },
				{ blockNumber: 2, txIndexWithinBlock: 1, logIndexWithinTx: 0 },
			),
		).toBeGreaterThan(0)
		expect(
			comparePublicPositions(
				{ blockNumber: 2, txIndexWithinBlock: 1, logIndexWithinTx: 4 },
				{ blockNumber: 2, txIndexWithinBlock: 1, logIndexWithinTx: 4 },
			),
		).toBe(0)
	})
})

describe("PublicEventIndexer.scan", () => {
	test("accumulates events across full pages up to a non-full page; tracks topBlockHash", async () => {
		const { reader } = makeReader([
			page([ev({ txHash: "0x1", l2BlockNumber: 5, blockHash: "0xb5" })], true),
			page([ev({ txHash: "0x2", l2BlockNumber: 6, blockHash: "0xb6" })], false),
		])
		const idx = new PublicEventIndexer(reader, noop)
		const res = await idx.scan("n", "c", {})
		expect(res.events.map((e) => e.txHash)).toEqual(["0x1", "0x2"])
		expect(res.scannedThrough).toEqual({ blockNumber: 6, txIndexWithinBlock: 0, logIndexWithinTx: 0 })
		expect(res.hasMore).toBe(false)
		expect(res.topBlockHash).toBe("0xb6")
	})

	test("stops at the page budget with hasMore=true when every page is full", async () => {
		const responses = Array.from({ length: DEFAULT_MAX_PAGES_PER_SCAN + 2 }, (_, i) =>
			page([ev({ txHash: `0x${i}`, l2BlockNumber: 5 + i })], true),
		)
		const { reader, fetchArgs } = makeReader(responses)
		const idx = new PublicEventIndexer(reader, noop)
		const res = await idx.scan("n", "c", {})
		expect(fetchArgs).toHaveLength(DEFAULT_MAX_PAGES_PER_SCAN)
		expect(res.hasMore).toBe(true)
	})

	test("empty first page → null cursor, no events, hasMore=false", async () => {
		const { reader } = makeReader([page([])])
		const idx = new PublicEventIndexer(reader, noop)
		const res = await idx.scan("n", "c", {})
		expect(res).toEqual({ events: [], scannedThrough: null, hasMore: false, topBlockHash: null })
	})

	test("threads afterCursor + referenceBlock to the reader; advances afterCursor per page", async () => {
		const { reader, fetchArgs } = makeReader([page([ev({ l2BlockNumber: 5 })], true), page([ev({ l2BlockNumber: 6 })], false)])
		const idx = new PublicEventIndexer(reader, noop)
		await idx.scan("n", "c", {
			afterCursor: { blockNumber: 4, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			referenceBlock: "0xref",
			fromBlock: 3,
		})
		expect(fetchArgs[0]).toEqual({
			fromBlock: 3,
			afterCursor: { blockNumber: 4, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			referenceBlock: "0xref",
		})
		expect(fetchArgs[1].afterCursor).toEqual({ blockNumber: 5, txIndexWithinBlock: 0, logIndexWithinTx: 0 })
		expect(fetchArgs[1].referenceBlock).toBe("0xref")
	})

	test("stops (no advance) when a page's cursor does not strictly advance (hostile node)", async () => {
		const warn = vi.fn()
		// Second full page repeats the same position — the cross-page guard must stop.
		const { reader, fetchArgs } = makeReader([page([ev({ l2BlockNumber: 5 })], true), page([ev({ l2BlockNumber: 5 })], true)])
		const idx = new PublicEventIndexer(reader, (level, msg) => level === "warn" && warn(msg))
		const res = await idx.scan("n", "c", {})
		expect(fetchArgs).toHaveLength(2)
		expect(res.events).toHaveLength(1) // only the first page kept
		expect(warn).toHaveBeenCalled()
	})

	test("a referenceBlock-reorg throw propagates unchanged (D6 detection signal)", async () => {
		const { reader } = makeReader([new Error("referenceBlock reorged out")])
		const idx = new PublicEventIndexer(reader, noop)
		await expect(idx.scan("n", "c", { referenceBlock: "0xgone" })).rejects.toThrow(/reorged out/)
	})
})

describe("PublicEventIndexer.filterToRecipients + probe", () => {
	test("filterToRecipients keeps only events addressed to a recipient (lower-cased)", () => {
		const idx = new PublicEventIndexer(makeReader([]).reader, noop)
		const events = [ev({ to: "0xAAA" }), ev({ to: "0xbbb" }), ev({ to: "0xCcC" })]
		const recipients = new Set(["0xaaa", "0xccc"])
		expect(idx.filterToRecipients(events, recipients).map((e) => e.to)).toEqual(["0xAAA", "0xCcC"])
	})

	test("probe fetches exactly one page with the given anchor and swallows the result", async () => {
		const { reader, fetchArgs } = makeReader([page([ev()])])
		const idx = new PublicEventIndexer(reader, noop)
		await idx.probe("n", "c", {
			afterCursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			referenceBlock: "0xanchor",
		})
		expect(fetchArgs).toHaveLength(1)
		expect(fetchArgs[0]).toEqual({
			afterCursor: { blockNumber: 8, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			referenceBlock: "0xanchor",
		})
	})

	test("probe propagates a reorg throw", async () => {
		const { reader } = makeReader([new Error("anchor gone")])
		const idx = new PublicEventIndexer(reader, noop)
		await expect(idx.probe("n", "c", { referenceBlock: "0xgone" })).rejects.toThrow(/anchor gone/)
	})
})
