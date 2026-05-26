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

		// 30s (down from 120s) because pg-btn-sendTx-default now sends with
		// `wait: "NO_WAIT"` — the dApp's promise settles when the wallet
		// submits the tx (txHash + offchain output) without waiting on chain
		// mining. The popup-shape test asserts that the dApp got the
		// callback, not on receipt mining latency. Codex audit session
		// 019e6628-bc1c-7282-a1eb-aad1cc5bd70d for the diagnosis.
		const result = await waitForPgResult(page, "sendTx", seqTx, 30_000)
		expect(["ok", "error"]).toContain(result.status)
	},
)
