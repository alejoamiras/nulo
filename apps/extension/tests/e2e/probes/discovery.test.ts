import { expect, test } from "vitest"
import { BROWSER } from "../fixtures/browser"
import { launchExtension, openPopup } from "../fixtures/extension"

/**
 * PROBE T — does Puppeteer's target machinery see a window the EXTENSION opened?
 *
 * Every popup finder in this suite is built on `browser.targets()`, `waitForTarget()` and the
 * `targetcreated` event. On Chrome those are CDP facts. On Firefox they are whatever Puppeteer
 * synthesises from BiDi browsing contexts, and a window opened by `chrome.windows.create` is not
 * obviously one of them. If this probe passes, the finders run unchanged on both browsers; if it
 * fails, Firefox needs its own finder implementations and four separate behaviours have to be
 * rebuilt on BiDi events — which is a different, much larger phase.
 *
 * Deliberately not asserted here: that the window is *usable*, beyond one evaluate. Probes 1 and
 * 2 drive real approval windows; this one answers discovery only.
 */
test("PROBE T — an extension-opened window is discoverable through the target APIs", async () => {
	const ctx = await launchExtension()
	const seen: string[] = []
	const onCreated = (target: { url(): string }) => seen.push(target.url())
	ctx.browser.on("targetcreated", onCreated)
	try {
		// NOT `pages()[0]`: that is the browser's own startup page, which `launchExtension`
		// deliberately leaves alone, and `chrome.*` does not exist in its realm.
		const page = await openPopup(ctx)
		const appearing = ctx.browser.waitForTarget((t) => t.url().includes("probe=t"), { timeout: 20_000 })

		await page.evaluate(() =>
			chrome.windows.create({ type: "popup", width: 420, height: 640, url: chrome.runtime.getURL("src/popup/index.html?probe=t") }),
		)

		const target = await appearing
		expect(target.type()).toBe("page")
		expect(ctx.browser.targets().filter((t) => t.url().includes("probe=t"))).toHaveLength(1)
		expect(seen.some((url) => url.includes("probe=t"))).toBe(true)

		const opened = await target.page()
		expect(opened).not.toBeNull()
		expect(await opened?.evaluate(() => typeof chrome?.runtime?.id)).toBe("string")

		console.log(`PROBE T PASS (${BROWSER})`)
	} finally {
		ctx.browser.off("targetcreated", onCreated)
		await ctx.close()
	}
})
