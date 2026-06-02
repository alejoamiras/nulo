import { inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup, waitForSendTxActiveStage } from "../fixtures/popups"
import { mintPublicTokensForAccount, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #35 — user picks Sponsored FPC fee in the execute popup.
 *
 * Default sendTx (no preset fee) opens with FeeSettingsCard. The user clicks
 * the trigger to override, then picks "sponsored". approveExecute({ feeMethod:
 * "sponsored" }) handles the two-step.
 *
 * Uses `dappConnectedExtensionWithTransactionCap` so the cap-popup
 * round-trip happens in fixture setup (hookTimeout=300s) rather than
 * during this test's budget. Asserts on `data-stage` (active processing
 * stage) instead of the dApp's full sendTx promise.
 */
test.skipIf(!hasConfig)(
	"tx-sendTx-sponsoredFpc — user override → sponsored fee → reaches active stage",
	{ timeout: 90_000 },
	async ({ dappConnectedExtensionWithTransactionCap }) => {
		const { playgroundPage: page, accountAddress } = dappConnectedExtensionWithTransactionCap

		// Pre-mint tokens so simulate succeeds + journal enters active stage.
		await mintPublicTokensForAccount(aztecConfig!, accountAddress)

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

		await snapshotResultSeq(page)
		const execPopupP = waitForPopup(dappConnectedExtensionWithTransactionCap, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-default")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)

		// Use the existing FeeSettingsCard's send-fee-method-* testids via approveExecute.
		// "sponsored" is the typical default + reasserted via the override flow.
		await approveExecute(execPopup, { feeMethod: "sponsored" })

		// Wait for the wallet's journal to enter an active processing stage
		// instead of the dApp's full sendTx promise. The popup-shape +
		// fee-method override flow is what this test verifies.
		const walletPopup = await openPopup(dappConnectedExtensionWithTransactionCap)
		await waitForSendTxActiveStage(walletPopup)
	},
)
