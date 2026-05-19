import { inject, expect } from "vitest"
import { test, openPopup, waitForHash, clickByTestId } from "../fixtures/extension"
import { navigateToSettings, waitForToast } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
// biome-ignore lint/correctness/noUnusedVariables: kept for un-skip — restore `test.skipIf(!hasConfig)` when cluster A is fixed.
const hasConfig = aztecConfig !== undefined

// SKIP: cluster A (tokenReadyExtension importToken cascade).
// See implementations-plan/network-test-triage/plan.md — un-skip on cluster fix.
test.skip("delete imported token from settings", { timeout: 120_000 }, async ({ tokenReadyExtension }) => {
	const page = await openPopup(tokenReadyExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "tokens")

	// Token row + "TST" symbol from deployTestToken
	await page.waitForSelector('[data-testid="token-row"]', { visible: true, timeout: 10_000 })
	const hasToken = await page.evaluate(() => (document.body.textContent ?? "").includes("TST"))
	expect(hasToken).toBe(true)

	// Open delete via the row's testid. The delete icon is an SVG inside a
	// Tooltip — clickByTestId's visibility checks don't always play well
	// with SVG rects, so dispatch a synthetic click that bubbles to the
	// Vue listener directly.
	await page.evaluate(() => {
		const el = document.querySelector<HTMLElement>('[data-testid="token-delete"]')
		el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
	})
	await clickByTestId(page, "confirm-submit")

	await waitForToast(page, "Token successfully deleted", 5_000)

	// Verify TST row is gone (other tokens may remain on the page)
	await page.waitForFunction(
		() => {
			const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="token-row"]')]
			return !rows.some((r) => (r.textContent ?? "").includes("TST"))
		},
		{ timeout: 5_000 },
	)

	await page.close()
})
