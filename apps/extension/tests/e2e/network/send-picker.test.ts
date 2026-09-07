/**
 * The Send token picker with more than one token: choosing another token updates the trigger,
 * and re-opening the picker marks that row as selected. One extra token is deployed and imported
 * beside the fixture's TST; the import is waited for with the fixture's freshness-gated row check.
 */

import { expect, inject } from "vitest"
import { test, openPopup, waitForHash, clickByTestId } from "../fixtures/extension"
import { captureBalanceBaseline, importToken, selectSendToken, waitForFreshBalanceRow } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const ONE = 10n ** 18n

test.skipIf(!hasConfig)(
	"send picker: choosing another token updates the trigger and marks the row selected",
	{ timeout: 420_000 },
	async ({ tokenReadyExtension }) => {
		const { deployExtraTokensForAccount } = await import("../fixtures/aztec")
		const addresses = await deployExtraTokensForAccount(aztecConfig!, tokenReadyExtension.accountAddress, [
			{ symbol: "ALT", amount: 25n * ONE },
		])

		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		const baseline = await captureBalanceBaseline(page, tokenReadyExtension.accountAddress, addresses.ALT)
		await importToken(page, addresses.ALT)
		await waitForFreshBalanceRow(page, {
			account: tokenReadyExtension.accountAddress,
			tokenContract: addresses.ALT,
			expectedPublicRaw: (25n * ONE).toString(),
			baselineUpdatedAt: baseline,
			timeoutMs: 90_000,
		})

		await clickByTestId(page, "actions-send")
		await page.waitForSelector('[data-testid="send-token-trigger"]', { visible: true, timeout: 15_000 })

		// Two tokens: no search box, both rows listed, the current token marked selected.
		await clickByTestId(page, "send-token-trigger")
		await page.waitForSelector('[data-testid="select-token-row"][data-symbol="ALT"]', { visible: true, timeout: 15_000 })
		expect(await page.$('[data-testid="select-token-search"]')).toBeNull()
		const rows = await page.$$eval('[data-testid="select-token-row"]', (els) =>
			els.map((el) => ({ symbol: (el as HTMLElement).dataset.symbol, selected: (el as HTMLElement).dataset.selected })),
		)
		expect(rows.map((r) => r.symbol).sort()).toEqual(["ALT", "TST"])
		expect(rows.filter((r) => r.selected === "true")).toHaveLength(1)
		await page.evaluate(() => {
			;(document.querySelector('[data-testid="select-token-row"][data-symbol="ALT"]') as HTMLElement)?.click()
		})
		await page.waitForFunction(() => document.querySelector('[data-testid="send-token-symbol"]')?.textContent?.trim() === "ALT", {
			timeout: 10_000,
		})

		// Pick TST back through the helper, then re-open and read the selection marks.
		await selectSendToken(page, "TST")
		await clickByTestId(page, "send-token-trigger")
		await page.waitForSelector('[data-testid="select-token-row"][data-symbol="TST"]', { visible: true, timeout: 15_000 })
		const marks = await page.$$eval('[data-testid="select-token-row"]', (els) =>
			Object.fromEntries(els.map((el) => [(el as HTMLElement).dataset.symbol, (el as HTMLElement).dataset.selected])),
		)
		expect(marks).toEqual({ TST: "true", ALT: "false" })

		expect(tokenReadyExtension.consoleErrors).toEqual([])
		expect(tokenReadyExtension.pageErrors).toEqual([])
	},
)
