import { mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { SCHEMA_VERSION_KEY } from "@nulo/wallet-core/migration"
import type { Page } from "puppeteer"
import { expect, inject, test } from "vitest"
import { BROWSER, discoverExtensionId, launchBrowser, openScratchPage } from "../fixtures/browser"
import { listOwnedLaunches } from "../fixtures/browser/ownership"
import { launchExtension, openPopup } from "../fixtures/extension"
import { E2E_DATA_ROOT } from "../lockfile"

/**
 * PROBE R — does a second launch on the same profile behave the way `migration.test.ts` needs?
 *
 * That suite closes the browser mid-migration and relaunches on the same profile to prove the
 * engine resumes over surviving data. On Firefox the add-on is installed *temporarily* on every
 * launch, which fires `onInstalled` again — so storage survival, the extension origin and
 * first-run-tab behaviour all have to be measured rather than carried over from Chrome.
 *
 * A pass is evidence for this one suite's needs. It is NOT a claim that a temporary reinstall is
 * equivalent to a Chrome restart.
 */
test("PROBE R — storage survives a relaunch, and teardown leaves nothing owned behind", async () => {
	const profile = mkdtempSync(path.join(E2E_DATA_ROOT, "probe-r-"))
	const MARKER = "nulo:probe-r"
	const read = (page: Page, key: string) => page.evaluate(async (k: string) => (await chrome.storage.local.get(k))[k], key)
	try {
		const first = await launchExtension({ userDataDir: profile })
		let firstVersion: unknown
		try {
			// An extension page, NOT `pages()[0]` — the browser's startup page has no `chrome.*`.
			const page = await openPopup(first)
			await page.evaluate(async (key: string) => chrome.storage.local.set({ [key]: "written-on-first-launch" }), MARKER)
			firstVersion = await read(page, SCHEMA_VERSION_KEY)
		} finally {
			await first.close()
		}
		// Without this, two unstamped stores would compare equal and prove nothing.
		expect(typeof firstVersion).toBe("number")

		// Through the driver, not `launchExtension`: that fixture closes a first-run tab as part of
		// settling, which would erase the very thing being measured.
		const second = await launchBrowser({
			extensionPath: inject("extensionPath"),
			userDataDir: profile,
			headless: process.env.HEADLESS !== "0",
		})
		try {
			const extensionId = await discoverExtensionId(second.browser)
			// IndexedDB — the PXE store — is keyed by origin, so a relaunch that minted a new
			// extension origin would keep `storage.local` and still lose the wallet's data.
			expect(extensionId).toBe(first.extensionId)

			await new Promise((resolve) => setTimeout(resolve, 5_000))
			const firstRun = second.browser.targets().filter((t) => t.type() === "page" && t.url().includes("/src/onboarding/"))
			console.log(`PROBE R first-run tabs a relaunch opened (${BROWSER}): ${firstRun.length}`)

			const page = await openScratchPage(second.browser, extensionId, { freshProfile: false })
			expect(await read(page, MARKER)).toBe("written-on-first-launch")
			// A second boot must find the store already at the stamped version and run nothing. A
			// bumped version here would mean the relaunch was read as a fresh install.
			expect(await read(page, SCHEMA_VERSION_KEY)).toBe(firstVersion)
		} finally {
			await second.close()
		}

		// Only this run's records: another agent's live launch is legitimately on disk.
		expect(listOwnedLaunches().filter((record) => record.ownerPid === process.pid)).toEqual([])
		console.log(`PROBE R PASS (${BROWSER})`)
	} finally {
		rmSync(profile, { recursive: true, force: true })
	}
})
