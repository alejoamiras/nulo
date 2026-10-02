import type { Page } from "puppeteer"
import { describe, expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { reloadExtensionPage } from "../fixtures/browser"
import { sessionChainsForOrigin } from "../fixtures/dappSession"
import { clickByTestId, grantCapBundle, openPopup, test, waitForHash, type ExtensionContext } from "../fixtures/extension"
import { deleteNetworkRow, navigateByHash, switchToLocalNetwork, switchToNetwork } from "../fixtures/helpers"
import { callExpectingNoPopup, openPlayground } from "../fixtures/playground"
import { approveConnect, approveVerify, waitForPopup, waitForPopupClosed } from "../fixtures/popups"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/** The V5 testnet's chain info: the wallet derives chain 1816023401 from it and has no such network. */
const V5_TESTNET = { chainId: "11155111", version: "1821665230" }

/**
 * A dApp that asks to connect on a chain the wallet has no network for gets no connection: the
 * user sees the network-unavailable notice where the connect window would open, the dApp hears
 * nothing, and no session is written. A connection whose network is deleted later gets the typed
 * 4901 refusal on its calls, and its next connect drops the remembered row and shows the notice.
 */
async function expectNotice(ctx: ExtensionContext, app: Page): Promise<void> {
	const opened = waitForPopup(ctx, "network-unavailable", { timeout: 30_000 })
	await clickByTestId(app, "pg-btn-connect")
	const notice = await opened
	for (const id of ["network-unavailable-title", "network-unavailable-body", "network-unavailable-hostname"]) {
		await notice.waitForSelector(`[data-testid="${id}"]`, { visible: true, timeout: 15_000 })
	}
	expect(ctx.browser.targets().some((t) => t.url().includes("#/windows/discover"))).toBe(false)
	await clickByTestId(notice, "network-unavailable-close-btn")
	await waitForPopupClosed(notice, 10_000)
	// Silence: the dApp is still waiting on its discovery, not connected and not refused.
	expect(await app.$eval('[data-testid="pg-status"]', (el) => el.getAttribute("data-status"))).toBe("discovering")
}

async function connectServed(ctx: ExtensionContext, app: Page): Promise<void> {
	const opened = waitForPopup(ctx, "discover", { timeout: 30_000 })
	await clickByTestId(app, "pg-btn-connect")
	await approveVerify(await approveConnect(ctx, await opened))
	await app.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })
	await grantCapBundle(ctx, app, "accounts", async (ids) => {
		if (!ids[0]) throw new Error("the capabilities window offered no account")
		return [ids[0]]
	})
}

describe("connect-unserved-chain — a dApp on a chain the wallet has no network for", () => {
	test.skipIf(!hasConfig)(
		"connect-unserved-chain — the notice replaces the connect window, no session is written, and the served chain still connects",
		{ timeout: 180_000 },
		async ({ registeredExtensionPerTest }) => {
			const ctx = registeredExtensionPerTest
			const popup = await openPopup(ctx)
			await waitForHash(popup, "#/popup/general")
			await switchToLocalNetwork(popup)

			const wrongChain = await openPlayground(ctx, { chainInfo: V5_TESTNET })
			const origin = await wrongChain.evaluate(() => location.origin)
			await expectNotice(ctx, wrongChain)
			expect(await sessionChainsForOrigin(ctx, origin)).toEqual([])

			const served = await openPlayground(ctx)
			await connectServed(ctx, served)
			expect(await sessionChainsForOrigin(ctx, origin)).toEqual(["0"])

			await served.close()
			await wrongChain.close()
			await popup.close()
		},
	)

	test.skipIf(!hasConfig)(
		"connect-unserved-chain — a deleted network: calls get the typed 4901, and the next connect drops the row and shows the notice",
		{ timeout: 240_000 },
		async ({ registeredExtensionPerTest }) => {
			const ctx = registeredExtensionPerTest
			const popup = await openPopup(ctx)
			await waitForHash(popup, "#/popup/general")
			await switchToLocalNetwork(popup)

			const app = await openPlayground(ctx)
			const origin = await app.evaluate(() => location.origin)
			await connectServed(ctx, app)

			await switchToNetwork(popup, "Testnet")
			await navigateByHash(popup, "#/popup/settings/networks")
			await deleteNetworkRow(popup, "Local Network")

			const accounts = await callExpectingNoPopup(ctx, app, "getAccounts", () => clickByTestId(app, "pg-btn-getAccounts"))
			expect(accounts.status).toBe("error")
			const payload = accounts.errorJson as string | { message?: string } | undefined
			const envelope = JSON.parse((typeof payload === "string" ? payload : payload?.message) ?? "null")
			expect(envelope).toEqual({ code: 4901, message: expect.any(String), data: { walletErrorCode: "CHAIN_NOT_SUPPORTED" } })
			expect(await sessionChainsForOrigin(ctx, origin)).toEqual(["0"])

			await reloadExtensionPage(app)
			await app.waitForSelector('[data-testid="pg-btn-connect"]', { visible: true, timeout: 30_000 })
			await expectNotice(ctx, app)
			expect(await sessionChainsForOrigin(ctx, origin)).toEqual([])

			await app.close()
			await popup.close()
		},
	)
})
