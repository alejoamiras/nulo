/** In a real browser: where a page or window has a bottom action row, an error snack sits at least
 *  12px above the row's top edge, so it never covers the row's buttons, even in a window shorter
 *  than the page, where a scroll brings the row up and a click lands on it in one task. */
import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, openPopup, replaceInputValue, test, waitForHash } from "../fixtures/extension"
import { navigateByHash, setActiveSendType, waitForToast } from "../fixtures/helpers"
import { waitForPopup } from "../fixtures/popups"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const sel = (testid: string) => `[data-testid="${testid}"]`
const SNACK = sel("snackbar")

type Placement = { snackTop: number; snackBottom: number; footerTop: number; left: number; width: number; columnCentre: number }
type AtEnd = { viewport: number; inset: number; footerTop: number; footerTopAtEnd: number; snackBottom: number }
type Hit = { id: string; hit: string; covered: boolean }

const FOOTER = sel("dapp-approval-footer")
const BUTTONS = ["execute-reject-btn", "execute-confirm-btn"]

/** The card rises 20px as it fades in. */
async function settledCard(page: Page): Promise<void> {
	await page.waitForFunction(
		(s: string) => {
			const card = document.querySelector(s)
			return card !== null && getComputedStyle(card).opacity === "1" && card.getAnimations().length === 0
		},
		{ timeout: 10_000, polling: 50 },
		SNACK,
	)
}

async function placement(page: Page, footer: string): Promise<Placement> {
	await settledCard(page)
	return page.evaluate(
		(s: string, f: string) => {
			const card = document.querySelector(s)?.getBoundingClientRect()
			const row = document.querySelector(f)?.getBoundingClientRect()
			if (!card || !row) throw new Error("no snack or no footer")
			return {
				snackTop: card.top,
				snackBottom: card.bottom,
				footerTop: row.top,
				left: card.left,
				width: card.width,
				columnCentre: (() => {
					const body = document.body.getBoundingClientRect()
					return body.left + body.width / 2
				})(),
			}
		},
		SNACK,
		footer,
	)
}

/** Adds a line of `height` px at the top of the footer, as its error line does. */
async function addFooterLine(page: Page, footer: string, height: number): Promise<void> {
	await page.evaluate(
		(f: string, px: number) => {
			const line = document.createElement("div")
			line.dataset.testid = "e2e-footer-line"
			line.style.height = `${px}px`
			line.style.flexShrink = "0"
			document.querySelector(f)?.prepend(line)
		},
		footer,
		height,
	)
}

/** Grows the footer by one 40px line, as a wrapping error line does, and returns the new placement
 *  once the snack has followed it. */
async function growFooter(page: Page, footer: string, before: Placement): Promise<Placement> {
	await addFooterLine(page, footer, 40)
	await page.waitForFunction(
		(s: string, top: number) => (document.querySelector(s)?.getBoundingClientRect().top ?? top) < top - 20,
		{ timeout: 5_000, polling: 50 },
		SNACK,
		before.snackTop,
	)
	return placement(page, footer)
}

/** Waits until the card sits 12px above where the footer stops once the page is scrolled to its end,
 *  and reads both. */
async function placementAtEnd(page: Page, footer: string): Promise<AtEnd> {
	await settledCard(page)
	await page.waitForFunction(
		(s: string, f: string) => {
			const card = document.querySelector(s)?.getBoundingClientRect()
			const row = document.querySelector(f)?.getBoundingClientRect()
			const root = document.scrollingElement ?? document.documentElement
			const toEnd = root.scrollHeight - root.clientHeight - root.scrollTop
			return card !== undefined && row !== undefined && Math.abs(row.top - toEnd - 12 - card.bottom) < 0.5
		},
		{ timeout: 5_000, polling: 50 },
		SNACK,
		footer,
	)
	return page.evaluate(
		(s: string, f: string) => {
			const card = document.querySelector(s)?.getBoundingClientRect()
			const row = document.querySelector(f)?.getBoundingClientRect()
			if (!card || !row) throw new Error("no snack or no footer")
			const root = document.scrollingElement ?? document.documentElement
			const viewport = document.documentElement.clientHeight
			const toEnd = root.scrollHeight - root.clientHeight - root.scrollTop
			return {
				viewport,
				inset: viewport - card.bottom,
				footerTop: row.top,
				footerTopAtEnd: row.top - toEnd,
				snackBottom: card.bottom,
			}
		},
		SNACK,
		footer,
	)
}

/** From the top of the page, scrolls each control into view and hit-tests its centre in the same
 *  task, as a pointer click does. */
async function hitsAfterScroll(page: Page, testids: string[]): Promise<Hit[]> {
	return page.evaluate(
		(s: string, ids: string[]) =>
			ids.map((id) => {
				window.scrollTo(0, 0)
				const el = document.querySelector(`[data-testid="${id}"]`)
				if (!el) throw new Error(`${id} not found`)
				el.scrollIntoView({ block: "center" })
				const box = el.getBoundingClientRect()
				const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
				const owner = hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? hit?.tagName ?? "none"
				return { id, hit: owner, covered: document.querySelector(s)?.contains(hit) === true }
			}),
		SNACK,
		testids,
	)
}

/** An address one past a random valid one, retried until it is off the curve: a shield to it fails
 *  the fee estimate. */
async function offCurveAddress(): Promise<string> {
	const { AztecAddress } = await import("@aztec/aztec.js/addresses")
	for (let i = 0; i < 64; i++) {
		const probe = AztecAddress.fromBigIntUnsafe((await AztecAddress.random()).toBigInt() + 1n)
		if (!(await probe.isValid())) return probe.toString()
	}
	throw new Error("no off-curve address in 64 tries")
}

test.skipIf(!hasConfig)(
	"Send: a fee-estimate error sits 12px above the footer and follows it when it grows",
	{ timeout: 300_000 },
	async ({ tokenReadyExtension }) => {
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general", 30_000)
		await navigateByHash(page, "#/popup/send", 10_000)
		await page.waitForSelector(sel("send-from-type"), { timeout: 10_000 })
		await setActiveSendType(page, "send-from-type", "public")
		await setActiveSendType(page, "send-to-type", "private")
		await page.waitForFunction(
			() => {
				const input = document.querySelector<HTMLInputElement>('[data-testid="send-amount-input"]')
				return input !== null && !input.disabled
			},
			{ timeout: 60_000, polling: 1_000 },
		)
		await replaceInputValue(page, sel("send-amount-input"), "1")
		await replaceInputValue(page, `${sel("send-destination-field")} input`, await offCurveAddress())
		await waitForToast(page, "Couldn't estimate fee", 120_000, { kind: "error" })

		const at = await placement(page, sel("send-footer"))
		console.log(`[snack-placement] Send: ${Math.round(at.footerTop - at.snackBottom)}px above the footer`)
		expect(at.footerTop - at.snackBottom).toBeGreaterThanOrEqual(11.5)
		expect(at.footerTop - at.snackBottom).toBeLessThanOrEqual(12.5)

		const grown = await growFooter(page, sel("send-footer"), at)
		expect(grown.footerTop).toBeLessThanOrEqual(at.footerTop - 40)
		expect(grown.footerTop - grown.snackBottom).toBeGreaterThanOrEqual(11.5)
		expect(grown.footerTop - grown.snackBottom).toBeLessThanOrEqual(12.5)

		expect(tokenReadyExtension.pageErrors).toEqual([])
	},
)

test.skipIf(!hasConfig)(
	"the execute window: a fee-estimate error sits 12px above the approve/reject footer",
	{ timeout: 300_000 },
	async ({ dappConnectedExtensionWithTransactionCap }) => {
		const ctx = dappConnectedExtensionWithTransactionCap
		const config = aztecConfig as AztecTestConfig
		const pg = ctx.playgroundPage
		// A public transfer of 1,000,000 base units from an account that holds none fails the estimate.
		await pg.evaluate(
			({ token, recipient }: { token: string; recipient: string }) => {
				const setVal = (s: string, v: string) => {
					const input = document.querySelector<HTMLInputElement>(s)
					if (!input) return
					Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(input, v)
					input.dispatchEvent(new Event("input", { bubbles: true }))
				}
				setVal('[data-testid="pg-input-tokenAddress"]', token)
				setVal('[data-testid="pg-input-recipient"]', recipient)
				setVal('[data-testid="pg-input-amount"]', "1000000")
			},
			{ token: config.tokenAddress, recipient: config.minterAddress },
		)
		const executeP = waitForPopup(ctx, "execute", { timeout: 60_000 })
		await clickByTestId(pg, "pg-btn-sendTx-default")
		const execute = await executeP
		await waitForToast(execute, "Couldn't estimate fee", 180_000, { kind: "error" })

		const at = await placement(execute, sel("dapp-approval-footer"))
		console.log(`[snack-placement] execute: ${Math.round(at.footerTop - at.snackBottom)}px above the footer, ${at.width}px wide`)
		expect(at.footerTop - at.snackBottom).toBeGreaterThanOrEqual(11.5)
		expect(at.footerTop - at.snackBottom).toBeLessThanOrEqual(12.5)
		// The window centres the 360px column; the card spans it less 16px a side.
		expect(Math.abs(at.width - 328)).toBeLessThanOrEqual(0.5)
		expect(Math.abs(at.left + at.width / 2 - at.columnCentre)).toBeLessThanOrEqual(0.5)

		const grown = await growFooter(execute, sel("dapp-approval-footer"), at)
		expect(grown.footerTop).toBeLessThanOrEqual(at.footerTop - 40)
		expect(grown.footerTop - grown.snackBottom).toBeGreaterThanOrEqual(11.5)
		expect(grown.footerTop - grown.snackBottom).toBeLessThanOrEqual(12.5)

		// A 500px window over the 600px page: the footer starts below the fold.
		await execute.evaluate(() => document.querySelector('[data-testid="e2e-footer-line"]')?.remove())
		await execute.setViewport({ width: 400, height: 500 })
		const short = await placementAtEnd(execute, FOOTER)
		console.log(`[snack-placement] 400x500 before scrolling: ${JSON.stringify(short)}`)
		expect(short.footerTop).toBeGreaterThanOrEqual(short.viewport)
		const hits = await hitsAfterScroll(execute, BUTTONS)
		console.log(`[snack-placement] 400x500 hits after the scroll: ${JSON.stringify(hits)}`)
		expect(hits.map((h) => h.covered)).toEqual([false, false])
		expect(hits[0]?.hit).toBe("execute-reject-btn")
		const scrolled = await placementAtEnd(execute, FOOTER)
		expect(scrolled.footerTop - scrolled.snackBottom).toBeCloseTo(12, 0)
		expect(scrolled.snackBottom).toBeCloseTo(short.snackBottom, 0)

		// The error line (a little taller than the real one, so the footer's top peeks onto the screen).
		await execute.evaluate(() => window.scrollTo(0, 0))
		await addFooterLine(execute, FOOTER, 18)
		const lined = await placementAtEnd(execute, FOOTER)
		console.log(`[snack-placement] 400x500 with the error line: ${JSON.stringify(lined)}`)
		expect(lined.inset).toBeGreaterThanOrEqual(short.inset + 27.5)
		const linedHits = await hitsAfterScroll(execute, BUTTONS)
		expect(linedHits.map((h) => h.covered)).toEqual([false, false])
		expect(linedHits[0]?.hit).toBe("execute-reject-btn")

		expect(ctx.pageErrors).toEqual([])
	},
)
