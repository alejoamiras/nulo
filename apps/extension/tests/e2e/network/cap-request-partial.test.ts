import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult, assertPgOk } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #08 — partial grant: approve some, reject others.
 *
 * Request the `basic` bundle (contracts + simulation), but toggle off the
 * `simulation` row before approving. The result should grant only `contracts`,
 * and the dispatcher should record `simulation` as a rejection (so a future
 * re-request shows the previously-denied badge).
 */
test.skipIf(!hasConfig)(
	"cap-request-partial — toggle off one cap, only the other gets granted",
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
		await approveCapabilities(popup, { toggleOff: ["simulation"] })

		const result = await waitForPgResult(page, "requestCapabilities", fromSeq, 30_000)
		await assertPgOk(page, result, "cap-request-partial:result")
		// resultJson is the WalletCapabilities response — granted should only contain contracts
		const granted = (result.resultJson as { granted?: Array<{ type: string }> })?.granted ?? []
		const grantedTypes = granted.map((g) => g.type)
		expect(grantedTypes).toContain("contracts")
		expect(grantedTypes).not.toContain("simulation")
	},
)
