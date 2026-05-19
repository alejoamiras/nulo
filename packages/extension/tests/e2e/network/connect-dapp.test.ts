import { expect, inject } from "vitest"
import { test, openPopup, waitForHash } from "../fixtures/extension"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #01 — connect-handshake.
 *
 * The dApp (local @nulo/playground) drives the full wallet-sdk handshake:
 *   discovery → /windows/discover (Allow) → ECDH key exchange →
 *   /windows/verify (OK) → playground status pill flips to "connected".
 *
 * This test only assumes the playground reaches "connected" and the wallet
 * popup remains usable on `#/popup/general`. Subsequent PRs add capability
 * grants and per-method tests on top of this fixture.
 */
test.skipIf(!hasConfig)(
	"connect-handshake — playground reaches connected via discover→verify",
	{ timeout: 90_000 },
	async ({ dappConnectedExtension }) => {
		// Verify the wallet popup is still usable
		const page = await openPopup(dappConnectedExtension)
		await waitForHash(page, "#/popup/general")
		await page.waitForSelector('[data-testid="account-selector"]', { visible: true, timeout: 10_000 })

		// Verify the playground side reached the connected state
		const status = await dappConnectedExtension.playgroundPage.evaluate(() =>
			document.querySelector('[data-testid="pg-status"]')?.getAttribute("data-status"),
		)
		expect(status).toBe("connected")

		expect(dappConnectedExtension.consoleErrors).toEqual([])
		expect(dappConnectedExtension.pageErrors).toEqual([])
		await page.close()
	},
)
