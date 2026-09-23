import type { Page } from "puppeteer"
import { expect } from "vitest"
import { TEST_PASSWORD } from "./fixtures/constants"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "./fixtures/extension"
import { navigateByHash, revealSeedPhrase } from "./fixtures/helpers"

const PASSWORD = TEST_PASSWORD

/** Read the value of the input inside the reveal-content container. */
const readRevealedValue = (page: Page) =>
	page.evaluate(() => {
		const scope = document.querySelector('[data-testid="reveal-content"]')
		const input = scope?.querySelector("input") as HTMLInputElement | null
		return input?.value ?? null
	})

test("seed phrase reveal returns 24 word-like tokens", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await revealSeedPhrase(page, PASSWORD)

	// Input is type=password by default, but its `.value` is still readable.
	const phrase = await readRevealedValue(page)
	expect(phrase).toBeTruthy()
	const tokens = (phrase as string).trim().split(/\s+/)
	expect(tokens.length).toBe(24)
	for (const token of tokens) expect(token).toMatch(/^[a-z]+$/)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 30_000)

test("full backup unlock surfaces protect + download CTAs", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateByHash(page, "#/popup/settings/security/export/full")
	await clickByTestId(page, "agree-continue-btn")

	await page.waitForSelector('[data-testid="unlock-password-input"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, '[data-testid="unlock-password-input"]', PASSWORD)
	await clickByTestId(page, "unlock-submit-btn")

	// handleBackup loops over ~11 service clients and computes a SHA hash —
	// in CI / cold extension boot this can take a while. Generous timeout.
	await page.waitForFunction(
		() => {
			const protect = document.querySelector('[data-testid="protect-password-btn"]') as HTMLButtonElement | null
			const download = document.querySelector('[data-testid="download-backup-btn"]') as HTMLButtonElement | null
			return !!protect && !protect.disabled && !!download && !download.disabled
		},
		{ timeout: 30_000, polling: 250 },
	)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)
