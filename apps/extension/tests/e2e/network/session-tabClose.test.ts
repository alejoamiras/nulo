import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { openPlayground } from "../fixtures/playground"
import { waitForPopup, approveDiscover, approveVerify } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #41 — closing the dApp tab terminates the wallet-sdk transport session
 * but does NOT delete the persisted DappSession.
 *
 * Per `background.ts:230-232` (`chrome.tabs.onRemoved` → `handler.terminateForTab`),
 * close-handling tears down the secure-channel transport but keeps the
 * DappSession record in storage. On reconnect from a fresh tab, the canonical
 * flow per `background.ts:295-298` auto-approves discover (DappSession exists
 * for origin + unlocked + non-expired) and re-pops verify only if
 * `trustedVerification=false`. The default `dappConnectedExtension` /
 * `approveVerify(...)` fixture path never sets `alwaysTrust=true`, so verify
 * WILL pop on reconnect.
 */
test.skipIf(!hasConfig)(
	"session-tabClose — close + reopen auto-approves discover, re-pops verify",
	{ timeout: 90_000 },
	async ({ registeredExtensionPerTest }) => {
		// First connect — full handshake, no alwaysTrust
		const dappPage = await openPlayground(registeredExtensionPerTest)
		const discoverP = waitForPopup(registeredExtensionPerTest, "discover", { timeout: 30_000 })
		await clickByTestId(dappPage, "pg-btn-connect")
		await approveDiscover(await discoverP)
		const verifyPage = await waitForPopup(registeredExtensionPerTest, "verify", { timeout: 30_000 })
		await approveVerify(verifyPage)
		await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })

		// Close the tab — terminates transport, DappSession persists
		await dappPage.close()

		// Open a fresh playground tab. Snapshot existing targets so we can assert
		// no NEW discover popup opened during the reconnect window.
		const dappPage2 = await openPlayground(registeredExtensionPerTest)
		const targetsBeforeReconnect = registeredExtensionPerTest.browser.targets().map((t) => t.url())

		// Reconnect: discover should auto-approve (DappSession exists for origin),
		// verify should re-pop (trustedVerification=false).
		const verifyP2 = waitForPopup(registeredExtensionPerTest, "verify", { timeout: 30_000 })
		await clickByTestId(dappPage2, "pg-btn-connect")
		const verifyPage2 = await verifyP2
		await approveVerify(verifyPage2)
		await dappPage2.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })

		// Sanity: no NEW discover popup target opened between the snapshot and now.
		const targetsAfterReconnect = registeredExtensionPerTest.browser.targets().map((t) => t.url())
		const newDiscoverTargets = targetsAfterReconnect.filter(
			(url) => url.includes("#/windows/discover") && !targetsBeforeReconnect.includes(url),
		)
		expect(newDiscoverTargets).toEqual([])

		await dappPage2.close()
	},
)
