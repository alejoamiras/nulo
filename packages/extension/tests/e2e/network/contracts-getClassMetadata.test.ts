import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #19 — getContractClassMetadata is silent on default sessions.
 *
 * Uses `contractClasses` capability. Class id is a Fr — for the test we
 * pass the token address as a class-id substitute (the call may return an
 * empty/fail result; the test verifies the SILENT-PATH dispatch, not the
 * data correctness).
 */
test.skipIf(!hasConfig)("contracts-getClassMetadata — silent path", { timeout: 90_000 }, async ({ dappConnectedExtension }) => {
	const page = dappConnectedExtension.playgroundPage

	// Grant contractClasses bundle
	await page.evaluate(() => {
		const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
		select.value = "contractClasses"
		select.dispatchEvent(new Event("change", { bubbles: true }))
	})
	const seqGrant = await snapshotResultSeq(page)
	const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 15_000 })
	await clickByTestId(page, "pg-btn-requestCapabilities")
	await approveCapabilities(await popupP)
	await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

	// Set classId input (using token address as a placeholder Fr)
	await page.evaluate((addr: string) => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="pg-input-classId"]')!
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
		setter?.call(input, addr)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, aztecConfig!.tokenAddress)

	const result = await callExpectingNoPopup(dappConnectedExtension, page, "getContractClassMetadata", async () => {
		await clickByTestId(page, "pg-btn-getContractClassMetadata")
	})
	// status may be ok (empty result) or error (invalid class id) — both are silent
	expect(["ok", "error"]).toContain(result.status)
})
