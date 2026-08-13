/**
 * Fiat-display smoke: with NO usable prices (the smoke sandbox chain has no
 * price-mapped tokens, and no network fetch succeeds here), every fiat surface
 * must be ABSENT — the pre-feature fake `$0.00` placeholders must never come
 * back. Also pins the settings kill-switch toggle's existence.
 */

import { expect } from "vitest"
import { test, openPopup, waitForHash, clickByTestId } from "./fixtures/extension"
import { navigateToSettings } from "./fixtures/helpers"

test("fresh wallet state matrix: truthful $0.00, zero fiat artifacts", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")
	await page.waitForSelector('[data-testid="balance-amount"]', { visible: true, timeout: 10_000 })

	// S-A matrix: an EMPTY wallet's account value IS $0.00 (true zero) —
	// never an em-dash, never a stale placeholder.
	const balanceText = await page.$eval('[data-testid="balance-amount"]', (el) => el.textContent?.trim() ?? "")
	expect(balanceText).toBe("$0.00")

	// And with no quotes, no fiat LINES render anywhere (no per-token fiat,
	// no header secondary line, no partial-aggregate label).
	expect(await page.$('[data-testid="token-fiat"]')).toBeNull()
	expect(await page.$('[data-testid="balance-fiat"]')).toBeNull()
	expect(await page.$('[data-testid="balance-fiat-partial"]')).toBeNull()

	expect(registeredExtension.pageErrors).toEqual([])
})

test("settings carries the 'Show fiat values' kill-switch and it toggles", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "appearance")
	await page.waitForSelector('[data-testid="fiat-values-toggle"]', { visible: true, timeout: 5_000 })

	// Toggle publishes its state as `data-toggle-active`; read and wait on that
	// rather than sleeping and scraping a mangled CSS-module class name.
	const readActive = () =>
		page.evaluate(() => document.querySelector('[data-testid="fiat-values-toggle"]')?.getAttribute("data-toggle-active"))

	expect(await readActive()).toBe("true") // default ON

	await clickByTestId(page, "fiat-values-toggle")
	await page
		.waitForFunction(
			() => document.querySelector('[data-testid="fiat-values-toggle"]')?.getAttribute("data-toggle-active") === "false",
			{ timeout: 2_000, polling: 50 },
		)
		.catch(() => {
			throw new Error("fiat-values-toggle never flipped to off after the click")
		})
	expect(await readActive()).toBe("false")

	expect(registeredExtension.pageErrors).toEqual([])
})
