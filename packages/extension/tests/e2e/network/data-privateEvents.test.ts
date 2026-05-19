import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #28 — getPrivateEvents is silent on default sessions
 * (PrivateData=4 < confirmationLevel=5).
 *
 * Requires `data` capability. Uses a stub eventMetadata (the wallet may
 * return [] or error — both are silent-path).
 *
 * Productionizing the test would need the real `Token` contract's
 * `Transfer` event metadata + a transfer must have actually happened.
 * For now, this test verifies only that the dispatch path doesn't open
 * a popup.
 */
test.skipIf(!hasConfig)(
	"data-privateEvents (#28) — silent path under data cap",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "data"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqGrant = await snapshotResultSeq(page)
		const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 15_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		await approveCapabilities(await popupP)
		await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

		await page.evaluate((addr: string) => {
			const input = document.querySelector<HTMLInputElement>('[data-testid="pg-input-tokenAddress"]')!
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
			setter?.call(input, addr)
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}, aztecConfig!.tokenAddress)

		const result = await callExpectingNoPopup(dappConnectedExtension, page, "getPrivateEvents", async () => {
			await clickByTestId(page, "pg-btn-getPrivateEvents")
		})
		expect(["ok", "error"]).toContain(result.status)
	},
)
