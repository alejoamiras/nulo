import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #12 — getAccounts post-grant returns the granted accounts.
 *
 * Workflow:
 *   1) Connect (no accounts cap yet)
 *   2) Request `accounts` bundle, select one account
 *   3) getAccounts() now returns that account
 */
test.skipIf(!hasConfig)(
	"meta-getAccounts — returns granted account post-cap-grant",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		// Grant accounts capability first
		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "accounts"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqGrant = await snapshotResultSeq(page)
		const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		const popup = await popupP
		await popup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 10_000 })
		const accountIds = await popup.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) => r.getAttribute("data-account-id")),
		)
		const firstAccount = accountIds[0]!
		await approveCapabilities(popup, { accounts: [firstAccount] })
		await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

		// Now call getAccounts — silent path, returns the granted account
		const result = await callExpectingNoPopup(dappConnectedExtension, page, "getAccounts", async () => {
			await clickByTestId(page, "pg-btn-getAccounts")
		})
		expect(result.status).toBe("ok")
		const accounts = result.resultJson as Array<{ alias: string; item: string }>
		expect(accounts.length).toBeGreaterThan(0)
		expect(accounts.map((a) => a.item)).toContain(firstAccount)
	},
)
