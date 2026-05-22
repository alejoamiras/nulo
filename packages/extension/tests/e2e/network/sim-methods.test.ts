import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities, waitCapabilitiesReady } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Tests #23-#25 — canonical simulation methods (simulateTx, profileTx,
 * executeUtility) are silent on default sessions (PrivateData=4 < confLevel=5).
 *
 * Each parametrized case: grant `accounts` + `simulation` (`accounts` bundle
 * provides both), set token + recipient inputs, click the method's button,
 * assert callExpectingNoPopup result.
 */
const cases: Array<{ id: number; name: string; method: string; btn: string }> = [
	{ id: 23, name: "simulateTx", method: "simulateTx", btn: "pg-btn-simulateTx-transfer" },
	{ id: 24, name: "profileTx", method: "profileTx", btn: "pg-btn-profileTx" },
	{ id: 25, name: "executeUtility", method: "executeUtility", btn: "pg-btn-executeUtility-balance" },
]

for (const c of cases) {
	test.skipIf(!hasConfig)(
		`sim-${c.name} (#${c.id}) — silent path returns ok or error`,
		{ timeout: 120_000 },
		async ({ dappConnectedExtensionPerTest: dappConnectedExtension }) => {
			const page = dappConnectedExtension.playgroundPage

			await page.evaluate(() => {
				const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
				select.value = "accounts"
				select.dispatchEvent(new Event("change", { bubbles: true }))
			})
			const seqGrant = await snapshotResultSeq(page)
			const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 15_000 })
			await clickByTestId(page, "pg-btn-requestCapabilities")
			const popup = await popupP
			await waitCapabilitiesReady(popup)
			const accountIds = await popup.evaluate(() =>
				[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) =>
					r.getAttribute("data-account-id"),
				),
			)
			await approveCapabilities(popup, { accounts: [accountIds[0]!] })
			await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

			// Set inputs the section needs
			await page.evaluate(
				({ token, recipient }: { token: string; recipient: string }) => {
					const setVal = (sel: string, v: string) => {
						const input = document.querySelector<HTMLInputElement>(sel)
						if (!input) return
						const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
						setter?.call(input, v)
						input.dispatchEvent(new Event("input", { bubbles: true }))
					}
					setVal('[data-testid="pg-input-tokenAddress"]', token)
					setVal('[data-testid="pg-input-recipient"]', recipient)
					setVal('[data-testid="pg-input-amount"]', "1")
				},
				{ token: aztecConfig!.tokenAddress, recipient: aztecConfig!.minterAddress },
			)

			const result = await callExpectingNoPopup(dappConnectedExtension, page, c.method, async () => {
				await clickByTestId(page, c.btn)
			})
			expect(["ok", "error"]).toContain(result.status)
		},
	)
}
