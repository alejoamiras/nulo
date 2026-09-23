import { expect, inject } from "vitest"
import type { Page } from "puppeteer"
import { clickByTestId, connectPlayground, test } from "../fixtures/extension"
import { snapshotResultSeq, waitForPgResult, assertPgOk } from "../fixtures/playground"
import { waitForPopup, approveCapabilities } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * A dApp connecting on a chain the wallet has never activated.
 *
 * The e2e build seeds Testnet as the active network and the playground's default chainInfo
 * resolves to Local Network, so NOT switching first (every other connect fixture does) is exactly
 * the mismatch a user hits when an Alpha wallet meets a Testnet app. The wallet must provision the
 * Local Network default account on demand, list it, name the chain, and let the user either approve
 * as is or switch first.
 */
async function requestAccountsCapability(ctx: Parameters<typeof connectPlayground>[0], page: Page) {
	const fromSeq = await snapshotResultSeq(page)
	await page.evaluate(() => {
		const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
		select.value = "accounts"
		select.dispatchEvent(new Event("change", { bubbles: true }))
	})
	const popupP = waitForPopup(ctx, "capabilities", { timeout: 60_000 })
	await clickByTestId(page, "pg-btn-requestCapabilities")
	const popup = await popupP
	await popup.waitForSelector('[data-testid="cap-chain-banner"][data-state="mismatch"]', { timeout: 60_000 })
	const bannerText = await popup.$eval('[data-testid="cap-chain-banner"]', (el) => el.textContent ?? "")
	expect(bannerText).toContain("Connecting on Local Network")
	expect(bannerText).toContain("Your wallet is on Testnet")
	const accountIds = await popup.$$eval('[data-testid="cap-account-item"]', (rows) => rows.map((r) => r.getAttribute("data-account-id")))
	expect(accountIds).toHaveLength(1)
	return { popup, fromSeq, address: accountIds[0]! }
}

async function stripNetwork(popup: Page): Promise<string> {
	return popup.$eval('[data-testid="identity-network"]', (el) => el.textContent?.trim() ?? "")
}

async function approveAndAssertGranted(page: Page, popup: Page, fromSeq: number, address: string) {
	await approveCapabilities(popup, { accounts: [address] })
	const result = await waitForPgResult(page, "requestCapabilities", fromSeq, 30_000)
	await assertPgOk(page, result, "cap-chain-mismatch:result")
	const granted = await page.$$eval('[data-testid="pg-account-item"]', (items) => items.map((el) => el.getAttribute("data-account-id")))
	expect(granted).toContain(address)
}

test.skipIf(!hasConfig)(
	"cap-chain-mismatch — approve as is: the wallet stays on Testnet, the app gets the Local Network account",
	{ timeout: 180_000 },
	async ({ registeredExtensionPerTest }) => {
		const page = await connectPlayground(registeredExtensionPerTest)
		const { popup, fromSeq, address } = await requestAccountsCapability(registeredExtensionPerTest, page)
		// The window closes on approve — read the strip before deciding.
		expect(await stripNetwork(popup)).toBe("Testnet")
		await approveAndAssertGranted(page, popup, fromSeq, address)
	},
)

test.skipIf(!hasConfig)(
	"cap-chain-mismatch — switch first: the banner settles, the strip follows, the same account is granted",
	{ timeout: 180_000 },
	async ({ registeredExtensionPerTest }) => {
		const page = await connectPlayground(registeredExtensionPerTest)
		const { popup, fromSeq, address } = await requestAccountsCapability(registeredExtensionPerTest, page)
		await clickByTestId(popup, "cap-switch-network-btn")
		await popup.waitForSelector('[data-testid="cap-chain-banner"][data-state="switched"]', { timeout: 30_000 })
		await popup.waitForFunction(
			() => document.querySelector('[data-testid="identity-network"]')?.textContent?.trim() === "Local Network",
			{ timeout: 30_000, polling: 200 },
		)
		await approveAndAssertGranted(page, popup, fromSeq, address)
	},
)
