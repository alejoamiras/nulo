/**
 * Home shows at most three token rows, ordered by value, with a "View all" link when more exist.
 * Four tokens on the sandbox (the fixture's TST + three deployed here) and a seeded quote — the
 * agent build maps every sandbox contract to USDC, so a quote prices them all and the biggest
 * balance ranks first. Every imported token is waited for with the same freshness-gated row check
 * the fixture uses, so the assertions never race the balance projector.
 */

import { expect, inject } from "vitest"
import { test, openPopup, waitForHash, clickByTestId } from "../fixtures/extension"
import { captureBalanceBaseline, importToken, waitForFreshBalanceRow } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const ONE = 10n ** 18n

const homeSymbols = (page: Awaited<ReturnType<typeof openPopup>>) =>
	page.$$eval('[data-testid="tokens-card"] [data-testid="token-symbol"]', (els) => els.map((el) => (el as HTMLElement).dataset.symbol))

test.skipIf(!hasConfig)(
	"home caps at three value-ordered rows and links to Holdings when more exist",
	{ timeout: 420_000 },
	async ({ tokenReadyExtension }) => {
		// Fixture: TST with 1000 public. Add BIG (5000), MID (10), TINY (1) — four tokens total.
		const extras = [
			{ symbol: "BIG", amount: 5000n * ONE },
			{ symbol: "MID", amount: 10n * ONE },
			{ symbol: "TINY", amount: 1n * ONE },
		]
		const { deployExtraTokensForAccount } = await import("../fixtures/aztec")
		const addresses = await deployExtraTokensForAccount(aztecConfig!, tokenReadyExtension.accountAddress, extras)

		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		for (const { symbol, amount } of extras) {
			const baseline = await captureBalanceBaseline(page, tokenReadyExtension.accountAddress, addresses[symbol])
			await importToken(page, addresses[symbol])
			await waitForFreshBalanceRow(page, {
				account: tokenReadyExtension.accountAddress,
				tokenContract: addresses[symbol],
				expectedPublicRaw: amount.toString(),
				baselineUpdatedAt: baseline,
				timeoutMs: 90_000,
			})
		}

		// Seed a quote so every sandbox token is priced; remount so the stale-on-connect read adopts it.
		await page.evaluate(() => {
			const state = { "usd-coin": { coingeckoId: "usd-coin", usd: 1.0, fetchedAt: Date.now(), providerUpdatedAt: null } }
			return chrome.storage.local.set({ "nulo:core:token-prices": JSON.stringify(state) })
		})
		await page.reload({ waitUntil: "domcontentloaded" })
		await waitForHash(page, "#/popup/general")

		await page.waitForFunction(
			() =>
				[...document.querySelectorAll('[data-testid="tokens-card"] [data-testid="token-symbol"]')]
					.map((el) => (el as HTMLElement).dataset.symbol)
					.join(",") === "BIG,TST,MID",
			{ timeout: 60_000 },
		)
		expect(await homeSymbols(page)).toEqual(["BIG", "TST", "MID"])
		expect(await page.$eval('[data-testid="tokens-count"]', (el) => el.textContent?.trim())).toBe("4")

		// The link opens Holdings; the fourth token lives there.
		await clickByTestId(page, "tokens-view-all")
		await waitForHash(page, "#/popup/holdings")
		await page.waitForSelector('[data-testid="holdings-page"] [data-testid="token-symbol"][data-symbol="TINY"]', {
			visible: true,
			timeout: 30_000,
		})

		expect(tokenReadyExtension.consoleErrors).toEqual([])
		expect(tokenReadyExtension.pageErrors).toEqual([])
	},
)
