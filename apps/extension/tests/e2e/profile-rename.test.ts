import { expect } from "vitest"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "./fixtures/extension"
import { navigateByHash, renameProfile, waitForToast } from "./fixtures/helpers"

const NEW_NAME = "Renamed Profile"

test("rename profile is reflected in settings name row", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	// Rename via popup; assert toast and updated name in row
	await renameProfile(page, NEW_NAME)
	await waitForToast(page, "Profile is updated")

	await navigateByHash(page, "#/popup/settings/profile")
	await page.waitForSelector('[data-testid="identity-name-row"]', { visible: true, timeout: 5_000 })
	const visibleName = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="identity-name-row"]')
		return row?.textContent?.trim() ?? ""
	})
	expect(visibleName).toContain(NEW_NAME)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("no-op rename keeps submit disabled", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	// File-scoped fixture: prior test renamed to NEW_NAME, so the active
	// profile name is now NEW_NAME (or the original if test 1 was skipped).
	// Read the input's prefilled value — that's the source of truth.
	await navigateByHash(page, "#/popup/settings/profile")
	await clickByTestId(page, "identity-name-row")
	await page.waitForSelector('[data-testid="profile-name-input"]', { visible: true, timeout: 5_000 })

	const currentName = await page.evaluate(() => {
		const wrapper = document.querySelector('[data-testid="profile-name-input"]')
		const input = wrapper?.querySelector("input") as HTMLInputElement | null
		return input?.value ?? ""
	})
	expect(currentName.length).toBeGreaterThan(0)

	// Re-typing the same name should keep submit disabled (duplicate check).
	await replaceInputValue(page, '[data-testid="profile-name-input"]', currentName)
	const disabled = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="edit-profile-submit"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(disabled).toBe(true)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("cancel resets the rename form to the active name", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateByHash(page, "#/popup/settings/profile")
	await clickByTestId(page, "identity-name-row")
	await page.waitForSelector('[data-testid="profile-name-input"]', { visible: true, timeout: 5_000 })

	const beforeName = await page.evaluate(() => {
		const wrapper = document.querySelector('[data-testid="profile-name-input"]')
		const input = wrapper?.querySelector("input") as HTMLInputElement | null
		return input?.value ?? ""
	})
	expect(beforeName.length).toBeGreaterThan(0)

	await replaceInputValue(page, '[data-testid="profile-name-input"]', "Tentative Name")
	// "Reset changes" reverts the form, doesn't close the popup
	await clickByTestId(page, "edit-profile-cancel")

	const afterName = await page.evaluate(() => {
		const wrapper = document.querySelector('[data-testid="profile-name-input"]')
		const input = wrapper?.querySelector("input") as HTMLInputElement | null
		return input?.value ?? ""
	})
	expect(afterName).toBe(beforeName)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})
