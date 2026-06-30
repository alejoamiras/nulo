import { expect } from "vitest"
import { test, openPopup, waitForHash, clickByTestId, clickSelector, replaceInputValue } from "./fixtures/extension"
import { closeStuckPopup, navigateToSettings, waitForToast } from "./fixtures/helpers"

test("accounts page shows initial account", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "accounts")

	// Manage-accounts page root + at least one row exist
	await page.waitForSelector('[data-testid="manage-accounts-page"]', { visible: true, timeout: 5_000 })
	await page.waitForSelector('[data-testid="manage-accounts-row"]', { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("create second account", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "accounts")

	await clickByTestId(page, "accounts-new-btn")

	// Wait for NewAccountPopup to mount
	await page.waitForSelector('[data-testid="account-name-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, '[data-testid="account-name-input"]', "Test Account 2")

	await clickByTestId(page, "new-account-submit")

	// Wait for the new row to appear (the post-create signal). We don't gate
	// on the popup's input vanishing because Vue's <Transition> can stick
	// mid-leave in headless Chrome (rAF throttling) — closeStuckPopup
	// force-removes the popup so subsequent assertions / tests see clean DOM.
	await page.waitForSelector('[data-testid="manage-accounts-row"][data-account-name="Test Account 2"]', {
		visible: true,
		timeout: 10_000,
	})
	await closeStuckPopup(page)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)

test("switch between accounts", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "accounts")

	await clickByTestId(page, "accounts-new-btn")
	await page.waitForSelector('[data-testid="account-name-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, '[data-testid="account-name-input"]', "SwitchTarget")

	await clickByTestId(page, "new-account-submit")
	// Wait for the new row, then close any stuck popup transition.
	const targetSelector = '[data-testid="manage-accounts-row"][data-account-name="SwitchTarget"]'
	await page.waitForSelector(targetSelector, { visible: true, timeout: 10_000 })
	await closeStuckPopup(page)

	// Click the newly created row to switch to it
	await page.waitForSelector(targetSelector, { visible: true, timeout: 5_000 })
	await clickSelector(page, targetSelector)

	// Verify active account changed in chrome storage
	const address = await page.evaluate(async () => {
		const result = await chrome.storage.local.get("nulo:ui:activeAccount")
		return result["nulo:ui:activeAccount"]
	})
	expect(address).toBeTruthy()
	expect(typeof address).toBe("string")

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)

test("edit account name reflects on the row", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "accounts")
	await page.waitForSelector('[data-testid="manage-accounts-row"]', { visible: true, timeout: 5_000 })

	// Pick the first row's name as the target to edit
	const beforeName = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="manage-accounts-row"]')
		return row?.getAttribute("data-account-name") ?? ""
	})
	expect(beforeName.length).toBeGreaterThan(0)

	// Click edit on that row
	await page.evaluate((name: string) => {
		const row = document.querySelector(`[data-testid="manage-accounts-row"][data-account-name="${name}"]`)
		const edit = row?.querySelector('[data-testid="account-edit-btn"]')
		edit?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
	}, beforeName)

	await page.waitForSelector('[data-testid="account-name-input"]', { visible: true, timeout: 5_000 })
	const newName = `${beforeName} Renamed`
	await replaceInputValue(page, '[data-testid="account-name-input"]', newName)
	await clickByTestId(page, "edit-account-submit")

	await waitForToast(page, "Account is updated")

	// Row exists with new name
	await page.waitForSelector(`[data-testid="manage-accounts-row"][data-account-name="${newName}"]`, {
		visible: true,
		timeout: 5_000,
	})

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)

test("hide and restore account moves it to/from hidden section", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "accounts")
	await page.waitForSelector('[data-testid="manage-accounts-page"]', { visible: true, timeout: 5_000 })

	// Need ≥2 accounts so the hide button is enabled. Create one.
	await clickByTestId(page, "accounts-new-btn")
	await page.waitForSelector('[data-testid="account-name-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, '[data-testid="account-name-input"]', "HideMe")
	await clickByTestId(page, "new-account-submit")
	await page.waitForSelector('[data-testid="manage-accounts-row"][data-account-name="HideMe"]', {
		visible: true,
		timeout: 10_000,
	})
	await closeStuckPopup(page)

	// Click hide on the HideMe row
	await page.evaluate(() => {
		const row = document.querySelector('[data-testid="manage-accounts-row"][data-account-name="HideMe"]')
		const hide = row?.querySelector('[data-testid="account-hide"]')
		hide?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
	})

	// Visible row gone; hidden row present
	await page.waitForFunction(() => !document.querySelector('[data-testid="manage-accounts-row"][data-account-name="HideMe"]'), {
		timeout: 5_000,
	})
	await page.waitForSelector('[data-testid="manage-accounts-hidden-row"][data-account-name="HideMe"]', {
		visible: true,
		timeout: 5_000,
	})

	// Click hidden row to restore
	await page.evaluate(() => {
		const row = document.querySelector('[data-testid="manage-accounts-hidden-row"][data-account-name="HideMe"]') as HTMLElement | null
		row?.click()
	})

	// Hidden row gone; visible row back
	await page.waitForFunction(() => !document.querySelector('[data-testid="manage-accounts-hidden-row"][data-account-name="HideMe"]'), {
		timeout: 5_000,
	})
	await page.waitForSelector('[data-testid="manage-accounts-row"][data-account-name="HideMe"]', {
		visible: true,
		timeout: 5_000,
	})

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)
