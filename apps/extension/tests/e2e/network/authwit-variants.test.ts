import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { waitForPopup, approveCapabilities, approveExecute } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #27 — createAuthWit variants (callIntent + innerHash).
 *
 * AUDIT (F-01): createAuthWit routes by scope coverage. A `callIntent` covered by the
 * granted transaction scope signs SILENTLY (within authority the dApp already holds). An
 * `innerHash` — whose inner hash is attacker-chosen and cannot be scope-verified — now
 * requires an EXPLICIT confirmation popup (it was silently signed under an accounts cap:
 * the F-01 hole). Raw `Fr` is rejected in the dispatcher and isn't reachable through
 * wallet-sdk public types — covered in unit tests, not here.
 */
for (const variant of ["callIntent", "innerHash"] as const) {
	test.skipIf(!hasConfig)(
		`authwit-${variant} (#27) — ${variant === "innerHash" ? "confirmation popup" : "silent path"} under accounts cap`,
		{ timeout: 90_000 },
		async ({ dappConnectedExtensionPerTest: dappConnectedExtension }) => {
			const page = dappConnectedExtension.playgroundPage

			await page.evaluate(() => {
				const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
				select.value = "transaction" // includes accounts + transaction (createAuthWit needs both for scope check)
				select.dispatchEvent(new Event("change", { bubbles: true }))
			})
			const seqGrant = await snapshotResultSeq(page)
			const popupP = waitForPopup(dappConnectedExtension, "capabilities", { timeout: 30_000 })
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

			if (variant === "callIntent") {
				// Covered by the granted transaction scope → signs silently.
				const result = await callExpectingNoPopup(dappConnectedExtension, page, "createAuthWit", async () => {
					await clickByTestId(page, "pg-btn-createAuthWit-callIntent")
				})
				expect(["ok", "error"]).toContain(result.status)
			} else {
				// innerHash → explicit confirmation popup (F-01): the opaque inner hash can't be
				// scope-verified, so the user approves it. Then read the dApp-side result.
				const seq = await snapshotResultSeq(page)
				const popupP = waitForPopup(dappConnectedExtension, "execute", { timeout: 30_000 })
				await clickByTestId(page, "pg-btn-createAuthWit-innerHash")
				const popup = await popupP
				await approveExecute(popup)
				const result = await waitForPgResult(page, "createAuthWit", seq, 30_000)
				expect(["ok", "error"]).toContain(result.status)
			}
		},
	)
}
