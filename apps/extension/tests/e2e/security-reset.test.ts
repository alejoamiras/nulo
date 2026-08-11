import { expect } from "vitest"
import { test, openPopup, waitForHash } from "./fixtures/extension"
import { captureSoleProfileId, resetProfile, waitForProfilePurged } from "./fixtures/helpers"

// Reset deletes the only profile and lands on /popup/register. A file-scoped
// fixture would leak that wiped state into any subsequent test; use the
// per-test fixture so each reset starts from a fresh registered browser.
//
// The reset UI AWAITS the full purge before navigating (reset.vue handleReset),
// so the purge's own completion signal is observed first and the redirect —
// prompt once the awaited delete resolved — after. The file budget covers
// nav-settle + purge + redirect sequentially.
test("reset profile wipes state and routes to register", async ({ registeredExtensionPerTest }) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general")

	const profileId = await captureSoleProfileId(page)
	await resetProfile(page)
	await waitForProfilePurged(page, profileId, { timeoutMs: 15_000 })

	// With only one profile, deletion lands the user on /popup/register
	await page.waitForFunction(() => window.location.hash.includes("/popup/register"), { timeout: 10_000 })

	expect(registeredExtensionPerTest.pageErrors).toEqual([])
}, 45_000)
