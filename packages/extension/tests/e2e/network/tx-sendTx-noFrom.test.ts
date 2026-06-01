import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveCapabilities, approveExecute, waitForExecuteContent, waitForPopup, waitForSendTxProvingStage } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #30 — sendTx with `from: "NO_FROM"` routes through DefaultEntrypoint
 * instead of the account contract. dispatcher.ts:82-88,334-348 sets
 * executionMode: "default_entrypoint", which makes the popup show the
 * "fee set by app" badge (no fee picker; embedded paymentMethod).
 */
test.skipIf(!hasConfig)(
	"tx-sendTx-noFrom — popup shows fee-set badge, no fee picker, reaches proving stage",
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
		const execPopupP = waitForPopup(dappConnectedExtension, "execute", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-sendTx-noFrom")
		const execPopup = await execPopupP
		await waitForExecuteContent(execPopup)

		// Fee-set badge should be present (executionMode: default_entrypoint)
		const hasFeeBadge = await execPopup.evaluate(() => !!document.querySelector('[data-testid="execute-op-fee-set-badge"]'))
		expect(hasFeeBadge).toBe(true)

		await approveExecute(execPopup)

		// Wait for the wallet's journal to enter `proving` instead of the dApp's
		// full sendTx promise. See waitForSendTxProvingStage.
		const walletPopup = await openPopup(dappConnectedExtension)
		await waitForSendTxProvingStage(walletPopup)
	},
)
