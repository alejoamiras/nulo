import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq } from "../fixtures/playground"
import { approveExecute, waitForExecuteContent, waitForPopup, waitForSendTxActiveStage } from "../fixtures/popups"
import { mintPublicTokensForAccount, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #31 — sendTx with `exec.feePayer` set bypasses the fee picker.
 * execute/index.vue:202 sets feeSettings to embedded automatically; the
 * popup shows the "fee set by app" badge.
 *
 * Uses `dappConnectedExtensionWithTransactionCap` so the cap-popup
 * round-trip happens in fixture setup (hookTimeout=300s) rather than
 * during this test's budget. Asserts on `data-stage` (active processing
 * stage) instead of the dApp's full sendTx promise.
 */
test.skipIf(!hasConfig)(
	"tx-sendTx-feePayer — exec.feePayer triggers embedded fee + fee-set badge, reaches active stage",
	{ timeout: 90_000 },
	async ({ dappConnectedExtensionWithTransactionCap }) => {
		const { playgroundPage: page, accountAddress } = dappConnectedExtensionWithTransactionCap

		// Pre-mint tokens so simulate succeeds + journal enters active stage.
		await mintPublicTokensForAccount(aztecConfig!, accountAddress)

		await page.evaluate(
			({ token, recipient, feePayer }: { token: string; recipient: string; feePayer: string }) => {
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
				setVal('[data-testid="pg-input-feePayer"]', feePayer)
			},
			{ token: aztecConfig!.tokenAddress, recipient: aztecConfig!.minterAddress, feePayer: aztecConfig!.sponsoredFpcAddress },
		)

		await snapshotResultSeq(page)
		const execPopupP = waitForPopup(dappConnectedExtensionWithTransactionCap, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-feePayer")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)

		const hasFeeBadge = await execPopup.evaluate(() => !!document.querySelector('[data-testid="execute-op-fee-set-badge"]'))
		expect(hasFeeBadge).toBe(true)

		await approveExecute(execPopup)

		// Wait for the wallet's journal to enter an active processing stage
		// instead of the dApp's full sendTx promise. feePayer is the SponsoredFPC;
		// the popup-shape + fee-set badge are what this test verifies, not on-chain
		// completion.
		const walletPopup = await openPopup(dappConnectedExtensionWithTransactionCap)
		await waitForSendTxActiveStage(walletPopup)
	},
)
