import { test, openPopup, waitForHash } from "./fixtures/extension"
import { lockWallet, ensureUnlocked } from "./fixtures/helpers"

test("lock wallet and unlock with password", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await lockWallet(page)

	// Close and reopen popup (fresh DOM after lock)
	await page.close()
	const page2 = await openPopup(registeredExtension)

	await waitForHash(page2, "#/popup/auth", 10_000)

	await ensureUnlocked(page2)

	await page2.waitForFunction(() => !window.location.hash.includes("/popup/auth"), { timeout: 10_000 })

	await page2.close()
})
