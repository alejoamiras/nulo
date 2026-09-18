import type { Page } from "puppeteer"
import { expect } from "vitest"
import { clickByTestId, openPopup, test, waitForHash } from "./fixtures/extension"
import { navigateToSettings } from "./fixtures/helpers"
import { interceptHealth, PRESTO_DETAILED_HEALTH, PRESTO_HTTP_HEALTH_URL, PRESTO_HTTPS_HEALTH_URL } from "./fixtures/presto"

const rowSelector = (status: string) => `[data-testid="setting-nav-proving"][data-status="${status}"]`
const cardSelector = (status: string) => `[data-testid="settings-proving-status"][data-status="${status}"]`

/** Counts the health probes the page sends; `interceptHealth`'s own listener answers them. */
function countProbes(page: Page): () => number {
	let probes = 0
	page.on("request", (req) => {
		if (req.url() === PRESTO_HTTPS_HEALTH_URL || req.url() === PRESTO_HTTP_HEALTH_URL) probes++
	})
	return () => probes
}

async function backToSettingsList(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.location.hash = "#/popup/settings"
	})
	await waitForHash(page, "#/popup/settings")
}

test("settings rests without probing; a check that reaches Presto is remembered, and the list then probes on its own", async ({
	registeredExtensionPerTest,
}) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general")
	await interceptHealth(page, { https: { status: 200, body: PRESTO_DETAILED_HEALTH }, http: "refused" })
	const probes = countProbes(page)

	// A probe can raise the browser's local-network prompt, so neither page may send one unasked.
	await navigateToSettings(page)
	await page.waitForSelector(rowSelector("idle"), { visible: true, timeout: 10_000 })
	await navigateToSettings(page, "proving")
	await waitForHash(page, "#/popup/settings/proving")
	await page.waitForSelector(cardSelector("idle"), { visible: true, timeout: 10_000 })
	await page.waitForSelector('[data-testid="settings-proving-get"]', { visible: true, timeout: 5_000 })
	expect(probes()).toBe(0)

	await clickByTestId(page, "settings-proving-retry")
	await page.waitForSelector(cardSelector("available"), { visible: true, timeout: 10_000 })
	const state = await page.evaluate(() => ({
		retry: !!document.querySelector('[data-testid="settings-proving-retry"]'),
		get: !!document.querySelector('[data-testid="settings-proving-get"]'),
	}))
	expect(state).toEqual({ retry: true, get: false })

	// The card turns `available` before the flag's write lands, and the list reads the flag once.
	await page.waitForFunction(
		async () => {
			// ValueStorage persists the config as one JSON string.
			const raw = (await chrome.storage.local.get("nulo:config"))["nulo:config"]
			return typeof raw === "string" && (JSON.parse(raw) as { prestoReached?: boolean }).prestoReached === true
		},
		{ timeout: 10_000 },
	)
	await backToSettingsList(page)
	await page.waitForSelector(rowSelector("available"), { visible: true, timeout: 10_000 })

	expect(registeredExtensionPerTest.consoleErrors).toEqual([])
	expect(registeredExtensionPerTest.pageErrors).toEqual([])
})

test("a check that finds nothing shows the not-running card and the Get Presto row, and is not remembered", async ({
	registeredExtensionPerTest,
}) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general")
	await interceptHealth(page, { https: "refused", http: "refused" })
	const probes = countProbes(page)

	await navigateToSettings(page, "proving")
	await waitForHash(page, "#/popup/settings/proving")
	await page.waitForSelector(cardSelector("idle"), { visible: true, timeout: 10_000 })
	await clickByTestId(page, "settings-proving-retry")
	await page.waitForSelector(cardSelector("offline"), { visible: true, timeout: 10_000 })
	await page.waitForSelector('[data-testid="settings-proving-get"]', { visible: true, timeout: 5_000 })

	// `offline` cannot tell a granted permission from a dismissed prompt, so the list stays at rest.
	const afterCheck = probes()
	await backToSettingsList(page)
	await page.waitForSelector(rowSelector("idle"), { visible: true, timeout: 10_000 })
	expect(probes()).toBe(afterCheck)

	expect(registeredExtensionPerTest.consoleErrors).toEqual([])
	expect(registeredExtensionPerTest.pageErrors).toEqual([])
})
