/**
 * Pre-extraction pins for the two page-drop WARN lines that move into the
 * plan-2 `validatePageOrdering` extraction: their exact message strings AND
 * structured argument shapes (codex audit condition — the isolated drop
 * behavior is already pinned; the log contract was not).
 */
import { BlockNumber } from "@aztec/foundation/branded-types"
import { Fr } from "@aztec/foundation/curves/bn254"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { BlockHash } from "@aztec/stdlib/block"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { LogResult } from "@aztec/stdlib/logs"
import { TxHash } from "@aztec/stdlib/tx"
import { describe, expect, test } from "vitest"
import { fetchPublicTokenTransferEvents } from "./public-events"

const CONTRACT = AztecAddress.fromBigIntUnsafe(0xc0ffeen).toString()

function makeLog(blockNumber: number, txIndexWithinBlock: number, logIndexWithinTx: number): LogResult {
	return {
		logData: [Fr.random(), Fr.random(), Fr.random(), new Fr(1n)],
		blockNumber: BlockNumber(blockNumber),
		blockHash: BlockHash.random(),
		blockTimestamp: BigInt(1_700_000_000 + blockNumber),
		txHash: TxHash.fromBigInt(BigInt(blockNumber * 1000 + txIndexWithinBlock)),
		txIndexWithinBlock,
		logIndexWithinTx,
	} as LogResult
}

function makeNode(page: LogResult[], checkpointed: number): AztecNode {
	return {
		getBlockNumber: async () => BlockNumber(checkpointed),
		getPublicLogsByTags: async () => [page],
	} as unknown as AztecNode
}

type WarnCall = [string, string, unknown]

describe("page-drop warn oracle", () => {
	test("beyond-checkpointed-tip drop warns with the exact message + {contract, pos, checkpointed}", async () => {
		const warns: WarnCall[] = []
		const page = await fetchPublicTokenTransferEvents(makeNode([makeLog(101, 0, 0)], 100), CONTRACT, {}, (level, msg, data) =>
			warns.push([level, msg, data]),
		)
		expect(page.dropped).toBe(true)
		const warn = warns.find(([, msg]) => msg.includes("beyond the checkpointed tip"))
		expect(warn).toBeDefined()
		expect(warn![0]).toBe("warn")
		expect(warn![1]).toBe("public-events: page contains a log beyond the checkpointed tip — dropping page")
		expect(warn![2]).toEqual({
			contract: CONTRACT,
			pos: { blockNumber: 101, txIndexWithinBlock: 0, logIndexWithinTx: 0 },
			checkpointed: 100,
		})
	})

	test("non-increasing drop warns with the exact message + {contract, prev, pos}", async () => {
		const warns: WarnCall[] = []
		const page = await fetchPublicTokenTransferEvents(
			makeNode([makeLog(50, 1, 1), makeLog(50, 1, 1)], 100),
			CONTRACT,
			{},
			(level, msg, data) => warns.push([level, msg, data]),
		)
		expect(page.dropped).toBe(true)
		const warn = warns.find(([, msg]) => msg.includes("not strictly increasing"))
		expect(warn).toBeDefined()
		expect(warn![0]).toBe("warn")
		expect(warn![1]).toBe("public-events: page is not strictly increasing (or precedes cursor) — dropping page")
		expect(warn![2]).toEqual({
			contract: CONTRACT,
			prev: { blockNumber: 50, txIndexWithinBlock: 1, logIndexWithinTx: 1 },
			pos: { blockNumber: 50, txIndexWithinBlock: 1, logIndexWithinTx: 1 },
		})
	})
})
