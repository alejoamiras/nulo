import type { HTTPRequest, Page } from "puppeteer"
import { expect } from "vitest"
import { test, openPopup, waitForHash } from "./fixtures/extension"
import { navigateToSettings } from "./fixtures/helpers"

// The popup probes Presto HTTPS-first, then runs one witness-free HTTP diagnostic after an HTTPS
// failure. Both are intercepted below the TLS handshake, so no certificate is needed.
const PRESTO_HTTPS_HEALTH_URL = "https://127.0.0.1:59834/health"
const PRESTO_HTTP_HEALTH_URL = "http://127.0.0.1:59833/health"
const PRESTO_DETAILED_HEALTH = {
	status: "ok",
	api_version: 1,
	version: "1.1.1",
	aztec_version: "5.2.0",
	available_versions: ["5.2.0"],
	bb_available: true,
	https_port: 59834,
}

async function interceptHealth(page: Page, mode: "available" | "offline"): Promise<void> {
	await page.setRequestInterception(true)
	page.on("request", (req: HTTPRequest) => {
		if (req.url() !== PRESTO_HTTPS_HEALTH_URL && req.url() !== PRESTO_HTTP_HEALTH_URL) return req.continue()
		if (mode === "offline") return req.abort("connectionrefused")
		if (req.url() === PRESTO_HTTPS_HEALTH_URL) {
			return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(PRESTO_DETAILED_HEALTH) })
		}
		return req.abort("connectionrefused")
	})
}

test("settings → proving with Presto available: the connected card, Details, no Get Presto row", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")
	await interceptHealth(page, "available")

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
	await interceptHealth(page, "offline")

	await navigateToSettings(page)
	await page.waitForSelector('[data-testid="setting-nav-proving"][data-status="offline"]', { visible: true, timeout: 10_000 })

	await navigateToSettings(page, "proving")
	await waitForHash(page, "#/popup/settings/proving")

	await page.waitForSelector('[data-testid="settings-proving-status"][data-status="offline"]', { visible: true, timeout: 10_000 })
	await page.waitForSelector('[data-testid="settings-proving-get"]', { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})
