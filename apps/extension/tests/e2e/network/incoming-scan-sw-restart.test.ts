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
 * card count (after re-waiting for A's chip so the re-mounted feed is hydrated) → KILL the SW → deliver
 * receipt B while it's dead → reopen. An MV3 recycle does NOT lock the wallet — the session mirror in
 * chrome.storage.session survives and is restored on respawn (well within the 30-min TTL), so the popup
 * routes straight to #/popup/general with no re-auth; reaching general is the respawn proof, and the
 * service's init-time hydrateSchedulers() resumes the scan from the persisted cursor with no popup
 * interaction. Then assert the feed grew by EXACTLY ONE card (B, discovered by the resumed scan) and the
 * balance advanced to 1020.
 *
 * Limitation (accepted): no deterministic mid-page pause hook exists for the public scan (the e2e
 * incoming-poll-gate wires only the note arm), so the kill lands at a clean post-A-scan boundary. Mid-scan
 * / mid-reconcile crash windows are covered at the unit layer (service.scenarios.test.ts D6 suite).
 */
import { expect, inject } from "vitest"
import type { Page } from "puppeteer"
import { openPopup, test, waitForHash, type ExtensionContext } from "../fixtures/extension"
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

			// Snapshot the STABLE feed size (post-A) BEFORE the restart. Re-wait for A's chip first: navigating
			// back to activity re-mounts the feed, which hydrates its rows asynchronously — counting before that
			// settles would sample a stale/empty view and make the +1 delta below meaningless. The feed already
			// holds A's record (+ any mint record); B must add EXACTLY one on top.
			await navigateByHash(page, "#/popup/activity")
			await page.waitForFunction(
				() =>
					[...document.querySelectorAll('[data-testid="tx-incoming-kind-chip"]')].some(
						(c) => (c.textContent || "").trim() === "Public → Public",
					),
				{ timeout: 60_000, polling: 1_000 },
			)
			const cardsBefore = await countIncomingCards(page)
			console.log(`✓ receipt A scanned; balance 1000 → 1010; feed has ${cardsBefore} card(s) pre-restart`)

			// ── KILL the SW. An MV3 recycle does NOT lock the wallet: the session mirror (a SessionSecretBox) in
			//    chrome.storage.session survives the recycle and is silently restored on respawn — by design, so
			//    the popup reconnects mid-session without re-prompting (session-manager.ts). What must survive
			//    for the resume is the scan cursor + records + outbox in chrome.storage.local.
			await page.close()
			await stopServiceWorker(tokenReadyExtension)

			// ── Receipt B delivered WHILE the SW is dead — only a resumed scan can discover it.
			await transferPublicTokens(wallet, aztecConfig.tokenAddress, minter, walletAddress, 10n * D, feeOptions)

			// ── Recovery: reopen the popup. The respawned SW restores the session from chrome.storage.session
			//    (well within the 30-min TTL) and routes straight to #/popup/general — no re-auth. Reaching
			//    general is the respawn proof: it requires the fresh SW to have booted and completed the session
			//    check. On that init the service's hydrateSchedulers() rebuilds the scan schedulers from the
			//    tokens in storage — the exact SW-restart resume path (service.ts: "resume polling without
			//    waiting for an onTokenAdded event") — so the scan resumes from the persisted cursor and
			//    discovers B with no popup interaction and no unlock.
			const page2 = await openPopup(tokenReadyExtension)
			await waitForHash(page2, "#/popup/general", 60_000)
			console.log("✓ SW respawned + session restored (routed to general) after restart")

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
