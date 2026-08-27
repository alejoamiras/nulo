import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { assertPgOk, callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #18 — getContractMetadata is silent on default sessions
 * (PxeState=3 < confirmationLevel=Transactions=5).
 *
 * Requires `contracts` cap with `canGetMetadata`. Test fills the
 * tokenAddress input with the deployed test token, then queries metadata.
 */
test.skipIf(!hasConfig)(
	"contracts-getMetadata — silent path returns metadata for known address",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		// Grant the basic bundle (includes contracts capability)
		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "basic"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqGrant = await snapshotResultSeq(page)
		const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		await approveCapabilities(await popupP)
		await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

		// Set the token address input
		await page.evaluate((addr: string) => {
			const input = document.querySelector<HTMLInputElement>('[data-testid="pg-input-tokenAddress"]')!
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
			setter?.call(input, addr)
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}, aztecConfig!.tokenAddress)

		const result = await callExpectingNoPopup(dappConnectedExtension, page, "getContractMetadata", async () => {
			await clickByTestId(page, "pg-btn-getContractMetadata")
		})
		await assertPgOk(page, result, "contracts-getMetadata:result")
		expect(result.resultJson).toBeDefined()
	},
)
