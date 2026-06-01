import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveCapabilities, approveExecute, waitForExecuteContent, waitForPopup, waitForSendTxActiveStage } from "../fixtures/popups"
import { mintPublicTokensForAccount, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #31 — sendTx with `exec.feePayer` set bypasses the fee picker.
 * execute/index.vue:202 sets feeSettings to embedded automatically; the
 * popup shows the "fee set by app" badge.
 */
test.skipIf(!hasConfig)(
	"tx-sendTx-feePayer — exec.feePayer triggers embedded fee + fee-set badge, reaches proving stage",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "transaction"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqGrant = await snapshotResultSeq(page)
		const capPopupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		const capPopup = await capPopupP
		await capPopup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 10_000 })
		const accountIds = await capPopup.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) => r.getAttribute("data-account-id")),
		)
		await approveCapabilities(capPopup, { accounts: [accountIds[0]!] })
		await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

		// Pre-mint tokens so simulate succeeds + journal enters active stage.
		await mintPublicTokensForAccount(aztecConfig!, accountIds[0]!)

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
		const execPopupP = waitForPopup(dappConnectedExtension, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-feePayer")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)

		const hasFeeBadge = await execPopup.evaluate(() => !!document.querySelector('[data-testid="execute-op-fee-set-badge"]'))
		expect(hasFeeBadge).toBe(true)

		await approveExecute(execPopup)

		// Wait for the wallet's journal to enter `proving` instead of the dApp's
		// full sendTx promise. feePayer is the SponsoredFPC; the popup-shape +
		// fee-set badge are what this test verifies, not on-chain completion.
		const walletPopup = await openPopup(dappConnectedExtension)
		await waitForSendTxActiveStage(walletPopup)
	},
)
