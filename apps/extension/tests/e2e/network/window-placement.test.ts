import type { Page } from "puppeteer"
import { describe, expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { FIREFOX_ONLY, isFirefox, waitForTarget } from "../fixtures/browser"
import {
	clickByTestId,
	type ExtensionContext,
	isTargetDetachError,
	launchExtension,
	openPopup,
	patchPagePolling,
	registerProfile,
	test as base,
	waitForHash,
	withTimeoutMessage,
} from "../fixtures/extension"
import { switchToLocalNetwork } from "../fixtures/helpers"
import { playgroundTestPage, selectPgBundle, setPgInput, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { type PopupKind, waitForExecuteContent, waitForMainFrame, waitForPopup } from "../fixtures/popups"
import { pointerClick } from "../helpers/legal-drivers"

/**
 * Every dApp window — connect, emoji check, permissions, execute — opens flush with the right edge
 * and top of the last-focused normal window, no taller than it, and its controls stay reachable at
 * that native size. Each expectation is derived from bounds the browser reports.
 */

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined

type Bounds = { left: number; top: number; width: number; height: number }
type WindowRead = Bounds & { id: number; type: string; state: string }
type Placed = { outer: WindowRead; inner: { width: number; height: number }; viewport: unknown }
type PlaygroundWindow = { id: number; page: Page; window: WindowRead }
type PlacementContext = ExtensionContext & { control: Page }

/** The height every dApp window asks for. */
const REQUESTED_HEIGHT = 800
/** Below headless Chrome's 600-tall screen, so each window's height comes from the anchor, not the 800 it asks. */
const ANCHOR: Bounds = { left: 100, top: 40, width: 600, height: 500 }
const SECOND: Bounds = { left: 0, top: 80, width: 500, height: 440 }
const W1_MOVED = { left: 20, top: 60 }

const test = base.extend<{ placement: PlacementContext }>({
	placement: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const ctx = await launchExtension({ fixedWindowSize: false })
			try {
				await registerProfile(ctx)
				const control = await openPopup(ctx)
				await waitForHash(control, "#/popup/general", 30_000)
				await switchToLocalNetwork(control)
				await use(Object.assign(ctx, { control }))
			} finally {
				await ctx.close()
			}
		},
		{ scope: "test" },
	],
})

/** A window read from an extension page once three reads 100 ms apart agree; `null` is the page's own. */
async function settledWindow(page: Page, windowId: number | null): Promise<WindowRead> {
	return page.evaluate(async (id) => {
		const read = async () => {
			const w = id === null ? await chrome.windows.getCurrent() : await chrome.windows.get(id)
			return { id: w.id, left: w.left, top: w.top, width: w.width, height: w.height, type: w.type, state: w.state }
		}
		const deadline = Date.now() + 15_000
		let last = await read()
		let same = 0
		while (same < 2) {
			if (Date.now() > deadline) throw new Error(`window bounds never settled: ${JSON.stringify(last)}`)
			await new Promise((resolve) => setTimeout(resolve, 100))
			const now = await read()
			same = JSON.stringify(now) === JSON.stringify(last) ? same + 1 : 0
			last = now
		}
		return last
	}, windowId) as Promise<WindowRead>
}

/** The product's own anchor query, asked from the control page. */
function lastFocused(control: Page): Promise<{ id: number; type: string }> {
	return control.evaluate(async () => {
		const w = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
		return { id: w.id as number, type: w.type as string }
	})
}

async function updateWindow(control: Page, id: number, info: chrome.windows.UpdateInfo): Promise<WindowRead> {
	await control.evaluate((windowId, update) => chrome.windows.update(windowId, update), id, info)
	return settledWindow(control, id)
}

/** Every window the browser lists, for failure messages. */
function census(control: Page): Promise<unknown[]> {
	return control.evaluate(async () =>
		(await chrome.windows.getAll()).map(({ id, type, left, top, width, height }) => ({ id, type, left, top, width, height })),
	)
}

async function readScreen(control: Page): Promise<Bounds> {
	return control.evaluate(() => {
		const s = screen as Screen & { availLeft: number; availTop: number }
		return { left: s.availLeft, top: s.availTop, width: s.availWidth, height: s.availHeight }
	})
}

/** A normal window holding an unconnected playground page, created from the control page so its id is known. */
async function openPlaygroundWindow(ctx: PlacementContext, bounds: Bounds): Promise<PlaygroundWindow> {
	const before = new Set(ctx.browser.targets())
	const url = playgroundTestPage()
	const origin = new URL(url).origin
	const id = await ctx.control.evaluate(
		async (pageUrl, b) => (await chrome.windows.create({ type: "normal", url: pageUrl, focused: true, ...b })).id,
		url,
		bounds,
	)
	if (typeof id !== "number") throw new Error("windows.create returned no window id")
	const target = await waitForTarget(ctx.browser, (t) => t.type() === "page" && !before.has(t) && t.url().startsWith(origin), 30_000)
	const page = await target.asPage()
	await waitForMainFrame(page)
	patchPagePolling(page)
	await page.waitForSelector('[data-testid="pg-status"]', { timeout: 30_000 })
	await updateWindow(ctx.control, id, { state: "normal" })
	const window = await updateWindow(ctx.control, id, bounds)
	expect(window, "the window took the requested geometry").toMatchObject({ ...bounds, type: "normal", state: "normal" })
	return { id, page, window }
}

/** `waitForPopup` armed before `action`, since it ignores windows that already exist. */
async function openedBy(ctx: PlacementContext, kind: PopupKind, dapp: Page, action: () => Promise<unknown>): Promise<Page> {
	const popup = waitForPopup(ctx, kind, { timeout: 60_000 })
	popup.catch(() => undefined)
	await action()
	return withTimeoutMessage(popup, async () => {
		const targets = ctx.browser.targets().map((t) => `${t.type()} ${t.url()}`)
		const windows = await census(ctx.control)
		const dappState = await dapp.evaluate(() => ({
			status: document.querySelector('[data-testid="pg-status"]')?.getAttribute("data-status"),
			error: document.querySelector('[data-testid="pg-error-text"]')?.textContent,
		}))
		return `no ${kind} window opened: ${JSON.stringify({ dappState, windows, targets })}`
	})
}

/** A click dispatched inside the page, which, unlike `clickByTestId`, never focuses its window. */
async function pageClick(page: Page, testid: string): Promise<void> {
	await page.waitForFunction(
		(id) => {
			const el = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
			return !!el && !el.disabled
		},
		{ timeout: 30_000 },
		testid,
	)
	await page.evaluate((id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.click(), testid)
}

/** The resolving click, through the real pointer once the control is enabled. The window closes on it. */
async function finalClick(page: Page, testid: string): Promise<void> {
	await page.waitForFunction(
		(id) => {
			const el = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)
			return !!el && !el.disabled && getComputedStyle(el).pointerEvents !== "none"
		},
		{ timeout: 60_000 },
		testid,
	)
	await pointerClick(page, testid).catch((err) => {
		if (!isTargetDetachError(err)) throw err
	})
}

async function expectTopRightOf(ctx: PlacementContext, label: string, page: Page, anchorId: number): Promise<Placed> {
	const outer = await settledWindow(page, null)
	const inner = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
	const placed = { outer, inner, viewport: page.viewport() }
	const anchor = await settledWindow(ctx.control, anchorId)
	const why = `${label}: ${JSON.stringify({ placed, anchor, windows: await census(ctx.control) })}`
	expect({ right: outer.left + outer.width, top: outer.top, height: outer.height }, why).toEqual({
		right: anchor.left + anchor.width,
		top: anchor.top,
		height: Math.min(REQUESTED_HEIGHT, anchor.height),
	})
	expect(placed.viewport, why).toBeNull()
	expect(inner.width, why).toBeGreaterThan(0)
	expect(inner.height, why).toBeGreaterThan(0)
	expect(inner.width, why).toBeLessThanOrEqual(outer.width)
	expect(inner.height, why).toBeLessThanOrEqual(outer.height)
	return placed
}

async function grantFirstAccount(ctx: PlacementContext, dapp: Page, anchorId: number): Promise<void> {
	await selectPgBundle(dapp, "transaction")
	const seq = await snapshotResultSeq(dapp)
	const caps = await openedBy(ctx, "capabilities", dapp, () => clickByTestId(dapp, "pg-btn-requestCapabilities"))
	await expectTopRightOf(ctx, "capabilities", caps, anchorId)
	await caps.waitForSelector('[data-testid="cap-account-item"]', { timeout: 60_000 })
	await caps.evaluate(() => {
		const row = document.querySelector<HTMLElement>('[data-testid="cap-account-item"]')
		if (row && !row.dataset.selected) row.click()
	})
	await caps.waitForSelector('[data-testid="cap-account-item"][data-selected]', { timeout: 5_000 })
	await finalClick(caps, "cap-approve-btn")
	expect((await waitForPgResult(dapp, "requestCapabilities", seq, 30_000)).status).toBe("ok")
}

/** Connect, emoji check, permissions, then a `sendTx` left waiting in its execute window W1, all anchored on A. */
async function walkToPendingSend(ctx: PlacementContext, config: AztecTestConfig) {
	const screenArea = await readScreen(ctx.control)
	const a = await openPlaygroundWindow(ctx, ANCHOR)
	expect(a.window.left, "on screen").toBeGreaterThanOrEqual(screenArea.left)
	expect(a.window.top, "on screen").toBeGreaterThanOrEqual(screenArea.top)
	expect(a.window.left + a.window.width, "on screen").toBeLessThanOrEqual(screenArea.left + screenArea.width)
	expect(a.window.top + a.window.height, "on screen").toBeLessThanOrEqual(screenArea.top + screenArea.height)
	expect((await lastFocused(ctx.control)).id, "A is the last-focused normal window").toBe(a.id)

	const discover = await openedBy(ctx, "discover", a.page, () => clickByTestId(a.page, "pg-btn-connect"))
	await expectTopRightOf(ctx, "discover", discover, a.id)
	const verify = await openedBy(ctx, "verify", a.page, () => finalClick(discover, "discover-allow-btn"))
	await expectTopRightOf(ctx, "verify", verify, a.id)
	await finalClick(verify, "verify-confirm-btn")
	await a.page.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 })

	await grantFirstAccount(ctx, a.page, a.id)

	await setPgInput(a.page, "tokenAddress", config.tokenAddress)
	await setPgInput(a.page, "recipient", config.minterAddress)
	await setPgInput(a.page, "amount", "1")
	const sendSeq = await snapshotResultSeq(a.page)
	const w1 = await openedBy(ctx, "execute", a.page, () => clickByTestId(a.page, "pg-btn-sendTx-default"))
	await waitForExecuteContent(w1, 60_000)
	const w1Id = (await expectTopRightOf(ctx, "execute", w1, a.id)).outer.id
	return { a, w1, w1Id, sendSeq }
}

/**
 * Connect on B's page must open at B's corner, which the test first proves differs from A's and W1's.
 * B shares A's origin, which already holds a session, so the wallet skips discovery and opens the emoji check.
 */
async function expectConnectOn(ctx: PlacementContext, b: PlaygroundWindow, others: number[]): Promise<void> {
	const windows = await Promise.all([b.id, ...others].map((id) => settledWindow(ctx.control, id)))
	const corners = new Set(windows.map((w) => `${w.left + w.width},${w.top}`))
	expect(corners.size, `three distinct corners: ${JSON.stringify(windows)}`).toBe(3)
	const verify = await openedBy(ctx, "verify", b.page, () => pageClick(b.page, "pg-btn-connect"))
	await expectTopRightOf(ctx, "emoji check from B", verify, b.id)
	await finalClick(verify, "verify-confirm-btn")
	await b.page.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 })
}

async function rejectPendingSend(w1: Page, dapp: Page, sendSeq: number): Promise<void> {
	await finalClick(w1, "execute-reject-btn")
	expect((await waitForPgResult(dapp, "sendTx", sendSeq, 30_000)).status).toBe("error")
}

test.skipIf(!aztecConfig)(
	"dApp windows open at the top-right of the last-focused normal window, no taller than it",
	{ timeout: 300_000 },
	async ({ placement: ctx }) => {
		const { a, w1, w1Id, sendSeq } = await walkToPendingSend(ctx, aztecConfig as AztecTestConfig)
		const b = await openPlaygroundWindow(ctx, SECOND)
		await updateWindow(ctx.control, w1Id, W1_MOVED)
		expect((await lastFocused(ctx.control)).id, "B is the last-focused normal window").toBe(b.id)
		await expectConnectOn(ctx, b, [a.id, w1Id])
		await rejectPendingSend(w1, a.page, sendSeq)
	},
)

describe.skipIf(!isFirefox)(FIREFOX_ONLY.windowRefocus, () => {
	test.skipIf(!aztecConfig)(
		"a focused approval popup never anchors the next window",
		{ timeout: 300_000 },
		async ({ placement: ctx }) => {
			const { a, w1, w1Id, sendSeq } = await walkToPendingSend(ctx, aztecConfig as AztecTestConfig)
			const b = await openPlaygroundWindow(ctx, SECOND)
			await updateWindow(ctx.control, b.id, { focused: true })
			expect((await lastFocused(ctx.control)).id, "B is the last-focused normal window").toBe(b.id)
			await updateWindow(ctx.control, w1Id, W1_MOVED)
			await updateWindow(ctx.control, w1Id, { focused: true })
			// Firefox ignores `windowTypes`, so the anchor query itself answers with the popup.
			expect(await lastFocused(ctx.control), "W1 is the last-focused window").toEqual({ id: w1Id, type: "popup" })
			await expectConnectOn(ctx, b, [a.id, w1Id])
			await rejectPendingSend(w1, a.page, sendSeq)
		},
	)
})
