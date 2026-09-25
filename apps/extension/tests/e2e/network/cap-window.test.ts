import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { isFirefox } from "../fixtures/browser"
import { clickByTestId, test, type ExtensionContext } from "../fixtures/extension"
import { assertPgOk, type PgBundle, type PgResult, requestPgBundle, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import {
	approveCapabilities,
	getCapItems,
	readCapabilitySwitch,
	rejectCapabilities,
	rejectExecute,
	waitCapabilitiesReady,
	waitForExecuteContent,
	waitForPopup,
	waitForPopupClosed,
} from "../fixtures/popups"
import { pointerClick } from "../helpers/legal-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * The permission window in a browser: what jsdom cannot show. Keys press native buttons, the Tab
 * order runs as drawn, the layout fits the drawings' 400×800, and a widening to any contract turns
 * the authorizations switch Off again. Every flow connects on its own launch, so no flow's grant
 * turns another's first request into a re-request.
 */

type Connected = ExtensionContext & { playgroundPage: Page }
type Stop = { testid: string; row?: string; tag: string }
type Rect = { width: number; height: number }

const sel = (testid: string) => `[data-testid="${testid}"]`

/** Request `bundle` on the token and return its window at 400×800 (Chrome's e2e window is 800×600). */
async function openWindow(ctx: Connected, bundle: PgBundle): Promise<{ popup: Page; seq: number }> {
	const seq = await snapshotResultSeq(ctx.playgroundPage)
	const popupP = waitForPopup(ctx, "capabilities", { timeout: 60_000 })
	await requestPgBundle(ctx.playgroundPage, bundle, { tokenAddress: aztecConfig!.tokenAddress })
	const popup = await popupP
	await popup.setViewport({ width: 400, height: 800 })
	await waitCapabilitiesReady(popup)
	return { popup, seq }
}

/** Where focus is. A row's stretched target carries no testid, so it reads as its row's, and its
 *  tag tells it from a control inside the row. */
const focusStop = (popup: Page): Promise<Stop> =>
	popup.evaluate(() => {
		const el = document.activeElement
		const row = el?.closest("[data-cap-row]")?.getAttribute("data-cap-row")
		return {
			testid: el?.closest("[data-testid]")?.getAttribute("data-testid") ?? "none",
			...(row ? { row } : {}),
			tag: el?.tagName ?? "none",
		}
	})

async function pressTab(popup: Page): Promise<Stop> {
	await popup.keyboard.press("Tab")
	return focusStop(popup)
}

const rectOf = (popup: Page, testid: string): Promise<Rect> =>
	popup.$eval(sel(testid), (el) => {
		const { width, height } = el.getBoundingClientRect()
		return { width, height }
	})

const attrOf = (popup: Page, testid: string, name: string): Promise<string | null> =>
	popup.$eval(sel(testid), (el, n) => el.getAttribute(n), name)

const waitForAttr = (popup: Page, testid: string, name: string, value: string | null) =>
	popup.waitForFunction(
		(s: string, n: string, v: string | null) => document.querySelector(s)?.getAttribute(n) === v,
		{ timeout: 5_000, polling: 50 },
		sel(testid),
		name,
		value,
	)

const focusedAttr = (popup: Page, name: string): Promise<string | null> =>
	popup.evaluate((n) => document.activeElement?.getAttribute(n) ?? null, name)

/** Answers every clipboard write and keeps what was written, so a copy is read without the focus and
 *  permission the real clipboard wants. */
async function recordCopies(popup: Page): Promise<void> {
	await popup.evaluate(() => {
		const w = window as unknown as { __copied?: string[] }
		w.__copied = []
		const write = (text: string) => {
			w.__copied?.push(text)
			return Promise.resolve()
		}
		Object.defineProperty(navigator.clipboard, "writeText", { value: write, configurable: true })
	})
}

const copies = (popup: Page): Promise<string[]> => popup.evaluate(() => (window as unknown as { __copied?: string[] }).__copied ?? [])

/** Asks for a call intent's signature and expects the confirmation window, titled Authorization. */
async function callIntentAsks(ctx: Connected): Promise<PgResult> {
	const page = ctx.playgroundPage
	const seq = await snapshotResultSeq(page)
	const popupP = waitForPopup(ctx, "execute", { timeout: 60_000 })
	await clickByTestId(page, "pg-btn-createAuthWit-callIntent")
	const popup = await popupP
	await waitForExecuteContent(popup)
	expect(await popup.$eval(sel("execute-op-title"), (el) => el.textContent?.trim())).toBe("Authorization")
	await rejectExecute(popup)
	return waitForPgResult(page, "createAuthWit", seq, 30_000)
}

async function rejectWindow(ctx: Connected, popup: Page, seq: number): Promise<void> {
	await rejectCapabilities(popup)
	expect((await waitForPgResult(ctx.playgroundPage, "requestCapabilities", seq, 30_000)).status).toBe("error")
	await waitForPopupClosed(popup)
}

test.skipIf(!hasConfig)(
	"cap-window — Tab runs account, rename, term, switch, Details; Enter opens Details, a row and the rename field",
	{ timeout: 180_000 },
	async ({ dappConnectedExtensionPerTest: ctx }) => {
		const first = await openWindow(ctx, "transaction-listed")
		const popup = first.popup
		await popup.bringToFront()

		const stops: Stop[] = []
		let switchOutline = ""
		while (stops.length < 8 && stops.at(-1)?.testid !== "cap-detail-toggle") {
			const stop = await pressTab(popup)
			stops.push(stop)
			if (stop.testid === "cap-toggle") {
				switchOutline = await popup.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle)
			}
		}
		expect(stops).toEqual([
			{ testid: "cap-account-item", tag: "BUTTON" },
			{ testid: "cap-account-rename-btn", tag: "BUTTON" },
			{ testid: "cap-auth-term", row: "authorizations", tag: "SPAN" },
			{ testid: "cap-toggle", row: "authorizations", tag: "DIV" },
			{ testid: "cap-detail-toggle", tag: "BUTTON" },
		])
		expect(switchOutline).toBe("solid")
		const rename = await rectOf(popup, "cap-account-rename-btn")
		expect(rename.height).toBeGreaterThanOrEqual(24)
		expect(rename.width).toBeGreaterThanOrEqual(24)

		await popup.keyboard.press("Enter")
		await waitForAttr(popup, "cap-detail-toggle", "aria-expanded", "true")
		expect(await pressTab(popup)).toEqual({ testid: "cap-details-row", tag: "BUTTON" })
		await popup.keyboard.press("Enter")
		await popup.waitForSelector(sel("cap-details-fns"), { visible: true, timeout: 5_000 })
		expect(await focusedAttr(popup, "aria-expanded")).toBe("true")
		expect(await pressTab(popup), "the copy button is out of the Tab order").toEqual({ testid: "cap-reject-btn", tag: "BUTTON" })

		const copy = await rectOf(popup, "cap-details-copy")
		expect(copy.width).toBeGreaterThanOrEqual(24)
		expect(copy.height).toBeGreaterThanOrEqual(24)
		await recordCopies(popup)
		await pointerClick(popup, "cap-details-copy")
		await popup.waitForFunction(() => ((window as unknown as { __copied?: string[] }).__copied ?? []).length > 0, {
			timeout: 5_000,
			polling: 50,
		})
		expect(await copies(popup)).toEqual([aztecConfig!.tokenAddress])
		expect(await attrOf(popup, "cap-details-row", "aria-expanded"), "the copy left the row open").toBe("true")
		expect(await popup.$(sel("cap-details-fns"))).not.toBeNull()

		await popup.focus(sel("cap-account-rename-btn"))
		await popup.keyboard.press("Enter")
		await popup.waitForSelector(sel("cap-account-alias-input"), { visible: true, timeout: 5_000 })
		expect((await focusStop(popup)).testid).toBe("cap-account-alias-input")
		await rejectWindow(ctx, popup, first.seq)
	},
)

// Its own connect: after a rejection the same request is a re-request, whose badged rows make the
// window scroll, and Firefox puts a scrolling region in the Tab order ahead of its controls.
test.skipIf(!hasConfig)(
	"cap-window — on a fresh window, Space and Enter press the account target, and Space the rename link",
	{ timeout: 180_000 },
	async ({ dappConnectedExtensionPerTest: ctx }) => {
		const fresh = await openWindow(ctx, "transaction-listed")
		await fresh.popup.bringToFront()
		expect(await pressTab(fresh.popup)).toEqual({ testid: "cap-account-item", tag: "BUTTON" })
		expect(await focusedAttr(fresh.popup, "aria-pressed")).toBe("true")
		await fresh.popup.keyboard.press(" ")
		await waitForAttr(fresh.popup, "cap-account-item", "data-selected", null)
		expect(await focusedAttr(fresh.popup, "aria-pressed")).toBe("false")
		await fresh.popup.keyboard.press("Enter")
		await waitForAttr(fresh.popup, "cap-account-item", "data-selected", "true")
		expect(await focusedAttr(fresh.popup, "aria-pressed")).toBe("true")
		expect(await pressTab(fresh.popup)).toEqual({ testid: "cap-account-rename-btn", tag: "BUTTON" })
		await fresh.popup.keyboard.press(" ")
		await fresh.popup.waitForSelector(sel("cap-account-alias-input"), { visible: true, timeout: 5_000 })
		await rejectWindow(ctx, fresh.popup, fresh.seq)
	},
)

// Chrome's alone: Firefox's BiDi session cannot emulate media features.
test.skipIf(!hasConfig || isFirefox)(
	"cap-window — reduced motion stills the Details chevron",
	{ timeout: 180_000 },
	async ({ dappConnectedExtensionPerTest: ctx }) => {
		const { popup, seq } = await openWindow(ctx, "transaction-listed")
		const chevron = `${sel("cap-detail-toggle")} ${sel("cap-disclosure-chevron")}`
		const duration = () => popup.$eval(chevron, (el) => getComputedStyle(el).transitionDuration)
		expect(await duration()).toBe("0.2s")
		await popup.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }])
		expect(await duration()).toBe("0s")
		await rejectWindow(ctx, popup, seq)
	},
)

test.skipIf(!hasConfig)(
	"cap-window — S2's rows fit 400×800 with Details closed, and the dotted term sits inside its line",
	{ timeout: 180_000 },
	async ({ dappConnectedExtensionPerTest: ctx }) => {
		const { popup, seq } = await openWindow(ctx, "transaction-listed")
		expect((await getCapItems(popup)).map((item) => item.row)).toEqual([
			"account-address",
			"simulation",
			"contracts",
			"authorizations",
			"transaction",
		])
		expect(await popup.$(sel("cap-unknown-contracts-note"))).not.toBeNull()
		expect(await attrOf(popup, "cap-detail-toggle", "aria-expanded")).toBe("false")

		const overflow = await popup.evaluate(() => {
			const scrollers = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) =>
				/(auto|scroll)/.test(getComputedStyle(el).overflowY),
			)
			return {
				scrollers: scrollers.length,
				overflowing: scrollers.filter((el) => el.scrollHeight > el.clientHeight).map((el) => [el.scrollHeight, el.clientHeight]),
				documentHeight: document.documentElement.scrollHeight,
				viewportHeight: window.innerHeight,
			}
		})
		expect(overflow.scrollers, "the window has its scroll container").toBeGreaterThan(0)
		expect(overflow.overflowing, "a scroller overflows (scrollHeight, clientHeight)").toEqual([])
		expect(overflow.documentHeight).toBeLessThanOrEqual(overflow.viewportHeight)

		// An empty inline-block sits on its line's baseline: one goes at the end of the term, one just
		// before its tooltip host in the sentence, and both come out once measured.
		const term = await popup.$eval(`${sel("cap-item")}[data-cap-row="authorizations"] ${sel("cap-row-sub")}`, (sub) => {
			const dotted = sub.querySelector('[data-testid="cap-auth-term"]')
			const host = [...sub.children].find((child) => dotted && child.contains(dotted))
			if (!dotted || !host) throw new Error("the authorizations line has no dotted term")
			const probe = () => {
				const marker = document.createElement("span")
				marker.style.cssText = "display: inline-block; width: 0; height: 0"
				return marker
			}
			const inTerm = dotted.appendChild(probe())
			const inLine = sub.insertBefore(probe(), host)
			const gap = Math.abs(inTerm.getBoundingClientRect().top - inLine.getBoundingClientRect().top)
			inTerm.remove()
			inLine.remove()
			const line = sub.getBoundingClientRect()
			const inside = [...dotted.getClientRects()].every(
				(r) => r.left >= line.left - 0.5 && r.right <= line.right + 0.5 && r.top >= line.top - 0.5 && r.bottom <= line.bottom + 0.5,
			)
			return { gap, inside, rects: dotted.getClientRects().length }
		})
		expect(term.rects).toBeGreaterThan(0)
		expect(term.inside, "the term's boxes lie inside its line").toBe(true)
		expect(term.gap, "the term's baseline against the sentence's, in px").toBeLessThanOrEqual(1)
		await rejectWindow(ctx, popup, seq)
	},
)

test.skipIf(!hasConfig)(
	"cap-window — A-5: a widening to any contract shows the authorizations row new, Off and flagged; the next call intent asks",
	{ timeout: 240_000 },
	async ({ dappConnectedExtensionPerTest: ctx }) => {
		const page = ctx.playgroundPage
		const connect = await openWindow(ctx, "transaction-listed")
		expect(await readCapabilitySwitch(connect.popup, "authorizations")).toBe(true)
		await approveCapabilities(connect.popup)
		await assertPgOk(page, await waitForPgResult(page, "requestCapabilities", connect.seq, 30_000), "cap-window:connect")

		const widen = await openWindow(ctx, "transaction")
		const authorizations = (await getCapItems(widen.popup)).find((item) => item.row === "authorizations")
		expect(authorizations).toMatchObject({ granted: false, flagged: true })
		expect(await readCapabilitySwitch(widen.popup, "authorizations")).toBe(false)
		await approveCapabilities(widen.popup)
		await assertPgOk(page, await waitForPgResult(page, "requestCapabilities", widen.seq, 30_000), "cap-window:allow")

		expect((await callIntentAsks(ctx)).status).toBe("error")
	},
)
