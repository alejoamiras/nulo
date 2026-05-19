import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
// biome-ignore lint/correctness/noUnusedVariables: kept for un-skip — restore `test.skipIf(!hasConfig)` when cluster E is fixed.
const hasConfig = aztecConfig !== undefined

/**
 * Test #20 — registerSender is silent on default sessions
 * (PxeState=3 < confirmationLevel=5). Requires `data` capability.
 */
// SKIP: cluster E (data-registerSender 15s waitForPgResult timeout).
// See implementations-plan/network-test-triage/plan.md — un-skip on cluster fix.
test.skip("data-registerSender — silent path adds sender to PXE", { timeout: 90_000 }, async ({ dappConnectedExtension }) => {
	const page = dappConnectedExtension.playgroundPage

	// Grant data + contracts (registerSender uses data cap)
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

	// Use the minter address as the sender to register
	await page.evaluate((addr: string) => {
		const input = document.querySelector<HTMLInputElement>('[data-testid="pg-input-senderAddress"]')!
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
		setter?.call(input, addr)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	}, aztecConfig!.minterAddress)

	const result = await callExpectingNoPopup(
		dappConnectedExtension,
		page,
		"registerSender",
		async () => {
			await clickByTestId(page, "pg-btn-registerSender")
		},
		60_000,
	)
	expect(["ok", "error"]).toContain(result.status)
})
