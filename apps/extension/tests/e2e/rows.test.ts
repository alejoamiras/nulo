/** In a real browser: a row's Tab stop, its ring, the native Enter/Space activation of a link and a
 *  button, a modified click's new tab, the measured 24px box and what sits on top of a titled span. */
import type { Page } from "puppeteer"
import { expect } from "vitest"
import { seedsForChain } from "@/wallet/services/token/default-tokens"
import { waitForTarget } from "./fixtures/browser"
import { type ExtensionContext, openPopup, patchPagePolling, test, waitForHash } from "./fixtures/extension"
import {
	addContact,
	captureSoleProfileId,
	clickNavTab,
	getAccountAddress,
	navigateToSettings,
	openNetworkDetail,
	seedUsdQuoteAndReload,
} from "./fixtures/helpers"
import { settleClosedPopup } from "./fixtures/popup-leave"
import { waitForMainFrame } from "./fixtures/popups"
import { pointerClick } from "./helpers/legal-drivers"
import { coveredAt, pressEscape, tabAround, waitForFocus } from "./helpers/pointer-probes"

const sel = (testid: string) => `[data-testid="${testid}"]`
const TX_HASH = `0x${"5e".repeat(32)}`
/** Puppeteer's BiDi keyboard (Firefox) knows the space bar only by its key value, not as "Space". */
const SPACE = " "

type Probe = {
	__pushes?: number
	__origPush?: History["pushState"]
	__scrolls?: number
	__spacePrevented?: boolean | null
	__clicks?: string[]
	__rowClicks?: number
	__linkClick?: { modified: boolean; href: string | null; prevented: boolean } | null
}

/** A finalized 1.5 USDC transfer for the active scope, under the tx root. Every field the row codec
 *  branches on is set; the priced contract is the chain's seeded USDC, so the quote reaches its row. */
async function seedTransaction(page: Page): Promise<void> {
	const profileId = await captureSoleProfileId(page)
	const account = await getAccountAddress(page)
	const { networkId, chainId } = await page.evaluate(async (pid: string) => {
		const all = await chrome.storage.local.get(null)
		const networkId = all[`nulo:core:active-network@${pid}`] as string
		const network = JSON.parse(all[`nulo:core:networks@${networkId}`] as string) as { chainId: number }
		return { networkId, chainId: network.chainId }
	}, profileId)
	const seed = seedsForChain(chainId)[0]
	if (!seed) throw new Error(`no default token seed for chain ${chainId}`)
	const now = Date.now()
	const token = { name: seed.displayName, symbol: seed.expectedSymbol, decimals: 6 }
	const tx = {
		chainId,
		profileId,
		networkId,
		account,
		nonce: "0",
		feePaymentMethod: 0,
		hash: TX_HASH,
		createdAt: now,
		updatedAt: now,
		status: 5,
		executionResult: 0,
		origin: { type: 0 },
		calls: [
			{
				contract: seed.contract,
				method: "transfer",
				args: [],
				transfers: [{ token, type: 0, from: account, to: account, amount: "1500000" }],
			},
		],
	}
	await page.evaluate(
		(key: string, row: unknown) => chrome.storage.local.set({ [key]: JSON.stringify(row) }),
		`nulo:core:txs@${TX_HASH}`,
		tx,
	)
}

async function openHomeWithRow(ctx: ExtensionContext): Promise<Page> {
	const page = await openPopup(ctx)
	await waitForHash(page, "#/popup/general")
	await seedTransaction(page)
	await seedUsdQuoteAndReload(page)
	await page.waitForSelector(sel("tx-card"), { visible: true, timeout: 15_000 })
	await page.bringToFront()
	return page
}

/** Presses Tab until focus is in the named control, reporting the walk. */
async function tabTo(page: Page, testid: string, limit = 40): Promise<string[]> {
	const visited: string[] = []
	while (visited.length < limit) {
		visited.push(...(await tabAround(page, 1)))
		if (visited.at(-1) === testid) return visited
	}
	throw new Error(`Tab never reached ${testid}: ${visited.join(" → ")}`)
}

/** Counts `history.pushState` calls, scroll events until the row acts (its push), and reads whether
 *  the next Space keydown was handled — a handled keydown has no default action, so no page scroll.
 *  All on the page, armed before the key or click that is measured. */
async function armNavigationProbe(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as Probe
		w.__pushes = 0
		w.__scrolls = 0
		w.__spacePrevented = null
		if (!w.__origPush) w.__origPush = history.pushState
		const orig = w.__origPush
		const onScroll = () => {
			w.__scrolls = (w.__scrolls ?? 0) + 1
		}
		window.addEventListener("scroll", onScroll, true)
		history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
			w.__pushes = (w.__pushes ?? 0) + 1
			window.removeEventListener("scroll", onScroll, true)
			return orig.apply(this, args)
		}
		window.addEventListener(
			"keydown",
			(e) => {
				if (e.key !== " ") return
				setTimeout(() => {
					w.__spacePrevented = e.defaultPrevented
				}, 0)
			},
			{ capture: true, once: true },
		)
	})
}

/** Reads the next click once every handler has run: its modifier, the link it landed on, and
 *  whether the page left the default to the browser, which for a modified click opens the link in a
 *  new tab. */
async function armLinkClickProbe(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as Probe
		w.__linkClick = null
		window.addEventListener(
			"click",
			(e) => {
				const href = (e.target as Element | null)?.closest("a")?.getAttribute("href") ?? null
				setTimeout(() => {
					w.__linkClick = { modified: e.ctrlKey || e.metaKey, href, prevented: e.defaultPrevented }
				}, 0)
			},
			{ capture: true, once: true },
		)
	})
}

const probe = (page: Page) =>
	page.evaluate(() => {
		const w = window as unknown as Probe
		return { pushes: w.__pushes ?? -1, scrolls: w.__scrolls ?? -1, spacePrevented: w.__spacePrevented ?? null }
	})

const hash = (page: Page) => page.evaluate(() => window.location.hash)
const historyLength = (page: Page) => page.evaluate(() => history.length)

async function waitForHashPrefix(page: Page, prefix: string): Promise<void> {
	await page.waitForFunction((p: string) => window.location.hash.startsWith(p), { timeout: 10_000, polling: 50 }, prefix)
}

async function goBackTo(page: Page, expected: string): Promise<void> {
	await page.evaluate(() => history.back())
	await waitForHash(page, expected, 10_000)
	await page.waitForSelector(sel("tx-card"), { visible: true, timeout: 15_000 })
}

/** Records the named control each click lands in, at `window` capture, and how many clicks bubble up
 *  to the endpoint row's root (where its handler listens) — without touching the event. */
async function recordClicks(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as Probe
		w.__clicks = []
		w.__rowClicks = 0
		window.addEventListener(
			"click",
			(e) => {
				const target = e.target instanceof Element ? e.target : null
				w.__clicks?.push(target?.closest("[data-testid]")?.getAttribute("data-testid") ?? target?.tagName ?? "none")
			},
			true,
		)
		document.querySelector('[data-testid="endpoint-row"]')?.addEventListener("click", () => {
			w.__rowClicks = (w.__rowClicks ?? 0) + 1
		})
	})
}

const clicks = (page: Page) =>
	page.evaluate(() => {
		const w = window as unknown as Probe
		return { window: w.__clicks ?? [], row: w.__rowClicks ?? -1 }
	})

async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
	await page.waitForSelector(selector, { visible: true, timeout: 10_000 })
	return page.evaluate((s: string) => {
		const el = document.querySelector(s)
		if (!el) throw new Error(`${s} not found`)
		el.scrollIntoView({ block: "center" })
		const box = el.getBoundingClientRect()
		return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
	}, selector)
}

/** Closes the popup holding the control with one Escape; returns whether the page handled the key. */
async function closeTopPopup(page: Page, innerTestId: string): Promise<boolean> {
	const handled = await pressEscape(page)
	try {
		await settleClosedPopup(page, innerTestId)
		return handled
	} catch (error) {
		const state = await page.evaluate((s: string) => {
			const el = document.querySelector(s)
			const wrapper = el && [...document.querySelectorAll("#popup > *")].find((w) => w.contains(el))
			const active = document.activeElement
			return {
				present: el !== null,
				wrapper: wrapper?.className ?? null,
				layers: document.querySelectorAll("#popup > *").length,
				active: active?.closest("[data-testid]")?.getAttribute("data-testid") ?? active?.tagName ?? "none",
			}
		}, sel(innerTestId))
		throw new Error(`Escape (handled=${handled}) left the popup holding ${innerTestId}: ${JSON.stringify(state)}; ${String(error)}`)
	}
}

/** What a page is showing, for a failure message. */
const tabState = (tab: Page) =>
	tab.evaluate(() => ({
		hash: window.location.hash,
		testids: [...document.querySelectorAll("[data-testid]")].slice(0, 40).map((el) => el.getAttribute("data-testid")),
		text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
	}))

/** The page's one contact: the one already there (a retry keeps the earlier attempt's), else a new one. */
async function ensureContact(page: Page): Promise<string> {
	const existing = await page.evaluate(
		() => document.querySelector('[data-testid="contact-row"]')?.getAttribute("data-contact-name") ?? null,
	)
	if (existing) return existing
	const name = `Row-${Math.random().toString(36).slice(2, 8)}`
	await addContact(page, name, `0x${"a1".repeat(32)}`)
	return name
}

test("Home's first activity row: a Tab stop with the ring, Enter and Space each open it with one pushState, the priced span is on top", async ({
	registeredExtension,
}) => {
	const page = await openHomeWithRow(registeredExtension)

	const walk = await tabTo(page, "tx-card")
	console.log(`[rows] the Tab walk to the row: ${walk.join(" → ")}`)
	const focused = await page.evaluate(() => {
		const el = document.activeElement as HTMLElement | null
		const row = el?.closest('[data-testid="tx-card"]')
		return { tag: el?.tagName, href: el?.getAttribute("href"), outline: row ? getComputedStyle(row).outlineWidth : null }
	})
	expect(focused.tag).toBe("A")
	expect(focused.href).toContain(`#/popup/tx/${TX_HASH}`)
	expect(focused.outline).toBe("2px")

	await armNavigationProbe(page)
	const entriesBefore = await historyLength(page)
	await page.keyboard.press("Enter")
	await waitForHashPrefix(page, "#/popup/tx/")
	expect(await probe(page)).toMatchObject({ pushes: 1 })
	expect(await historyLength(page)).toBe(entriesBefore + 1)

	await goBackTo(page, "#/popup/general")
	await tabTo(page, "tx-card")
	await armNavigationProbe(page)
	await page.keyboard.press(SPACE)
	await waitForHashPrefix(page, "#/popup/tx/")
	await page.waitForFunction(() => (window as unknown as Probe).__spacePrevented !== null, { timeout: 5_000, polling: 50 })
	expect(await probe(page)).toEqual({ pushes: 1, scrolls: 0, spacePrevented: true })

	await goBackTo(page, "#/popup/general")
	expect(await coveredAt(page, "activity-fiat")).toBeNull()
	expect(await page.$eval(sel("activity-fiat"), (el) => el.getAttribute("title"))).toBe("At today's price")
	await armNavigationProbe(page)
	await pointerClick(page, "activity-fiat")
	await waitForHashPrefix(page, "#/popup/tx/")
	expect(await probe(page)).toMatchObject({ pushes: 1 })

	expect(registeredExtension.pageErrors).toEqual([])
}, 90_000)

test("a contact row: its edit action is a 24px box whose real press stays on Contacts; a Ctrl-click opens Send in a new tab with the contact", async ({
	registeredExtension,
}) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")
	await navigateToSettings(page, "contacts")
	await page.waitForSelector(`${sel("contacts-new-btn")}, ${sel("contact-row")}`, { visible: true, timeout: 10_000 })
	const name = await ensureContact(page)
	const row = `${sel("contact-row")}[data-contact-name="${name}"]`

	const href = await page.$eval(`${row} a[data-row-target]`, (a) => a.getAttribute("href") ?? "")
	expect(href).toContain("#/popup/send?contact=")
	const box = await page.$eval(`${row} ${sel("contact-edit")}`, (el) => {
		const { width, height } = el.getBoundingClientRect()
		return { width, height }
	})
	expect(box.width).toBeGreaterThanOrEqual(24)
	expect(box.height).toBeGreaterThanOrEqual(24)

	await armNavigationProbe(page)
	await pointerClick(page, "contact-edit")
	await page.waitForSelector(sel("edit-contact-submit"), { visible: true, timeout: 5_000 })
	expect(await hash(page)).toBe("#/popup/settings/contacts")
	expect(await probe(page)).toMatchObject({ pushes: 0 })
	await closeTopPopup(page, "edit-contact-submit")

	const before = new Set(registeredExtension.browser.targets())
	const point = await centreOf(page, row)
	await armLinkClickProbe(page)
	await page.keyboard.down("Control")
	await page.mouse.click(point.x, point.y)
	await page.keyboard.up("Control")
	const target = await waitForTarget(registeredExtension.browser, (t) => t.type() === "page" && !before.has(t), 10_000)
	const tab = await target.asPage()
	try {
		// The new tab's own URL is no witness to where it opened: the wallet's cold boot routes it on at
		// once (today it bounces a deep link to Home), and Firefox's navigation entry names no URL.
		// What opened it is the browser's default for a modified click the page left alone, on the
		// row's link.
		await page.waitForFunction(() => (window as unknown as Probe).__linkClick != null, { timeout: 5_000, polling: 50 })
		expect(await page.evaluate(() => (window as unknown as Probe).__linkClick)).toEqual({ modified: true, href, prevented: false })
		expect(await hash(page)).toBe("#/popup/settings/contacts")
		await waitForMainFrame(tab, 10_000)
		// A tab opened in the background gets no animation frames; the polls must not depend on them.
		patchPagePolling(tab)
		// Where the boot leaves the tab once its shell is up, for the record.
		await tab.waitForSelector(sel("bottom-nav"), { timeout: 30_000 }).catch(() => undefined)
		console.log(`[rows] the Ctrl-click's tab, after boot, shows ${(await tabState(tab)).hash}`)
	} finally {
		await tab.close().catch(() => undefined)
	}

	expect(registeredExtension.pageErrors).toEqual([])
}, 90_000)

test("a click-mode Settings row opens on Enter and on Space; an action inside a Tooltip runs once per key and never activates its row; inert rows are skipped", async ({
	registeredExtension,
}) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")
	await navigateToSettings(page, "networks")
	const firstName = await page.$eval(sel("network-row"), (el) => el.getAttribute("data-network-name"))
	await openNetworkDetail(page, firstName ?? "")
	await page.bringToFront()

	await tabTo(page, "network-detail-rename", 12)
	for (const key of ["Enter", SPACE] as const) {
		await page.keyboard.press(key)
		await page.waitForSelector(sel("network-name-input"), { visible: true, timeout: 5_000 })
		await closeTopPopup(page, "network-name-input")
		await waitForFocus(page, "network-detail-rename")
	}

	// The disabled active-network row above and the raw Chain ID row below the rename row hold no
	// stop: the next two are the endpoint row's target and its first action.
	await recordClicks(page)
	expect(await tabAround(page, 2)).toEqual(["endpoint-row", "endpoint-edit-btn"])
	for (const [i, key] of (["Enter", SPACE] as const).entries()) {
		await page.keyboard.press(key)
		await page.waitForSelector(sel("endpoint-rpc-input"), { visible: true, timeout: 5_000 })
		// The action's click stops at the action: none reaches the row root, where the row's handler is.
		expect(await clicks(page)).toEqual({ window: Array(i + 1).fill("endpoint-edit-btn"), row: 0 })
		expect(await hash(page)).toContain("/popup/settings/networks/")
		// The press dismissed the action's tooltip, so the one Escape is the popup's.
		await page.waitForFunction(() => !document.querySelector('[data-testid="tooltip-bubble"]'), { timeout: 2_000, polling: 50 })
		expect(await closeTopPopup(page, "endpoint-rpc-input")).toBe(true)
		await waitForFocus(page, "endpoint-edit-btn")
	}

	expect(registeredExtension.pageErrors).toEqual([])
}, 90_000)

test("History's list keeps the −8px row box inside the page: nothing scrolls sideways", async ({ registeredExtension }) => {
	const page = await openHomeWithRow(registeredExtension)
	await clickNavTab(page, "activity")
	await waitForHash(page, "#/popup/activity")
	await page.waitForSelector(`${sel("activity-feed-root")} ${sel("tx-card")}`, { visible: true, timeout: 15_000 })

	// The row's box bleeds 8px into the page padding by design; what must not happen is a scroll
	// container or the document gaining width, or the row leaving the viewport.
	const layout = await page.evaluate(() => {
		const overflowing: string[] = []
		const row = document.querySelector('[data-testid="tx-card"]')
		let el: Element | null = row
		while (el && el !== document.body) {
			const clips = getComputedStyle(el).overflowX !== "visible"
			if (clips && el.scrollWidth > el.clientWidth)
				overflowing.push(`${el.getAttribute("data-testid") ?? el.tagName} ${el.scrollWidth}>${el.clientWidth}`)
			el = el.parentElement
		}
		if (document.documentElement.scrollWidth > window.innerWidth) overflowing.push("html")
		const box = row?.getBoundingClientRect()
		return { overflowing, left: box?.left ?? -1, right: box?.right ?? -1, width: window.innerWidth }
	})
	expect(layout.overflowing).toEqual([])
	expect(layout.left).toBeGreaterThanOrEqual(0)
	expect(layout.right).toBeLessThanOrEqual(layout.width)

	expect(registeredExtension.pageErrors).toEqual([])
}, 60_000)
