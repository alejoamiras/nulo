import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult, assertPgOk } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #09 — repeat request with all-already-granted skips the popup entirely.
 *
 * Dispatcher early-returns at `dispatcher.ts:395` if the delta is empty.
 * After granting the `basic` bundle once, requesting it again should resolve
 * without opening /windows/capabilities.
 */
test.skipIf(!hasConfig)(
	"cap-request-repeat-noPopup — second request with same bundle skips popup",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "basic"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})

		// First request — popup shown, approve
		const seqA = await snapshotResultSeq(page)
		const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		await approveCapabilities(await popupP)
		const first = await waitForPgResult(page, "requestCapabilities", seqA, 30_000)
		await assertPgOk(page, first, "cap-request-repeat-noPopup:first")

		// Second request — should NOT open a popup
		const seqB = await snapshotResultSeq(page)
		const targetsBefore = dappConnectedExtension.browser.targets().length
		await clickByTestId(page, "pg-btn-requestCapabilities")
		const second = await waitForPgResult(page, "requestCapabilities", seqB, 8_000)
		await assertPgOk(page, second, "cap-request-repeat-noPopup:second")

		const targetsAfter = dappConnectedExtension.browser.targets().length
		expect(targetsAfter).toBeLessThanOrEqual(targetsBefore)
	},
)
