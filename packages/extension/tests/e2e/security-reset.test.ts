import { expect } from "vitest"
import { test, openPopup, waitForHash } from "./fixtures/extension"
import { resetProfile } from "./fixtures/helpers"

// Reset deletes the only profile and lands on /popup/register. A file-scoped
// fixture would leak that wiped state into any subsequent test; use the
// per-test fixture so each reset starts from a fresh registered browser.
test("reset profile wipes state and routes to register", async ({ registeredExtensionPerTest }) => {
	const page = await openPopup(registeredExtensionPerTest)
	await waitForHash(page, "#/popup/general")

	await resetProfile(page)

	// With only one profile, deletion lands the user on /popup/register
	await page.waitForFunction(() => window.location.hash.includes("/popup/register"), { timeout: 10_000 })

	expect(registeredExtensionPerTest.pageErrors).toEqual([])
}, 30_000)
