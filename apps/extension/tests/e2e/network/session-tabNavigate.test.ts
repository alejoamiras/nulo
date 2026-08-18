import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { openPlayground } from "../fixtures/playground"
import { waitForPopup, approveDiscover, approveVerify } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #42 — cross-origin navigation terminates the wallet-sdk transport
 * session but does NOT delete the persisted DappSession.
 *
 * Per `wireTabLifecycle` (`wallet-sdk/tab-lifecycle.ts`: the
 * `chrome.tabs.onUpdated` cross-origin filter), navigation to a different
 * origin tears down the secure-channel transport but keeps the DappSession
 * record in storage. On reconnect (from any tab on the playground origin), the
 * canonical flow (`handleDiscovery`'s returning-session auto-approve in
 * `background.ts`) auto-approves discover and re-pops verify (since
 * `trustedVerification=false` for the default `approveVerify` fixture path).
 *
 * Same-origin SPA hash navigations do NOT terminate (per the upstream PR #56
 * comment block in `background.ts`); only true cross-origin navs do.
 */
test.skipIf(!hasConfig)(
	"session-tabNavigate — cross-origin nav auto-approves discover, re-pops verify",
	{ timeout: 90_000 },
	async ({ registeredExtensionPerTest }) => {
		// First connect on the playground origin
		const dappPage = await openPlayground(registeredExtensionPerTest)
		const discoverP = waitForPopup(registeredExtensionPerTest, "discover", { timeout: 30_000 })
		await clickByTestId(dappPage, "pg-btn-connect")
		await approveDiscover(await discoverP)
		const verifyPage = await waitForPopup(registeredExtensionPerTest, "verify", { timeout: 30_000 })
		await approveVerify(verifyPage)
		await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })

		// Navigate the same tab to a different origin — terminates transport, DappSession persists
		await dappPage.goto("about:blank", { waitUntil: "domcontentloaded" })

		// Open a fresh playground tab to reconnect. Snapshot existing targets so we
		// can assert no NEW discover popup opened during the reconnect window.
		const dappPage2 = await openPlayground(registeredExtensionPerTest)
		const targetsBeforeReconnect = registeredExtensionPerTest.browser.targets().map((t) => t.url())

		// Reconnect: discover should auto-approve, verify should re-pop.
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

		await dappPage.close()
		await dappPage2.close()
	},
)
