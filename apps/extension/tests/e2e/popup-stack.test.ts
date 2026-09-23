/**
 * The popup stack in a real browser: a popup opened over another covers it, holds the keyboard,
 * and hands both back when it closes. The Send page's review sheet takes a slot on this same
 * stack, so this is the browser half of what its page tests assert as orders and trap calls.
 */
import { expect } from "vitest"
import { clickByTestId, openPopup, test, waitForHash } from "./fixtures/extension"
import { settleClosedPopup } from "./fixtures/popup-leave"
import { pointerClick } from "./helpers/legal-drivers"
import { coveredAt, tabAround, waitForFocus } from "./helpers/pointer-probes"

const sel = (testid: string) => `[data-testid="${testid}"]`

/** The element is hit-testable at its centre again — the popup over it is really gone, not mid-leave. */
async function waitUntilReachable(page: import("puppeteer").Page, testid: string): Promise<void> {
	await page.waitForFunction(
		(s: string) => {
			const el = document.querySelector(s)
			if (!el) return false
			const box = el.getBoundingClientRect()
			const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
			return Boolean(top) && (el === top || el.contains(top))
		},
		{ timeout: 10_000, polling: 100 },
		sel(testid),
	)
}

test("a popup over a popup: the lower one is covered, Tab stays in the top one, closing it hands both back", async ({
	registeredExtension,
}) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await clickByTestId(page, "account-avatar-btn")
	await page.waitForSelector(sel("accounts-popup"), { visible: true, timeout: 5_000 })
	expect(await coveredAt(page, "account-item")).toBeNull()

	await pointerClick(page, "accounts-popup-new")
	await page.waitForSelector(sel("account-name-input"), { visible: true, timeout: 5_000 })

	// Covered: the pointer would land on the newer popup, never on the row beneath it.
	expect(await coveredAt(page, "account-item")).not.toBeNull()
	expect(await coveredAt(page, "accounts-popup-new")).not.toBeNull()

	// Held: however far Tab goes, it never reaches the lower popup's controls.
	const inside = await tabAround(page, 8)
	expect(inside).toContain("account-name-input")
	expect(inside).not.toContain("account-item")
	expect(inside).not.toContain("accounts-popup-new")

	// Handed back: the top popup's own close control — the last one on the stack — is reachable, and
	// once it has gone the row is hit-testable again and Tab cycles inside the lower popup.
	await pointerClick(page, "popup-close-btn", { last: true })
	const forced = await settleClosedPopup(page, "account-name-input")
	if (forced) console.log("[popup-stack] the top popup's leave transition stuck; finished by hand")
	await waitUntilReachable(page, "account-item")
	const below = await tabAround(page, 8)
	expect(below).toContain("popup-close-btn")
	expect(below).not.toContain("account-name-input")
	expect(below).not.toContain("new-account-submit")

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)

test("Escape closes only the top popup, and each close hands focus back to the control that opened it", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	// Real pointer input: each opener holds focus when its popup opens, which is where focus must return.
	await pointerClick(page, "account-avatar-btn")
	await page.waitForSelector(sel("accounts-popup"), { visible: true, timeout: 5_000 })
	await pointerClick(page, "accounts-popup-new")
	await page.waitForSelector(sel("account-name-input"), { visible: true, timeout: 5_000 })
	expect(await coveredAt(page, "account-item")).not.toBeNull()

	// The keyboard is inside the top popup before Escape is pressed, not parked on the opener.
	const inside = await tabAround(page, 2)
	expect(inside.some((t) => ["account-name-input", "new-account-submit", "popup-close-btn"].includes(t))).toBe(true)
	expect(inside).not.toContain("account-item")
	expect(inside).not.toContain("accounts-popup-new")

	// First Escape: the top popup goes, the lower one stays and gets the keyboard back at its opener.
	await page.keyboard.press("Escape")
	const forcedTop = await settleClosedPopup(page, "account-name-input")
	if (forcedTop) console.log("[popup-stack] the top popup's leave transition stuck; finished by hand")
	await waitUntilReachable(page, "account-item")
	await waitForFocus(page, "accounts-popup-new")
	await page.waitForSelector(sel("accounts-popup"), { visible: true, timeout: 5_000 })
	const below = await tabAround(page, 4)
	expect(below).toContain("popup-close-btn")
	expect(below).not.toContain("account-name-input")
	expect(below).not.toContain("new-account-submit")

	// Second Escape: the lower popup goes and focus lands on the button that opened it.
	await page.keyboard.press("Escape")
	const forcedLower = await settleClosedPopup(page, "accounts-popup")
	if (forcedLower) console.log("[popup-stack] the lower popup's leave transition stuck; finished by hand")
	await page.waitForFunction((s: string) => !document.querySelector(s), { timeout: 10_000, polling: 100 }, sel("accounts-popup"))
	await waitForFocus(page, "account-avatar-btn")

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)
