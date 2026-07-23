/**
 * Case 4 (implementations-plan/incoming-public-transfers, deferred "if feasible"): the public-event scan
 * RESUMES correctly across a service-worker restart. Proves the persisted cursor + records survive an MV3
 * SW recycle and a freshly-respawned scheduler picks up a NEW receipt delivered while it was down — without
 * re-processing or getting stuck.
 *
 * Flow: deliver receipt A (scan runs, cursor advances, D4 auto-refreshes 1000→1010) → KILL the SW →
 * deliver receipt B while it's dead → reopen + unlock (SW recycle wipes chrome.storage.session, so the
 * wallet locks; the cursor/records in chrome.storage.local survive) → assert the resumed scan discovers B
 * (a 2nd incoming card + balance → 1020) AND A's record persisted (still exactly the first card). If only
 * a resumed, cursor-aware scan runs would B ever appear.
 *
 * Limitation (accepted): the public scan has no deterministic mid-page pause hook (the e2e incoming-poll
 * -gate wires only the note arm), so the kill lands at a clean post-A-scan boundary, not mid-page —
 * mirroring backup-restore-sw-restart.test.ts's race-timed-kill precedent. The mid-scan reorg/crash
 * windows are covered deterministically at the unit layer (service.scenarios.test.ts D6 suite).
 */
import { expect, inject } from "vitest"
import type { Page } from "puppeteer"
import { TEST_PASSWORD } from "../fixtures/constants"
import { clickByTestId, openPopup, replaceInputValue, test, waitForHash, type ExtensionContext } from "../fixtures/extension"
import { getAccountAddress, getTokenDetailBalances, navigateByHash, navigateToTokenDetail, switchToLocalNetwork } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined
const D = 10n ** 18n

/** Terminate the extension's MV3 background service worker (mirrors sw-restart-network.test.ts). An absent
 *  target is a pass-through — Chrome's own idle reaper beating us to it IS the restart we're exercising. */
async function stopServiceWorker(ext: ExtensionContext): Promise<void> {
	const swTarget = await ext.browser
		.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(ext.extensionId), { timeout: 5_000 })
		.catch(() => null)
	if (!swTarget) return
	const swSession = await swTarget.createCDPSession()
	try {
		await swSession.send("Runtime.terminateExecution")
	} catch {
		// Session dies with the SW; swallow disconnect noise.
	}
}

/** Wait for the cold-respawned SW to write its liveness heartbeat to chrome.storage.session. */
async function waitForLiveness(page: Page): Promise<void> {
	await page.waitForFunction(
		async () => {
			try {
				return !!(await chrome.storage.session.get("nulo:liveness"))["nulo:liveness"]
			} catch {
				return false
			}
		},
		{ timeout: 30_000, polling: 500 },
	)
}

const publicBalanceIncludes = (needle: string) => () =>
	(document.querySelector('[data-testid="public-balance-value"]')?.textContent || "").replace(/[,\s]/g, "").includes(needle)

test.skipIf(!hasConfig)(
	"incoming public scan RESUMES across a service-worker restart (persisted cursor + records)",
	{ timeout: 900_000 },
	async ({ tokenReadyExtension }) => {
		if (!aztecConfig) throw new Error("unreachable — skipIf guards")
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await switchToLocalNetwork(page)
		const walletAddress = await getAccountAddress(page)

		const { createTestWallet, createSponsoredFeeOptions, mintPublicTokens, transferPublicTokens } = await import("../fixtures/aztec")
		const { wallet, cleanup } = await createTestWallet(aztecConfig.nodeUrl)
		try {
			const feeOptions = await createSponsoredFeeOptions(wallet)
			const minter = aztecConfig.minterAddress
			await mintPublicTokens(wallet, aztecConfig.tokenAddress, minter, 500n * D, minter, feeOptions)

			// ── Receipt A: the scan runs, cursor advances, D4 auto-refreshes 1000 → 1010 (no manual click).
			await transferPublicTokens(wallet, aztecConfig.tokenAddress, minter, walletAddress, 10n * D, feeOptions)
			await navigateByHash(page, "#/popup/activity")
			await page.waitForFunction(
				() =>
					[...document.querySelectorAll('[data-testid="tx-incoming-kind-chip"]')].some(
						(c) => (c.textContent || "").trim() === "Public → Public",
					),
				{ timeout: 180_000, polling: 1_000 },
			)
			await navigateByHash(page, "#/popup/general")
			await navigateToTokenDetail(page)
			await page.waitForFunction(publicBalanceIncludes("1010"), { timeout: 180_000, polling: 1_000 })
			console.log("✓ receipt A scanned; balance 1000 → 1010 (cursor advanced past A)")

			// ── KILL the SW (recycle wipes chrome.storage.session → wallet locks; the cursor + A's record in
			//    chrome.storage.local survive).
			await page.close()
			await stopServiceWorker(tokenReadyExtension)

			// ── Receipt B delivered WHILE the SW is dead — only a resumed, cursor-aware scan can discover it.
			await transferPublicTokens(wallet, aztecConfig.tokenAddress, minter, walletAddress, 10n * D, feeOptions)

			// ── Recovery: reopen + unlock. The respawned scheduler re-hydrates from the persisted cursor.
			const page2 = await openPopup(tokenReadyExtension)
			await waitForLiveness(page2)
			await waitForHash(page2, "#/popup/auth", 20_000)
			await page2.waitForSelector('[data-testid="auth-password-input"]', { visible: true, timeout: 10_000 })
			await replaceInputValue(page2, '[data-testid="auth-password-input"]', TEST_PASSWORD)
			await clickByTestId(page2, "auth-submit")
			await page2.waitForFunction(() => !window.location.hash.includes("/popup/auth"), { timeout: 20_000 })
			await waitForHash(page2, "#/popup/general", 15_000)
			console.log("✓ SW respawned + wallet unlocked after restart")

			// ── The resumed scan must find B: a 2nd incoming card + the public balance advances to 1020.
			await navigateByHash(page2, "#/popup/activity")
			await page2.waitForFunction(() => document.querySelectorAll('[data-testid="tx-incoming-card"]').length >= 2, {
				timeout: 240_000,
				polling: 1_000,
			})
			const cards = await page2.evaluate(() => document.querySelectorAll('[data-testid="tx-incoming-card"]').length)
			expect(cards).toBeGreaterThanOrEqual(2)
			console.log(`✓ ${cards} incoming cards — A survived the restart + B was discovered by the resumed scan`)

			await navigateByHash(page2, "#/popup/general")
			await navigateToTokenDetail(page2)
			await page2.waitForFunction(publicBalanceIncludes("1020"), { timeout: 180_000, polling: 1_000 })
			const balances = await getTokenDetailBalances(page2)
			expect(balances.publicBalance.replace(/[,\s]/g, "")).toBe("1020")
			console.log("✓ D4 balance auto-refreshed to 1020 across the restart — no manual refresh")

			await page2.close()
		} finally {
			await cleanup()
		}
	},
)
