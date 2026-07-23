/**
 * Case 4 (implementations-plan/incoming-public-transfers, deferred "if feasible"): the public-event scan
 * REHYDRATES + resumes across a service-worker restart. Delivers a NEW receipt while the SW is dead and
 * proves the respawned scheduler discovers it (exactly one new record) while the pre-restart records
 * persist — end-to-end, against real chrome.storage + a real MV3 recycle.
 *
 * Scope (honest): this is the INTEGRATION half. It proves durable records + scheduler rehydration + a new
 * receipt getting picked up. It does NOT by itself prove "resume from the PERSISTED cursor without
 * re-processing" — a buggy restart that rescanned from block 0 and PK-deduped the old records would look
 * identical here. That cursor-aware-resume property is proved deterministically at the unit layer:
 * service.scenarios.test.ts → "a fresh service instance resumes its scan from the PERSISTED cursor".
 *
 * Flow: deliver receipt A (scan runs, cursor advances, D4 auto-refreshes 1000→1010) → snapshot the feed's
 * card count + the SW liveness timestamp → KILL the SW → deliver receipt B while it's dead → reopen, wait
 * for a FRESHER liveness heartbeat (proves a real respawn, not the surviving pre-kill value), unlock (an
 * MV3 recycle drops the in-memory master secret, so strict mode closes the session and the wallet locks —
 * chrome.storage.session itself persists) → assert the feed grew by EXACTLY ONE card (B, discovered by the
 * resumed scan) and the balance advanced to 1020.
 *
 * Limitation (accepted): no deterministic mid-page pause hook exists for the public scan (the e2e
 * incoming-poll-gate wires only the note arm), so the kill lands at a clean post-A-scan boundary. Mid-scan
 * / mid-reconcile crash windows are covered at the unit layer (service.scenarios.test.ts D6 suite).
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

/** The runtime writes `nulo:liveness = clock.now()` on boot + heartbeat (runtime.ts). Read the current one. */
const readLiveness = (page: Page): Promise<number | undefined> =>
	page.evaluate(async () => {
		try {
			return (await chrome.storage.session.get("nulo:liveness"))["nulo:liveness"] as number | undefined
		} catch {
			return undefined
		}
	})

const countIncomingCards = (page: Page): Promise<number> =>
	page.evaluate(() => document.querySelectorAll('[data-testid="tx-incoming-card"]').length)

test.skipIf(!hasConfig)(
	"incoming public scan REHYDRATES + finds a new receipt across a service-worker restart",
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
			await page.waitForFunction(
				() =>
					(document.querySelector('[data-testid="public-balance-value"]')?.textContent || "")
						.replace(/[,\s]/g, "")
						.includes("1010"),
				{ timeout: 180_000, polling: 1_000 },
			)

			// Snapshot the STABLE feed size (post-A) + the last liveness beat, BEFORE the restart. The feed
			// already holds A's record (+ any mint record); B must add EXACTLY one on top.
			await navigateByHash(page, "#/popup/activity")
			const cardsBefore = await countIncomingCards(page)
			const livenessBefore = (await readLiveness(page)) ?? 0
			console.log(`✓ receipt A scanned; balance 1000 → 1010; feed has ${cardsBefore} card(s) pre-restart`)

			// ── KILL the SW. An MV3 recycle drops the in-memory master (→ strict mode locks the wallet); the
			//    cursor + records + outbox in chrome.storage.local survive.
			await page.close()
			await stopServiceWorker(tokenReadyExtension)

			// ── Receipt B delivered WHILE the SW is dead — only a resumed scan can discover it.
			await transferPublicTokens(wallet, aztecConfig.tokenAddress, minter, walletAddress, 10n * D, feeOptions)

			// ── Recovery: reopen, wait for a FRESHER liveness beat (a real respawn, not the surviving value),
			//    then unlock. The respawned scheduler re-hydrates from the persisted cursor.
			const page2 = await openPopup(tokenReadyExtension)
			await page2.waitForFunction(
				async (since) => {
					try {
						const v = (await chrome.storage.session.get("nulo:liveness"))["nulo:liveness"]
						return typeof v === "number" && v > (since as number)
					} catch {
						return false
					}
				},
				{ timeout: 45_000, polling: 500 },
				livenessBefore,
			)
			await waitForHash(page2, "#/popup/auth", 20_000)
			await page2.waitForSelector('[data-testid="auth-password-input"]', { visible: true, timeout: 10_000 })
			await replaceInputValue(page2, '[data-testid="auth-password-input"]', TEST_PASSWORD)
			await clickByTestId(page2, "auth-submit")
			await page2.waitForFunction(() => !window.location.hash.includes("/popup/auth"), { timeout: 20_000 })
			await waitForHash(page2, "#/popup/general", 15_000)
			console.log("✓ SW respawned (fresh liveness) + wallet unlocked after restart")

			// ── The resumed scan must add EXACTLY receipt B's record — cardsBefore + 1 (no more, no fewer:
			//    catches both a missed B and a spurious re-index of the pre-restart records).
			await navigateByHash(page2, "#/popup/activity")
			await page2.waitForFunction(
				(want) => document.querySelectorAll('[data-testid="tx-incoming-card"]').length >= (want as number),
				{
					timeout: 240_000,
					polling: 1_000,
				},
				cardsBefore + 1,
			)
			const cardsAfter = await countIncomingCards(page2)
			expect(cardsAfter).toBe(cardsBefore + 1)
			console.log(`✓ feed ${cardsBefore} → ${cardsAfter} — the resumed scan discovered exactly receipt B`)

			await navigateByHash(page2, "#/popup/general")
			await navigateToTokenDetail(page2)
			await page2.waitForFunction(
				() =>
					(document.querySelector('[data-testid="public-balance-value"]')?.textContent || "")
						.replace(/[,\s]/g, "")
						.includes("1020"),
				{ timeout: 180_000, polling: 1_000 },
			)
			const balances = await getTokenDetailBalances(page2)
			expect(balances.publicBalance.replace(/[,\s]/g, "")).toBe("1020")
			console.log("✓ balance 1010 → 1020 after the restart")

			await page2.close()
		} finally {
			await cleanup()
		}
	},
)
