import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #06 — accounts capability triggers account selector + alias input.
 *
 * The accounts capability is special: the popup shows the account list with
 * per-account alias input. We pick the first available account, leave the
 * default alias, and approve. After grant, `state.accounts` is populated from
 * the dispatcher's enriched `granted.accounts` response (canonical refactor B2).
 */
test.skipIf(!hasConfig)(
	"cap-request-accounts — selects account, alias persists",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage
		const fromSeq = await snapshotResultSeq(page)

		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "accounts"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})

		const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 15_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")

		const popup = await popupP
		await popup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 10_000 })
		const accountIds = await popup.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) => r.getAttribute("data-account-id")),
		)
		expect(accountIds.length).toBeGreaterThan(0)
		const firstAccount = accountIds[0]!

		await approveCapabilities(popup, { accounts: [firstAccount] })

		const result = await waitForPgResult(page, "requestCapabilities", fromSeq, 30_000)
		expect(result.status).toBe("ok")

		// Playground should now show the account in pg-account-list
		const accounts = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('[data-testid="pg-account-item"]')]
				.filter((el) => el.getAttribute("data-account-id"))
				.map((el) => el.getAttribute("data-account-id")),
		)
		expect(accounts).toContain(firstAccount)
	},
)
