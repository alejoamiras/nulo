/**
 * A private send whose gas balances cannot be read must never be DEFAULTED to the account's own
 * public Fee Juice — that payer names the sender, so the wallet only chooses it on a private
 * balance it positively read as zero. With the node unreachable nothing can be read, which is the
 * cheapest way to put the Send page in that state: no chain, no funded account.
 *
 * The smoke build pins the active network to Testnet; its RPC origin is refused at the browser
 * through CDP interception, so the run does not depend on the public endpoint being up or down.
 */
import { describe, expect } from "vitest"
import { clickByTestId, openPopup, test, waitForHash } from "./fixtures/extension"
import { interceptRpc } from "./helpers/rpc-intercept"

/** Origin of the Testnet seed (`DEFAULT_SEEDS` in the network service). */
const TESTNET_RPC_ORIGIN = "https://lb.drpc.live"

/** The card has settled once it either shows a method or explains why it shows none. Before that —
 *  a fresh profile has no saved pick to preview — neither is present, so no assertion below can pass
 *  against a card that simply has not resolved yet. */
const SETTLED = `(() => {
	const trigger = document.querySelector('[data-testid="send-fee-method-trigger"]')
	return Boolean(trigger?.getAttribute("data-fee-method")) || Boolean(document.querySelector('[data-testid="fee-init-degraded"]'))
})()`

describe("send fee privacy (dead RPC)", () => {
	test("a private send with unreadable balances never falls back to the public payer", { timeout: 180_000, retry: 0 }, async ({
		registeredExtensionPerTest: ctx,
	}) => {
		const interception = await interceptRpc(ctx.browser, ctx.extensionId, TESTNET_RPC_ORIGIN, { kind: "refuse" })
		try {
			const page = await openPopup(ctx)
			await waitForHash(page, "#/popup/general", 30_000)
			await clickByTestId(page, "actions-send")
			await page.waitForSelector('[data-testid="send-fee-method-trigger"]', { visible: true, timeout: 30_000 })

			// Private is the Send page's default origin — asserted, not assumed.
			const origin = await page.$eval('[data-testid="fee-settings-card"]', (el) => el.getAttribute("data-origin"))
			expect(origin).toBe("private")

			await page.waitForFunction(SETTLED, { timeout: 120_000, polling: 500 })

			const state = await page.evaluate(() => ({
				method: document.querySelector('[data-testid="send-fee-method-trigger"]')?.getAttribute("data-fee-method") ?? null,
				notice: Boolean(document.querySelector('[data-testid="send-fee-privacy-notice"]')),
				explained: Boolean(document.querySelector('[data-testid="fee-init-degraded"]')),
				takeover: Boolean(document.querySelector('[data-testid="send-get-fee-juice"]')),
			}))
			console.log(`[send-fee-privacy] settled: ${JSON.stringify(state)}`)

			expect(state.method).not.toBe("public")
			expect(state.notice).toBe(false)
			// Nothing was read, so nothing is known to be empty: no "you have no gas" takeover either.
			expect(state.takeover).toBe(false)
			// Either a payer that does not name the account, or no payer plus the reason why.
			expect(state.method !== null || state.explained).toBe(true)

			expect(interception.failures()).toEqual([])
			expect(interception.hits()).toBeGreaterThan(0)
			await page.close()
		} finally {
			await interception.stop()
		}
	})
})
