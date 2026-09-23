import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { openPlayground } from "../fixtures/playground"
import { approveDiscover, approveVerify, countVerifyWindows, waitForPopup } from "../fixtures/popups"
import { switchToLocalNetwork } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * A remembered, untrusted origin reconnecting from four tabs at once is admitted through the
 * origin's verify-window budget: at most two verify windows exist at any moment (the security
 * property — the cap the reconnect gate enforces), the two beyond it wait rather than being
 * rejected, and once the open windows are approved every waiting tab connects. The precise
 * refill/close ordering is unit-tested deterministically; here the sandbox proves the cap holds
 * and no honest handshake is dropped, well inside the dApp's 60 s discovery window.
 */
test.skipIf(!hasConfig)(
	"session-reconnect-flood — four simultaneous reconnects never exceed two verify windows, none dropped",
	{ timeout: 180_000 },
	async ({ registeredExtensionPerTest }) => {
		const ctx = registeredExtensionPerTest
		const setupPage = await openPopup(ctx)
		await waitForHash(setupPage, "#/popup/general", 15_000)
		await switchToLocalNetwork(setupPage)
		await setupPage.close()

		// Remember the origin without trusting it, so every reconnect needs a verify window.
		const first = await openPlayground(ctx)
		const discoverP = waitForPopup(ctx, "discover", { timeout: 30_000 })
		await clickByTestId(first, "pg-btn-connect")
		await approveDiscover(await discoverP)
		await approveVerify(await waitForPopup(ctx, "verify", { timeout: 30_000 }))
		await first.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })
		await first.close()

		const tabs = [await openPlayground(ctx), await openPlayground(ctx), await openPlayground(ctx), await openPlayground(ctx)]
		const connected = (page: (typeof tabs)[number], timeout: number) =>
			page.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout })
		const statusOf = (page: (typeof tabs)[number]) => page.$eval('[data-testid="pg-status"]', (el) => el.getAttribute("data-status"))

		for (const tab of tabs) await clickByTestId(tab, "pg-btn-connect")

		// Two tabs open their verify windows and connect; the cap holds while they are open.
		await connected(tabs[0], 40_000)
		await connected(tabs[1], 40_000)
		await new Promise((r) => setTimeout(r, 2_000))
		expect(countVerifyWindows(ctx)).toBeLessThanOrEqual(2)
		const stillWaiting = (await Promise.all([statusOf(tabs[2]), statusOf(tabs[3])])).filter((s) => s !== "connected")
		expect(stillWaiting.length).toBeGreaterThanOrEqual(1)

		// Approve every verify window as it appears; the waiting handshakes are served (on window
		// close and the token refill) rather than rejected, and the cap is never exceeded meanwhile.
		// The SDK sends its key-exchange response BEFORE it runs the async establishment callback, so
		// a tab can report connected while its verify window has not appeared yet — meaning
		// `countVerifyWindows === 0` is transiently true before the last window opens. Exit only once
		// every tab is connected AND every tab's window has been approved (one approval per tab), so
		// the loop can never break with a window still unapproved.
		let approvals = 0
		const deadline = Date.now() + 120_000
		while (Date.now() < deadline) {
			expect(countVerifyWindows(ctx)).toBeLessThanOrEqual(2)
			const open = ctx.browser.targets().filter((t) => t.type() === "page" && t.url().includes("#/windows/verify"))
			for (const target of open) {
				await approveVerify(await target.asPage())
				approvals++
			}
			const statuses = await Promise.all(tabs.map(statusOf))
			if (statuses.every((s) => s === "connected") && approvals >= tabs.length && countVerifyWindows(ctx) === 0) break
			await new Promise((r) => setTimeout(r, 2_000))
		}

		for (const tab of tabs) await connected(tab, 5_000)
		expect(countVerifyWindows(ctx)).toBe(0)
		// The loop already gated its exit on four approvals; asserting it here documents the invariant
		// the flood must satisfy — four windows shown and approved, never more than two open at once.
		expect(approvals).toBeGreaterThanOrEqual(4)

		for (const tab of tabs) await tab.close()
	},
)
