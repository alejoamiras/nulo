/**
 * A menu open inside a popup keeps the normal layering under Escape: the first press closes the
 * menu while the popup still holds the keyboard, the second closes the popup. Each press must also
 * come back handled: Chrome closes its toolbar popup, the whole wallet, on an Escape the page leaves
 * unhandled, and this suite's tab would not show it. The fee-method menu is the only menu a registry
 * popup hosts (the two authwits popups); the registry popup keeps its submit disabled until it has
 * read the account's registry state from a node — hence the network suite. The same popup proves
 * that only its focused Send confirms: an Enter on a priority button, on a method in the open fee
 * menu, or held down and carried onto Send never starts the toggle. No transaction is sent.
 */
import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { navigateToSettings } from "../fixtures/helpers"
import { settleClosedPopup } from "../fixtures/popup-leave"
import { pointerClick } from "../helpers/legal-drivers"
import { activeTestId, focusInPopupOf, pressEscape, waitForFocus } from "../helpers/pointer-probes"

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

type BusyWatch = { __busySeen?: boolean; __busyObserver?: MutationObserver }

/** Records every `aria-busy="true"` the submit shows from now on, however brief: `aria-busy`
 *  follows the toggle's loading flag, which its handler sets before its first await. */
async function armBusyWatch(page: Page): Promise<void> {
	await page.evaluate((s: string) => {
		const w = window as unknown as BusyWatch
		w.__busyObserver?.disconnect()
		w.__busySeen = document.querySelector(s)?.getAttribute("aria-busy") === "true"
		const observer = new MutationObserver((records) => {
			for (const r of records) {
				const el = r.target as Element
				if (el.matches(s) && (r.oldValue === "true" || el.getAttribute("aria-busy") === "true")) w.__busySeen = true
			}
		})
		observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-busy"], attributeOldValue: true })
		w.__busyObserver = observer
	}, sel("registry-toggle-submit"))
}

/** Fails when the submit went busy since `armBusyWatch`, read after a 2-second settle. A started
 *  toggle closes the popup once its transaction is done, so the test waits for that first and the
 *  file's teardown never lands mid-send. */
async function expectNoToggle(page: Page, what: string): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 2_000))
	const busy = await page.evaluate(() => {
		const w = window as unknown as BusyWatch
		w.__busyObserver?.disconnect()
		return w.__busySeen === true
	})
	if (busy) {
		console.log(`[popup-escape-layered] ${what} started the registry toggle; letting it finish`)
		await waitForToggleToFinish(page)
	}
	expect(busy, `${what} started the registry toggle`).toBe(false)
}

/** Polls in short reads: a proving transaction outlasts the connection's protocol timeout, which
 *  bounds a single `waitForFunction`. */
async function waitForToggleToFinish(page: Page): Promise<void> {
	const deadline = Date.now() + 780_000
	while (Date.now() < deadline) {
		const busy = await page.evaluate(
			(s: string) => document.querySelector(s)?.getAttribute("aria-busy") === "true",
			sel("registry-toggle-submit"),
		)
		if (!busy) break
		await new Promise((resolve) => setTimeout(resolve, 2_000))
	}
	await settleClosedPopup(page, "registry-toggle-submit").catch(() => false)
}

type EnterRecord = { on: string | null; repeat: boolean }

/** Records each Enter keydown's target and `repeat`, so a driver that sends no repeat fails the held
 *  step instead of passing it. */
async function recordEnterKeydowns(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as { __enterKeydowns?: EnterRecord[] }
		w.__enterKeydowns = []
		window.addEventListener(
			"keydown",
			(e) => {
				if (e.key !== "Enter") return
				const on = e.target instanceof Element ? e.target.closest("[data-testid]")?.getAttribute("data-testid") : null
				w.__enterKeydowns?.push({ on: on ?? null, repeat: e.repeat })
			},
			true,
		)
	})
}

async function focusControl(page: Page, testid: string): Promise<void> {
	await page.focus(sel(testid))
	await waitForFocus(page, testid)
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

test.skipIf(!hasConfig)(
	"an Enter on another control never sends, and a held Enter carried onto Send does not either",
	{ timeout: 900_000 },
	async ({ localNetworkExtension }) => {
		const page = await openPopup(localNetworkExtension)
		await waitForHash(page, "#/popup/general")

		await navigateToSettings(page, "advanced", "account-state", "authwits")
		await clickByTestId(page, "authwits-actions-btn")
		await clickByTestId(page, "authwits-toggle-registry")
		await waitForSubmitLive(page)
		await page.waitForSelector(sel("send-fee-priority-fast"), { visible: true, timeout: 30_000 })

		await focusControl(page, "send-fee-priority-fast")
		await armBusyWatch(page)
		await page.keyboard.press("Enter")
		await expectNoToggle(page, "Enter on a priority button")

		await waitForSubmitLive(page)
		await pointerClick(page, "send-fee-method-trigger")
		await page.waitForSelector(menuItem, { visible: true, timeout: 5_000 })
		await armBusyWatch(page)
		await page.keyboard.press("ArrowDown")
		await page.keyboard.press("Enter")
		// The menu closes on its item's click, so a closed menu is the item's own action having run.
		await page.waitForFunction((s: string) => !document.querySelector(s), { timeout: 5_000, polling: 100 }, menuItem)
		await expectNoToggle(page, "Enter on a fee method in the open menu")

		await waitForSubmitLive(page)
		await recordEnterKeydowns(page)
		await focusControl(page, "send-fee-priority-urgent")
		await armBusyWatch(page)
		await page.keyboard.down("Enter")
		await waitForSubmitLive(page)
		await focusControl(page, "registry-toggle-submit")
		await page.keyboard.down("Enter")
		await page.keyboard.up("Enter")
		const enters = await page.evaluate(() => (window as unknown as { __enterKeydowns?: EnterRecord[] }).__enterKeydowns)
		expect(enters, "the driver sent no repeat onto Send, so the held Enter proved nothing").toEqual([
			{ on: "send-fee-priority-urgent", repeat: false },
			{ on: "registry-toggle-submit", repeat: true },
		])
		await expectNoToggle(page, "A held Enter carried onto Send")

		expect(localNetworkExtension.consoleErrors).toEqual([])
		expect(localNetworkExtension.pageErrors).toEqual([])
	},
)
