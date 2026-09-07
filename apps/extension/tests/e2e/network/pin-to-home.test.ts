/**
 * Pin to Home end to end: with a seeded quote TST (1000) outranks a deployed ALT (25) by value;
 * pinning ALT from its token page moves it to the first Home row, the pin survives closing and
 * reopening the popup, and unpinning restores the value order. The menu item's `data-pinned`
 * reflects the state on the token page.
 */

import { expect, inject } from "vitest"
import { test, openPopup, waitForHash } from "../fixtures/extension"
import {
	clickNavTab,
	importTokenAndWaitForBalance,
	navigateToTokenDetail,
	pinFromTokenPage,
	readPinState,
	seedUsdQuoteAndReload,
} from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const ONE = 10n ** 18n

const homeSymbols = (page: Awaited<ReturnType<typeof openPopup>>) =>
	page.$$eval('[data-testid="tokens-card"] [data-testid="token-symbol"]', (els) => els.map((el) => (el as HTMLElement).dataset.symbol))

const waitForHomeOrder = (page: Awaited<ReturnType<typeof openPopup>>, order: string) =>
	page.waitForFunction(
		(want: string) =>
			[...document.querySelectorAll('[data-testid="tokens-card"] [data-testid="token-symbol"]')]
				.map((el) => (el as HTMLElement).dataset.symbol)
				.join(",") === want,
		{ timeout: 60_000 },
		order,
	)

test.skipIf(!hasConfig)(
	"pin to home: the pinned token leads Home, survives a reopen, and unpin restores the order",
	{ timeout: 420_000 },
	async ({ tokenReadyExtension }) => {
		const { deployExtraTokensForAccount } = await import("../fixtures/aztec")
		const addresses = await deployExtraTokensForAccount(aztecConfig!, tokenReadyExtension.accountAddress, [
			{ symbol: "ALT", amount: 25n * ONE },
		])

		let page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await importTokenAndWaitForBalance(page, tokenReadyExtension.accountAddress, addresses.ALT, (25n * ONE).toString())

		await seedUsdQuoteAndReload(page)
		await waitForHomeOrder(page, "TST,ALT")

		// Pin ALT from its page; the menu item flips to pinned.
		await navigateToTokenDetail(page, "ALT")
		expect(await readPinState(page)).toBe("false")
		await pinFromTokenPage(page)
		expect(await readPinState(page)).toBe("true")

		await clickNavTab(page, "general")
		await waitForHomeOrder(page, "ALT,TST")

		// The pin is persisted: a fresh popup shows the same order.
		await page.close()
		page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await waitForHomeOrder(page, "ALT,TST")
		expect(await homeSymbols(page)).toEqual(["ALT", "TST"])

		// Unpin restores the value order.
		await navigateToTokenDetail(page, "ALT")
		await pinFromTokenPage(page)
		expect(await readPinState(page)).toBe("false")
		await clickNavTab(page, "general")
		await waitForHomeOrder(page, "TST,ALT")

		expect(tokenReadyExtension.consoleErrors).toEqual([])
		expect(tokenReadyExtension.pageErrors).toEqual([])
	},
)
