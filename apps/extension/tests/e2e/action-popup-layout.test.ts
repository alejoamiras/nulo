/**
 * The toolbar popup, as Firefox renders it: in a panel, which lays a document out differently from
 * the window every other test opens the popup in. Firefox only — no protocol opens Chrome's.
 */
import { expect, vi } from "vitest"
import { isFirefox } from "./fixtures/browser"
import { evaluateInActionPopup, openActionPopup } from "./fixtures/browser/firefox-action-popup"
import { test } from "./fixtures/extension"

interface Layout {
	hash: string
	viewportHeight: number
	shellHeight: number
	navBottom: number
}

const MEASURE = `
	const doc = content.document;
	const box = (selector) => doc.querySelector(selector)?.getBoundingClientRect();
	return {
		hash: content.location.hash,
		viewportHeight: content.innerHeight,
		shellHeight: Math.round(box("#app")?.height ?? -1),
		navBottom: Math.round(box('[data-testid="bottom-nav"]')?.bottom ?? -1),
	};`

const clickTab = (tab: string) => `content.document.querySelector('[data-testid="nav-${tab}"]')?.click(); return null;`

/**
 * Firefox re-measures a panel after DOM changes, once at once and once ~100 ms later, and a page
 * keeps growing while its data loads — so one good reading proves nothing. Every reading across
 * the window has to agree.
 */
const SETTLE_SAMPLES_MS = [0, 150, 300, 600, 1_200]
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test.skipIf(!isFirefox)("the bottom nav stays on the popup's bottom edge on every tab", async ({ registeredExtensionPerTest: ctx }) => {
	await openActionPopup(ctx.browser)
	const measure = () => evaluateInActionPopup<Layout>(ctx.browser, MEASURE)

	// A popup that has just opened passes through the lock screen while the session is restored,
	// so "on this tab" means on it, nav mounted, three readings running.
	const onTab = async (tab: string) => {
		let streak = 0
		await vi.waitFor(
			async () => {
				const { hash, navBottom } = await measure()
				streak = hash === `#/popup/${tab}` && navBottom > 0 ? streak + 1 : 0
				expect(streak, `settling on ${tab}, last seen ${hash}`).toBeGreaterThanOrEqual(3)
			},
			{ timeout: 20_000, interval: 250 },
		)
	}
	await onTab("general")

	// Each tab's page is a different height, which is what used to move the nav.
	for (const tab of ["holdings", "activity", "settings", "general"]) {
		await evaluateInActionPopup(ctx.browser, clickTab(tab))
		await onTab(tab)

		for (const wait of SETTLE_SAMPLES_MS) {
			await sleep(wait)
			const layout = await measure()
			expect(layout, `${tab} +${wait}ms`).toMatchObject({
				hash: `#/popup/${tab}`,
				shellHeight: layout.viewportHeight,
				navBottom: layout.viewportHeight,
			})
		}
	}
})
