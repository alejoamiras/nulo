/** In a real browser: where a page or window has a bottom action row, an error snack sits at least
 *  12px above the row's top edge, so it never covers the row's buttons. */
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

type Placement = { snackTop: number; snackBottom: number; footerTop: number; left: number; width: number; innerWidth: number }

/** The settled card against the footer: the card rises 20px as it fades in. */
async function placement(page: Page, footer: string): Promise<Placement> {
	await page.waitForFunction(
		(s: string) => {
			const card = document.querySelector(s)
			return card !== null && getComputedStyle(card).opacity === "1" && card.getAnimations().length === 0
		},
		{ timeout: 10_000, polling: 50 },
		SNACK,
	)
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
				innerWidth: window.innerWidth,
			}
		},
		SNACK,
		footer,
	)
}

/** Grows the footer by one 40px line, as a wrapping error line does, and returns the new placement
 *  once the snack has followed it. */
async function growFooter(page: Page, footer: string, before: Placement): Promise<Placement> {
	await page.evaluate((f: string) => {
		const line = document.createElement("div")
		line.style.height = "40px"
		document.querySelector(f)?.prepend(line)
	}, footer)
	await page.waitForFunction(
		(s: string, top: number) => (document.querySelector(s)?.getBoundingClientRect().top ?? top) < top - 20,
		{ timeout: 5_000, polling: 50 },
		SNACK,
		before.snackTop,
	)
	return placement(page, footer)
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
		console.log(`[snack-placement] execute: ${Math.round(at.footerTop - at.snackBottom)}px above the footer`)
		expect(at.footerTop - at.snackBottom).toBeGreaterThanOrEqual(11.5)
		expect(at.footerTop - at.snackBottom).toBeLessThanOrEqual(12.5)

		const grown = await growFooter(execute, sel("dapp-approval-footer"), at)
		expect(grown.footerTop).toBeLessThanOrEqual(at.footerTop - 40)
		expect(grown.footerTop - grown.snackBottom).toBeGreaterThanOrEqual(11.5)
		expect(grown.footerTop - grown.snackBottom).toBeLessThanOrEqual(12.5)

		expect(ctx.pageErrors).toEqual([])
	},
)
