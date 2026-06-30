import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { openPlayground } from "../fixtures/playground"
import { waitForPopup, approveDiscover, approveVerify } from "../fixtures/popups"
import { switchToLocalNetwork } from "../fixtures/helpers"
import { openPopup, waitForHash } from "../fixtures/extension"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #04 — session reconnect parameterized.
 *
 *   alwaysTrust=false — second connect skips discover (auto-approved by
 *                       background.ts:280 when DappSession exists) but
 *                       SHOWS verify (because trustedVerification=false).
 *   alwaysTrust=true  — skips both discover AND verify.
 *
 * Codex audit caught: handleDiscovery auto-approves whenever a DappSession
 * exists, so a second connect from the same origin does NOT re-fire the
 * discover popup. Only verify gets surfaced if !trustedVerification.
 */
for (const alwaysTrust of [false, true]) {
	test.skipIf(!hasConfig)(
		`session-reconnect — alwaysTrust=${alwaysTrust} reconnect ${alwaysTrust ? "skips" : "shows"} verify`,
		{
			timeout: 120_000,
		},
		async ({ registeredExtensionPerTest }) => {
			// Switch to Local Network so the playground's chainInfo (Fr.ZERO = 0)
			// matches the wallet's active network.
			const setupPage = await openPopup(registeredExtensionPerTest)
			await waitForHash(setupPage, "#/popup/general", 15_000)
			await switchToLocalNetwork(setupPage)
			await setupPage.close()

			// First connect — full handshake with the alwaysTrust toggle as configured
			const dappPage = await openPlayground(registeredExtensionPerTest)
			const discoverP1 = waitForPopup(registeredExtensionPerTest, "discover", { timeout: 30_000 })
			await clickByTestId(dappPage, "pg-btn-connect")
			await approveDiscover(await discoverP1)
			const verifyPage1 = await waitForPopup(registeredExtensionPerTest, "verify", { timeout: 30_000 })
			await approveVerify(verifyPage1, { alwaysTrust })
			await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })

			// Disconnect from dApp side
			await clickByTestId(dappPage, "pg-btn-disconnect")
			await dappPage.waitForSelector('[data-testid="pg-status"][data-status="disconnected"]', { timeout: 10_000 })

			// Reload + reconnect — discovery is auto-approved (DappSession persists);
			// no /windows/discover popup should appear.
			await dappPage.reload({ waitUntil: "domcontentloaded" })
			await dappPage.waitForSelector('[data-testid="pg-status"]', { timeout: 10_000 })

			if (alwaysTrust) {
				// No discover popup, no verify popup — should reach connected directly.
				await clickByTestId(dappPage, "pg-btn-connect")
				await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 })

				// Sanity: assert no verify popup ever opened during the reconnect.
				const verifyOpened = registeredExtensionPerTest.browser.targets().some((t) => t.url().includes("#/windows/verify"))
				expect(verifyOpened).toBe(false)
			} else {
				// Discover auto-approves but verify pops because trustedVerification=false.
				const verifyP2 = waitForPopup(registeredExtensionPerTest, "verify", { timeout: 30_000 })
				await clickByTestId(dappPage, "pg-btn-connect")
				const verifyPage2 = await verifyP2
				await approveVerify(verifyPage2)
				await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })
			}

			await dappPage.close()
		},
	)
}
