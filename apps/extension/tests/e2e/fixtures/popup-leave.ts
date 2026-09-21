/**
 * Headless Chrome's rAF throttling can freeze a Vue `<Transition>` mid-leave: the store has closed
 * the popup, the trap is released, and the DOM still stands. `closeStuckPopup` (helpers.ts) clears
 * the whole `#popup` layer for that; this is the scoped form for a popup that closed over another.
 */
import type { Page } from "puppeteer"

/** After a popup's own close control: wait for its DOM to leave — or, since headless Chrome's rAF
 *  throttling can freeze a `<Transition>` mid-leave, for the leave to have begun, then finish it by
 *  hand. Scoped to the popup that holds `innerTestId`, so the popups beneath it stay. Returns whether
 *  the leave had to be forced. The store-side close is what the leave class proves; the trap release
 *  that goes with it is the next Tab's business, not this helper's. */
export async function settleClosedPopup(page: Page, innerTestId: string): Promise<boolean> {
	const inner = `[data-testid="${innerTestId}"]`
	await page.waitForFunction(
		(s: string) => {
			const el = document.querySelector(s)
			if (!el) return true
			const wrapper = [...document.querySelectorAll("#popup > *")].find((w) => w.contains(el))
			return Boolean(wrapper && /leave/.test(wrapper.className))
		},
		{ timeout: 10_000, polling: 100 },
		inner,
	)
	return page.evaluate((s: string) => {
		const el = document.querySelector(s)
		if (!el) return false
		;[...document.querySelectorAll("#popup > *")].find((w) => w.contains(el))?.remove()
		for (const d of document.querySelectorAll("[class*='dark_bg'i]")) if (/leave/.test(d.className)) d.remove()
		return true
	}, inner)
}
