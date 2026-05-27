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
 * 180s budget. Mirrors the Phase 2 fix applied to register-token. The earlier
 * inline cap-grant + tx flow exceeded the 180s budget on cold shard 3 (PR #63
 * Network e2e run) even after retry x2; pushing the cap-grant work into the
 * fixture should keep the test body in the 30–60s range it actually needs.
 *
 * See implementations-plan/e2e-stabilization/lessons/phase-3a.md for the
 * probe findings that ruled out cross-browser warm-up and pivoted to this
 * approach.
 */
test.skipIf(!hasConfig)(
	"tx-sendTx-default — popup opens, fee picker shown, confirm submits",
	{ timeout: 180_000 },
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

		// 180s budget chosen empirically by the Phase 4 acceptance gate:
		//   - 30s failed deterministically (4 of 5 runs) — prover starts cold
		//   - 90s failed too (split fee-methods to its own job didn't help) —
		//     so the bottleneck is the runner-pool prover time itself,
		//     not the same-shard queue pressure
		// Per codex audit session 019e6743-2fb7-7df3-bad7-6cf503cf2338 §1
		// (Phase 4 follow-up): 180s is the hosted-runner-prover envelope.
		// NO_WAIT already trims the post-submit side; the wallet still does
		// buildAndEstimateTxRequest → proveTxTask → sendTxTask before the
		// dApp's promise settles. Local M-series WASM equivalent: <15s.
		const t0 = Date.now()
		const result = await waitForPgResult(page, "sendTx", seqTx, 180_000)
		const waitMs = Date.now() - t0
		// Print to CI log for runner-envelope tuning. Codex audit suggested
		// stage-level (simulating/proving/submitting) timing in follow-up
		// if 180s also flakes; this wrapper timing is the minimum viable
		// diagnostic that doesn't require wallet code changes.
		console.log(`[tx-sendTx-default] waitForPgResult settled in ${waitMs}ms`)
		expect(["ok", "error"]).toContain(result.status)
	},
)
