/**
 * Smoke coverage for the duplicate-recovery-phrase warn-and-confirm (owner policy: a warned
 * choice, never a hard block — see `implementations-plan/key-model-v2-hardening/plan.md` §C).
 *
 * The flow: reveal profile A's recovery phrase, then import that SAME phrase as a new profile.
 * The service throws the typed `DuplicateWalletError`; the shared import composable catches it,
 * raises the standard ConfirmPopup, and — on confirm — retries with the override so the
 * duplicate profile is created.
 */
import { expect } from "vitest"
import type { Page } from "puppeteer"
import { TEST_PASSWORD } from "./fixtures/constants"
import { clickByTestId, openPopup, replaceInputValue, test, waitForHash } from "./fixtures/extension"
import { acceptConfirmPopup, closeStuckPopup, navigateByHash, revealSeedPhrase } from "./fixtures/helpers"

/** Read the revealed recovery phrase out of the reveal card. */
async function readRevealedPhrase(page: Page): Promise<string> {
	const phrase = await page.evaluate(() => {
		const scope = document.querySelector('[data-testid="reveal-content"]')
		const input = scope?.querySelector("input") as HTMLInputElement | null
		return input?.value ?? ""
	})
	expect(phrase.trim().split(/\s+/).length).toBe(24)
	return phrase.trim()
}

/** Fill the popup import form for the recovery-phrase option and submit. */
async function submitSeedImport(page: Page, phrase: string, profileName: string): Promise<void> {
	await navigateByHash(page, "#/popup/import", 15_000)
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), { timeout: 15_000, polling: 300 })
	await page.waitForSelector('[data-testid="import-option-seed"]', { visible: true, timeout: 15_000 })
	await clickByTestId(page, "import-option-seed")
	await page.waitForSelector('[data-testid="import-seed-input"] input', { visible: true, timeout: 15_000 })
	await replaceInputValue(page, '[data-testid="import-name-input"] input', profileName)
	await replaceInputValue(page, '[data-testid="import-seed-input"] input', phrase)
	await replaceInputValue(page, '[data-testid="import-password-input"] input', TEST_PASSWORD)
	await replaceInputValue(page, '[data-testid="import-password-confirm-input"] input', TEST_PASSWORD)
	await page.waitForFunction(
		() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-seed-submit-btn"]')
			return btn !== null && !btn.disabled
		},
		{ timeout: 15_000, polling: 200 },
	)
	await clickByTestId(page, "import-seed-submit-btn")
}

test("importing an EXISTING recovery phrase warns, and confirming creates the duplicate profile", { timeout: 180_000 }, async ({
	registeredExtensionPerTest,
}) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general", 30_000)

	// Profile A's own phrase — the exact input that must trip the guard.
	await revealSeedPhrase(page, TEST_PASSWORD)
	const phrase = await readRevealedPhrase(page)
	await closeStuckPopup(page)

	await submitSeedImport(page, phrase, "Duplicate Profile")

	// The guard fires: the shared confirm dialog appears instead of an immediate import.
	await page.waitForSelector('[data-testid="confirm-submit"]', { visible: true, timeout: 30_000 })
	const dialogText = await page.evaluate(() => document.body.textContent ?? "")
	expect(dialogText).toMatch(/recovery phrase/i)

	// Confirm → the retry carries the override → the duplicate profile is created + activated.
	await acceptConfirmPopup(page)
	await waitForHash(page, "#/popup/general", 60_000)

	// Both profiles now exist (the duplicate was genuinely added, not silently dropped).
	const profileCount = await page.evaluate(async () => {
		const all = await chrome.storage.local.get(null)
		return Object.keys(all).filter((k) => k.startsWith("nulo:core:profiles@")).length
	})
	expect(profileCount).toBe(2)
})

test("declining the duplicate warning leaves only the original profile", { timeout: 180_000 }, async ({ registeredExtensionPerTest }) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general", 30_000)

	await revealSeedPhrase(page, TEST_PASSWORD)
	const phrase = await readRevealedPhrase(page)
	await closeStuckPopup(page)

	await submitSeedImport(page, phrase, "Declined Profile")
	await page.waitForSelector('[data-testid="confirm-cancel"]', { visible: true, timeout: 30_000 })
	await clickByTestId(page, "confirm-cancel")
	await closeStuckPopup(page)

	// Nothing was created — the guard is a warning, and declining abandons the import cleanly.
	const profileCount = await page.evaluate(async () => {
		const all = await chrome.storage.local.get(null)
		return Object.keys(all).filter((k) => k.startsWith("nulo:core:profiles@")).length
	})
	expect(profileCount).toBe(1)
})
