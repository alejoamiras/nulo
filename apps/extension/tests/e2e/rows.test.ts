/** In a real browser: a row's Tab stop, its ring, the native Enter/Space activation of a link and a
 *  button, a modified click's new tab, the measured 24px box, what sits on top of a titled span
 *  and of the row's icon, and how far apart rows sit and whether anything leaves one. */
import type { Page } from "puppeteer"
import { expect } from "vitest"
import { prepareKeys, waitForNewTab, waitForTarget } from "./fixtures/browser"
import { type ExtensionContext, openPopup, test, waitForHash } from "./fixtures/extension"
import {
	addContact,
	clickNavTab,
	navigateByHash,
	navigateToSettings,
	openNetworkDetail,
	seedUsdQuoteAndReload,
	setDeveloperMode,
	setTheme,
} from "./fixtures/helpers"
import { settleClosedPopup } from "./fixtures/popup-leave"
import { readActivityScope, seedReceipt, seedTokenRow, seedTransaction } from "./helpers/activity-seeds"
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
	__logsClicks?: number
	__linkClick?: { modified: boolean; href: string | null; prevented: boolean } | null
}

/** A priced 1.5 cUSD transfer: the price map quotes it as USDC. */
async function openHomeWithRow(ctx: ExtensionContext): Promise<Page> {
	const page = await openPopup(ctx)
	await waitForHash(page, "#/popup/general")
	await seedTransaction(page, await readActivityScope(page), { hash: TX_HASH, amount: "1500000" })
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

async function shiftTab(page: Page): Promise<void> {
	await page.keyboard.down("Shift")
	await page.keyboard.press("Tab")
	await page.keyboard.up("Shift")
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

/** Home's token card settles after the activity row shows, and its empty state then pushes the row
 *  down: a point measured before it lands can miss the row. */
async function backToHome(page: Page): Promise<void> {
	await page.evaluate(() => history.back())
	await waitForHash(page, "#/popup/general", 10_000)
	await page.waitForSelector(sel("tx-card"), { visible: true, timeout: 15_000 })
	await page.waitForSelector(sel("tokens-empty-import-link"), { visible: true, timeout: 15_000 })
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

test("Home's first activity row: a Tab stop with the ring, Enter and Space each open it with one pushState, the priced span is on top, a press on the icon opens it", async ({
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

	await backToHome(page)
	await tabTo(page, "tx-card")
	await armNavigationProbe(page)
	await page.keyboard.press(SPACE)
	await waitForHashPrefix(page, "#/popup/tx/")
	await page.waitForFunction(() => (window as unknown as Probe).__spacePrevented !== null, { timeout: 5_000, polling: 50 })
	expect(await probe(page)).toEqual({ pushes: 1, scrolls: 0, spacePrevented: true })

	await backToHome(page)
	expect(await coveredAt(page, "activity-fiat")).toBeNull()
	expect(await page.$eval(sel("activity-fiat"), (el) => el.getAttribute("title"))).toBe("At today's price")
	await armNavigationProbe(page)
	await pointerClick(page, "activity-fiat")
	await waitForHashPrefix(page, "#/popup/tx/")
	expect(await probe(page)).toMatchObject({ pushes: 1 })

	// The icon box is positioned for its badge, so it paints above the row's link unless it lets the
	// pointer through: the press at its centre must land on the row.
	await backToHome(page)
	const onIcon = await centreOf(page, `${sel("tx-card")} ${sel("activity-icon")}`)
	const hit = await page.evaluate(
		({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid") ?? "nothing",
		onIcon,
	)
	expect(hit).toBe("tx-card")
	await armNavigationProbe(page)
	await page.mouse.click(onIcon.x, onIcon.y)
	await waitForHashPrefix(page, "#/popup/tx/")
	expect(await probe(page)).toMatchObject({ pushes: 1 })

	expect(registeredExtension.pageErrors).toEqual([])
}, 90_000)

test("a contact row: its edit action is a 24px box whose real press stays on Contacts; a Ctrl-click opens the row's link in a new tab", async ({
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

	const point = await centreOf(page, row)
	await armLinkClickProbe(page)
	const tab = await waitForNewTab(
		registeredExtension.browser,
		async () => {
			await page.keyboard.down("Control")
			try {
				await page.mouse.click(point.x, point.y)
			} finally {
				await page.keyboard.up("Control")
			}
		},
		10_000,
	)
	try {
		// The new tab's own URL is no witness to where it opened: the wallet's cold boot routes it on at
		// once, and Firefox reports the tab only as about:blank. What opened it is the browser's default
		// for a modified click the page left alone, on the row's link.
		await page.waitForFunction(() => (window as unknown as Probe).__linkClick != null, { timeout: 5_000, polling: 50 })
		expect(await page.evaluate(() => (window as unknown as Probe).__linkClick)).toEqual({ modified: true, href, prevented: false })
		expect(await hash(page)).toBe("#/popup/settings/contacts")
	} finally {
		await tab.close()
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

test("Settings → Advanced's Logs row: one Tab stop with the ring; Enter opens the log window and Space runs the same handler", async ({
	registeredExtension,
}) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")
	await setDeveloperMode(page, true)
	await navigateByHash(page, "#/popup/settings/advanced")
	await page.waitForSelector(sel("settings-logs-row"), { visible: true, timeout: 10_000 })
	await page.evaluate(() => {
		const w = window as unknown as Probe
		w.__logsClicks = 0
		document.querySelector('[data-testid="settings-logs-row"]')?.addEventListener("click", () => {
			w.__logsClicks = (w.__logsClicks ?? 0) + 1
		})
	})
	await page.bringToFront()

	await tabTo(page, "settings-logs-open", 20)
	const ring = await page.$eval(sel("settings-logs-row"), (el) => {
		const style = getComputedStyle(el)
		return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`
	})
	expect(ring).toBe("solid 2px -2px")
	// Checked before Enter, while no window the wallet opened can take focus from the popup.
	expect(await tabAround(page, 1)).not.toContain("settings-logs-open")
	await shiftTab(page)
	await waitForFocus(page, "settings-logs-open")

	const before = new Set(registeredExtension.browser.targets())
	await page.keyboard.press("Enter")
	const logs = await waitForTarget(
		registeredExtension.browser,
		(t) => t.type() === "page" && !before.has(t) && t.url().includes("#/windows/logger"),
		10_000,
	)
	try {
		// The window is open, so Space brings it forward instead of opening a second one.
		await prepareKeys(page)
		await waitForFocus(page, "settings-logs-open")
		await page.keyboard.press(SPACE)
		await page.waitForFunction(() => (window as unknown as Probe).__logsClicks === 2, { timeout: 5_000, polling: 50 })
		expect(registeredExtension.browser.targets().filter((t) => t.type() === "page" && !before.has(t))).toHaveLength(1)
	} finally {
		await (await logs.asPage()).close().catch(() => undefined)
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

const ROWS = `${sel("tx-card")}, ${sel("tx-incoming-card")}`
const RECEIPT_TOKEN_ID = 1
/** A dApp's own name: with it the row's title line wraps at 360px. */
const DAPP_NAME = "Shielded Payroll Portal"

type RowLayout = {
	row: string
	top: number
	bottom: number
	amount: string | null
	fiat: string | null
	/** Descendants whose box leaves the row's. */
	escapes: string[]
	/** Descendants outside the amount column whose box enters it. */
	intrudes: string[]
	/** The amount's text is wider than its box. */
	cut: boolean
}

function readRows(page: Page): Promise<RowLayout[]> {
	return page.evaluate((rowsSel: string) => {
		const EDGE = 0.5
		const name = (el: Element) => el.getAttribute("data-testid") ?? el.tagName.toLowerCase()
		const within = (b: DOMRect, box: DOMRect) =>
			b.left >= box.left - EDGE && b.right <= box.right + EDGE && b.top >= box.top - EDGE && b.bottom <= box.bottom + EDGE
		const meets = (b: DOMRect, box: DOMRect) =>
			b.left < box.right - EDGE && b.right > box.left + EDGE && b.top < box.bottom - EDGE && b.bottom > box.top + EDGE
		const drawn = (row: Element) =>
			[...row.querySelectorAll("*")].filter((el) => {
				const b = el.getBoundingClientRect()
				return b.width > 0 && b.height > 0
			})
		const intruders = (row: Element, col: Element | null) => {
			if (!col) return []
			const colBox = col.getBoundingClientRect()
			// The row's link is stretched under the whole row by design.
			const outside = drawn(row).filter((el) => !col.contains(el) && !el.closest("[data-row-target]"))
			return outside.filter((el) => meets(el.getBoundingClientRect(), colBox)).map(name)
		}
		return [...document.querySelectorAll(rowsSel)].map((row) => {
			const box = row.getBoundingClientRect()
			const amount = row.querySelector<HTMLElement>('[data-testid="activity-amount"]')
			return {
				row: `${name(row)} ${row.getAttribute("data-tx-hash")?.slice(0, 6) ?? ""}`.trim(),
				top: box.top,
				bottom: box.bottom,
				amount: amount?.textContent?.trim() ?? null,
				fiat: row.querySelector('[data-testid="activity-fiat"]')?.textContent?.trim() ?? null,
				escapes: drawn(row)
					.filter((el) => !within(el.getBoundingClientRect(), box))
					.map(name),
				intrudes: intruders(row, row.querySelector('[data-testid="activity-amount-col"]')),
				cut: amount !== null && amount.scrollWidth > amount.clientWidth,
			}
		})
	}, ROWS)
}

/** The page's rows once `count` of them show their dollar figure and hold still across two polls: a
 *  receipt, a token lookup or a quote that lands late moves them. */
async function settledRows(page: Page, count: number): Promise<RowLayout[]> {
	await page
		.waitForFunction(
			(rowsSel: string, n: number) => {
				const w = window as unknown as { __rowsKey?: string }
				const rows = [...document.querySelectorAll(rowsSel)]
				const priced = rows.every((row) => row.querySelector('[data-testid="activity-fiat"]')?.textContent?.includes("$"))
				const boxes = rows.map((el) => {
					const b = el.getBoundingClientRect()
					return `${b.top},${b.bottom}`
				})
				const key = boxes.join("|")
				const still = boxes.length === n && priced && key === w.__rowsKey
				w.__rowsKey = key
				return still
			},
			{ timeout: 15_000, polling: 100 },
			ROWS,
			count,
		)
		.catch(async (error: unknown) => {
			throw new Error(`${count} rows never held still: ${JSON.stringify(await readRows(page))}; ${String(error)}`)
		})
	return readRows(page)
}

const gapsOf = (rows: RowLayout[]) => rows.slice(1).map((row, i) => row.top - rows[i].bottom)

/** Opens a surface by its hash and waits for the rows on screen to leave: the hash changes before
 *  the router swaps the page, so the old page's rows could pass for the new page's. */
async function openSurface(page: Page, hash: string): Promise<void> {
	const leaving = await page.$$(ROWS)
	await navigateByHash(page, hash)
	await page.waitForFunction((...rows: Element[]) => rows.every((row) => !row.isConnected), { timeout: 15_000, polling: 100 }, ...leaving)
	await Promise.all(leaving.map((row) => row.dispose()))
}

/** Each opened by its hash: Appearance, where the theme is set, has no bottom nav. */
const SURFACES = [
	{ name: "Home", hash: "#/popup/general" },
	{ name: "the token page", hash: `#/popup/tokens/${RECEIPT_TOKEN_ID}` },
	{ name: "History", hash: "#/popup/activity" },
]

test("rows sit 10px apart on Home, a token's page and History, the date heading 12px above the first; a dApp's long title, a nine-digit amount and a priced receipt stay inside their rows and never cover an amount, dark and light", async ({
	registeredExtensionPerTest,
}) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general")
	const scope = await readActivityScope(page)
	const now = Date.now()
	await seedTransaction(page, scope, { hash: TX_HASH, amount: "1500000", at: now })
	await seedTransaction(page, scope, { hash: `0x${"6a".repeat(32)}`, amount: "123456789123456", at: now - 1_000 })
	await seedTransaction(page, scope, {
		hash: `0x${"6b".repeat(32)}`,
		amount: "2500000",
		at: now - 2_000,
		transferType: 2,
		dapp: DAPP_NAME,
	})
	await seedTokenRow(page, scope, RECEIPT_TOKEN_ID)
	await seedReceipt(page, scope, { tokenId: RECEIPT_TOKEN_ID, amount: "4200000", nullifier: `0x${"5c".repeat(32)}`, at: now - 3_000 })
	await seedUsdQuoteAndReload(page)
	await page.bringToFront()

	for (const theme of ["dark", "light"] as const) {
		await navigateToSettings(page, "appearance")
		await setTheme(page, theme)
		for (const surface of SURFACES) {
			await openSurface(page, surface.hash)
			const rows = await settledRows(page, 4)
			const gaps = gapsOf(rows)
			console.log(
				`[rows] ${theme}, ${surface.name}: heights ${rows.map((r) => (r.bottom - r.top).toFixed(1)).join(", ")}; gaps ${gaps.map((g) => g.toFixed(1)).join(", ")}; amounts ${rows.map((r) => r.amount).join(", ")}`,
			)
			expect(rows.filter((r) => r.amount === null || r.cut || r.escapes.length > 0 || r.intrudes.length > 0)).toEqual([])
			for (const gap of gaps) expect.soft(gap, `${surface.name}'s row gap`).toBeCloseTo(10, 0)
			if (surface.name !== "History") continue
			const clearance = await page.evaluate((rowsSel: string) => {
				const label = document.querySelector('[data-testid="activity-date-label"]')
				const first = document.querySelector(rowsSel)
				return label && first ? first.getBoundingClientRect().top - label.getBoundingClientRect().bottom : null
			}, ROWS)
			console.log(`[rows] ${theme}, History: date label to first row ${clearance?.toFixed(1)}`)
			expect(clearance).toBeCloseTo(12, 0)
		}
	}

	expect(registeredExtensionPerTest.pageErrors).toEqual([])
}, 180_000)
