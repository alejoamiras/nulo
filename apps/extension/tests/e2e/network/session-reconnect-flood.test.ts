import { expect, inject } from "vitest"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { openPlayground } from "../fixtures/playground"
import { approveDiscover, approveVerify, countVerifyWindows, waitForPopup } from "../fixtures/popups"
import { switchToLocalNetwork } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * A remembered, untrusted origin reconnecting from several tabs at once is admitted through the
 * origin's verify-window budget: two verify windows at most, the third handshake served as soon as
 * one closes, the fourth only once the reconnect bucket refills (sized well inside the dApp's 60 s
 * discovery timeout). Nothing is rejected and no tab hangs.
 */
test.skipIf(!hasConfig)(
	"session-reconnect-flood — four reconnects: two verify windows, the rest served on close and refill",
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

		const firstClickAt = Date.now()
		for (const tab of tabs) await clickByTestId(tab, "pg-btn-connect")

		// The first two reconnects open their windows and connect; the other two wait.
		await connected(tabs[0], 30_000)
		await connected(tabs[1], 30_000)
		await new Promise((r) => setTimeout(r, 3_000))
		expect(countVerifyWindows(ctx)).toBe(2)
		for (const waiting of [tabs[2], tabs[3]]) {
			const status = await waiting.$eval('[data-testid="pg-status"]', (el) => el.getAttribute("data-status"))
			expect(status).not.toBe("connected")
		}

		// Arm the wait for the third window BEFORE closing the open ones, then approve both.
		const thirdWindow = waitForPopup(ctx, "verify", { timeout: 30_000 })
		const open = ctx.browser.targets().filter((t) => t.type() === "page" && t.url().includes("#/windows/verify"))
		for (const target of open) await approveVerify(await target.asPage())

		// A freed slot serves the third at once; the fourth needs the reconnect bucket to refill.
		await connected(tabs[2], 30_000)
		const third = await thirdWindow
		expect(countVerifyWindows(ctx)).toBeLessThanOrEqual(2)
		const fourthWindow = waitForPopup(ctx, "verify", { timeout: 60_000 })
		await approveVerify(third)
		await connected(tabs[3], 60_000)
		expect(Date.now() - firstClickAt).toBeGreaterThanOrEqual(15_000)
		expect(countVerifyWindows(ctx)).toBeLessThanOrEqual(2)
		await approveVerify(await fourthWindow)

		for (const tab of tabs) await tab.close()
	},
)
