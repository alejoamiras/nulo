/** In a real browser: the snack's geometry, its 6 s life, the single-card replacement and the pointer
 *  hold need layout, real timers and a real pointer. */
import type { Page } from "puppeteer"
import { expect } from "vitest"
import { clickByTestId, type ExtensionContext, openPopup, test, waitForHash } from "./fixtures/extension"
import { navigateToSettings, waitForToast } from "./fixtures/helpers"
import { activeTestId } from "./helpers/pointer-probes"

const sel = (testid: string) => `[data-testid="${testid}"]`
const SNACK = sel("snackbar")
const COPY = "account-address-copy"

type Rect = { left: number; top: number; bottom: number; width: number; height: number; innerWidth: number; innerHeight: number }
type Life = { appeared: number[]; removed: number[] }
type Probe = { __snackLife?: Life; __snackMax?: number; __snackDone?: boolean }

async function openHome(ctx: ExtensionContext): Promise<Page> {
	const page = await openPopup(ctx)
	await waitForHash(page, "#/popup/general")
	await page.waitForSelector(sel(COPY), { visible: true, timeout: 15_000 })
	return page
}

/** Points the clipboard write at one outcome: the snack is the wallet's reaction to the write, and
 *  the real clipboard needs a focused document this suite cannot promise. */
async function stubClipboard(page: Page, outcome: "resolve" | "reject"): Promise<void> {
	await page.evaluate((o: string) => {
		const write = o === "resolve" ? () => Promise.resolve() : () => Promise.reject(new Error("denied"))
		Object.defineProperty(navigator.clipboard, "writeText", { value: write, configurable: true })
	}, outcome)
}

/** The card's rect once it has stopped moving: it rises 20px while it fades in. */
async function settledSnack(page: Page): Promise<Rect> {
	await page.waitForFunction(
		(s: string) => {
			const card = document.querySelector(s)
			return card !== null && getComputedStyle(card).opacity === "1" && card.getAnimations().length === 0
		},
		{ timeout: 5_000, polling: 50 },
		SNACK,
	)
	return page.$eval(SNACK, (card) => {
		const { left, top, bottom, width, height } = card.getBoundingClientRect()
		return { left, top, bottom, width, height, innerWidth: window.innerWidth, innerHeight: window.innerHeight }
	})
}

/** Stamps every card's first appearance and its removal on the page clock, so a life is measured
 *  where it runs, not across the driver round trip. */
async function recordSnackLife(page: Page): Promise<void> {
	await page.evaluate((s: string) => {
		const life: Life = { appeared: [], removed: [] }
		;(window as unknown as Probe).__snackLife = life
		const seen = new Set<Element>()
		new MutationObserver(() => {
			for (const card of document.querySelectorAll(s)) {
				if (seen.has(card)) continue
				seen.add(card)
				life.appeared.push(performance.now())
			}
			for (const card of seen) {
				if (card.isConnected) continue
				seen.delete(card)
				life.removed.push(performance.now())
			}
		}).observe(document.body, { childList: true, subtree: true })
	}, SNACK)
}

const snackLife = (page: Page): Promise<Life> =>
	page.evaluate(() => (window as unknown as Probe).__snackLife ?? { appeared: [], removed: [] })

/** Waits until `ms` have passed on the page clock since `since`. */
async function pageClockPast(page: Page, since: number, ms: number): Promise<void> {
	await page.waitForFunction((t: number, wait: number) => performance.now() - t >= wait, { timeout: ms + 5_000, polling: 100 }, since, ms)
}

/** Counts the cards on every animation frame for `ms` and keeps the maximum. */
async function sampleCards(page: Page, ms: number): Promise<void> {
	await page.evaluate(
		(s: string, duration: number) => {
			const w = window as unknown as Probe
			w.__snackMax = 0
			w.__snackDone = false
			const end = performance.now() + duration
			const tick = () => {
				w.__snackMax = Math.max(w.__snackMax ?? 0, document.querySelectorAll(s).length)
				if (performance.now() < end) requestAnimationFrame(tick)
				else w.__snackDone = true
			}
			requestAnimationFrame(tick)
		},
		SNACK,
		ms,
	)
}

async function sampledMax(page: Page): Promise<number> {
	await page.waitForFunction(() => (window as unknown as Probe).__snackDone === true, { timeout: 5_000, polling: 50 })
	return page.evaluate(() => (window as unknown as Probe).__snackMax ?? -1)
}

/** Presses copy twice, `gap` ms apart on the page clock, both writes resolving. */
async function pressCopyTwice(page: Page, gap: number): Promise<void> {
	await page.evaluate(
		async (s: string, ms: number) => {
			const button = document.querySelector<HTMLElement>(s)
			if (!button) throw new Error(`${s} not found`)
			button.click()
			await new Promise((r) => setTimeout(r, ms))
			button.click()
		},
		sel(COPY),
		gap,
	)
}

/** A success followed at once by an error: the second press lands the tick after the first write
 *  resolved, with the write now failing. */
async function pressCopyThenFail(page: Page): Promise<void> {
	await page.evaluate(async (s: string) => {
		const button = document.querySelector<HTMLElement>(s)
		if (!button) throw new Error(`${s} not found`)
		button.click()
		await new Promise((r) => setTimeout(r, 0))
		Object.defineProperty(navigator.clipboard, "writeText", {
			value: () => Promise.reject(new Error("denied")),
			configurable: true,
		})
		button.click()
	}, sel(COPY))
}

/** Focuses the last tabbable control outside `#toast` and names it. */
async function focusLastPageControl(page: Page): Promise<string> {
	return page.evaluate(() => {
		const toast = document.getElementById("toast")
		const controls = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")].filter(
			(el) => !toast?.contains(el) && el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0,
		)
		const last = controls.at(-1)
		last?.focus()
		return last?.closest("[data-testid]")?.getAttribute("data-testid") ?? last?.tagName ?? "none"
	})
}

const cardCount = (page: Page) => page.$$eval(SNACK, (cards) => cards.length)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForSnackGone(page: Page, timeout: number): Promise<void> {
	await page.waitForFunction((s: string) => !document.querySelector(s), { timeout, polling: 50 }, SNACK)
}

test("a copy success on Home spans the viewport above the nav and closes itself after 6 s", async ({ registeredExtension }) => {
	const page = await openHome(registeredExtension)
	await stubClipboard(page, "resolve")
	await recordSnackLife(page)

	await clickByTestId(page, COPY)
	await waitForToast(page, "Address is copied", 5_000, { kind: "success" })
	const rect = await settledSnack(page)
	expect(rect.bottom).toBeCloseTo(rect.innerHeight - 76, 0)
	expect(rect.width).toBeCloseTo(rect.innerWidth - 32, 0)
	expect(rect.left).toBeCloseTo(16, 0)

	const { appeared } = await snackLife(page)
	expect(appeared).toHaveLength(1)
	await pageClockPast(page, appeared[0] ?? 0, 5_500)
	expect(await cardCount(page)).toBe(1)
	await waitForSnackGone(page, 6_500)
	const life = await snackLife(page)
	expect(life.removed).toHaveLength(1)
	const lived = (life.removed[0] ?? 0) - (life.appeared[0] ?? 0)
	console.log(`[snackbar] the success lived ${Math.round(lived)}ms`)
	expect(lived).toBeGreaterThanOrEqual(5_500)
	expect(lived).toBeLessThanOrEqual(6_500)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)

test("a replacement never shows two cards: two copies 50 ms apart, then a success followed at once by an error", async ({
	registeredExtension,
}) => {
	const page = await openHome(registeredExtension)
	await stubClipboard(page, "resolve")

	await sampleCards(page, 1_000)
	await pressCopyTwice(page, 50)
	await sleep(400)
	await pressCopyThenFail(page)
	await waitForToast(page, "Couldn't copy address", 5_000, { kind: "error" })
	expect(await sampledMax(page)).toBe(1)
	expect(await cardCount(page)).toBe(1)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)

test("the pointer resting on the snack keeps it; after leaving, it goes within its remaining time", async ({ registeredExtension }) => {
	const page = await openHome(registeredExtension)
	await stubClipboard(page, "resolve")
	await page.bringToFront()

	await clickByTestId(page, COPY)
	await waitForToast(page, "Address is copied", 5_000, { kind: "success" })
	const rect = await settledSnack(page)
	await page.mouse.move(rect.left + rect.width / 2, rect.top + rect.height / 2, { steps: 5 })
	await sleep(8_000)
	expect(await cardCount(page)).toBe(1)

	await page.mouse.move(rect.left + rect.width / 2, rect.top - 40, { steps: 5 })
	await waitForSnackGone(page, 6_500)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)

test("an error on a page without the nav sits 12px up, stays, and closes from the keyboard", async ({ registeredExtension }) => {
	const page = await openHome(registeredExtension)
	await navigateToSettings(page, "accounts")
	await waitForHash(page, "#/popup/settings/accounts")
	await page.waitForSelector(sel("manage-accounts-page"), { visible: true, timeout: 5_000 })
	await stubClipboard(page, "reject")
	await recordSnackLife(page)

	await clickByTestId(page, COPY)
	await waitForToast(page, "Couldn't copy address", 5_000, { kind: "error" })
	const rect = await settledSnack(page)
	expect(rect.bottom).toBeCloseTo(rect.innerHeight - 12, 0)
	const { appeared } = await snackLife(page)
	await pageClockPast(page, appeared[0] ?? 0, 10_000)
	expect(await cardCount(page)).toBe(1)

	await page.bringToFront()
	const last = await focusLastPageControl(page)
	console.log(`[snackbar] the last page control is ${last}`)
	await page.keyboard.press("Tab")
	expect(await activeTestId(page)).toBe("snackbar-close")
	await page.keyboard.press("Enter")
	await waitForSnackGone(page, 5_000)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)
