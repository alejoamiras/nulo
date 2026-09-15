import { expect } from "vitest"
import { test, openPopup, waitForHash } from "./fixtures/extension"
import { navigateToSettings } from "./fixtures/helpers"
import { interceptHealth, PRESTO_DETAILED_HEALTH } from "./fixtures/presto"

test("settings → proving with Presto available: the connected card, Details, no Get Presto row", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")
	await interceptHealth(page, { https: { status: 200, body: PRESTO_DETAILED_HEALTH }, http: "refused" })

	await navigateToSettings(page, "proving")
	await waitForHash(page, "#/popup/settings/proving")

	await page.waitForSelector('[data-testid="settings-proving-status"][data-status="available"]', { visible: true, timeout: 10_000 })
	const state = await page.evaluate(() => ({
		retry: !!document.querySelector('[data-testid="settings-proving-retry"]'),
		get: !!document.querySelector('[data-testid="settings-proving-get"]'),
	}))
	expect(state).toEqual({ retry: true, get: false })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("settings → proving with nothing listening: the not-detected card and the Get Presto row; the index row agrees", async ({
	registeredExtension,
}) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")
	await interceptHealth(page, { https: "refused", http: "refused" })

	await navigateToSettings(page)
	await page.waitForSelector('[data-testid="setting-nav-proving"][data-status="offline"]', { visible: true, timeout: 10_000 })

	await navigateToSettings(page, "proving")
	await waitForHash(page, "#/popup/settings/proving")

	await page.waitForSelector('[data-testid="settings-proving-status"][data-status="offline"]', { visible: true, timeout: 10_000 })
	await page.waitForSelector('[data-testid="settings-proving-get"]', { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})
