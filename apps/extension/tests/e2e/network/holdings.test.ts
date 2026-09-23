/**
 * The Holdings tab against a real funded wallet: value order with a seeded quote, real balances
 * on every row, search by symbol (hit and miss), the sort toggle, and the fold hiding an empty
 * token. Two deployed tokens join the fixture's TST: ZED (funded above TST) and EMPTY (never
 * minted, so its projected balance is a genuine 0). Each import is waited for with the fixture's
 * freshness-gated row check, so the assertions never race the balance projector.
 */

import { expect, inject } from "vitest"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "../fixtures/extension"
import { importTokenAndWaitForBalance, openHoldings, seedUsdQuoteAndReload } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const ONE = 10n ** 18n

const listedSymbols = (page: Awaited<ReturnType<typeof openPopup>>) =>
	page.$$eval('[data-testid="holdings-page"] [data-testid="token-symbol"]', (els) => els.map((el) => (el as HTMLElement).dataset.symbol))

test.skipIf(!hasConfig)(
	"holdings: value order, real balances, search, sort and the empty fold",
	{ timeout: 420_000 },
	async ({ tokenReadyExtension }) => {
		const extras = [
			{ symbol: "ZED", amount: 5000n * ONE },
			{ symbol: "EMPTY", amount: 0n },
		]
		const { deployExtraTokensForAccount } = await import("../fixtures/aztec")
		const addresses = await deployExtraTokensForAccount(aztecConfig!, tokenReadyExtension.accountAddress, extras)

		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		for (const { symbol, amount } of extras) {
			await importTokenAndWaitForBalance(page, tokenReadyExtension.accountAddress, addresses[symbol], amount.toString())
		}

		await seedUsdQuoteAndReload(page)

		await openHoldings(page)

		// ── Value order + the empty fold: the funded rows show, EMPTY hides behind the fold row.
		await page.waitForFunction(
			() =>
				[...document.querySelectorAll('[data-testid="holdings-page"] [data-testid="token-symbol"]')]
					.map((el) => (el as HTMLElement).dataset.symbol)
					.join(",") === "ZED,TST",
			{ timeout: 60_000 },
		)
		expect(await page.$eval('[data-testid="holdings-count"]', (el) => el.textContent?.trim())).toBe("3")
		const foldText = await page.$eval('[data-testid="holdings-fold"]', (el) => el.textContent?.trim() ?? "")
		expect(foldText).toContain("1 empty")

		// ── Real balances render on the rows (not the loading block), each with a fiat line.
		const cards = await page.$$eval('[data-testid="holdings-page"] [data-testid="tokens-card"]', (els) =>
			els.map((c) => ({
				loading: !!c.querySelector('[data-testid="token-balance-loading"]'),
				fiat: c.querySelector('[data-testid="token-fiat"]')?.textContent?.trim() ?? "",
			})),
		)
		expect(cards).toHaveLength(2)
		expect(cards.every((c) => !c.loading)).toBe(true)
		expect(cards.every((c) => c.fiat.startsWith("≈ $"))).toBe(true)

		// ── Expanding the fold reveals EMPTY.
		await clickByTestId(page, "holdings-fold")
		await page.waitForSelector('[data-testid="holdings-page"] [data-testid="token-symbol"][data-symbol="EMPTY"]', {
			visible: true,
			timeout: 5_000,
		})

		// ── Search: a symbol hit keeps only that row; a miss shows the no-results line.
		await replaceInputValue(page, '[data-testid="holdings-search"]', "tst")
		await page.waitForFunction(
			() =>
				[...document.querySelectorAll('[data-testid="holdings-page"] [data-testid="token-symbol"]')]
					.map((el) => (el as HTMLElement).dataset.symbol)
					.join(",") === "TST",
			{ timeout: 5_000 },
		)
		await replaceInputValue(page, '[data-testid="holdings-search"]', "zzz-no-such-token")
		await page.waitForSelector('[data-testid="holdings-no-results"]', { visible: true, timeout: 5_000 })
		await replaceInputValue(page, '[data-testid="holdings-search"]', "")

		// ── Sort toggle flips the label and the order: "TestToken" < "ZED Token" by name.
		await clickByTestId(page, "holdings-sort")
		await page.waitForFunction(() => document.querySelector('[data-testid="holdings-sort"]')?.getAttribute("data-sort") === "name", {
			timeout: 5_000,
		})
		expect((await listedSymbols(page)).slice(0, 2)).toEqual(["TST", "ZED"])

		expect(tokenReadyExtension.consoleErrors).toEqual([])
		expect(tokenReadyExtension.pageErrors).toEqual([])
	},
)
