/**
 * Tooltips and the glossary in a real browser, where jsdom has no layout: the bubble stays inside the
 * window, the pointer can reach it, it swallows the click it covers, Escape closes it before anything
 * under it, and pressing the control a tooltip labels closes it for the popup that press opens.
 */
import type { Page } from "puppeteer"
import { TimeoutError } from "puppeteer"
import { expect } from "vitest"
import { GLOSSARY, GLOSSARY_SECTIONS } from "@/utils/glossary"
import { isFirefox, reloadExtensionPage } from "./fixtures/browser"
import { clickByTestId, openPopup, test, waitForHash } from "./fixtures/extension"
import { lockWallet, navigateToSettings } from "./fixtures/helpers"
import { settleClosedPopup } from "./fixtures/popup-leave"
import { pressEscape, tabAround, waitForFocus } from "./helpers/pointer-probes"

const sel = (testid: string) => `[data-testid="${testid}"]`
const BUBBLE = sel("tooltip-bubble")
const TERM = sel("gas-label-private")
const DEFINITION = GLOSSARY["private-fee-juice"].definition
const INSET = 8

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }
type ClickRecord = { inBubble: boolean; target: string }
type Recorder = { __clicks?: ClickRecord[] }

/** The open bubble's rect once it has stopped moving: placement lands a tick after it opens and the
 *  rise moves it 2px while it fades in, so an earlier read sees it unplaced or high. */
async function settledBubble(page: Page): Promise<Rect> {
	await page.waitForFunction(
		(s: string) => {
			const bubble = document.querySelector(s)
			return bubble !== null && getComputedStyle(bubble).opacity === "1" && bubble.getAnimations().length === 0
		},
		{ timeout: 5_000, polling: 50 },
		BUBBLE,
	)
	return page.$eval(BUBBLE, (bubble) => {
		const { left, top, right, bottom, width, height } = bubble.getBoundingClientRect()
		return { left, top, right, bottom, width, height }
	})
}

const centre = (r: Rect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

async function waitForBubbleGone(page: Page): Promise<void> {
	await page.waitForFunction((s: string) => !document.querySelector(s), { timeout: 5_000, polling: 50 }, BUBBLE)
}

/** Whether the bubble's presence holds for `ms`: a close lands within the 150ms grace, an open within
 *  the 300ms delay, so 400ms covers both. */
async function holds(page: Page, present: boolean, ms = 400): Promise<boolean> {
	return page
		.waitForFunction(
			(s: string, want: boolean) => (document.querySelector(s) !== null) !== want,
			{ timeout: ms, polling: 25 },
			BUBBLE,
			present,
		)
		.then(
			() => false,
			(error: unknown) => {
				if (error instanceof TimeoutError) return true
				throw error
			},
		)
}

/** Records each click's target at `window` capture and stops it there, so nothing under the point acts
 *  on it; `mousedown` passes, since the bubble's own `mousedown` handling is under test. */
async function recordClicks(page: Page): Promise<void> {
	await page.evaluate((s: string) => {
		const w = window as unknown as Recorder
		w.__clicks = []
		window.addEventListener(
			"click",
			(e) => {
				const target = e.target instanceof Element ? e.target : null
				w.__clicks?.push({
					inBubble: Boolean(target?.closest(s)),
					target: target?.closest("[data-testid]")?.getAttribute("data-testid") ?? target?.tagName ?? "none",
				})
				e.stopImmediatePropagation()
				e.preventDefault()
			},
			true,
		)
	}, BUBBLE)
}

async function clickAt(page: Page, point: { x: number; y: number }): Promise<ClickRecord> {
	const before = await page.evaluate(() => (window as unknown as Recorder).__clicks?.length ?? 0)
	await page.mouse.click(point.x, point.y)
	await page.waitForFunction(
		(n: number) => ((window as unknown as Recorder).__clicks?.length ?? 0) > n,
		{ timeout: 5_000, polling: 25 },
		before,
	)
	const record = await page.evaluate((n: number) => (window as unknown as Recorder).__clicks?.[n], before)
	if (!record) throw new Error("the click was not recorded")
	return record
}

const hitsBubble = (page: Page, point: { x: number; y: number }) =>
	page.evaluate((s: string, x: number, y: number) => Boolean(document.elementFromPoint(x, y)?.closest(s)), BUBBLE, point.x, point.y)

const hash = (page: Page) => page.evaluate(() => window.location.hash)

async function openHome(page: Page): Promise<void> {
	await waitForHash(page, "#/popup/general")
	await page.waitForSelector(TERM, { visible: true, timeout: 15_000 })
}

test("Settings → Glossary lists every entry in section order, and its back arrow returns to Settings", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "glossary")
	await waitForHash(page, "#/popup/settings/glossary")
	await page.waitForSelector(sel("glossary-entry-proving"), { visible: true, timeout: 5_000 })
	const entries = await page.$$eval('[data-testid^="glossary-entry-"]', (els) => els.map((el) => el.getAttribute("data-testid")))
	expect(entries).toEqual(GLOSSARY_SECTIONS.flatMap((section) => section.keys.map((key) => `glossary-entry-${key}`)))

	await clickByTestId(page, "subpage-back")
	await waitForHash(page, "#/popup/settings")

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)

test("a dotted term's tooltip in the 360×600 popup: inside the window, reachable, swallowing the click it covers", async ({
	registeredExtension,
}) => {
	const page = await openPopup(registeredExtension)
	await openHome(page)

	// Tab only as far as the term: a walk past the last stop leaves the document on Firefox, and a
	// scripted focus after that fires no focus events.
	const stops: string[] = []
	while (stops.length < 15 && stops.at(-1) !== "gas-label-private") stops.push(...(await tabAround(page, 1)))
	expect(stops.slice(-2)).toEqual(["gas-label-public", "gas-label-private"])

	await page.focus(TERM)
	const byFocus = await settledBubble(page)
	const view = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
	expect(byFocus.left).toBeGreaterThanOrEqual(INSET)
	expect(byFocus.right).toBeLessThanOrEqual(view.width - INSET)
	expect(byFocus.top).toBeGreaterThanOrEqual(INSET)
	expect(byFocus.bottom).toBeLessThanOrEqual(view.height - INSET)
	expect(byFocus.width).toBeLessThanOrEqual(272)
	expect(await page.$eval(sel("tooltip-text"), (el) => el.textContent?.trim())).toBe(DEFINITION)
	if (isFirefox) {
		const described = await page.$eval(
			TERM,
			(term) => document.getElementById(term.getAttribute("aria-describedby") ?? "")?.textContent,
		)
		expect(described).toBe(DEFINITION)
	} else {
		const term = await page.$(TERM)
		const node = await page.accessibility.snapshot({ root: term ?? undefined, interestingOnly: false })
		expect(node?.description).toBe(DEFINITION)
	}

	// Hover opens it; the pointer crosses the gap onto the bubble and it stays.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
	await waitForBubbleGone(page)
	await page.hover(TERM)
	const byHover = await settledBubble(page)
	await page.mouse.move(centre(byHover).x, centre(byHover).y, { steps: 10 })
	expect(await holds(page, true)).toBe(true)
	await page.keyboard.press("Escape")
	await waitForBubbleGone(page)

	// The swallowed click, at the centre of the bubble as focus opens it.
	await page.focus(TERM)
	const p = centre(await settledBubble(page))
	expect(await hitsBubble(page, p)).toBe(true)
	await recordClicks(page)

	await page.keyboard.press("Escape")
	await waitForBubbleGone(page)
	const underneath = await clickAt(page, p)
	console.log(`[tooltips-glossary] under the bubble's centre: ${underneath.target}`)
	expect(underneath.inBubble).toBe(false)

	await page.focus(TERM)
	await settledBubble(page)
	expect((await clickAt(page, p)).inBubble).toBe(true)
	expect(await holds(page, true)).toBe(true)
	await waitForFocus(page, "gas-label-private")
	expect(await hash(page)).toBe("#/popup/general")

	await reloadExtensionPage(page)
	await openHome(page)
	await recordClicks(page)
	await page.hover(TERM)
	const reopened = await settledBubble(page)
	expect((await clickAt(page, centre(reopened))).inBubble).toBe(true)
	expect(await holds(page, true)).toBe(true)
	expect(await hash(page)).toBe("#/popup/general")

	expect(await pressEscape(page)).toBe(true)
	await waitForBubbleGone(page)

	// Taller than the window: it pins to the top inset and runs past the bottom edge.
	await page.setViewport({ width: 360, height: Math.ceil(reopened.height) + 4 })
	const shortHeight = await page.evaluate(() => window.innerHeight)
	console.log(`[tooltips-glossary] bubble ${reopened.height}px tall, window set to ${shortHeight}px`)
	expect(shortHeight).toBeLessThan(reopened.height + 2 * INSET)
	await page.focus(TERM)
	const tall = await settledBubble(page)
	expect(tall.top).toBe(INSET)
	expect(tall.bottom).toBeGreaterThan(shortHeight)
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
	await waitForBubbleGone(page)
	await page.setViewport({ width: 360, height: 600 })

	// An unbroken string wraps inside the cap instead of running past it.
	await page.focus(TERM)
	await settledBubble(page)
	const long = await page.$eval(sel("tooltip-text"), (text) => {
		text.textContent = "x".repeat(200)
		const bubble = text.closest('[data-testid="tooltip-bubble"]')
		return { width: bubble?.getBoundingClientRect().width ?? Number.NaN, scroll: text.scrollWidth, client: text.clientWidth }
	})
	expect(long.width).toBeLessThanOrEqual(272)
	expect(long.scroll).toBeLessThanOrEqual(long.client)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
}, 90_000)

test("pressing Delete profile closes its tooltip, and the popup it opens takes the first Escape", async ({
	registeredExtensionPerTest,
}) => {
	const home = await openPopup(registeredExtensionPerTest)
	await waitForHash(home, "#/popup/general")
	await lockWallet(home)
	await home.close()

	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/auth", 10_000)
	await page.waitForSelector(sel("auth-reset"), { visible: true, timeout: 5_000 })
	await page.focus(sel("auth-reset"))
	await settledBubble(page)

	await page.keyboard.press(" ")
	await page.waitForSelector(sel("forgot-reset-btn"), { visible: true, timeout: 5_000 })
	expect(await page.$$eval(sel("forgot-reset-btn"), (els) => els.length)).toBe(1)
	expect(await page.$(BUBBLE)).toBeNull()

	expect(await pressEscape(page)).toBe(true)
	const forced = await settleClosedPopup(page, "forgot-reset-btn")
	if (forced) console.log("[tooltips-glossary] the forgot-password popup's leave transition stuck; finished by hand")
	await waitForFocus(page, "auth-reset")
	expect(await holds(page, false)).toBe(true)

	expect(registeredExtensionPerTest.consoleErrors).toEqual([])
	expect(registeredExtensionPerTest.pageErrors).toEqual([])
}, 60_000)
