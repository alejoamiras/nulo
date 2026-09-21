import type { Browser, Page } from "puppeteer"
import { describe, expect, inject } from "vitest"
import { isFirefox, pxeHostState } from "../fixtures/browser"
import { type BackgroundIdentity, backgroundIdentity } from "../fixtures/browser/firefox"
import { TEST_PASSWORD } from "../fixtures/constants"
import { clickByTestId, openPopup, test, type ExtensionContext } from "../fixtures/extension"
import { ensureUnlocked, waitForLockScreen } from "../fixtures/helpers"
import { assertPgOk, openPlayground, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveVerify, waitForPopup } from "../fixtures/popups"
import { sendDefaultTx } from "../fixtures/send"
import { mintPublicTokensForAccount, type AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Resolves with the identity of a background page newer than `previous`, or rejects after `timeout` ms. */
async function waitForNewBackground(browser: Browser, previous: BackgroundIdentity, timeout: number): Promise<BackgroundIdentity> {
	const deadline = Date.now() + timeout
	for (;;) {
		const identity = await backgroundIdentity(browser).catch(() => undefined)
		if (identity && identity.timeOrigin !== previous.timeOrigin) return identity
		if (Date.now() > deadline) throw new Error(`no new background page after ${timeout}ms`)
		await sleep(250)
	}
}

/**
 * Assert the lock, unlock, open a fresh dApp page, connect, and re-request the granted bundle. The
 * lock is asserted first because `ensureUnlocked` succeeds on an already-unlocked wallet, which is
 * the regression this spec exists to catch. An approved origin is auto-approved at discovery; the
 * verify window re-fires only when the session was not trusted, so both endings are accepted.
 */
async function unlockAndReconnect(ctx: ExtensionContext): Promise<Page> {
	const popup = await openPopup(ctx)
	await waitForLockScreen(popup, 60_000)
	await ensureUnlocked(popup, TEST_PASSWORD, { decisionBudgetMs: 120_000 })
	await popup.waitForFunction(() => window.location.hash.includes("/popup/general"), { timeout: 120_000 })
	await popup.close()

	const page = await openPlayground(ctx)
	const verifyP = waitForPopup(ctx, "verify", { timeout: 30_000 }).catch(() => undefined)
	const connected = page.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 60_000 })
	await clickByTestId(page, "pg-btn-connect")
	const verify = await Promise.race([verifyP, connected.then(() => undefined)])
	if (verify) await approveVerify(verify)
	await connected

	await page.evaluate(() => {
		const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')
		if (!select) throw new Error("pg-bundle-select not present")
		select.value = "transaction"
		select.dispatchEvent(new Event("change", { bubbles: true }))
	})
	const seq = await snapshotResultSeq(page)
	await clickByTestId(page, "pg-btn-requestCapabilities")
	await assertPgOk(page, await waitForPgResult(page, "requestCapabilities", seq, 60_000), "firefox-background-restart:caps")
	return page
}

/**
 * The PXE host's lifetime rule on Firefox: it lives at most as long as the background page. After the
 * background ends the wallet is locked (strict security mode drops the session on any background
 * death, on both browsers, by design), and the first request after the unlock builds exactly one new
 * host. Chrome's offscreen document survives a worker restart; its restart path is covered by the
 * `CHROME_ONLY.backgroundKill` files.
 *
 * The background is ended with `runtime.reload()` from an extension page, which ends every other
 * extension page too (the dApp page is a web page and stays) — so what this pins is the locked state
 * and the recovery on a fresh background, not that the host alone dies with a terminated background.
 */
describe.skipIf(!isFirefox)("firefox — the PXE host dies with the background page", () => {
	test.skipIf(!hasConfig)(
		"firefox-background-restart — new background, no host, then unlock → reconnect → send on exactly one new host",
		{ timeout: 600_000 },
		async ({ dappConnectedExtensionWithTransactionCap: ctx }) => {
			await mintPublicTokensForAccount(aztecConfig!, ctx.accountAddress)
			await sendDefaultTx(ctx, ctx.playgroundPage, aztecConfig!, "firefox-background-restart:before")
			const before = await backgroundIdentity(ctx.browser)
			expect(before.hosts).toHaveLength(1)

			const popup = await openPopup(ctx)
			// The page this runs in dies with the reload, so the evaluation itself never returns cleanly.
			await popup.evaluate(() => chrome.runtime.reload()).catch(() => {})
			await popup.close().catch(() => {})
			const after = await waitForNewBackground(ctx.browser, before, 60_000)
			expect(after.hosts).toEqual([])

			await ctx.playgroundPage.close().catch(() => {})
			const page = await unlockAndReconnect(ctx)
			await sendDefaultTx(ctx, page, aztecConfig!, "firefox-background-restart:after", { popupTimeoutMs: 180_000 })

			const recovered = await backgroundIdentity(ctx.browser)
			expect(recovered.timeOrigin).toBe(after.timeOrigin)
			expect(recovered.hosts).toHaveLength(1)
			expect(recovered.hosts[0]).not.toBe(before.hosts[0])
			const check = await openPopup(ctx)
			try {
				expect(await pxeHostState(check)).toEqual({ count: 1, visibility: ["visible"] })
			} finally {
				await check.close().catch(() => {})
			}
		},
	)
})
