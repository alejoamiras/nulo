/**
 * E2E regression gate for the AmountCard decimal clamp.
 *
 * Locks the Layer 1 + Layer 3 contract end-to-end: a user typing more
 * fractional digits than the active token supports must see the input
 * clamp to the token's decimals AND see the inline hint. If the clamp
 * silently regressed, the SW boundary's coerceAmount would still throw
 * loudly — but the UX would be opaque again.
 *
 * Requires the local Aztec node so we can mint a real token (the
 * AmountCard input is `disabled` until `tokenBalanceByType > 0`).
 */
import { inject, expect } from "vitest"
import { test, openPopup, waitForHash } from "../fixtures/extension"
import { captureBalanceBaseline, setActiveSendType, waitForFreshBalanceRow } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

test.skipIf(!hasConfig)(
	"send amount input clamps fractional digits beyond token.decimals + shows inline hint",
	{ timeout: 120_000 },
	async ({ tokenReadyExtension }) => {
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")

		// Wait for the public token row to mount AND the balance text to load on
		// the freshly-mounted popup. The fixture's polling loop ran on its own
		// page (now closed); the test's new page must re-fetch balances on boot.
		await page.waitForSelector('[data-testid="token-symbol"]', { visible: true, timeout: 30_000 })
		{
			const baseline = await captureBalanceBaseline(page, tokenReadyExtension.accountAddress, aztecConfig!.tokenAddress)
			await waitForFreshBalanceRow(page, {
				account: tokenReadyExtension.accountAddress,
				tokenContract: aztecConfig!.tokenAddress,
				expectedPublicRaw: (1000n * 10n ** 18n).toString(),
				baselineUpdatedAt: baseline,
				timeoutMs: 90_000,
			})
		}

		// Open SendPopup, then flip from-type to "public" — the fixture mints
		// only public tokens via `mintPublicTokens`, but send.vue defaults
		// `selectedSendType = "private"` (zero balance), so the input would
		// stay disabled and the clamp guard silently skip.
		await page.evaluate(() => {
			;(document.querySelector('[data-testid="actions-send"]') as HTMLElement)?.click()
		})
		await page.waitForSelector('[data-testid="send-from-type"]', { timeout: 10_000 })
		await setActiveSendType(page, "send-from-type", "public")
		await page.waitForSelector('[data-testid="send-amount-input"]', { visible: true, timeout: 10_000 })

		// Wait for the input to become enabled — `:disabled="!tokenBalanceByType"`.
		// 60s + 2s polling matches the existing `sendTransfer` pattern
		// (helpers.ts:559-565) and is what the cold-PXE cycle costs.
		await page.waitForFunction(
			() => {
				const el = document.querySelector('[data-testid="send-amount-input"]') as HTMLInputElement | null
				return !!el && !el.disabled
			},
			{ timeout: 60_000, polling: 2_000 },
		)

		// Type an over-decimaled amount. The fixture's TestToken has 18 decimals
		// (per `deployTestToken` in fixtures/aztec.ts), so a 19-decimal value
		// forces a clamp. NOTE: synthetic `dispatchEvent("input")` does NOT
		// trigger Vue 3's vModelText listener reliably on native inputs —
		// must use real keyboard input via `page.keyboard.type` so the v-model
		// writeback + `@input="handleAmountInput"` both fire.
		await page.evaluate(() => {
			;(document.querySelector('[data-testid="send-amount-input"]') as HTMLInputElement)?.focus()
		})
		await page.keyboard.type("1.1234567890123456789", { delay: 5 })

		// The input clamps to the token's decimals — must be SHORTER than the typed value.
		const clamped = await page.evaluate(() => (document.querySelector('[data-testid="send-amount-input"]') as HTMLInputElement)?.value)
		expect(clamped.length).toBeLessThan("1.1234567890123456789".length)
		// Sanity: the clamp leaves a valid decimal-form string.
		expect(/^\d+(\.\d+)?$/.test(clamped)).toBe(true)

		// Hint is rendered when clamping fired.
		await page.waitForSelector('[data-testid="send-amount-clamp-hint"]', { visible: true, timeout: 5_000 })
		const hintText = await page.evaluate(() => document.querySelector('[data-testid="send-amount-clamp-hint"]')?.textContent ?? "")
		expect(hintText).toMatch(/decimal/i)
	},
)
