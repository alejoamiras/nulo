import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult, assertPgOk } from "../fixtures/playground"
import { waitForPopup, waitForPopupClosed, approveCapabilities, rejectCapabilities, getCapItems } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #07 — re-request after rejection shows "previously denied" badge.
 *
 * 1) Request `data` bundle → user rejects.
 * 2) Re-request same bundle → popup shows the data row with a
 *    cap-rerequested-badge present.
 * 3) Approve this time; verify dispatcher returns ok.
 */
test.skipIf(!hasConfig)(
	"cap-request-rerequest — second request marks previously-denied caps",
	{ timeout: 120_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "data"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})

		// First attempt — reject
		const seqA = await snapshotResultSeq(page)
		const popup1P = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		const popup1 = await popup1P
		await rejectCapabilities(popup1)
		const rej = await waitForPgResult(page, "requestCapabilities", seqA, 20_000)
		expect(rej.status).toBe("error")
		// Defense-in-depth: wait for popup1 page to close. The new waitForPopup
		// also excludes pre-existing URLs as the primary guard.
		await waitForPopupClosed(popup1)

		// Second attempt — popup shows rerequested badge on data row
		const seqB = await snapshotResultSeq(page)
		const popup2P = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
		await clickByTestId(page, "pg-btn-requestCapabilities")
		const popup2 = await popup2P

		const items = await getCapItems(popup2)
		const dataRow = items.find((i) => i.id === "data")
		expect(dataRow?.rerequested).toBe(true)

		await approveCapabilities(popup2)
		const ok = await waitForPgResult(page, "requestCapabilities", seqB, 20_000)
		await assertPgOk(page, ok, "cap-request-rerequest.test:ok")
	},
)
