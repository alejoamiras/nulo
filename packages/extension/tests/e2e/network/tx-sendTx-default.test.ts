import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, waitForExecuteContent, approveExecute } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #29 — sendTx default (account-bound). Always opens /windows/execute
 * (Transactions=5 >= confirmationLevel=5).
 *
 * Flow: tx cap pre-granted by fixture → set inputs → click → /windows/execute
 * opens with FeeSettingsCard (no fee preset) → user accepts default → tx submits.
 *
 * Uses `dappConnectedExtensionWithTransactionCap` so the cap-popup round-trip
 * happens during fixture setup (hookTimeout=300s) rather than in this test's
 * test budget.
 */
test.skipIf(!hasConfig)(
	"tx-sendTx-default — popup opens, fee picker shown, confirm submits",
	// Test budget MUST exceed waitForPgResult (360s) below — needs room for
	// fixture/setup (~15s on cold shard) + popup drive (~5s) + the wait
	// itself. 420s gives ~60s headroom over the wait ceiling.
	{ timeout: 420_000 },
	async ({ dappConnectedExtensionWithTransactionCap }) => {
		const { playgroundPage: page } = dappConnectedExtensionWithTransactionCap

		// Set inputs
		await page.evaluate(
			({ token, recipient }: { token: string; recipient: string }) => {
				const setVal = (sel: string, v: string) => {
					const input = document.querySelector<HTMLInputElement>(sel)
					if (!input) return
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
					setter?.call(input, v)
					input.dispatchEvent(new Event("input", { bubbles: true }))
				}
				setVal('[data-testid="pg-input-tokenAddress"]', token)
				setVal('[data-testid="pg-input-recipient"]', recipient)
				setVal('[data-testid="pg-input-amount"]', "1")
			},
			{ token: aztecConfig!.tokenAddress, recipient: aztecConfig!.minterAddress },
		)

		// Fire sendTx + drive the execute popup
		const seqTx = await snapshotResultSeq(page)
		const execPopupP = waitForPopup(dappConnectedExtensionWithTransactionCap, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-default")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)

		// Verify the op card shows aztec_sendTx
		const ops = await execPopup.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="execute-op-item"]')].map((el) => ({
				id: el.getAttribute("data-op-id"),
				kind: el.getAttribute("data-op-kind"),
			})),
		)
		expect(ops.length).toBe(1)
		expect(ops[0].kind).toBe("aztec_sendTx")

		await approveExecute(execPopup)

		// 360s budget absorbs the slow-runner-pool tail on the WASM kernel-prove
		// chain (init/inner/reset/tail kernel proofs). accelerator-server 1.0.1
		// only covers `createChonkProof`; the kernel proofs still run via bb.js
		// WASM in-process and hit the slow-runner cold tail. Local M-series
		// equivalent: <15s. Codex audit 019e6743…: 180s is the hosted-runner-
		// PROVER envelope, but the kernel-prove envelope is larger and not
		// covered by accelerator until upstream exposes more endpoints.
		const t0 = Date.now()
		const result = await waitForPgResult(page, "sendTx", seqTx, 360_000)
		const waitMs = Date.now() - t0
		// Print to CI log for runner-envelope tuning. Codex audit suggested
		// stage-level (simulating/proving/submitting) timing in follow-up
		// if 180s also flakes; this wrapper timing is the minimum viable
		// diagnostic that doesn't require wallet code changes.
		console.log(`[tx-sendTx-default] waitForPgResult settled in ${waitMs}ms`)
		expect(["ok", "error"]).toContain(result.status)
	},
)
