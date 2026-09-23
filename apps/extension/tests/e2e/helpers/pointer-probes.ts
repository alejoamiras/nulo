/**
 * Real-browser facts a page test cannot reach: what the pointer would hit, where the keyboard is.
 * Every probe reads the live document; none clicks (that is `pointerClick` in `legal-drivers.ts`).
 */
import type { Page } from "puppeteer"

const sel = (testid: string) => `[data-testid="${testid}"]`

/** What sits on top of the element at its centre — its testid or tag — or null when the element itself is hit. */
export async function coveredAt(page: Page, testid: string): Promise<string | null> {
	return page.evaluate((s) => {
		const el = document.querySelector(s)
		if (!el) throw new Error(`${s} not found`)
		const box = el.getBoundingClientRect()
		const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
		if (top && (el === top || el.contains(top))) return null
		return top?.getAttribute("data-testid") ?? top?.tagName ?? "nothing"
	}, sel(testid))
}

/** The named control focus is in — the focused element's own testid or its nearest named ancestor's
 *  (an `Input` names its wrapper, not the `<input>`) — or the bare tag when nothing above it is named. */
export async function activeTestId(page: Page): Promise<string> {
	return page.evaluate(() => {
		const el = document.activeElement
		return el?.closest("[data-testid]")?.getAttribute("data-testid") ?? el?.tagName ?? "none"
	})
}

/** Focus lands on the named control. A released focus trap hands focus back on a timer, not in the
 *  release itself, so a read straight after the close can beat it — this waits for the landing. */
export async function waitForFocus(page: Page, testid: string, timeout = 5_000): Promise<void> {
	await page
		.waitForFunction(
			(s: string) => document.activeElement?.closest("[data-testid]")?.getAttribute("data-testid") === s,
			{ timeout, polling: 50 },
			testid,
		)
		.catch(async (error: unknown) => {
			throw new Error(`focus did not land on ${testid} (on ${await activeTestId(page)}): ${String(error)}`)
		})
}

/** Whether focus is inside the popup that holds the named control (its wrapper under `#popup`). A Tab
 *  walk checked with this proves the keyboard never left; one that merely misses an outside control
 *  can pass after focus has escaped. */
export async function focusInPopupOf(page: Page, testid: string): Promise<boolean> {
	return page.evaluate((s) => {
		const el = document.querySelector(s)
		const wrapper = el && [...document.querySelectorAll("#popup > *")].find((w) => w.contains(el))
		return Boolean(wrapper && document.activeElement && wrapper.contains(document.activeElement))
	}, sel(testid))
}

/** Presses Tab `times` times and reports where focus landed after each press. */
export async function tabAround(page: Page, times: number): Promise<string[]> {
	const visited: string[] = []
	for (let i = 0; i < times; i++) {
		await page.keyboard.press("Tab")
		visited.push(await activeTestId(page))
	}
	return visited
}
