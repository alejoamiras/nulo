import { expect } from "vitest"
import { test, openPopup, waitForHash } from "./fixtures/extension"
import { clickNavTab } from "./fixtures/helpers"

test("settings page shows all sections", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await clickNavTab(page, "settings")
	await waitForHash(page, "#/popup/settings")

	// Assert core settings destinations exist by testid. Route segments are
	// the stable contract even when section labels get reorganized.
	for (const segment of ["profile", "accounts", "security", "networks", "tokens"]) {
		await page.waitForSelector(`[data-testid="setting-nav-${segment}"]`, {
			visible: true,
			timeout: 5_000,
		})
	}
	// About is a footer link with a real href (not a SettingItem)
	await page.waitForSelector('a[href="#/popup/settings/about"]', { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("activity page shows empty state", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await clickNavTab(page, "activity")
	await waitForHash(page, "#/popup/activity")

	// The activity page should show its hero title
	await page.waitForSelector("text/HISTORY", { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("bottom navigation switches between pages", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await clickNavTab(page, "activity")
	await waitForHash(page, "#/popup/activity")

	await clickNavTab(page, "settings")
	await waitForHash(page, "#/popup/settings")

	await clickNavTab(page, "general")
	await waitForHash(page, "#/popup/general")

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("about page shows version info", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await clickNavTab(page, "settings")
	await waitForHash(page, "#/popup/settings")

	// Jump directly via router rather than clicking the below-the-fold footer link
	await page.evaluate(() => {
		const link = document.querySelector<HTMLAnchorElement>('a[href="#/popup/settings/about"]')
		link?.click()
	})

	await waitForHash(page, "#/popup/settings/about")

	// About page embeds wallet + Aztec version strings. These are informational
	// fixed labels, safe to text-match.
	await page.waitForSelector("text/Wallet version", { visible: true, timeout: 5_000 })
	await page.waitForSelector("text/Aztec version", { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})
