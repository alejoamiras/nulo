/**
 * Deterministic fiat-display coverage WITHOUT the live price API: the price
 * cache (`nulo:core:token-prices`) is validated at READ time (shape + per-id
 * sanity bands + freshness), so a fixture can write a valid quote directly
 * into storage and every fiat surface must light up from the cache alone.
 * Fee Juice's mapping is chain-independent, so this works on the sandbox
 * chain (whose tokens are otherwise unmapped by design).
 *
 * If the e2e environment happens to reach the real CoinGecko, the service's
 * monotonic merge keeps whichever quote is newer — both are valid, so the
 * assertion stays deterministic either way.
 */

import { expect, inject } from "vitest"
import { test, openPopup, waitForHash } from "../fixtures/extension"
import type { AztecTestConfig } from "../fixtures/aztec"

// Same gate every network suite uses — the env var isn't visible to the test
// process; the harness injects the config via vitest's provide/inject.
const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test.skipIf(!hasConfig)(
	"gas card fiat line renders from a seeded price cache (no live API)",
	{ timeout: 120_000 },
	async ({ feeJuiceImportedExtension }) => {
		const page = await openPopup(feeJuiceImportedExtension)
		await waitForHash(page, "#/popup/general")

		// Seed a VALID aztec quote (in-band, fresh) straight into the cache.
		await page.evaluate(() => {
			const state = {
				aztec: { coingeckoId: "aztec", usd: 0.02, fetchedAt: Date.now(), providerUpdatedAt: null },
			}
			return chrome.storage.local.set({ "nulo:core:token-prices": JSON.stringify(state) })
		})

		// Remount so usePrices' stale-on-connect read picks the cache up.
		await page.reload({ waitUntil: "domcontentloaded" })
		await waitForHash(page, "#/popup/general")

		// Non-zero public FJ (fixture pre-funds) + usable quote → fiat line.
		await page.waitForSelector('[data-testid="gas-balance-public"]', { visible: true, timeout: 60_000 })
		await page.waitForSelector('[data-testid="gas-fiat-public"]', { visible: true, timeout: 30_000 })

		const fiatText = await page.evaluate(() => document.querySelector('[data-testid="gas-fiat-public"]')?.textContent?.trim() || "")
		expect(fiatText).toMatch(/^≈ (\$|<\$)/)

		// And the balance itself is still token-denominated beside it.
		const balanceText = await page.evaluate(
			() => document.querySelector('[data-testid="gas-balance-public"]')?.textContent?.trim() || "",
		)
		expect(balanceText).toContain("FJ")
		expect(balanceText).not.toBe("0 FJ")
	},
)
