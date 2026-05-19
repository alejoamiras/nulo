import { expect } from "vitest"
import { test, openPopup, waitForHash, typeIntoInput, clickByTestId } from "./fixtures/extension"

test("fresh install shows register page", async ({ extension }) => {
	const page = await openPopup(extension)

	await waitForHash(page, "#/popup/register")

	await page.waitForSelector('[data-testid="register-create-btn"]', { visible: true })
	await page.waitForSelector('[data-testid="register-import-btn"]', { visible: true })
})

test("create profile with password", async ({ extension }) => {
	const page = await openPopup(extension)
	await waitForHash(page, "#/popup/register")

	// Wait for GlobalLoader to disappear
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
		timeout: 15_000,
		polling: 500,
	})

	await clickByTestId(page, "register-create-btn")

	// Wait for RegisterPopup to fully mount
	await page.waitForSelector('[data-testid="register-submit-btn"]', {
		visible: true,
		timeout: 10_000,
	})

	await page.waitForSelector('input[placeholder="Strong password"]', {
		visible: true,
		timeout: 10_000,
	})

	// Fill passwords (≥8 chars, matching)
	const testPassword = "TestPassword123!"
	await typeIntoInput(page, "Strong password", testPassword)
	await typeIntoInput(page, "Repeat password", testPassword)

	// Submit (clickByTestId gates on :disabled so it waits for validation)
	await clickByTestId(page, "register-submit-btn")

	// Wait for async navigation to general page
	await waitForHash(page, "#/popup/general", 15_000)

	// Verify post-registration state
	await page.waitForSelector('[data-testid="balance-amount"]', { visible: true, timeout: 10_000 })
	await page.waitForSelector('[data-testid="actions-send"]', { visible: true, timeout: 5_000 })
	await page.waitForSelector('[data-testid="actions-receive"]', { visible: true, timeout: 5_000 })

	// Bottom navigation tabs present
	const navLinks = await page.evaluate(() => {
		const links = [...document.querySelectorAll("a")]
		return links.map((a) => a.getAttribute("href")).filter((h) => h?.includes("#/popup/"))
	})
	expect(navLinks).toContain("#/popup/activity")
	expect(navLinks).toContain("#/popup/general")
	expect(navLinks).toContain("#/popup/settings")

	// Regression gate: profile creation must produce exactly ONE account.
	// Past bug: app.vue's `initAccount()` and `watch(network)` both ran an
	// auto-create-default-account branch. During profile creation both fired
	// concurrently and raced, sometimes producing 2 accounts at indices 0 and 1.
	// EntityStorage shape: each account stored at `nulo:core:accounts@<address>`.
	const accountCount = await page.evaluate(async () => {
		const all = await new Promise<Record<string, unknown>>((resolve) => chrome.storage.local.get(null, resolve))
		return Object.keys(all).filter((k) => k.startsWith("nulo:core:accounts@")).length
	})
	expect(accountCount).toBe(1)

	expect(extension.consoleErrors).toEqual([])
	expect(extension.pageErrors).toEqual([])
}, 60_000)
