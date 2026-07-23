/**
 * Phase 2 node-API capability probe (fail-loud, runs in the gate).
 *
 * The draft's `describe.skipIf` SOURCE test would never actually execute — `audit:vue` runs
 * `src/**` with no sandbox and `e2e:agent` runs only `tests/e2e/network/**`. So this lives in the
 * network suite and calls the new `@nulo/aztec-runtime/pxe/public-events` node functions directly
 * against the live sandbox node — proving the node serves `getPublicLogsByTags` (Inference 3) and
 * that the tips + class-gate helpers behave BEFORE the deep service integration is trusted.
 */
import { createAztecNodeClient } from "@aztec/aztec.js/node"
import { fetchPublicTokenTransferEvents, getPublicScanTips, resolveTokenClassStatus } from "@nulo/aztec-runtime/pxe/public-events"
import { expect, inject, test } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test.skipIf(!hasConfig)("getPublicScanTips returns well-formed checkpointed + finalized tips", { timeout: 60_000 }, async () => {
	const node = createAztecNodeClient(aztecConfig!.nodeUrl)
	const tips = await getPublicScanTips(node)
	expect(typeof tips.checkpointedBlockNumber).toBe("number")
	expect(tips.checkpointedBlockNumber).toBeGreaterThanOrEqual(0)
	expect(typeof tips.finalizedBlockNumber).toBe("number")
	// The checkpointed block hash resolves on a live node (used as the D6 reconciliation anchor).
	expect(tips.checkpointedBlockHash === null || typeof tips.checkpointedBlockHash === "string").toBe(true)
})

test.skipIf(!hasConfig)(
	"getPublicTokenTransferEvents serves a well-formed (possibly empty) page from the live node",
	{ timeout: 60_000 },
	async () => {
		const node = createAztecNodeClient(aztecConfig!.nodeUrl)
		const page = await fetchPublicTokenTransferEvents(node, aztecConfig!.tokenAddress, {})
		expect(Array.isArray(page.events)).toBe(true)
		expect(typeof page.hasMore).toBe("boolean")
		// `scannedThrough` is a cursor (all-number fields) when non-empty, or null when empty.
		if (page.scannedThrough !== null) {
			expect(typeof page.scannedThrough.blockNumber).toBe("number")
			expect(typeof page.scannedThrough.txIndexWithinBlock).toBe("number")
			expect(typeof page.scannedThrough.logIndexWithinTx).toBe("number")
		}
		// Every decoded event carries the record + reorg fields.
		for (const ev of page.events) {
			expect(typeof ev.from).toBe("string")
			expect(typeof ev.to).toBe("string")
			expect(() => BigInt(ev.amountRaw)).not.toThrow()
			expect(typeof ev.blockHash).toBe("string")
			expect(typeof ev.txHash).toBe("string")
		}
	},
)

test.skipIf(!hasConfig)(
	"resolveTokenClassStatus recognizes the sandbox token as the bundled Token (never non-standard)",
	{ timeout: 60_000 },
	async () => {
		const node = createAztecNodeClient(aztecConfig!.nodeUrl)
		// The dual-anchor gate resolves the class at the EXACT pinned checkpoint hash (codex R4 #7), so
		// pass the live checkpoint hash from the tips probe.
		const tips = await getPublicScanTips(node)
		expect(tips.checkpointedBlockHash).not.toBeNull()
		const status = await resolveTokenClassStatus(node, aztecConfig!.tokenAddress, tips.checkpointedBlockHash!)
		// The sandbox token IS the aztec-standards Token, so the gate must never report `non-standard`.
		// `unresolved` is tolerated here (the finalized anchor can lag a freshly-deployed sandbox); the
		// full scan-through-finality path is exercised by the Phase 5 behavioral e2e.
		expect(status).not.toBe("non-standard")
	},
)
