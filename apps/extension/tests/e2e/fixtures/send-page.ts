/**
 * The Send page from the outside: what it says a send publishes, and the one way to submit one.
 * Every real send in the suite goes through `submitSend`, which reads the fee-source tag, the
 * footer's action and the strip's `you` cell together and refuses to click while they disagree —
 * so each send is also a check that the gate and its two mirrors hold on the built extension.
 */
import type { Page } from "puppeteer"
import { pointerClick } from "../helpers/legal-drivers"
import { clickByTestId } from "./extension"
import type { FeeMethodSubtitle } from "./helpers"
import { settleClosedPopup } from "./popup-leave"

export type SendAction = "send" | "review"
export type Visibility = "hidden" | "public" | "exposed" | "unknown"

export interface SendView {
	/** `fee-settings-card[data-origin]`. */
	origin: string | null
	/** `send-fee-method-trigger[data-fee-method]` — may preview a saved pick while balances load. */
	method: string | null
	/** The tag's `data-notice-shape`; null when no tag is drawn. */
	tag: string | null
	/** The strip's three cells; null when there is nothing to send (no strip). */
	strip: { you: Visibility | null; to: string | null; amount: string | null } | null
	/** `send-submit[data-action]`; null when the footer holds no submit button (the get-gas takeover). */
	action: SendAction | null
	sheetOpen: boolean
}

export interface ReviewView {
	you: Visibility | null
	shape: string | null
	to: string | null
	amount: string | null
	/** `send-review-fee[data-payer]`. */
	payer: string | null
	remedyHref: string | null
	ready: boolean
}

const sel = (testid: string) => `[data-testid="${testid}"]`

export async function openSend(page: Page): Promise<void> {
	await clickByTestId(page, "actions-send")
	await page.waitForSelector(sel("send-from-type"), { timeout: 10_000 })
}

export async function readSendView(page: Page): Promise<SendView> {
	return page.evaluate(() => {
		const q = (t: string) => document.querySelector(`[data-testid="${t}"]`)
		const strip = q("send-publish-strip")
		return {
			origin: q("fee-settings-card")?.getAttribute("data-origin") ?? null,
			method: q("send-fee-method-trigger")?.getAttribute("data-fee-method") ?? null,
			tag: q("send-fee-privacy-notice")?.getAttribute("data-notice-shape") ?? null,
			strip: strip
				? {
						you: strip.getAttribute("data-you") as Visibility | null,
						to: strip.getAttribute("data-to"),
						amount: strip.getAttribute("data-amount"),
					}
				: null,
			action: (q("send-submit")?.getAttribute("data-action") as SendAction | null) ?? null,
			sheetOpen: q("send-review-sheet")?.getAttribute("data-open") === "true",
		}
	})
}

/** Tag ⇔ "Review send" ⇔ FEE PAYER: three readings of one fact. Anything else is a page at odds with itself. */
export function assertPublishInvariant(view: SendView): SendView {
	const tagged = view.tag !== null
	const gated = view.action === "review"
	const exposed = view.strip?.you === "exposed"
	if (tagged !== gated || gated !== exposed) {
		throw new Error(
			`the Send page disagrees with itself (tag ${view.tag}, action ${view.action}, you ${view.strip?.you}): ${JSON.stringify(view)}`,
		)
	}
	return view
}

/** Waits until the card, under `origin`, has settled on `method` — a default takes a balance read to
 *  land, so this is the signal, never a sleep. The returned view has passed the invariant. */
export async function waitForFee(page: Page, origin: "private" | "public", method: FeeMethodSubtitle, timeout = 90_000): Promise<SendView> {
	try {
		await page.waitForFunction(
			({ o, m }: { o: string; m: string }) =>
				document.querySelector('[data-testid="fee-settings-card"]')?.getAttribute("data-origin") === o &&
				document.querySelector('[data-testid="send-fee-method-trigger"]')?.getAttribute("data-fee-method") === m,
			{ timeout, polling: 250 },
			{ o: origin, m: method },
		)
	} catch (e) {
		throw new Error(
			`fee card never settled on ${method} under a ${origin} origin; it shows ${JSON.stringify(await readSendView(page))}`,
			{
				cause: e,
			},
		)
	}
	return assertPublishInvariant(await readSendView(page))
}

/** Waits for the tag to read `shape`, or to be gone (`null`). Returns the settled view, invariant checked. */
export async function waitForTag(page: Page, shape: string | null, timeout = 30_000): Promise<SendView> {
	await page.waitForFunction(
		(want: string | null) =>
			(document.querySelector('[data-testid="send-fee-privacy-notice"]')?.getAttribute("data-notice-shape") ?? null) === want,
		{ timeout, polling: 250 },
		shape,
	)
	return assertPublishInvariant(await readSendView(page))
}

export async function waitForReview(page: Page, open: boolean, timeout = 15_000): Promise<void> {
	await page.waitForFunction(
		(want: string) => document.querySelector('[data-testid="send-review-sheet"]')?.getAttribute("data-open") === want,
		{ timeout, polling: 100 },
		open ? "true" : "false",
	)
}

/** "Send now" is armed: `data-ready` set and the button enabled. */
export async function waitForReviewReady(page: Page, timeout = 15_000): Promise<void> {
	await page.waitForFunction(
		() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="send-review-submit"]')
			return Boolean(btn) && btn?.getAttribute("data-ready") === "true" && !btn?.disabled
		},
		{ timeout, polling: 100 },
	)
}

export async function readReview(page: Page): Promise<ReviewView> {
	return page.evaluate(() => {
		const q = (t: string) => document.querySelector(`[data-testid="${t}"]`)
		const you = q("send-review-row-you")
		return {
			you: (you?.getAttribute("data-visibility") as Visibility | null) ?? null,
			shape: you?.getAttribute("data-notice-shape") ?? null,
			to: q("send-review-row-to")?.getAttribute("data-visibility") ?? null,
			amount: q("send-review-row-amount")?.getAttribute("data-visibility") ?? null,
			payer: q("send-review-fee")?.getAttribute("data-payer") ?? null,
			remedyHref: q("send-fee-privacy-remedy")?.getAttribute("href") ?? null,
			ready: q("send-review-submit")?.getAttribute("data-ready") === "true",
		}
	})
}

/** The strip is a real button: a hit-tested click, so nothing may sit over it. */
export async function openReviewFromStrip(page: Page): Promise<void> {
	await pointerClick(page, "send-publish-strip")
	await waitForReview(page, true)
}

/** The sheet is closed in the store and its DOM has left — finished by hand when the leave transition sticks. */
export async function waitForReviewClosed(page: Page): Promise<void> {
	await waitForReview(page, false)
	await settleClosedPopup(page, "send-review-submit")
}

export async function closeReview(page: Page): Promise<void> {
	await clickByTestId(page, "popup-close-btn")
	await waitForReviewClosed(page)
}

/**
 * Submits the filled form the way the footer offers it, and only that way. `expect` is the caller's
 * claim about the gate; a footer that offers the other action is a failed test, not a detour.
 * "send" is the ordinary in-page click; "review" is a real click on "Review send", the sheet, the
 * arming wait, then a real click on "Send now". The toast is the caller's to wait for.
 */
export async function submitSend(page: Page, opts: { expect: SendAction }): Promise<SendView> {
	const view = assertPublishInvariant(await readSendView(page))
	if (view.action !== opts.expect) {
		throw new Error(`expected the footer to offer "${opts.expect}", it offers "${view.action}": ${JSON.stringify(view)}`)
	}
	if (opts.expect === "send") {
		await page.evaluate(() => document.querySelector('[data-testid="send-submit"]')?.scrollIntoView({ block: "center" }))
		await clickByTestId(page, "send-submit")
		if ((await readSendView(page)).sheetOpen) throw new Error("a send nobody gated opened the review sheet")
		return view
	}
	await pointerClick(page, "send-submit")
	await waitForReview(page, true)
	await waitForReviewReady(page)
	await pointerClick(page, "send-review-submit")
	return view
}

/** The page has left: the form is gone. */
export async function waitForSendGone(page: Page, timeout = 10_000): Promise<void> {
	await page.waitForFunction(() => !document.querySelector('[data-testid="send-destination-field"]'), { timeout })
}

/** The form's two values. A destination that matched a contact or account becomes a card on blur,
 *  so the recipient is the typed text or the card's resolved address, whichever the field shows. */
export async function readSendInputs(page: Page): Promise<{ amount: string; destination: string }> {
	return page.evaluate(() => {
		const field = document.querySelector('[data-testid="send-destination-field"]')
		const card = field?.querySelector('[data-testid="recipient-card"]')
		return {
			amount: document.querySelector<HTMLInputElement>('[data-testid="send-amount-input"]')?.value ?? "",
			destination: card?.getAttribute("data-address") ?? field?.querySelector("input")?.value ?? "",
		}
	})
}

/** Opt-in capture of the popup (`NULO_E2E_SHOT_DIR`), both themes: a popup-surface change ships with a
 *  picture of it, and a colour token that only reads well on one theme is what a row count never sees. */
export async function shotSend(page: Page, name: string, focus = "send-publish-strip"): Promise<void> {
	const dir = process.env.NULO_E2E_SHOT_DIR
	if (!dir) return
	await page.evaluate((s: string) => document.querySelector(s)?.scrollIntoView({ block: "center" }), sel(focus))
	// A popup still entering is drawn part-way through its fade; a shot of it ghosts the page beneath.
	await page
		.waitForFunction(
			() =>
				![...document.querySelectorAll("#popup *, [class*='dark_bg'i]")].some((el) => /enter/.test(el.getAttribute("class") ?? "")),
			{ timeout: 3_000, polling: 100 },
		)
		.catch(() => undefined)
	await page.screenshot({ path: `${dir}/${name}.png` as `${string}.png` })
	const flipped = await page.evaluate(() => {
		const root = document.documentElement
		const was = root.getAttribute("theme")
		root.setAttribute("theme", was === "dark" ? "light" : "dark")
		return was
	})
	await page.screenshot({ path: `${dir}/${name}-${flipped === "dark" ? "light" : "dark"}.png` as `${string}.png` })
	await page.evaluate((was: string | null) => {
		if (was === null) document.documentElement.removeAttribute("theme")
		else document.documentElement.setAttribute("theme", was)
	}, flipped)
}
