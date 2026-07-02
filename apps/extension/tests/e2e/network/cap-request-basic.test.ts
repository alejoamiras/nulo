import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities, getCapItems } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #05 — basic bundle request grants contracts + simulation.
 *
 * Bundle: `basic` = [contracts(*, canRegister, canGetMetadata), simulation(*, *)].
 * Verifies cap-item rows render with the requested types and the
 * requestCapabilities() call settles ok.
 */
test.skipIf(!hasConfig)(
	"cap-request-basic — basic bundle approves and grants contracts+simulation",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage
		const fromSeq = await snapshotResultSeq(page)

		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "basic"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})

		const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")

		const popup = await popupP
		const items = await getCapItems(popup)
		const ids = items.map((i) => i.id)
		expect(ids).toEqual(expect.arrayContaining(["contracts", "simulation"]))

		await approveCapabilities(popup)

		const result = await waitForPgResult(page, "requestCapabilities", fromSeq, 30_000)
		expect(result.status).toBe("ok")
	},
)
