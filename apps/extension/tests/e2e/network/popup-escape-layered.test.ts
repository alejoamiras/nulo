/**
 * A menu open inside a popup keeps the normal layering under Escape: the first press closes the
 * menu while the popup still holds the keyboard, the second closes the popup. The fee-method menu
 * inside the authwits registry popup is the one menu a registry popup hosts, and it has entries
 * only once fee discovery has run against a node — hence the network suite. No transaction is sent.
 */
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { navigateToSettings } from "../fixtures/helpers"
import { settleClosedPopup } from "../fixtures/popup-leave"
import { pointerClick } from "../helpers/legal-drivers"
import { tabAround } from "../helpers/pointer-probes"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const sel = (testid: string) => `[data-testid="${testid}"]`
/** The menu's entries, never its trigger (which shares the prefix). */
const menuItem = '[data-testid^="send-fee-method-"]:not([data-testid="send-fee-method-trigger"])'

test.skipIf(!hasConfig)(
	"escape closes a menu inside a popup first and the popup second",
	{ timeout: 120_000 },
	async ({ localNetworkExtension }) => {
		const page = await openPopup(localNetworkExtension)
		await waitForHash(page, "#/popup/general")

		await navigateToSettings(page, "advanced", "account-state", "authwits")
		await clickByTestId(page, "authwits-actions-btn")
		await clickByTestId(page, "authwits-toggle-registry")
		await page.waitForSelector(sel("registry-toggle-submit"), { visible: true, timeout: 15_000 })

		// The trigger names a method only after fee discovery; before that the menu has nothing to hold.
		await page.waitForFunction(
			(s: string) => Boolean(document.querySelector(s)?.getAttribute("data-fee-method")),
			{ timeout: 30_000, polling: 500 },
			sel("send-fee-method-trigger"),
		)
		await pointerClick(page, "send-fee-method-trigger")
		await page.waitForSelector(menuItem, { visible: true, timeout: 5_000 })

		// First Escape: the menu goes. The popup is still open — proven by containment, not visibility,
		// since a store-closed popup can linger through its leave transition.
		await page.keyboard.press("Escape")
		await page.waitForFunction((s: string) => !document.querySelector(s), { timeout: 5_000, polling: 100 }, menuItem)
		const held = await tabAround(page, 10)
		expect(held).toContain("registry-toggle-submit")
		expect(held).not.toContain("authwits-actions-btn")

		// Second Escape: the popup goes.
		await page.keyboard.press("Escape")
		const forced = await settleClosedPopup(page, "registry-toggle-submit")
		if (forced) console.log("[popup-escape-layered] the popup's leave transition stuck; finished by hand")
		await page.waitForFunction(
			(s: string) => !document.querySelector(s),
			{ timeout: 10_000, polling: 100 },
			sel("registry-toggle-submit"),
		)

		expect(localNetworkExtension.consoleErrors).toEqual([])
		expect(localNetworkExtension.pageErrors).toEqual([])
	},
)
