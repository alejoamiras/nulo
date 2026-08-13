import { expect, inject } from "vitest"
import { test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult, assertPgOk } from "../fixtures/playground"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #40 — concurrent rapid-fire silent calls settle in FIFO order.
 *
 * background.ts:148-156 + :172-180 implement per-session message + decrypt
 * queues to prevent reordering. Fire 5 silent calls without awaiting and
 * verify all settle in their issuance order (data-result-seq ascending).
 */
test.skipIf(!hasConfig)(
	"concurrency-rapid-fire — 5 concurrent silent calls settle FIFO",
	{ timeout: 60_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage
		const seqBefore = await snapshotResultSeq(page)

		// Click 5 buttons in rapid succession (no awaits between)
		await page.evaluate(() => {
			const btns = ["pg-btn-getChainInfo", "pg-btn-getChainInfo", "pg-btn-getChainInfo", "pg-btn-getChainInfo", "pg-btn-getChainInfo"]
			for (const id of btns) {
				const el = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
				if (!el) continue
				el.click()
			}
		})

		// Wait for all 5 results to settle. Each subsequent call should produce
		// a higher seq than the previous one.
		const settled: number[] = []
		for (let i = 0; i < 5; i++) {
			const r = await waitForPgResult(page, "getChainInfo", seqBefore + i, 30_000)
			settled.push(r.seq)
			await assertPgOk(page, r, "concurrency-rapid-fire:r")
		}

		// FIFO check: seqs should be strictly ascending
		for (let i = 1; i < settled.length; i++) {
			expect(settled[i]).toBeGreaterThan(settled[i - 1])
		}
	},
)
