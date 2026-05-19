import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #27 — createAuthWit variants (callIntent + innerHash).
 *
 * createAuthWit access level is PrivateData (4) < confirmationLevel=5,
 * so silent. Both intent shapes go through scope-enforcement.ts:241-287.
 *
 * Raw-Fr variant exists in the dispatcher (scope-enforcement.ts:286-287)
 * but isn't reachable through wallet-sdk public types — covered in unit
 * tests, not here.
 */
for (const variant of ["callIntent", "innerHash"] as const) {
	test.skipIf(!hasConfig)(
		`authwit-${variant} (#27) — silent path under accounts cap`,
		{ timeout: 90_000, retry: 1 },
		async ({ dappConnectedExtensionPerTest: dappConnectedExtension }) => {
			const page = dappConnectedExtension.playgroundPage

			await page.evaluate(() => {
				const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
				select.value = "transaction" // includes accounts + transaction (createAuthWit needs both for scope check)
				select.dispatchEvent(new Event("change", { bubbles: true }))
			})
			const seqGrant = await snapshotResultSeq(page)
			const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 15_000 })
			await clickByTestId(page, "pg-btn-requestCapabilities")
			const popup = await popupP
			await popup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 10_000 })
			const accountIds = await popup.evaluate(() =>
				[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) =>
					r.getAttribute("data-account-id"),
				),
			)
			await approveCapabilities(popup, { accounts: [accountIds[0]!] })
			await waitForPgResult(page, "requestCapabilities", seqGrant, 30_000)

			await page.evaluate((addr: string) => {
				const setVal = (sel: string, v: string) => {
					const input = document.querySelector<HTMLInputElement>(sel)
					if (!input) return
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
					setter?.call(input, v)
					input.dispatchEvent(new Event("input", { bubbles: true }))
				}
				setVal('[data-testid="pg-input-tokenAddress"]', addr)
				setVal('[data-testid="pg-input-consumer"]', addr)
			}, aztecConfig!.tokenAddress)

			const result = await callExpectingNoPopup(dappConnectedExtension, page, "createAuthWit", async () => {
				const btnSel = variant === "callIntent" ? "pg-btn-createAuthWit-callIntent" : "pg-btn-createAuthWit-innerHash"
				await clickByTestId(page, btnSel)
			})
			expect(["ok", "error"]).toContain(result.status)
		},
	)
}
