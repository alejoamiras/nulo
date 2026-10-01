import { AztecAddress } from "@aztec-labs/aztec.js/addresses"
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node"
import type { Page } from "puppeteer"
import { describe, expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { reloadExtensionPage } from "../fixtures/browser"
import { clickByTestId, grantCapBundle, openPopup, test, waitForHash, type ExtensionContext } from "../fixtures/extension"
import { ensureUnlocked, lockWallet, switchToLocalNetwork } from "../fixtures/helpers"
import { registerPasskeyProfile, setupPasskeyVirtualAuth } from "../fixtures/passkey"
import { assertPgOk, callExpectingNoPopup, openPlayground, selectPgBundle, setPgInput, setPgTextarea } from "../fixtures/playground"
import { approveConnect, approveVerify, waitForPopup } from "../fixtures/popups"
import { serializeInstance } from "../fixtures/selfpay-phase"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/**
 * A dApp that asks to connect while the wallet is locked: the discovery queues (no window while
 * locked), the unlock drains it into the connect window, and the session that opens serves every
 * method the app uses, from the same page and from a reloaded one. Run for a password unlock and a
 * passkey unlock, which open the session through different paths.
 */
async function connectWhileLocked(ctx: ExtensionContext, unlock: () => Promise<void>): Promise<Page> {
	const dappPage = await openPlayground(ctx)
	await clickByTestId(dappPage, "pg-btn-connect")

	await new Promise((r) => setTimeout(r, 1_500))
	expect(ctx.browser.targets().some((t) => t.url().includes("#/windows/discover"))).toBe(false)

	const discoverP = waitForPopup(ctx, "discover", { timeout: 30_000 })
	await unlock()
	await approveVerify(await approveConnect(ctx, await discoverP))
	await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })
	return dappPage
}

/** The suite's token as a dApp registers it: the node's instance, serialized for the playground. */
async function tokenInstanceJson(): Promise<string> {
	const node = createAztecNodeClient(aztecConfig!.nodeUrl)
	const instance = await node.getContract(AztecAddress.fromStringUnsafe(aztecConfig!.tokenAddress))
	if (!instance) throw new Error(`token ${aztecConfig!.tokenAddress} not found at the node`)
	return serializeInstance(instance)
}

/** getAccounts, registerContract, a utility read and simulateTx all answer ok, with no window. */
async function expectSessionServes(ctx: ExtensionContext, page: Page, account: string, label: string): Promise<void> {
	const accounts = await callExpectingNoPopup(ctx, page, "getAccounts", () => clickByTestId(page, "pg-btn-getAccounts"))
	await assertPgOk(page, accounts, `${label}:getAccounts`)
	expect((accounts.resultJson as Array<{ item: string }>).map((a) => a.item.toLowerCase())).toContain(account.toLowerCase())

	await setPgTextarea(page, "phase-tokenInstance", await tokenInstanceJson())
	const registered = await callExpectingNoPopup(ctx, page, "phase.register", () => clickByTestId(page, "pg-btn-phase-register"), 60_000)
	await assertPgOk(page, registered, `${label}:registerContract`)
	// balance_of_private is a utility function; the playground's own executeUtility button reads
	// balance_of_public, which is public and fails on every session.
	const utility = await callExpectingNoPopup(ctx, page, "phase.balance", () => clickByTestId(page, "pg-btn-phase-balance"), 90_000)
	await assertPgOk(page, utility, `${label}:executeUtility`)

	await setPgInput(page, "tokenAddress", aztecConfig!.tokenAddress)
	await setPgInput(page, "recipient", aztecConfig!.minterAddress)
	// Zero moves nothing, so the simulation needs no balance on a never-sent account.
	await setPgInput(page, "amount", "0")
	const simulation = await callExpectingNoPopup(ctx, page, "simulateTx", () => clickByTestId(page, "pg-btn-simulateTx-transfer"), 120_000)
	await assertPgOk(page, simulation, `${label}:simulateTx`)
}

/** Reload the app, reconnect through the remembered session's emoji check, and re-ask for the
 *  accounts bundle: already granted, so it answers without a window. */
async function reconnectAfterReload(ctx: ExtensionContext, page: Page, label: string): Promise<void> {
	await reloadExtensionPage(page)
	await page.waitForSelector('[data-testid="pg-btn-connect"]', { visible: true, timeout: 30_000 })
	const verifyP = waitForPopup(ctx, "verify", { timeout: 30_000 })
	await clickByTestId(page, "pg-btn-connect")
	await approveVerify(await verifyP)
	await page.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })
	await selectPgBundle(page, "accounts")
	const caps = await callExpectingNoPopup(ctx, page, "requestCapabilities", () => clickByTestId(page, "pg-btn-requestCapabilities"))
	await assertPgOk(page, caps, `${label}:requestCapabilities after reload`)
}

const firstAccount = async (accountIds: (string | null)[]): Promise<string[]> => {
	const address = accountIds[0]
	if (!address) throw new Error("capabilities popup returned no accounts")
	return [address]
}

/** The whole flow after the wallet is unlocked from a queued discovery. */
async function expectLockedConnectServes(ctx: ExtensionContext, unlock: () => Promise<void>, label: string): Promise<void> {
	const page = await connectWhileLocked(ctx, unlock)
	const [account] = await grantCapBundle(ctx, page, "accounts", firstAccount)
	await expectSessionServes(ctx, page, account!, label)

	await reconnectAfterReload(ctx, page, label)
	await expectSessionServes(ctx, page, account!, `${label}:reload`)
	await page.close()
}

describe("connect-locked-queue — discovery queued while locked, drained on unlock", () => {
	test.skipIf(!hasConfig)(
		"connect-locked-queue — password unlock: the drained connection serves every method, also after a reload",
		{ timeout: 300_000 },
		async ({ registeredExtensionPerTest }) => {
			const ctx = registeredExtensionPerTest
			const popup = await openPopup(ctx)
			await waitForHash(popup, "#/popup/general")
			await switchToLocalNetwork(popup)
			await lockWallet(popup)

			await expectLockedConnectServes(ctx, () => ensureUnlocked(popup), "password")
			await popup.close()
		},
	)

	test.skipIf(!hasConfig)(
		"connect-locked-queue — passkey unlock: the drained connection serves every method, also after a reload",
		{ timeout: 300_000 },
		async ({ freshExtensionPerTest }) => {
			const ctx = freshExtensionPerTest
			// The credential lives on the page the authenticator was added to, so every ceremony
			// (register, then the unlock) runs in this one popup, kept open throughout.
			const anchor = await openPopup(ctx)
			const auth = await setupPasskeyVirtualAuth(ctx.browser, anchor)
			try {
				await registerPasskeyProfile(anchor)
				await switchToLocalNetwork(anchor)
				await lockWallet(anchor)

				const unlockWithPasskey = async () => {
					await anchor.waitForFunction(
						() => {
							const btn = document.querySelector<HTMLButtonElement>('[data-testid="auth-submit"]')
							return btn !== null && !btn.disabled
						},
						{ timeout: 15_000 },
					)
					await clickByTestId(anchor, "auth-submit")
					await waitForHash(anchor, "#/popup/general", 60_000)
				}
				await expectLockedConnectServes(ctx, unlockWithPasskey, "passkey")
			} finally {
				await auth.cleanup()
			}
		},
	)
})
