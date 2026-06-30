import { expect, inject } from "vitest"
import { clickByTestId, test } from "../fixtures/extension"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * Test #43 — explicit dApp-initiated disconnect.
 *
 * The dApp calls `provider.disconnect()` after a successful handshake;
 * playground status flips to "disconnected" and `wallet` ref clears.
 * The extension's session record persists (so reconnect can be silent if
 * trustedVerification was set), but the dApp's wallet handle is gone.
 */
test.skipIf(!hasConfig)(
	"session-explicitDisconnect — playground transitions to disconnected on click",
	{ timeout: 60_000 },
	async ({ dappConnectedExtension }) => {
		const page = dappConnectedExtension.playgroundPage

		// Already connected via fixture — assert
		const statusBefore = await page.evaluate(() => document.querySelector('[data-testid="pg-status"]')?.getAttribute("data-status"))
		expect(statusBefore).toBe("connected")

		// Click disconnect
		await clickByTestId(page, "pg-btn-disconnect")

		await page.waitForSelector('[data-testid="pg-status"][data-status="disconnected"]', { timeout: 10_000 })

		// Account list should be empty after disconnect
		const accountCount = await page.evaluate(() => document.querySelectorAll('[data-testid="pg-account-item"]').length)
		// Empty state renders a single placeholder li; assert no real account-id rows
		const realAccounts = await page.evaluate(
			() =>
				[...document.querySelectorAll('[data-testid="pg-account-item"]')].filter((el) => el.getAttribute("data-account-id")).length,
		)
		expect(realAccounts).toBe(0)
		// (accountCount may be 1 placeholder)
		expect(accountCount).toBeLessThanOrEqual(1)
	},
)
