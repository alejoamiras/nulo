import { inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { assertPgOk, callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #16 — getAddressBook is silent on default sessions (AppState=1 < confirmationLevel=5).
 *
 * Requires `data` capability to be granted first per capability-map.ts:42.
 */
test.skipIf(!hasConfig)(
	"data-addressBook — silent path after data cap granted",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		// Grant data capability
		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "data"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqGrant = await snapshotResultSeq(page)
		const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		await approveCapabilities(await popupP)
		await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

		// Call getAddressBook — silent
		const result = await callExpectingNoPopup(dappConnectedExtension, page, "getAddressBook", async () => {
			await clickByTestId(page, "pg-btn-getAddressBook")
		})
		await assertPgOk(page, result, "data-addressBook:result")
	},
)
