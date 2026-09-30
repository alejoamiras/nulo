/**
 * C3 fiat-input flow, end-to-end on the sandbox: the agent build arms
 * `VITE_NULO_E2E_PRICE_MAP=1`, mapping every sandbox-chain token to USDC, and
 * the test seeds a valid usd-coin quote into the price cache — so the full
 * priced-token UI (row fiat, header aggregate, unit-pair toggle, fiat typing →
 * derived token amount) runs against a REAL funded wallet with no live API
 * dependency. Values assert structurally (a live CoinGecko fetch may merge a
 * newer, equally-valid quote; both are ~$1 for USDC).
 */

import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import { reloadExtensionPage } from "../fixtures/browser"
import { test, openPopup, waitForHash, clickByTestId } from "../fixtures/extension"
import { setActiveSendType, waitForHomeTotal } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/** A viewport point 1 px inside the amount row's top edge, over the middle or the right end of `testid`. */
async function rowTopEdge(page: Page, testid: string, over: "middle" | "right"): Promise<{ x: number; y: number }> {
	return page.evaluate(
		(id: string, at: string) => {
			const row = document.querySelector('[data-testid="send-amount-row"]')
			const el = document.querySelector(`[data-testid="${id}"]`)
			if (!row || !el) throw new Error(`rowTopEdge: send-amount-row or ${id} is missing`)
			row.scrollIntoView({ block: "center" })
			const box = el.getBoundingClientRect()
			return { x: at === "middle" ? box.left + box.width / 2 : box.right - 2, y: row.getBoundingClientRect().top + 1 }
		},
		testid,
		over,
	)
}

test.skipIf(!hasConfig)(
	"priced sandbox token: row + header fiat render, fiat typing derives the send amount",
	{ timeout: 180_000 },
	async ({ tokenReadyExtension }) => {
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")

		// Seed a valid quote; remount so the stale-on-connect read adopts it.
		await page.evaluate(() => {
			const state = {
				"usd-coin": { coingeckoId: "usd-coin", usd: 1.0, fetchedAt: Date.now(), providerUpdatedAt: null },
			}
			return chrome.storage.local.set({ "nulo:core:token-prices": JSON.stringify(state) })
		})
		await reloadExtensionPage(page)
		await waitForHash(page, "#/popup/general")

		// ── B1: the funded token row carries its fiat line ────────────────
		await page.waitForSelector('[data-testid="token-fiat"]', { visible: true, timeout: 60_000 })
		const rowFiat = await page.$eval('[data-testid="token-fiat"]', (el) => el.textContent?.trim() ?? "")
		expect(rowFiat).toMatch(/^≈ \$/)

		// ── A1: the aggregate header shows a REAL dollar figure ───────────
		await waitForHomeTotal(page)
		const headerText = await page.$eval('[data-testid="balance-amount"]', (el) => el.textContent?.trim() ?? "")
		expect(headerText).toMatch(/\$/)
		expect(headerText).not.toBe("$0.00") // 1,000 minted tokens at ~$1 ≠ zero

		// ── C3: open Send from the token page ─────────────────────────────
		await clickByTestId(page, "tokens-card")
		await page.waitForSelector('[data-testid="actions-send"]', { visible: true, timeout: 30_000 })
		await page.evaluate(() => document.querySelector('[data-testid="actions-send"]')?.scrollIntoView({ block: "center" }))
		await clickByTestId(page, "actions-send")
		await page.waitForSelector('[data-testid="send-amount-input"]', { visible: true, timeout: 30_000 })

		// The fixture mints PUBLIC tokens — select the funded side (the private
		// balance is zero, which disables the input and hides the balance row).
		await page.waitForSelector('[data-testid="send-from-type"]', { timeout: 10_000 })
		await setActiveSendType(page, "send-from-type", "public")

		// The unit pair exists ONLY for priced tokens — this run has one.
		await page.waitForSelector('[data-testid="send-amount-fiat-toggle"]', { visible: true, timeout: 15_000 })
		// Corner balance segment (1A rework: amount + symbol only, no privacy
		// dot/word) — it mounts once the selected-type balance loads (async
		// after the popup opens).
		await page.waitForSelector('[data-testid="send-amount-balance"]', { visible: true, timeout: 30_000 })
		const balanceSeg = await page.$eval('[data-testid="send-amount-balance"]', (el) => el.textContent?.trim() ?? "")
		expect(balanceSeg).toMatch(/\d/)

		// Flip to USD with a press on the switch at the amount row's top edge: the switch takes a press
		// anywhere in the row's height. A press on the field's right end, beside the switch, still
		// lands in the field.
		const onSwitch = await rowTopEdge(page, "send-amount-fiat-toggle", "middle")
		await page.mouse.click(onSwitch.x, onSwitch.y)
		await page.waitForSelector('[data-testid="send-amount-fiat-input"]', { visible: true, timeout: 10_000 })
		const fiatFocused = () => page.$eval('[data-testid="send-amount-fiat-input"]', (el) => el === document.activeElement)
		expect(await fiatFocused()).toBe(false)
		const onField = await rowTopEdge(page, "send-amount-fiat-input", "right")
		await page.mouse.click(onField.x, onField.y)
		expect(await fiatFocused()).toBe(true)
		await page.type('[data-testid="send-amount-fiat-input"]', "2")

		// Debounced derivation lands: the secondary line shows the TOKEN
		// amount that will send (round-down at the frozen quote, ~2 at ~$1).
		await page.waitForFunction(
			() => {
				const el = document.querySelector('[data-testid="send-amount-derived"]')
				return el !== null && /≈ \d/.test(el.textContent ?? "")
			},
			{ timeout: 10_000, polling: 100 },
		)
		const derived = await page.$eval('[data-testid="send-amount-derived"]', (el) => el.textContent?.trim() ?? "")
		const derivedAmount = Number.parseFloat((derived.match(/≈ ([\d.,]+)/)?.[1] ?? "0").replace(/,/g, ""))
		expect(derivedAmount).toBeGreaterThan(1.5)
		expect(derivedAmount).toBeLessThan(2.5)

		// Flip back: the token input returns, carrying the derived amount.
		await clickByTestId(page, "send-amount-fiat-toggle")
		await page.waitForSelector('[data-testid="send-amount-input"]', { visible: true, timeout: 10_000 })

		expect(tokenReadyExtension.pageErrors).toEqual([])
	},
)
