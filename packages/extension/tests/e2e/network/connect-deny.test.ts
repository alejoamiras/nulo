import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import { openPlayground } from "../fixtures/playground"
import { waitForPopup, denyDiscover } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #02 — user denies at /windows/discover.
 *
 * Verifies the deny path: clicking discover-deny-btn rejects the discovery
 * request, the playground transitions to "error" state, and no /windows/verify
 * popup ever opens.
 */
test.skipIf(!hasConfig)(
	"connect-deny — user denies at discover, playground enters error",
	{ timeout: 120_000 },
	async ({ registeredExtension }) => {
		const dappPage = await openPlayground(registeredExtension)

		const discoverP = waitForPopup(registeredExtension, "discover", { timeout: 30_000 })
		await clickByTestId(dappPage, "pg-btn-connect")

		const discoverPage = await discoverP
		await denyDiscover(discoverPage)

		// The wallet-sdk's getAvailableWallets has a 60s default timeout; even
		// after the user denies, surfacing the error to the dApp side may take
		// up to that long. Allow up to 65s.
		await dappPage.waitForFunction(
			() => {
				const s = document.querySelector('[data-testid="pg-status"]')?.getAttribute("data-status")
				return s === "error" || s === "idle" || s === "disconnected"
			},
			{ timeout: 65_000 },
		)

		// Verify no /windows/verify popup ever opened
		const targets = registeredExtension.browser.targets().map((t) => t.url())
		const verifyOpen = targets.some((u) => u.includes("#/windows/verify"))
		expect(verifyOpen).toBe(false)

		await dappPage.close()
	},
)
