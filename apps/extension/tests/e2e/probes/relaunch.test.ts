import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { SCHEMA_VERSION_KEY } from "@nulo/wallet-core/migration"
import { expect, test } from "vitest"
import { BROWSER } from "../fixtures/browser"
import { listOwnedLaunches } from "../fixtures/browser/ownership"
import { E2E_DATA_ROOT } from "../lockfile"
import { launchExtension, openPopup } from "../fixtures/extension"

/**
 * PROBE R — does a second launch on the same profile behave the way `migration.test.ts` needs?
 *
 * That suite closes the browser mid-migration and relaunches on the same profile to prove the
 * engine resumes over surviving data. On Firefox the add-on is installed *temporarily* each
 * launch, which mints a new `moz-extension://` origin and fires `onInstalled` with reason
 * "install" every time — so neither storage survival nor first-run-tab behaviour can be assumed
 * from the Chrome experience. Both are measured here.
 *
 * A pass is evidence for this one suite's needs. It is NOT a claim that a temporary reinstall is
 * equivalent to a Chrome restart.
 */
test("PROBE R — storage survives a relaunch, and teardown leaves nothing owned behind", async () => {
	const profile = mkdtempSync(path.join(E2E_DATA_ROOT, "probe-r-"))
	const MARKER = "nulo:probe-r"
	try {
		const first = await launchExtension({ userDataDir: profile })
		const firstVersion = await (async () => {
			// An extension page, NOT `pages()[0]` — the browser's startup page has no `chrome.*`.
			const page = await openPopup(first)
			await page.evaluate(async (key: string) => {
				await chrome.storage.local.set({ [key]: "written-on-first-launch" })
			}, MARKER)
			return page.evaluate(async (key: string) => (await chrome.storage.local.get(key))[key], SCHEMA_VERSION_KEY)
		})()
		await first.close()

		const second = await launchExtension({ userDataDir: profile })
		try {
			const page = await openPopup(second)
			const survived = await page.evaluate(async (key: string) => (await chrome.storage.local.get(key))[key], MARKER)
			const secondVersion = await page.evaluate(async (key: string) => (await chrome.storage.local.get(key))[key], SCHEMA_VERSION_KEY)

			expect(survived).toBe("written-on-first-launch")
			// A second boot must find the store already at the stamped version and run nothing. A
			// bumped version here would mean the relaunch was read as a fresh install.
			expect(secondVersion).toBe(firstVersion)

			// Measured, not asserted: the Chrome suite assumes a relaunch opens no first-run tab, and
			// a temporary reinstall may well open one. Phase 5 needs the real answer, not a guess.
			const openedTabs = second.browser.targets().filter((t) => t.type() === "page" && t.url().includes("/src/onboarding/"))
			console.log(`PROBE R onboarding pages after relaunch (${BROWSER}): ${openedTabs.length}`)
		} finally {
			await second.close()
		}

		expect(listOwnedLaunches()).toEqual([])
		console.log(`PROBE R PASS (${BROWSER})`)
	} finally {
		rmSync(profile, { recursive: true, force: true })
	}
})
