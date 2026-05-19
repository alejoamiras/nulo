import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #36 — batch with silent + cap-required legs.
 *
 * The mixed batch in the playground combines getChainInfo + getAccounts +
 * getContractMetadata. All silent on default sessions, but getContractMetadata
 * needs `contracts` capability — so the test grants `basic` first.
 */
test.skipIf(!hasConfig)(
	"batch-mixed — silent path returns named results for all legs",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "basic"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const seqGrant = await snapshotResultSeq(page)
		const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 15_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		await approveCapabilities(await popupP)
		await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

		// Set tokenAddress for getContractMetadata leg
		await page.evaluate((addr: string) => {
			const input = document.querySelector<HTMLInputElement>('[data-testid="pg-input-tokenAddress"]')!
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
			setter?.call(input, addr)
			input.dispatchEvent(new Event("input", { bubbles: true }))
		}, aztecConfig!.tokenAddress)

		const result = await callExpectingNoPopup(dappConnectedExtension, page, "batch", async () => {
			await clickByTestId(page, "pg-btn-batch-mixed")
		})
		expect(result.status).toBe("ok")
		const arr = result.resultJson as Array<{ name: string }>
		expect(arr.map((r) => r.name).sort()).toEqual(["getAccounts", "getChainInfo", "getContractMetadata"])
	},
)
