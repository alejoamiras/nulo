import { expect } from "vitest"
import { TEST_PASSWORD } from "./fixtures/constants"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "./fixtures/extension"
import { lockWallet, openForgotPasswordFromAuth } from "./fixtures/helpers"

test("wrong password surfaces error-text and lets the user retry", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await lockWallet(page)
	await page.close()

	const page2 = await openPopup(registeredExtension)
	await waitForHash(page2, "#/popup/auth", 10_000)

	await page2.waitForSelector('[data-testid="auth-password-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page2, '[data-testid="auth-password-input"]', "WrongPassword!")
	await clickByTestId(page2, "auth-submit")

	// Error appears, with role="alert" + testid contract
	await page2.waitForSelector('[data-testid="error-text"][role="alert"]', { visible: true, timeout: 10_000 })

	// Field clears on retry-input — verify by typing the correct password and unlocking
	await replaceInputValue(page2, '[data-testid="auth-password-input"]', TEST_PASSWORD)
	await clickByTestId(page2, "auth-submit")
	await page2.waitForFunction(() => !window.location.hash.includes("/popup/auth"), { timeout: 10_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
	await page2.close()
}, 30_000)

test("ForgotPassword link opens popup and routes to reset", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await lockWallet(page)
	await page.close()

	const page2 = await openPopup(registeredExtension)
	await waitForHash(page2, "#/popup/auth", 10_000)

	await openForgotPasswordFromAuth(page2)
	await clickByTestId(page2, "forgot-reset-btn")

	// handleReset calls popupStore.closeAll() then router.push to reset
	await page2.waitForFunction(() => window.location.hash.includes("/popup/settings/security/reset"), { timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
	await page2.close()
}, 30_000)

// Tests 3-4 use the per-test fixture: each gets a fresh registered browser,
// so prior test state (locked wallet, lingering popups) can't leak across
// tests. The lock-and-reopen dance is heavy enough that a clean fixture is
// simpler than recovering arbitrary state.
test("SelectProfile from auth lists the active profile", async ({ registeredExtensionPerTest }) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general")

	await lockWallet(page)
	await page.close()

	const page2 = await openPopup(registeredExtensionPerTest)
	await waitForHash(page2, "#/popup/auth", 10_000)

	await clickByTestId(page2, "auth-profile")
	await page2.waitForSelector('[data-testid="select-profile-row"]', { visible: true, timeout: 5_000 })

	const rows = await page2.$$('[data-testid="select-profile-row"]')
	expect(rows.length).toBeGreaterThanOrEqual(1)
	const firstId = await rows[0].evaluate((el) => el.getAttribute("data-profile-id"))
	const firstName = await rows[0].evaluate((el) => el.getAttribute("data-profile-name"))
	expect(firstId).toBeTruthy()
	expect(firstName).toBeTruthy()

	expect(registeredExtensionPerTest.consoleErrors).toEqual([])
	expect(registeredExtensionPerTest.pageErrors).toEqual([])
	await page2.close()
}, 30_000)

test("SelectProfile new-btn routes to /popup/profile/new", async ({ registeredExtensionPerTest }) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general")

	await lockWallet(page)
	await page.close()

	const page2 = await openPopup(registeredExtensionPerTest)
	await waitForHash(page2, "#/popup/auth", 10_000)

	await clickByTestId(page2, "auth-profile")
	await page2.waitForSelector('[data-testid="select-profile-new-btn"]', { visible: true, timeout: 5_000 })
	await clickByTestId(page2, "select-profile-new-btn")

	await page2.waitForFunction(() => window.location.hash.includes("/popup/profile/new"), { timeout: 5_000 })

	expect(registeredExtensionPerTest.pageErrors).toEqual([])
	await page2.close()
}, 30_000)
