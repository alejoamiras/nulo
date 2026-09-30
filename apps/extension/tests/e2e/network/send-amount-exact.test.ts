/**
 * Retry 0: the test mints into the file-scoped `tokenReadyExtension`, so a retry would run against
 * a balance the first attempt already raised.
 */
import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import { type AztecTestConfig, mintPublicTokensForAccount } from "../fixtures/aztec"
import { openPopup, replaceInputValue, test, waitForHash } from "../fixtures/extension"
import { captureBalanceBaseline, setActiveSendType, waitForFreshBalanceRow } from "../fixtures/helpers"
import { closeReview, openReviewFromStrip, openSend, readSendInputs } from "../fixtures/send-page"
import { pointerClick } from "../helpers/legal-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const MINTED = 1_234_567_123_456_789_012_345_678n
const PUBLIC_BALANCE = 1000n * 10n ** 18n + MINTED
const AMOUNT = '[data-testid="send-amount-input"]'
const DESTINATION = '[data-testid="send-destination-field"]'
const REVIEW_AMOUNT = '[data-testid="send-review-amount"]'

/** On a timeout the error carries what the page showed, so a refused amount reads as one. */
async function waitForEstimateAndConfirm(page: Page): Promise<void> {
	try {
		await page.waitForSelector('[data-testid="fee-estimate"]', { visible: true, timeout: 120_000 })
		await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('[data-testid="send-submit"]')?.disabled === false, {
			timeout: 10_000,
		})
	} catch (err) {
		const shown = await page.evaluate(() => ({
			amount: document.querySelector<HTMLInputElement>('[data-testid="send-amount-input"]')?.value,
			confirmDisabled: document.querySelector<HTMLButtonElement>('[data-testid="send-submit"]')?.disabled,
		}))
		throw new Error(`no estimate with Confirm on: ${JSON.stringify(shown)}`, { cause: err })
	}
}

async function waitForAmount(page: Page, expected: string): Promise<void> {
	try {
		await page.waitForFunction(
			(sel: string, want: string) => document.querySelector<HTMLInputElement>(sel)?.value === want,
			{ timeout: 10_000 },
			AMOUNT,
			expected,
		)
	} catch (err) {
		const amount = await page.$eval(AMOUNT, (el) => (el as HTMLInputElement).value)
		throw new Error(`the amount field reads ${JSON.stringify(amount)}, not ${JSON.stringify(expected)}`, { cause: err })
	}
}

/** `hidden` is how far the field's text can scroll, in px: 0 when the whole amount is in view. */
async function readField(page: Page): Promise<{ value: string; hidden: number; fontSize: number; metaTop: number }> {
	return page.$eval(AMOUNT, (el) => {
		const input = el as HTMLInputElement
		const at = input.scrollLeft
		input.scrollLeft = 1e6
		const hidden = input.scrollLeft
		input.scrollLeft = at
		return {
			value: input.value,
			hidden,
			fontSize: Number.parseFloat(getComputedStyle(input).fontSize),
			metaTop: document.querySelector('[data-testid="send-amount-meta"]')?.getBoundingClientRect().top ?? Number.NaN,
		}
	})
}

async function fieldShowsWholeAmount(page: Page): Promise<boolean> {
	const fits = (sel: string) => {
		const input = document.querySelector<HTMLInputElement>(sel)
		if (!input) return false
		const at = input.scrollLeft
		input.scrollLeft = 1e6
		const hidden = input.scrollLeft
		input.scrollLeft = at
		return hidden === 0
	}
	return page.waitForFunction(fits, { timeout: 3_000 }, AMOUNT).then(
		() => true,
		() => false,
	)
}

async function readReviewAmount(page: Page): Promise<{ text: string; overflow: number; fontSize: number }> {
	return page.$eval(REVIEW_AMOUNT, (el) => ({
		text: el.textContent?.replace(/\s+/g, "") ?? "",
		overflow: el.scrollWidth - el.clientWidth,
		fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
	}))
}

test.skipIf(!hasConfig)(
	"a million or more estimates and confirms, typed and Max amounts stay exact, and all of it shows",
	{ timeout: 420_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		await mintPublicTokensForAccount(aztecConfig!, tokenReadyExtension.accountAddress, MINTED)

		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await page.waitForSelector('[data-testid="token-symbol"]', { visible: true, timeout: 30_000 })
		const baseline = await captureBalanceBaseline(page, tokenReadyExtension.accountAddress, aztecConfig!.tokenAddress)
		await waitForFreshBalanceRow(page, {
			account: tokenReadyExtension.accountAddress,
			tokenContract: aztecConfig!.tokenAddress,
			expectedPublicRaw: PUBLIC_BALANCE.toString(),
			baselineUpdatedAt: baseline,
			timeoutMs: 90_000,
		})

		await openSend(page)
		await setActiveSendType(page, "send-from-type", "public")
		await setActiveSendType(page, "send-to-type", "public")
		await page.waitForFunction(
			(sel: string) => document.querySelector<HTMLInputElement>(sel)?.disabled === false,
			{ timeout: 60_000, polling: 1_000 },
			AMOUNT,
		)

		// Filling the destination moves focus, which is what leaves the amount field.
		await replaceInputValue(page, AMOUNT, "1234567.123456789012345678")
		await replaceInputValue(page, DESTINATION, tokenReadyExtension.accountAddress)
		await waitForEstimateAndConfirm(page)
		expect((await readSendInputs(page)).amount).toBe("1,234,567.123456789012345678")
		// Soft, so one run reports every fit check.
		expect.soft(await fieldShowsWholeAmount(page), `typed, at rest: ${JSON.stringify(await readField(page))}`).toBe(true)

		// Leaving the destination turns it into the account's card, which moves Max, so the focus goes
		// through the amount field first. A pointer press on Max then leaves that field at rest,
		// grouped and fitted at once.
		await page.$eval(AMOUNT, (el) => {
			;(el as HTMLInputElement).focus()
			;(el as HTMLInputElement).blur()
		})
		await pointerClick(page, "send-amount-max")
		await waitForAmount(page, "1,235,567.123456789012345678")
		expect.soft(await page.$eval(AMOUNT, (el) => el === document.activeElement), "Max left the field focused").toBe(false)
		expect.soft(await fieldShowsWholeAmount(page), `Max, at rest: ${JSON.stringify(await readField(page))}`).toBe(true)
		const resting = await readField(page)
		await page.$eval(AMOUNT, (el) => (el as HTMLInputElement).focus())
		await page
			.waitForFunction(
				(sel: string) => {
					const input = document.querySelector(sel)
					return input !== null && Number.parseFloat(getComputedStyle(input).fontSize) === 40
				},
				{ timeout: 3_000 },
				AMOUNT,
			)
			.catch(() => undefined)
		const focused = await readField(page)
		expect.soft(focused.fontSize, "with focus the field is at full size").toBe(40)
		expect.soft(focused.metaTop, "the line under the field moved").toBeCloseTo(resting.metaTop, 0)
		await page.$eval(AMOUNT, (el) => (el as HTMLInputElement).blur())
		await waitForEstimateAndConfirm(page)
		expect(await page.$eval('[data-testid="send-amount-balance"]', (el) => el.textContent?.trim())).toBe("1,235,567.12345678 TST")

		await openReviewFromStrip(page)
		const review = await readReviewAmount(page)
		expect(review.text).toBe("1,235,567.123456789012345678TST")
		expect.soft(review.overflow, `the review's amount line overflows: ${JSON.stringify(review)}`).toBeLessThanOrEqual(0)
		expect.soft(review.fontSize, "the review's amount is below 60% of 30 px").toBeGreaterThanOrEqual(18)
		await closeReview(page)

		expect(tokenReadyExtension.pageErrors).toEqual([])
	},
)
