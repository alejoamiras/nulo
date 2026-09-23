/**
 * A menu open inside a popup keeps the normal layering under Escape: the first press closes the
 * menu while the popup still holds the keyboard, the second closes the popup. Each press must also
 * come back handled: Chrome closes its toolbar popup, the whole wallet, on an Escape the page leaves
 * unhandled, and this suite's tab would not show it. The fee-method menu is the only menu a registry
 * popup hosts (the two authwits popups); the registry popup keeps its submit disabled until it has
 * read the account's registry state from a node — hence the network suite. No transaction is sent.
 */
import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { navigateToSettings } from "../fixtures/helpers"
import { settleClosedPopup } from "../fixtures/popup-leave"
import { pointerClick } from "../helpers/legal-drivers"
import { activeTestId, focusInPopupOf } from "../helpers/pointer-probes"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const sel = (testid: string) => `[data-testid="${testid}"]`
const menuItem = '[data-testid^="send-fee-method-"]:not([data-testid="send-fee-method-trigger"])'

/** Waits for the submit to go live. It is disabled until the fee settings are in and while the registry
 *  read is in flight, so the menu then opens in a popup done loading; a disabled submit is no Tab stop. */
async function waitForSubmitLive(page: Page): Promise<void> {
	await page.waitForFunction(
		(s: string) => {
			const el = document.querySelector<HTMLButtonElement>(s)
			return Boolean(el && !el.disabled)
		},
		{ timeout: 30_000, polling: 250 },
		sel("registry-toggle-submit"),
	)
}

type EscapeRead = { __escapeHandled?: boolean; __escapeReader?: true }

/** Presses Escape and returns whether the page marked it handled. A window listener reads it, after
 *  every document listener has had its turn. */
async function pressEscape(page: Page): Promise<boolean> {
	await page.evaluate(() => {
		const w = window as unknown as EscapeRead
		w.__escapeHandled = undefined
		if (w.__escapeReader) return
		w.__escapeReader = true
		window.addEventListener("keydown", (e) => {
			if (e.key === "Escape") w.__escapeHandled = e.defaultPrevented
		})
	})
	await page.keyboard.press("Escape")
	await page.waitForFunction(() => (window as unknown as EscapeRead).__escapeHandled !== undefined, {
		timeout: 5_000,
		polling: 50,
	})
	return page.evaluate(() => (window as unknown as EscapeRead).__escapeHandled === true)
}

test.skipIf(!hasConfig)(
	"escape closes a menu inside a popup first and the popup second",
	{ timeout: 120_000 },
	async ({ localNetworkExtension }) => {
		const page = await openPopup(localNetworkExtension)
		await waitForHash(page, "#/popup/general")

		await navigateToSettings(page, "advanced", "account-state", "authwits")
		await clickByTestId(page, "authwits-actions-btn")
		await clickByTestId(page, "authwits-toggle-registry")
		await waitForSubmitLive(page)

		await pointerClick(page, "send-fee-method-trigger")
		await page.waitForSelector(menuItem, { visible: true, timeout: 5_000 })

		expect(await pressEscape(page), "the menu's Escape went unhandled; the toolbar popup would close").toBe(true)
		await page.waitForFunction((s: string) => !document.querySelector(s), { timeout: 5_000, polling: 100 }, menuItem)

		// The popup is still open — proven by containment, not visibility, since a store-closed popup can
		// linger through its leave transition.
		await waitForSubmitLive(page)
		const landings: string[] = []
		for (let i = 0; i < 10; i++) {
			await page.keyboard.press("Tab")
			const where = await activeTestId(page)
			expect(await focusInPopupOf(page, "registry-toggle-submit"), `Tab ${i + 1} left the popup for ${where}`).toBe(true)
			landings.push(where)
		}
		expect(landings).toContain("registry-toggle-submit")

		expect(await pressEscape(page), "the popup's Escape went unhandled; the toolbar popup would close").toBe(true)
		const forced = await settleClosedPopup(page, "registry-toggle-submit")
		if (forced) console.log("[popup-escape-layered] the popup's leave transition stuck; finished by hand")
		await page.waitForFunction(
			(s: string) => !document.querySelector(s),
			{ timeout: 10_000, polling: 100 },
			sel("registry-toggle-submit"),
		)
		// Nothing is left to close, so this press stays unhandled (in the toolbar popup, the browser's own
		// close), which also proves the reads above can see an unhandled press.
		expect(await pressEscape(page)).toBe(false)

		expect(localNetworkExtension.consoleErrors).toEqual([])
		expect(localNetworkExtension.pageErrors).toEqual([])
	},
)
