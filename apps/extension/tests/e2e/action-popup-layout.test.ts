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
	shellHeight: number | null
	navBottom: number | null
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

test.skipIf(!isFirefox)("the bottom nav stays on the popup's bottom edge on every tab", async ({ registeredExtensionPerTest: ctx }) => {
	await openActionPopup(ctx.browser)

	// Each tab's page is a different height, which is what used to move the nav.
	for (const tab of ["general", "holdings", "activity", "settings", "general"]) {
		await evaluateInActionPopup(ctx.browser, clickTab(tab))
		await vi.waitFor(
			async () => {
				const layout = await evaluateInActionPopup<Layout>(ctx.browser, MEASURE)
				expect(layout.hash).toBe(`#/popup/${tab}`)
				expect(layout, tab).toMatchObject({ shellHeight: layout.viewportHeight, navBottom: layout.viewportHeight })
			},
			{ timeout: 15_000, interval: 250 },
		)
	}
})
