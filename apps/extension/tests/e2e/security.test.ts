import { expect } from "vitest"
import { TEST_PASSWORD } from "./fixtures/constants"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "./fixtures/extension"
import { changePassword, lockWallet, navigateByHash, waitForToast } from "./fixtures/helpers"

const ORIGINAL_PASSWORD = TEST_PASSWORD
const NEW_PASSWORD = "NewTestPassword456!"

/** During a password rotation the SW re-issues the session encryption key,
 *  which forcibly disconnects every open service client. Each pending or
 *  near-pending request rejects with "Client disconnected" — that surfaces
 *  in `consoleErrors`. The cascade is expected behavior, not a regression. */
const isBenignPasswordChangeError = (msg: string): boolean => msg.includes("Client disconnected")

test("change password rejects too-short and mismatched inputs", async ({ registeredExtensionPerTest }) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general")

	await navigateByHash(page, "#/popup/settings/security/change-password")
	await page.waitForSelector('[data-testid="current-password-input"]', { visible: true, timeout: 5_000 })

	// Too-short new password keeps submit disabled
	await replaceInputValue(page, '[data-testid="current-password-input"]', ORIGINAL_PASSWORD)
	await replaceInputValue(page, '[data-testid="new-password-input"]', "short")
	await replaceInputValue(page, '[data-testid="new-password-repeat-input"]', "short")
	const submitDisabledShort = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="change-password-submit-btn"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(submitDisabledShort).toBe(true)

	// Mismatched repeats keeps submit disabled
	await replaceInputValue(page, '[data-testid="new-password-input"]', "ValidPassword123")
	await replaceInputValue(page, '[data-testid="new-password-repeat-input"]', "DifferentPassword123")
	const submitDisabledMismatch = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="change-password-submit-btn"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(submitDisabledMismatch).toBe(true)

	expect(registeredExtensionPerTest.consoleErrors).toEqual([])
	expect(registeredExtensionPerTest.pageErrors).toEqual([])
})

// Bumped per-test timeout to 120s. The multi-step flow (popup boot →
// changePassword → toast → back-nav → lockWallet → fresh popup → auth) racks
// up on the order of 30-90s on hosted CI's cold-PXE timing curve; the 60s
// config default was too tight, and the prior 30s explicit override was even
// worse (PR #77 era).
test("change password succeeds and unlocks with new password", { timeout: 120_000 }, async ({ registeredExtensionPerTest }) => {
	const page = await openPopup(registeredExtensionPerTest)
	// Bump default 5s → 15s: hosted CI's popup boot + auto-redirect from "#/" to
	// "#/popup/general" can occasionally exceed 5s under cumulative load.
	await waitForHash(page, "#/popup/general", 15_000)

	await changePassword(page, ORIGINAL_PASSWORD, NEW_PASSWORD)
	await waitForToast(page, "Profile password changed")

	// router.back() returns to whatever was previous; we just need to end up
	// somewhere outside the change-password page. With longer timeout because
	// the SW round-trip + back-nav can take >5s under vitest worker pressure.
	await page.waitForFunction(() => !window.location.hash.includes("change-password"), { timeout: 15_000 })

	await lockWallet(page)
	await page.close()

	const page2 = await openPopup(registeredExtensionPerTest)
	await waitForHash(page2, "#/popup/auth", 10_000)

	await page2.waitForSelector('[data-testid="auth-password-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page2, '[data-testid="auth-password-input"]', NEW_PASSWORD)
	await clickByTestId(page2, "auth-submit")

	await page2.waitForFunction(() => !window.location.hash.includes("/popup/auth"), { timeout: 10_000 })

	const nonBenignConsoleErrors = registeredExtensionPerTest.consoleErrors.filter((e) => !isBenignPasswordChangeError(e))
	const nonBenignPageErrors = registeredExtensionPerTest.pageErrors.filter((e) => !isBenignPasswordChangeError(e.message))
	expect(nonBenignConsoleErrors).toEqual([])
	expect(nonBenignPageErrors).toEqual([])
	await page2.close()
})

test("auto-lock TTL change persists across navigation", async ({ registeredExtensionPerTest }) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general")

	await navigateByHash(page, "#/popup/settings/security")
	await page.waitForSelector('[data-testid="auto-lock-input"]', { visible: true, timeout: 5_000 })

	// Targets the descendant <input> of the wrapper that received the testid
	// via inheritAttrs (replaceInputValue handles that fallback).
	await replaceInputValue(page, '[data-testid="auto-lock-input"]', "45")

	// Debounced sessionTtl write fires after 300ms; wait for the toast to
	// confirm the write landed before navigating away.
	await waitForToast(page, "Auto-lock timeout updated")

	// Navigate away and back. Uses `/about` — a real sibling settings page.
	// (Previously `/privacy`, which has no `.vue` page in
	// `src/popup/pages/settings/`; vue-router never settled the hash there
	// and waitForFunction timed out at 5s.)
	await navigateByHash(page, "#/popup/settings/about")
	await navigateByHash(page, "#/popup/settings/security")

	await page.waitForSelector('[data-testid="auto-lock-input"]', { visible: true, timeout: 5_000 })

	const persistedValue = await page.evaluate(() => {
		const wrapper = document.querySelector('[data-testid="auto-lock-input"]')
		const input = wrapper instanceof HTMLInputElement ? wrapper : wrapper?.querySelector("input")
		return (input as HTMLInputElement | null)?.value ?? null
	})
	expect(persistedValue).toBe("45")

	const nonBenignConsoleErrors = registeredExtensionPerTest.consoleErrors.filter((e) => !isBenignPasswordChangeError(e))
	const nonBenignPageErrors = registeredExtensionPerTest.pageErrors.filter((e) => !isBenignPasswordChangeError(e.message))
	expect(nonBenignConsoleErrors).toEqual([])
	expect(nonBenignPageErrors).toEqual([])
})
