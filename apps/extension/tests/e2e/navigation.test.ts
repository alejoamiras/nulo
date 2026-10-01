import type { Page } from "puppeteer"
import { expect } from "vitest"
import { test, openPopup, waitForHash } from "./fixtures/extension"
import { clickNavTab, openHoldings, seedUsdQuoteAndReload } from "./fixtures/helpers"
import { readActivityScope, seedTransaction } from "./helpers/activity-seeds"
import { tabAround } from "./helpers/pointer-probes"

test("settings page shows all sections", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await clickNavTab(page, "settings")
	await waitForHash(page, "#/popup/settings")

	// Assert core settings destinations exist by testid. Route segments are
	// the stable contract even when section labels get reorganized.
	for (const segment of ["profile", "accounts", "security", "networks", "tokens"]) {
		await page.waitForSelector(`[data-testid="setting-nav-${segment}"]`, {
			visible: true,
			timeout: 5_000,
		})
	}
	// About is a footer link with a real href (not a SettingItem)
	await page.waitForSelector('a[href="#/popup/settings/about"]', { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("activity page shows empty state", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await clickNavTab(page, "activity")
	await waitForHash(page, "#/popup/activity")

	await page.waitForSelector('[data-testid="page-hero-title"]', { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("bottom navigation switches between all four pages", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await openHoldings(page)

	await clickNavTab(page, "activity")
	await waitForHash(page, "#/popup/activity")

	await clickNavTab(page, "settings")
	await waitForHash(page, "#/popup/settings")

	await clickNavTab(page, "general")
	await waitForHash(page, "#/popup/general")

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("about page shows version info", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await clickNavTab(page, "settings")
	await waitForHash(page, "#/popup/settings")

	// Jump directly via router rather than clicking the below-the-fold footer link
	await page.evaluate(() => {
		const link = document.querySelector<HTMLAnchorElement>('a[href="#/popup/settings/about"]')
		link?.click()
	})

	await waitForHash(page, "#/popup/settings/about")

	// About page embeds wallet + Aztec version strings. These are informational
	// fixed labels, safe to text-match.
	await page.waitForSelector("text/Wallet version", { visible: true, timeout: 5_000 })
	await page.waitForSelector("text/Aztec version", { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

type Box = { top: number; bottom: number; left: number; right: number; width: number; height: number }

type BarRead = {
	/** The hero title's top, from the top of its scrolling page. */
	titleOffset: number
	heroPaddingBottom: string
	wrapper: { top: number; clientWidth: number }
	bar: Box & { opacity: number }
	/** What the pointer meets at the bar's centre and 1px inside each edge: `bar`, `hero` or a testid. */
	hits: string[]
	/** Logged, not asserted: the parent's height is the flow the bar takes. */
	barParent: Box
}

function readBar(page: Page, wrapperTestid: string): Promise<BarRead> {
	return page.evaluate((wrapperSel: string) => {
		const one = (s: string) => {
			const el = document.querySelector(s)
			if (!el) throw new Error(`${s} not found`)
			return el as HTMLElement
		}
		const boxOf = (el: Element) => {
			const { top, bottom, left, right, width, height } = el.getBoundingClientRect()
			return { top, bottom, left, right, width, height }
		}
		const wrapper = one(wrapperSel)
		const bar = one('[data-testid="page-title-bar"]')
		const hero = one('[data-testid="page-hero"]')
		const b = boxOf(bar)
		// Opacity is not inherited: what shows is the product along the ancestors.
		let opacity = 1
		for (let el: Element | null = bar; el; el = el.parentElement) opacity *= Number(getComputedStyle(el).opacity)
		const midX = b.left + b.width / 2
		const midY = b.top + b.height / 2
		const points = [
			[midX, midY],
			[b.left + 1, midY],
			[b.right - 1, midY],
			[midX, b.top + 1],
			[midX, b.bottom - 1],
		]
		const hits = points.map(([x, y]) => {
			const hit = document.elementFromPoint(x, y)
			if (hit && bar.contains(hit)) return "bar"
			if (hit && hero.contains(hit)) return "hero"
			return hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? hit?.tagName ?? "nothing"
		})
		const wrapperBox = wrapper.getBoundingClientRect()
		return {
			titleOffset: one('[data-testid="page-hero-title"]').getBoundingClientRect().top - wrapperBox.top,
			heroPaddingBottom: getComputedStyle(hero).paddingBottom,
			wrapper: { top: wrapperBox.top, clientWidth: wrapper.clientWidth },
			bar: { ...b, opacity },
			hits,
			barParent: boxOf(bar.parentElement ?? bar),
		}
	}, `[data-testid="${wrapperTestid}"]`)
}

/** Scrolls the page and waits for the bar's fade to finish in the state the scroll asks for. */
async function scrollAndSettle(page: Page, wrapperTestid: string, to: "top" | "end"): Promise<BarRead> {
	await page.evaluate(
		(s: string, end: boolean) => {
			const wrapper = document.querySelector(s)
			if (wrapper) wrapper.scrollTop = end ? wrapper.scrollHeight : 0
		},
		`[data-testid="${wrapperTestid}"]`,
		to === "end",
	)
	await page.waitForFunction(
		(want: number) => {
			let opacity = 1
			for (let el = document.querySelector('[data-testid="page-title-bar"]'); el; el = el.parentElement)
				opacity *= Number(getComputedStyle(el).opacity)
			return opacity === want
		},
		{ timeout: 5_000, polling: 50 },
		to === "end" ? 1 : 0,
	)
	return readBar(page, wrapperTestid)
}

const SETTINGS_ROW = "setting-nav-networks"

/** Puts a Settings row under the shown bar's bottom edge, clicks 2px below that edge and returns
 *  what the pointer met there and the hash the click led to. */
async function clickBelowBar(page: Page): Promise<{ hit: string; hash: string }> {
	const point = await page.evaluate((rowSel: string) => {
		const wrapper = document.querySelector('[data-testid="settings-page"]')
		const bar = document.querySelector('[data-testid="page-title-bar"]')
		const row = document.querySelector(rowSel)
		if (!wrapper || !bar || !row) throw new Error("Settings, its bar or its row is missing")
		const barHeight = bar.getBoundingClientRect().height
		wrapper.scrollTop += row.getBoundingClientRect().top - wrapper.getBoundingClientRect().top - barHeight + 8
		const rowBox = row.getBoundingClientRect()
		return { x: rowBox.left + rowBox.width / 2 }
	}, `[data-testid="${SETTINGS_ROW}"]`)
	await page.waitForFunction(
		() => {
			let opacity = 1
			for (let el = document.querySelector('[data-testid="page-title-bar"]'); el; el = el.parentElement)
				opacity *= Number(getComputedStyle(el).opacity)
			return opacity === 1
		},
		{ timeout: 5_000, polling: 50 },
	)
	const y = await page.$eval('[data-testid="page-title-bar"]', (bar) => bar.getBoundingClientRect().bottom + 2)
	const hit = await page.evaluate(
		(x: number, at: number) => document.elementFromPoint(x, at)?.closest("[data-testid]")?.getAttribute("data-testid") ?? "nothing",
		point.x,
		y,
	)
	await page.mouse.click(point.x, y)
	await page
		.waitForFunction(() => window.location.hash === "#/popup/settings/networks", { timeout: 3_000, polling: 50 })
		.catch(() => undefined)
	return { hit, hash: await page.evaluate(() => window.location.hash) }
}

const pages = [
	{ tab: "activity", hash: "#/popup/activity", wrapper: "activity-feed-root" },
	{ tab: "settings", hash: "#/popup/settings", wrapper: "settings-page" },
] as const

test("History's and Settings' titles sit 10px below the header with 28px under the hero; the compact bar shows once the hero leaves, covers the page's width and takes the pointer only while shown", async ({
	registeredExtensionPerTest,
}) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general")
	// Enough rows that History scrolls its hero away.
	const scope = await readActivityScope(page)
	const now = Date.now()
	for (let i = 0; i < 10; i++) {
		await seedTransaction(page, scope, { hash: `0x${(0x10 + i).toString(16).repeat(32)}`, amount: "1500000", at: now - i * 1_000 })
	}
	await seedUsdQuoteAndReload(page)
	await page.bringToFront()

	for (const { tab, hash, wrapper } of pages) {
		await clickNavTab(page, tab)
		await waitForHash(page, hash)
		// Inside the destination's own wrapper: the hash changes before the router swaps the page.
		await page.waitForSelector(`[data-testid="${wrapper}"] [data-testid="page-hero-title"]`, { visible: true, timeout: 10_000 })
		const atTop = await scrollAndSettle(page, wrapper, "top")
		const shown = await scrollAndSettle(page, wrapper, "end")
		const back = await scrollAndSettle(page, wrapper, "top")
		console.log(`[titles] ${tab}: ${JSON.stringify({ atTop, shown, back })}`)

		// Hidden, the bar lets every press through; shown, it is opaque and owns every point it covers.
		expect(atTop.hits.filter((h) => h === "bar")).toEqual([])
		expect(shown.bar.opacity).toBe(1)
		expect(shown.hits).toEqual(["bar", "bar", "bar", "bar", "bar"])
		expect(back.hits.filter((h) => h === "bar")).toEqual([])

		expect.soft(atTop.titleOffset, `${tab}: title below the header`).toBeGreaterThanOrEqual(9)
		expect.soft(atTop.titleOffset, `${tab}: title below the header`).toBeLessThanOrEqual(11)
		expect.soft(atTop.heroPaddingBottom, `${tab}: space under the hero`).toBe("28px")
		expect.soft(atTop.hits, `${tab}: the hidden bar lies over the hero`).toEqual(["hero", "hero", "hero", "hero", "hero"])
		expect.soft(Math.abs(shown.bar.top - shown.wrapper.top), `${tab}: the shown bar's top`).toBeLessThanOrEqual(1)
		expect.soft(Math.abs(shown.bar.width - shown.wrapper.clientWidth), `${tab}: the shown bar's width`).toBeLessThanOrEqual(1)
	}

	// One lap of Tab from Settings' first row: every row in order, then the rest of the popup, never the bar.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
	const walk = await tabAround(page, 50)
	const start = walk.indexOf("setting-nav-profile")
	const end = walk.indexOf("setting-nav-profile", start + 1)
	expect(start >= 0 && end > start, `a full lap in ${walk.join(" → ")}`).toBe(true)
	const lap = walk.slice(start, end)
	console.log(`[titles] Settings' Tab lap: ${lap.join(" → ")}`)
	expect(lap.filter((stop) => stop.startsWith("page-"))).toEqual([])
	const rows = await page.$$eval('[data-testid^="setting-nav-"]', (els) => els.map((el) => el.getAttribute("data-testid")))
	expect(lap.filter((stop) => stop.startsWith("setting-nav-"))).toEqual(rows)

	const below = await clickBelowBar(page)
	console.log(`[titles] a click 2px under the shown bar met ${below.hit} and led to ${below.hash}`)
	expect.soft(below, "a click just under the shown bar opens the row there").toEqual({
		hit: SETTINGS_ROW,
		hash: "#/popup/settings/networks",
	})

	expect(registeredExtensionPerTest.pageErrors).toEqual([])
}, 120_000)
