import { expect, inject } from "vitest"
import { clickByTestId, test, openPopup, waitForHash } from "../fixtures/extension"
import { lockWallet, ensureUnlocked } from "../fixtures/helpers"
import { openPlayground } from "../fixtures/playground"
import { waitForPopup, approveDiscover, approveVerify } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #03 — wallet locked → discovery queued → drained on unlock.
 *
 * The dApp fires discovery while the wallet is locked. The DiscoveryQueue
 * (background.ts:7) holds it; once the user unlocks, `onActiveProfileChanged`
 * fires and the queue drains, opening the discover popup.
 */
test.skipIf(!hasConfig)(
	"connect-locked-queue — discovery queued while locked, drained on unlock",
	{ timeout: 90_000 },
	async ({ registeredExtensionPerTest }) => {
		// Lock the wallet first
		const popupPage = await openPopup(registeredExtensionPerTest)
		await waitForHash(popupPage, "#/popup/general")
		await lockWallet(popupPage)

		// Fire discovery — should be queued (no popup yet)
		const dappPage = await openPlayground(registeredExtensionPerTest)
		await clickByTestId(dappPage, "pg-btn-connect")

		// Give the SW a moment to enqueue
		await new Promise((r) => setTimeout(r, 1_500))
		const discoverOpenWhileLocked = registeredExtensionPerTest.browser.targets().some((t) => t.url().includes("#/windows/discover"))
		expect(discoverOpenWhileLocked).toBe(false)

		// Set up popup waiters BEFORE unlock so we don't miss them
		const discoverP = waitForPopup(registeredExtensionPerTest, "discover", { timeout: 30_000 })

		// Unlock — drains the queue, fires the discover popup
		await ensureUnlocked(popupPage)

		const discoverPage = await discoverP
		await approveDiscover(discoverPage)

		const verifyPage = await waitForPopup(registeredExtensionPerTest, "verify", { timeout: 15_000 })
		await approveVerify(verifyPage)

		await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })

		await dappPage.close()
		await popupPage.close()
	},
)
