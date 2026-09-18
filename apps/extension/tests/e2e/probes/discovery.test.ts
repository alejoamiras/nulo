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
	const created: string[] = []
	const changed: string[] = []
	const onCreated = (target: { url(): string }) => created.push(target.url())
	const onChanged = (target: { url(): string }) => changed.push(target.url())
	ctx.browser.on("targetcreated", onCreated)
	ctx.browser.on("targetchanged", onChanged)
	try {
		// NOT `pages()[0]`: that is the browser's own startup page, which `launchExtension`
		// deliberately leaves alone, and `chrome.*` does not exist in its realm.
		const page = await openPopup(ctx)
		const isProbe = (t: { url(): string }) => t.url().includes("probe=t")
		// Settled rather than awaited: each capability is reported on its own, because a finder can
		// be rebuilt on whichever of them holds, and a throw here would hide the ones after it.
		const waited = ctx.browser.waitForTarget(isProbe, { timeout: 15_000 }).then(
			() => true,
			() => false,
		)

		await page.evaluate(() =>
			chrome.windows.create({ type: "popup", width: 420, height: 640, url: chrome.runtime.getURL("src/popup/index.html?probe=t") }),
		)

		let listed = ctx.browser.targets().filter(isProbe)
		for (let i = 0; listed.length === 0 && i < 60; i++) {
			await new Promise((resolve) => setTimeout(resolve, 250))
			listed = ctx.browser.targets().filter(isProbe)
		}
		const opened = await listed[0]?.page()
		const facts = {
			"targets() lists it": listed.length === 1,
			"type is page": listed[0]?.type() === "page",
			"page is scriptable": (await opened?.evaluate(() => typeof chrome?.runtime?.id).catch(() => undefined)) === "string",
			"waitForTarget resolves by url": await waited,
			"targetcreated carries the url": created.some((url) => url.includes("probe=t")),
			"targetchanged carries the url": changed.some((url) => url.includes("probe=t")),
		}
		const failed = Object.entries(facts)
			.filter(([, ok]) => !ok)
			.map(([name]) => name)
		console.log(`PROBE T facts (${BROWSER}) ${JSON.stringify(facts)} created=${JSON.stringify(created.map((u) => u.slice(0, 20)))}`)
		console.log(failed.length === 0 ? `PROBE T PASS (${BROWSER})` : `PROBE T FAIL (${BROWSER}): ${failed.join("; ")}`)

		// The kill line is reachability, not which API reached it: a window nothing can list or
		// script ends the plan, while a missing event only decides how the finders are written.
		expect(facts["targets() lists it"] && facts["type is page"] && facts["page is scriptable"]).toBe(true)
	} finally {
		ctx.browser.off("targetcreated", onCreated)
		ctx.browser.off("targetchanged", onChanged)
		await ctx.close()
	}
})
